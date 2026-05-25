#!/usr/bin/env node
/**
 * migrate-prod.ts — production migration runner with audit trail.
 *
 * Flow:
 *   1. Pre-flight: ensure _migrations table exists.
 *   2. List `packages/database/src/migrations/*.sql` sorted by filename.
 *   3. For each unapplied migration (tracked by numeric version + sha256):
 *        a. Begin tx.
 *        b. Execute sql.
 *        c. INSERT audit row into _migrations.
 *        d. Commit. On failure → rollback, abort, exit 1.
 *   4. Exit codes: 0 success, 1 error, 2 already-up-to-date.
 *   5. --dry-run prints the plan without mutating anything.
 *
 * Usage:
 *   tsx scripts/migrate-prod.ts [--dry-run] [--json]
 *
 * Environment:
 *   DATABASE_URL   required (must be set explicitly in production)
 *   OPERATOR_ENV   operator tag written to the audit row (e.g. 'ci', 'prod')
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import postgres from 'postgres';

const SAFE_MIGRATION_NAME = /^\d{4}[A-Za-z0-9_.-]*\.sql$/;

export interface MigrationEntry {
  readonly filename: string;
  readonly version: string;
  readonly sha256: string;
  readonly sql: string;
}

export interface MigrationPlan {
  readonly all: readonly MigrationEntry[];
  readonly applied: readonly string[];
  readonly pending: readonly MigrationEntry[];
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  readonly durationMs: number;
  readonly dryRun: boolean;
}

interface RunnerOpts {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly migrationsDir: string;
}

function parseOpts(argv: readonly string[]): RunnerOpts {
  const dryRun = argv.includes('--dry-run');
  const json = argv.includes('--json');
  const migrationsDir = resolve(
    process.cwd(),
    'packages/database/src/migrations',
  );
  return { dryRun, json, migrationsDir };
}

export async function loadMigrations(dir: string): Promise<MigrationEntry[]> {
  const entries = await readdir(dir);
  const valid = entries.filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
  const out: MigrationEntry[] = [];
  for (const name of valid) {
    if (!SAFE_MIGRATION_NAME.test(name)) {
      throw new Error(`Rejected unsafe migration filename: ${name}`);
    }
    const abs = resolve(dir, name);
    const rel = relative(dir, abs);
    if (rel.startsWith('..') || rel.includes('..')) {
      throw new Error(`Migration path escapes dir: ${name}`);
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- validated above
    const sql = await readFile(abs, 'utf8');
    const version = name.replace(/\.sql$/, '');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    out.push({ filename: name, version, sha256, sql });
  }
  return out;
}

export async function ensureMigrationsTable(
  sql: postgres.Sql<Record<string, unknown>>,
): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      version       TEXT        PRIMARY KEY,
      applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms   INTEGER     NOT NULL,
      sha256        TEXT        NOT NULL,
      operator_env  TEXT        NOT NULL DEFAULT 'unknown'
    )
  `;
}

export async function listApplied(
  sql: postgres.Sql<Record<string, unknown>>,
): Promise<string[]> {
  const rows = await sql<{ version: string }[]>`
    SELECT version FROM _migrations ORDER BY version ASC
  `;
  return rows.map((r) => r.version);
}

export function planMigrations(
  all: readonly MigrationEntry[],
  applied: readonly string[],
): MigrationPlan {
  const appliedSet = new Set(applied);
  const pending = all.filter((m) => !appliedSet.has(m.version));
  return { all, applied, pending };
}

export async function runMigrations(
  connectionString: string,
  opts: RunnerOpts,
): Promise<{ plan: MigrationPlan; result: MigrationResult }> {
  const start = Date.now();
  const all = await loadMigrations(opts.migrationsDir);
  const sql = postgres(connectionString, { max: 2, onnotice: () => {} });
  try {
    await ensureMigrationsTable(sql);
    const applied = await listApplied(sql);
    const plan = planMigrations(all, applied);

    if (opts.dryRun) {
      return {
        plan,
        result: {
          applied: [],
          skipped: plan.pending.map((m) => m.filename),
          durationMs: Date.now() - start,
          dryRun: true,
        },
      };
    }

    const operatorEnv = process.env.OPERATOR_ENV
      ?? process.env.NODE_ENV
      ?? 'unknown';
    const newlyApplied: string[] = [];
    for (const m of plan.pending) {
      const runStart = Date.now();
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(m.sql);
          await tx`
            INSERT INTO _migrations (version, duration_ms, sha256, operator_env)
            VALUES (${m.version}, ${Date.now() - runStart}, ${m.sha256}, ${operatorEnv})
          `;
        });
        newlyApplied.push(m.filename);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`migration ${m.filename} failed: ${msg}`);
      }
    }

    return {
      plan,
      result: {
        applied: newlyApplied,
        skipped: [],
        durationMs: Date.now() - start,
        dryRun: false,
      },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const opts = parseOpts(process.argv.slice(2));
  const dsn = process.env.DATABASE_URL;
  if (!dsn && process.env.NODE_ENV === 'production') {
    process.stderr.write('DATABASE_URL is required in production\n');
    process.exit(1);
  }
  const connectionString = dsn ?? 'postgresql://localhost:5432/borjie';
  try {
    const { plan, result } = await runMigrations(connectionString, opts);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ plan: {
        total: plan.all.length,
        applied: plan.applied.length,
        pending: plan.pending.map((m) => m.filename),
      }, result })}\n`);
    } else {
      process.stdout.write(
        `migrations: total=${plan.all.length} already-applied=${plan.applied.length} ` +
        `pending=${plan.pending.length}\n`,
      );
      for (const f of result.applied) process.stdout.write(`  applied: ${f}\n`);
      for (const f of result.skipped) process.stdout.write(`  would-apply: ${f}\n`);
    }
    if (plan.pending.length === 0) process.exit(2);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`migrate-prod failed: ${msg}\n`);
    process.exit(1);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void main();
}

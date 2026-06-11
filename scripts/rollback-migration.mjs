#!/usr/bin/env node
/**
 * rollback-migration.mjs — scripted, drilled migration rollback.
 *
 * The founder decides WHEN to roll back; this script is the HOW. It consumes
 * the down-migration registry (packages/database/src/migrations/down/_registry.json)
 * to reverse the last N *applied* migrations, reading the applied set from the
 * production runner's `_migrations` tracking table (the same table
 * scripts/migrate-prod.ts writes — version = filename minus `.sql`).
 *
 * SAFETY MODEL (fail-safe by construction):
 *   - DRY-RUN by default. Prints the exact down SQL it WOULD run plus the
 *     dataLoss flag per step, and mutates nothing. You must pass --apply to
 *     execute.
 *   - REFUSES to apply any registry entry marked `dataLoss: true` unless
 *     --force is ALSO passed. (--apply alone is not enough for a destructive
 *     down.)
 *   - Verifies the down SQL file exists on disk before it would run a step;
 *     a missing file aborts the plan (no partial rollback).
 *   - Honest-degrade: if an applied migration has NO entry in the registry,
 *     the step is reported as a GAP (no down script known) and the plan stops
 *     at the first gap — it never guesses a reverse.
 *   - Each step runs in its own transaction: execute the down SQL, then delete
 *     the `_migrations` row for that version, then COMMIT. A failure rolls that
 *     step back and aborts the rest (rollback is strictly last-applied-first).
 *
 * USAGE:
 *   node scripts/rollback-migration.mjs                 # dry-run, last 1
 *   node scripts/rollback-migration.mjs --count=3       # dry-run, last 3
 *   node scripts/rollback-migration.mjs --apply         # execute last 1 (non-dataLoss only)
 *   node scripts/rollback-migration.mjs --apply --force # execute, allow dataLoss
 *   node scripts/rollback-migration.mjs --json          # machine-readable plan
 *
 * ENVIRONMENT:
 *   DATABASE_URL   required — connection string for the target database.
 *
 * EXIT CODES:
 *   0  success (dry-run printed, or --apply completed)
 *   1  error (DB unreachable, missing down file, gap in plan, apply failure,
 *      or a dataLoss step blocked without --force)
 *   2  nothing to roll back (no applied migrations / count exceeds applied set
 *      in a benign way is still 0; this code is reserved for "_migrations table
 *      absent")
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(
  __dirname,
  '..',
  'packages',
  'database',
  'src',
  'migrations',
);
const REGISTRY_PATH = join(MIGRATIONS_DIR, 'down', '_registry.json');

// ---------------------------------------------------------------------------
// CLI parsing (pure)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const force = argv.includes('--force');
  const json = argv.includes('--json');
  let count = 1;
  for (const raw of argv) {
    if (raw === '-n' || raw === '--count' || raw.startsWith('--count=')) {
      const inline = raw.includes('=') ? raw.split('=')[1] : undefined;
      const value = inline ?? argv[argv.indexOf(raw) + 1];
      const parsed = Number.parseInt(value ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) count = parsed;
    }
  }
  return { apply, force, json, count };
}

// ---------------------------------------------------------------------------
// Registry (pure)
// ---------------------------------------------------------------------------

/**
 * Build a lookup from up-migration version (filename minus `.sql`) to its
 * registry entry. The registry keys `up` WITH the `.sql` extension; the
 * `_migrations` table stores the version WITHOUT it — normalise to the
 * extension-less version so the two reconcile.
 */
export function indexRegistry(registry) {
  const byVersion = new Map();
  for (const entry of registry.mappings ?? []) {
    const version = String(entry.up ?? '').replace(/\.sql$/, '');
    if (version.length === 0) continue;
    byVersion.set(version, entry);
  }
  return byVersion;
}

/**
 * Compose the rollback plan: the last `count` applied versions (descending —
 * newest first), each resolved against the registry. Pure; does no IO.
 *
 * Returns { steps, firstGapIndex } where each step is:
 *   { version, entry|null, downRelPath|null, dataLoss, gap }
 */
export function composePlan(appliedVersions, byVersion, count) {
  // applied comes back ASC from the DB; reverse to newest-first.
  const newestFirst = [...appliedVersions].reverse();
  const target = newestFirst.slice(0, count);
  const steps = target.map((version) => {
    const entry = byVersion.get(version) ?? null;
    if (entry === null) {
      return {
        version,
        entry: null,
        downRelPath: null,
        dataLoss: false,
        gap: true,
      };
    }
    return {
      version,
      entry,
      downRelPath: entry.down, // e.g. "down/0343_down_oauth_state_nonces.sql"
      dataLoss: entry.dataLoss === true,
      gap: false,
    };
  });
  const firstGapIndex = steps.findIndex((s) => s.gap);
  return { steps, firstGapIndex };
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadRegistry() {
  const raw = await readFile(REGISTRY_PATH, 'utf8');
  return JSON.parse(raw);
}

async function ensureMigrationsTable(sql) {
  // The `_migrations` ledger is created by scripts/migrate-prod.ts on first
  // run. If it does not exist, there is nothing applied to reverse.
  const rows = await sql`
    SELECT to_regclass('public._migrations') AS reg
  `;
  return rows[0]?.reg != null;
}

async function listApplied(sql) {
  const rows = await sql`
    SELECT version FROM _migrations ORDER BY version ASC
  `;
  return rows.map((r) => r.version);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function printHeader({ apply, force, count }) {
  const mode = apply ? (force ? 'APPLY (--force)' : 'APPLY') : 'DRY-RUN';
  console.log('='.repeat(72));
  console.log(`rollback-migration — mode=${mode} count=${count}`);
  console.log('='.repeat(72));
}

function printStep(index, step, downSql) {
  const n = index + 1;
  if (step.gap) {
    console.log(
      `\n[${n}] ${step.version}  ⚠ GAP — no down entry in _registry.json`,
    );
    console.log(
      '     This migration has no documented reverse. The plan stops here;',
    );
    console.log(
      '     reverse it by hand or add a registry mapping + down script.',
    );
    return;
  }
  const loss = step.dataLoss ? '  ‼ dataLoss:true' : '';
  console.log(`\n[${n}] ${step.version}  → ${step.downRelPath}${loss}`);
  if (step.entry?.reverses) {
    console.log(`     reverses: ${step.entry.reverses}`);
  }
  if (downSql != null) {
    const indented = downSql
      .trimEnd()
      .split('\n')
      .map((l) => `       │ ${l}`)
      .join('\n');
    console.log('     down SQL:');
    console.log(indented);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dsn = process.env.DATABASE_URL?.trim();
  if (!dsn) {
    process.stderr.write('[rollback] DATABASE_URL is required\n');
    process.exit(1);
  }

  let registry;
  try {
    registry = await loadRegistry();
  } catch (err) {
    process.stderr.write(
      `[rollback] failed to read registry: ${err?.message ?? String(err)}\n`,
    );
    process.exit(1);
  }
  const byVersion = indexRegistry(registry);

  const sql = postgres(dsn, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const hasTable = await ensureMigrationsTable(sql);
    if (!hasTable) {
      process.stderr.write(
        '[rollback] _migrations table absent — nothing has been applied via the runner.\n',
      );
      process.exit(2);
    }
    const applied = await listApplied(sql);
    if (applied.length === 0) {
      process.stderr.write('[rollback] no applied migrations to reverse.\n');
      process.exit(2);
    }

    const { steps, firstGapIndex } = composePlan(applied, byVersion, opts.count);

    // Pre-flight: resolve down SQL for each non-gap step and verify the file
    // exists BEFORE we would mutate anything.
    const resolved = [];
    for (const step of steps) {
      if (step.gap) {
        resolved.push({ step, downSql: null, downAbs: null });
        continue;
      }
      const downAbs = resolve(MIGRATIONS_DIR, step.downRelPath);
      const exists = await fileExists(downAbs);
      if (!exists) {
        resolved.push({ step, downSql: null, downAbs, missing: true });
        continue;
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from the in-repo registry
      const downSql = await readFile(downAbs, 'utf8');
      resolved.push({ step, downSql, downAbs });
    }

    // JSON plan output (machine-readable) takes the dry-run path regardless.
    if (opts.json) {
      const plan = resolved.map(({ step, downAbs, missing }) => ({
        version: step.version,
        down: step.downRelPath,
        dataLoss: step.dataLoss,
        gap: step.gap,
        downFilePresent: step.gap ? null : missing !== true,
        downAbsPath: downAbs,
      }));
      const blockedByDataLoss = resolved.some(
        ({ step }) => step.dataLoss && opts.apply && !opts.force,
      );
      console.log(
        JSON.stringify(
          {
            mode: opts.apply ? (opts.force ? 'apply-force' : 'apply') : 'dry-run',
            count: opts.count,
            appliedTotal: applied.length,
            firstGapIndex,
            blockedByDataLoss,
            steps: plan,
          },
          null,
          2,
        ),
      );
      // JSON mode is always a plan preview — never mutates.
      await sql.end({ timeout: 5 });
      process.exit(firstGapIndex === 0 ? 1 : 0);
    }

    printHeader(opts);

    // Print every step (human plan).
    resolved.forEach(({ step, downSql }, i) => printStep(i, step, downSql));

    // Gate checks (applied to the WHOLE plan before any execution).
    const gapBlocked = firstGapIndex !== -1;
    const missingFile = resolved.find((r) => r.missing);
    const dataLossSteps = resolved.filter(({ step }) => step.dataLoss);
    const dataLossBlocked =
      opts.apply && !opts.force && dataLossSteps.length > 0;

    console.log(`\n${'-'.repeat(72)}`);
    if (gapBlocked) {
      console.log(
        `BLOCKED: step ${firstGapIndex + 1} is a registry GAP — no down script. ` +
          'Add a registry mapping or reverse by hand.',
      );
    }
    if (missingFile) {
      console.log(
        `BLOCKED: down file missing on disk for ${missingFile.step.version} ` +
          `(${missingFile.step.downRelPath}).`,
      );
    }
    if (dataLossBlocked) {
      const list = dataLossSteps.map((r) => r.step.version).join(', ');
      console.log(
        `BLOCKED: ${dataLossSteps.length} step(s) are dataLoss:true (${list}). ` +
          'Re-run with --force to allow the destructive down.',
      );
    }

    if (!opts.apply) {
      console.log(
        '\nDRY-RUN only — nothing was changed. Re-run with --apply to execute' +
          (dataLossSteps.length > 0 ? ' (add --force for the dataLoss steps).' : '.'),
      );
      await sql.end({ timeout: 5 });
      process.exit(gapBlocked || missingFile ? 1 : 0);
    }

    // --apply path. Hard-stop on any blocker.
    if (gapBlocked || missingFile || dataLossBlocked) {
      console.log('\nABORTED: a gate above blocks this rollback. No changes made.');
      await sql.end({ timeout: 5 });
      process.exit(1);
    }

    console.log('\nAPPLYING rollback (last-applied-first)…');
    for (const { step, downSql } of resolved) {
      const start = Date.now();
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(downSql);
          await tx`DELETE FROM _migrations WHERE version = ${step.version}`;
        });
        console.log(
          `  reversed: ${step.version} (${Date.now() - start}ms)`,
        );
      } catch (err) {
        const msg = err?.message ?? String(err);
        process.stderr.write(
          `[rollback] FAILED reversing ${step.version}: ${msg}\n`,
        );
        process.stderr.write(
          '[rollback] this step rolled back; earlier steps (if any) are committed. ' +
            'Rollback stops here.\n',
        );
        await sql.end({ timeout: 5 });
        process.exit(1);
      }
    }

    console.log(`\nDONE — reversed ${resolved.length} migration(s).`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err) {
    const msg = err?.message ?? String(err);
    process.stderr.write(`[rollback] fatal: ${msg}\n`);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* swallow */
    }
    process.exit(1);
  }
}

// Execute only when invoked directly; importers (tests) get the named exports.
const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main();
}

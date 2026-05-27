#!/usr/bin/env node
/**
 * verify-migrations.ts — Drizzle migration ledger drift detector.
 *
 * Closes KI-001 in Docs/KNOWN_ISSUES.md: the `drizzle.__drizzle_migrations`
 * table can record a migration hash as applied while the CREATE TABLE
 * statements inside it never actually ran (partial rollback, manual DB
 * surgery, restore-from-backup that predates the migration). Drizzle
 * itself does NOT detect this — it skips any migration whose hash is
 * in the ledger, so subsequent `db:migrate` runs cannot recover.
 *
 * Strategy:
 *
 *   1. Discover every *.sql migration file under
 *      packages/database/src/migrations/ and packages/database/drizzle/
 *      (whichever exists — both paths are supported because the repo's
 *      drizzle.config.ts emits to src/migrations but the historical
 *      directory at drizzle/ still holds the bulk of files).
 *
 *   2. For each file, extract the relations it is expected to create
 *      via best-effort regex over:
 *        - CREATE TABLE [IF NOT EXISTS] <name> ...
 *        - CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name> ON ...
 *        - CREATE TYPE <name> AS ENUM ...
 *      This is NOT a full SQL parser — it tolerates DO $$ blocks,
 *      schema-qualified names, quoted identifiers, and trailing
 *      WHERE/USING clauses. Statements it cannot parse are recorded
 *      as "?" (skipped) — they degrade gracefully to no-op.
 *
 *   3. Connect to DATABASE_URL via the postgres-js client (already a
 *      top-level dep of @borjie/database). For each migration whose
 *      hash exists in drizzle.__drizzle_migrations, verify every
 *      extracted relation actually exists in information_schema
 *      (tables for CREATE TABLE, pg_indexes for CREATE INDEX, pg_type
 *      for CREATE TYPE).
 *
 *   4. Print a single report line per migration:
 *        ✓ <name>           — all expected relations present
 *        ✗ <name> [drift]   — applied but >=1 relation missing
 *        ? <name>           — skipped (no parseable relations OR not
 *                              recorded in ledger)
 *
 *   5. Exit code:
 *        0  no drift detected
 *        1  drift detected (at least one ✗)
 *        2  fatal harness error (DB unreachable, malformed config)
 *
 * CLI:
 *   pnpm verify:migrations
 *   pnpm verify:migrations --migrations-dir=packages/database/drizzle
 *   DATABASE_URL=postgres://... pnpm verify:migrations --json
 *
 * Safety: read-only. Issues only SELECTs against information_schema
 * and pg_catalog. NEVER mutates the database. Safe to run against
 * production.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedMigration {
  readonly filename: string;
  readonly hash: string;
  readonly tables: readonly string[];
  readonly indexes: readonly string[];
  readonly types: readonly string[];
}

export type DriftStatus = 'matched' | 'drift' | 'skipped';

export interface DriftFinding {
  readonly filename: string;
  readonly hash: string;
  readonly status: DriftStatus;
  readonly missingTables: readonly string[];
  readonly missingIndexes: readonly string[];
  readonly missingTypes: readonly string[];
  readonly reason: string | null;
}

export interface VerifyOptions {
  readonly migrationsDirs: readonly string[];
  readonly databaseUrl: string;
  readonly json?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Strip line and block comments so regex matchers don't pick up
 * commented-out CREATE statements.
 */
export function stripSqlComments(sql: string): string {
  // Block comments first (greedy /* ... */).
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments — preserve newlines so we don't merge statements.
  cleaned = cleaned.replace(/--[^\n]*/g, '');
  return cleaned;
}

/**
 * Normalise an identifier to lowercase and strip surrounding quotes
 * (double or backtick). Schema-qualified names ("public"."tab")
 * collapse to the unqualified table name (the audit only checks
 * existence, not schema).
 */
export function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim().replace(/[`"]/g, '');
  const parts = trimmed.split('.');
  const last = parts[parts.length - 1] ?? '';
  return last.toLowerCase();
}

/**
 * Extract every CREATE TABLE name from a SQL file. Tolerates:
 *   - IF NOT EXISTS
 *   - Schema-qualified names (public.foo, "public"."foo")
 *   - Quoted identifiers
 *   - Multi-line statements
 *
 * Does NOT detect tables created via dynamic SQL inside DO $$ blocks —
 * those degrade to "?".
 */
export function extractCreateTables(sql: string): readonly string[] {
  const cleaned = stripSqlComments(sql);
  const re =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`]+)/gi;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    found.add(normalizeIdentifier(raw));
  }
  return Array.from(found);
}

/**
 * Extract every CREATE INDEX name. Tolerates UNIQUE, CONCURRENTLY,
 * IF NOT EXISTS, and quoted identifiers.
 */
export function extractCreateIndexes(sql: string): readonly string[] {
  const cleaned = stripSqlComments(sql);
  const re =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."`]+)\s+on/gi;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    found.add(normalizeIdentifier(raw));
  }
  return Array.from(found);
}

/**
 * Extract every CREATE TYPE name. Catches both bare and DO-wrapped
 * (DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object ...).
 * This is the idiom the Borjie bootstrap migration uses.
 */
export function extractCreateTypes(sql: string): readonly string[] {
  const cleaned = stripSqlComments(sql);
  const re = /create\s+type\s+([a-zA-Z0-9_."`]+)/gi;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const raw = match[1];
    if (raw === undefined) continue;
    found.add(normalizeIdentifier(raw));
  }
  return Array.from(found);
}

/**
 * Drizzle records the migration hash as the filename minus the .sql
 * extension. Mirrors packages/database/src/run-migrations.ts.
 */
export function migrationHashFromFilename(filename: string): string {
  return basename(filename).replace(/\.sql$/, '');
}

/**
 * Parse a single migration file into the relations it is expected to
 * create. Used by main() and unit-tested directly.
 */
export function parseMigrationSource(
  filename: string,
  sql: string,
): ParsedMigration {
  return {
    filename,
    hash: migrationHashFromFilename(filename),
    tables: extractCreateTables(sql),
    indexes: extractCreateIndexes(sql),
    types: extractCreateTypes(sql),
  };
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, '..');
const DEFAULT_MIGRATION_DIRS = [
  'packages/database/src/migrations',
  'packages/database/drizzle',
];

const MIGRATION_FILENAME = /^[A-Za-z0-9_.-]+\.sql$/;

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function discoverMigrationDirs(
  override: readonly string[],
): Promise<readonly string[]> {
  const candidates =
    override.length > 0 ? override : DEFAULT_MIGRATION_DIRS;
  const resolved: string[] = [];
  for (const rel of candidates) {
    const abs = resolve(ROOT, rel);
    if (await pathExists(abs)) {
      resolved.push(abs);
    }
  }
  return resolved;
}

async function listMigrationFiles(
  dir: string,
): Promise<readonly string[]> {
  const entries = await readdir(dir);
  return entries
    .filter((f) => MIGRATION_FILENAME.test(f))
    .filter((f) => !f.startsWith('_legacy'))
    .sort((a, b) => a.localeCompare(b));
}

async function loadMigrations(
  dirs: readonly string[],
): Promise<readonly ParsedMigration[]> {
  const parsed: ParsedMigration[] = [];
  const seenHashes = new Set<string>();
  for (const dir of dirs) {
    const files = await listMigrationFiles(dir);
    for (const file of files) {
      const hash = migrationHashFromFilename(file);
      if (seenHashes.has(hash)) {
        // Same migration may appear in both dirs during transition;
        // prefer the first occurrence.
        continue;
      }
      seenHashes.add(hash);
      const sql = await readFile(join(dir, file), 'utf8');
      parsed.push(parseMigrationSource(file, sql));
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Database probes
// ---------------------------------------------------------------------------

interface ProbeResult {
  readonly appliedHashes: ReadonlySet<string>;
  readonly tables: ReadonlySet<string>;
  readonly indexes: ReadonlySet<string>;
  readonly types: ReadonlySet<string>;
}

async function probeDatabase(databaseUrl: string): Promise<ProbeResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // The ledger table only exists once the migration runner has been
    // invoked at least once. If absent, treat every migration as
    // unapplied (every drift check becomes "skipped").
    let appliedRows: { hash: string }[] = [];
    try {
      appliedRows = (await sql<{ hash: string }[]>`
        SELECT hash FROM drizzle.__drizzle_migrations
      `) as unknown as { hash: string }[];
    } catch {
      appliedRows = [];
    }
    const applied = new Set<string>();
    for (const row of appliedRows) {
      applied.add(row.hash);
    }

    const tableRows = (await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `) as unknown as { table_name: string }[];
    const tables = new Set<string>();
    for (const row of tableRows) {
      tables.add(row.table_name.toLowerCase());
    }

    const indexRows = (await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    `) as unknown as { indexname: string }[];
    const indexes = new Set<string>();
    for (const row of indexRows) {
      indexes.add(row.indexname.toLowerCase());
    }

    const typeRows = (await sql<{ typname: string }[]>`
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    `) as unknown as { typname: string }[];
    const types = new Set<string>();
    for (const row of typeRows) {
      types.add(row.typname.toLowerCase());
    }

    return {
      appliedHashes: applied,
      tables,
      indexes,
      types,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// Drift evaluation
// ---------------------------------------------------------------------------

export function evaluateDrift(
  migrations: readonly ParsedMigration[],
  probe: ProbeResult,
): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const m of migrations) {
    if (!probe.appliedHashes.has(m.hash)) {
      findings.push({
        filename: m.filename,
        hash: m.hash,
        status: 'skipped',
        missingTables: [],
        missingIndexes: [],
        missingTypes: [],
        reason: 'not recorded in drizzle.__drizzle_migrations',
      });
      continue;
    }

    if (
      m.tables.length === 0 &&
      m.indexes.length === 0 &&
      m.types.length === 0
    ) {
      findings.push({
        filename: m.filename,
        hash: m.hash,
        status: 'skipped',
        missingTables: [],
        missingIndexes: [],
        missingTypes: [],
        reason: 'no parseable CREATE statements',
      });
      continue;
    }

    const missingTables = m.tables.filter(
      (t) => !probe.tables.has(t),
    );
    const missingIndexes = m.indexes.filter(
      (i) => !probe.indexes.has(i),
    );
    const missingTypes = m.types.filter(
      (t) => !probe.types.has(t),
    );

    const drifted =
      missingTables.length > 0 ||
      missingIndexes.length > 0 ||
      missingTypes.length > 0;

    findings.push({
      filename: m.filename,
      hash: m.hash,
      status: drifted ? 'drift' : 'matched',
      missingTables,
      missingIndexes,
      missingTypes,
      reason: null,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI rendering
// ---------------------------------------------------------------------------

function renderHuman(findings: readonly DriftFinding[]): string {
  const lines: string[] = [];
  for (const f of findings) {
    if (f.status === 'matched') {
      lines.push(`✓ ${f.filename}`);
    } else if (f.status === 'drift') {
      const parts: string[] = [];
      if (f.missingTables.length > 0) {
        parts.push(`tables: ${f.missingTables.join(', ')}`);
      }
      if (f.missingIndexes.length > 0) {
        parts.push(`indexes: ${f.missingIndexes.join(', ')}`);
      }
      if (f.missingTypes.length > 0) {
        parts.push(`types: ${f.missingTypes.join(', ')}`);
      }
      lines.push(`✗ ${f.filename} [drift] ${parts.join(' | ')}`);
    } else {
      lines.push(`? ${f.filename} (${f.reason ?? 'unknown'})`);
    }
  }
  const matchedCount = findings.filter((f) => f.status === 'matched').length;
  const driftCount = findings.filter((f) => f.status === 'drift').length;
  const skippedCount = findings.filter((f) => f.status === 'skipped').length;
  lines.push('');
  lines.push(
    `Summary: ${matchedCount} matched, ${driftCount} drift, ${skippedCount} skipped`,
  );
  return lines.join('\n');
}

function renderJson(findings: readonly DriftFinding[]): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      findings,
      summary: {
        matched: findings.filter((f) => f.status === 'matched').length,
        drift: findings.filter((f) => f.status === 'drift').length,
        skipped: findings.filter((f) => f.status === 'skipped').length,
      },
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly migrationsDirs: readonly string[];
  readonly json: boolean;
  readonly help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const dirs: string[] = [];
  let json = false;
  let help = false;
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? 'true' : raw.slice(eq + 1);
    switch (key) {
      case 'migrations-dir':
        dirs.push(value);
        break;
      case 'json':
        json = value === 'true' || value === '1' || value === '';
        break;
      case 'help':
      case 'h':
        help = true;
        break;
      default:
        break;
    }
  }
  return { migrationsDirs: dirs, json, help };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
verify-migrations — Drizzle migration ledger drift detector

Usage:
  pnpm verify:migrations
  pnpm verify:migrations --migrations-dir=packages/database/drizzle
  pnpm verify:migrations --json

Environment:
  DATABASE_URL   required — connection string for the target database

Exit codes:
  0  no drift detected
  1  drift detected
  2  fatal harness error
`);
}

export async function runVerify(
  options: VerifyOptions,
): Promise<readonly DriftFinding[]> {
  const dirs = await discoverMigrationDirs(options.migrationsDirs);
  if (dirs.length === 0) {
    throw new Error('no migration directories found');
  }
  const migrations = await loadMigrations(dirs);
  const probe = await probeDatabase(options.databaseUrl);
  return evaluateDrift(migrations, probe);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      'verify-migrations: DATABASE_URL is required (read-only probe).',
    );
    process.exit(2);
  }
  let findings: readonly DriftFinding[];
  try {
    findings = await runVerify({
      migrationsDirs: args.migrationsDirs,
      databaseUrl,
      json: args.json,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      'verify-migrations: fatal —',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(2);
  }

  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(renderJson(findings));
  } else {
    // eslint-disable-next-line no-console
    console.log(renderHuman(findings));
  }

  const drift = findings.some((f) => f.status === 'drift');
  process.exit(drift ? 1 : 0);
}

// Execute only when invoked directly (tsx scripts/verify-migrations.ts).
// Importers (tests) consume the named exports without firing main().
const isDirectInvocation =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (isDirectInvocation) {
  main();
}

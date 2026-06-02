/**
 * BORJIE Migration Runner
 * Runs SQL migrations in order from src/migrations/
 *
 * Exposed as `runMigrations()` so it can be invoked from a boot-time hook
 * (e.g. container entrypoint, api-gateway prestart) without forking a
 * child process. Also self-executes when run directly as a CLI via tsx.
 */

import { readdir, readFile } from 'fs/promises';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import postgres from 'postgres';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Hand-authored delta migrations (0077+) — property→mining era and after. */
const MIGRATIONS_DIR = resolve(join(__dirname, 'migrations'));

/**
 * drizzle-kit-generated baseline (0000–0076). Creates the core mining schema
 * — including `incidents`, which `src/migrations/0082` ALTERs. This dir MUST
 * apply BEFORE `src/migrations/` or 0082 fails on a fresh DB with
 * "relation incidents does not exist" (INT-4).
 *
 * Historically this baseline was applied by a separate shim
 * (`scripts/apply-borjie-mining-migration.mjs`) before the canonical runner,
 * so the standalone runner / fresh-CI apply of `src/migrations/` alone broke.
 * Folding it in here makes EVERY from-scratch bootstrap through this runner
 * baseline-first and forward-only. Both phases share the
 * `drizzle.__drizzle_migrations` ledger; the two dirs use disjoint number
 * ranges so filename hashes never collide. The legacy `_legacy_*.sql.skip`
 * baseline files are excluded by the `.sql` extension filter, matching
 * `scripts/apply-borjie-mining-migration.mjs`.
 */
const BASELINE_DIR = resolve(join(__dirname, '..', 'drizzle'));

/**
 * Ordered apply phases. The BASELINE schema lands first, then the deltas.
 * Within each phase files apply in lexical (== numeric) order.
 */
const MIGRATION_PHASES: readonly string[] = [BASELINE_DIR, MIGRATIONS_DIR];

/** Strict allowlist: files must be `<digits-or-letters>.sql` with no path chars. */
const SAFE_MIGRATION_NAME = /^[A-Za-z0-9_.-]+\.sql$/;

/**
 * Resolve a migration filename to an absolute path guaranteed to live inside
 * `baseDir`. Rejects traversal, absolute paths, and names that do not match
 * the allowlist. Prevents the `detect-non-literal-fs-filename` risk.
 */
function resolveMigrationPath(baseDir: string, name: string): string {
  if (!SAFE_MIGRATION_NAME.test(name)) {
    throw new Error(`Rejected unsafe migration filename: ${name}`);
  }
  const abs = resolve(baseDir, name);
  const rel = relative(baseDir, abs);
  if (rel.startsWith('..') || rel.includes('..') || abs === baseDir) {
    throw new Error(`Migration path escapes migrations dir: ${name}`);
  }
  return abs;
}

/**
 * Strip a leading `BEGIN;` and trailing `COMMIT;` (or `END;`) from a migration
 * body, tolerating leading SQL line comments / whitespace and trailing
 * whitespace. Returns the body unchanged if no wrapping transaction is found.
 *
 * Why: postgres-js refuses explicit transaction control inside `sql.unsafe()`.
 * Our shipped migrations carry their own `BEGIN; … COMMIT;` for psql / Supabase
 * SQL editor compat; we re-wrap with `sql.begin()` at the call site.
 *
 * Exported for unit-test coverage.
 */
export function stripWrappingTransaction(content: string): string {
  // Leading: any mix of whitespace + `-- line comment` lines + `/* block */`
  // comments, then `BEGIN;` or `BEGIN WORK;` or `START TRANSACTION;`.
  const leadingNoise = `(?:\\s|--[^\\n]*\\n|/\\*[\\s\\S]*?\\*/)*`;
  const beginRe = new RegExp(
    `^(${leadingNoise})(?:BEGIN(?:\\s+WORK)?|START\\s+TRANSACTION)\\s*;\\s*`,
    'i',
  );
  // Trailing: `COMMIT;` or `END;` possibly followed by whitespace / comments
  const commitRe = /\s*(?:COMMIT(?:\s+WORK)?|END)\s*;?\s*(?:--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/i;
  const hasBegin = beginRe.test(content);
  const hasCommit = commitRe.test(content);
  if (!hasBegin || !hasCommit) {
    return content;
  }
  return content.replace(beginRe, '$1').replace(commitRe, '');
}

export interface RunMigrationsOptions {
  databaseUrl?: string;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export interface RunMigrationsResult {
  applied: number;
  skipped: number;
}

/**
 * Resolve the DATABASE_URL, falling back to `process.env.DATABASE_URL`.
 * Throws if neither is set — callers (CLI entry, boot-time hook, tests) are
 * responsible for providing the URL explicitly.
 */
function resolveDatabaseUrl(opts?: RunMigrationsOptions): string {
  const url = opts?.databaseUrl ?? process.env.DATABASE_URL;
  if (!url || url.length === 0) {
    throw new Error('DATABASE_URL not set');
  }
  return url;
}

type MigrationLogger = Pick<Console, 'warn' | 'error'>;

/**
 * Apply every `*.sql` file in `baseDir` (lex == numeric order) that is not yet
 * recorded in `drizzle.__drizzle_migrations`, tracking each by its bare
 * filename. Returns the per-phase applied/skipped counts. Shared by every
 * phase so the baseline + delta dirs go through identical safety + ledger
 * logic.
 */
async function applyPhase(
  sql: ReturnType<typeof postgres>,
  baseDir: string,
  logger: MigrationLogger,
): Promise<RunMigrationsResult> {
  const files = await readdir(baseDir);
  const migrations = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  let applied = 0;
  let skipped = 0;

  for (const file of migrations) {
    const name = file.replace('.sql', '');
    const alreadyApplied = await sql`
      SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${name}
    `;
    if (alreadyApplied.length > 0) {
      logger.warn('Skipping ' + file + ' (already applied)');
      skipped += 1;
      continue;
    }

    logger.warn('Running ' + file + '...');
    const safePath = resolveMigrationPath(baseDir, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by resolveMigrationPath()
    const content = await readFile(safePath, 'utf-8');
    // postgres-js's `sql.unsafe()` rejects explicit transaction control
    // (`BEGIN;` / `COMMIT;`) inside the script. Many of our shipped
    // migrations wrap themselves in `BEGIN; … COMMIT;` for psql-compat,
    // so strip the wrapper before handing the body to postgres-js.
    // Atomicity is preserved by wrapping the call in our own `sql.begin()`.
    const body = stripWrappingTransaction(content);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${name}, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
      `;
    });
    logger.warn('Applied ' + file);
    applied += 1;
  }

  return { applied, skipped };
}

export async function runMigrations(
  opts?: RunMigrationsOptions,
): Promise<RunMigrationsResult> {
  const databaseUrl = resolveDatabaseUrl(opts);
  const logger = opts?.logger ?? console;
  const sql = postgres(databaseUrl);

  let applied = 0;
  let skipped = 0;

  try {
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
      )
    `);

    // Baseline (drizzle/) first, then deltas (src/migrations/). Baseline-first
    // is what makes a from-scratch bootstrap succeed: `incidents` is created in
    // the baseline (drizzle/0003) before `src/migrations/0082` ALTERs it.
    for (const dir of MIGRATION_PHASES) {
      const phase = await applyPhase(sql, dir, logger);
      applied += phase.applied;
      skipped += phase.skipped;
    }

    logger.warn('All migrations completed');
    return { applied, skipped };
  } catch (err) {
    logger.error('Migration failed:', err);
    throw err;
  } finally {
    await sql.end();
  }
}

// Detect "run as CLI" robustly. Comparing `file://${argv[1]}` directly breaks
// on paths containing spaces (`import.meta.url` percent-encodes them; argv
// does not), so route both through `pathToFileURL`.
const isCliEntry = (() => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return false;
  }
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  runMigrations()
    .then((r) => {
      logger.warn(`[migrations] applied=${r.applied} skipped=${r.skipped}`);
      process.exit(0);
    })
    .catch((err) => {
      logger.error('[migrations] failed', { error: err });
      process.exit(1);
    });
}

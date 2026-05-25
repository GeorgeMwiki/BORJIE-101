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
const MIGRATIONS_DIR = resolve(join(__dirname, 'migrations'));

/** Strict allowlist: files must be `<digits-or-letters>.sql` with no path chars. */
const SAFE_MIGRATION_NAME = /^[A-Za-z0-9_.-]+\.sql$/;

/**
 * Resolve a migration filename to an absolute path that is guaranteed to live
 * inside MIGRATIONS_DIR. Rejects traversal, absolute paths, and names that do
 * not match the allowlist. Prevents the `detect-non-literal-fs-filename` risk.
 */
function resolveMigrationPath(name: string): string {
  if (!SAFE_MIGRATION_NAME.test(name)) {
    throw new Error(`Rejected unsafe migration filename: ${name}`);
  }
  const abs = resolve(MIGRATIONS_DIR, name);
  const rel = relative(MIGRATIONS_DIR, abs);
  if (rel.startsWith('..') || rel.includes('..') || abs === MIGRATIONS_DIR) {
    throw new Error(`Migration path escapes migrations dir: ${name}`);
  }
  return abs;
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

    const files = await readdir(MIGRATIONS_DIR);
    const migrations = files
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

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
      const safePath = resolveMigrationPath(file);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by resolveMigrationPath()
      const content = await readFile(safePath, 'utf-8');
      await sql.unsafe(content);
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${name}, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
      `;
      logger.warn('Applied ' + file);
      applied += 1;
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

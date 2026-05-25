/**
 * E2E test-data seed runner.
 *
 * Reads `e2e/fixtures/seed.sql` and applies it against the E2E postgres
 * (configured by DATABASE_URL — defaults to the docker-compose.e2e.yml
 * mapping at localhost:55432). Designed to be invoked AFTER the
 * api-gateway has booted and run its drizzle migrations.
 *
 * Run via `pnpm tsx e2e/fixtures/seed-runner.ts`.
 *
 * Uses `postgres` (postgres.js) — the same driver `@borjie/database`
 * uses — so no extra dependency is needed at the root workspace.
 *
 * Idempotent: every statement in seed.sql is guarded with
 * `ON CONFLICT DO NOTHING` so re-running is safe (e.g. when iterating on
 * specs without tearing the stack down).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, 'seed.sql');

const DEFAULT_URL =
  'postgresql://borjie:borjie_e2e@localhost:55432/borjie_e2e';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_URL;
  const sql = readFileSync(SEED_PATH, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[seed-runner] applying seed.sql to ${redact(databaseUrl)}`);

  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    // postgres.js doesn't expose a bulk-sql method; the simplest portable
    // approach is to split on top-level `;` and run each statement. We avoid
    // `client.unsafe(sql)` because that path treats the whole string as one
    // statement on some PG versions.
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      if (stmt.trim().length === 0) continue;
      await client.unsafe(stmt);
    }
    // eslint-disable-next-line no-console
    console.log(`[seed-runner] seed applied (${statements.length} statements) ✓`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[seed-runner] seed failed:', error);
    throw new Error('Seed failed — ensure migrations have run first');
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * Naive but adequate SQL statement splitter: splits on `;` at line-end while
 * ignoring lines that start with `--`. Good enough for our seed file which is
 * hand-written and contains no procedural blocks. If we ever need stored
 * procs or DO blocks here, swap for a real parser.
 */
function splitStatements(sql: string): readonly string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function redact(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

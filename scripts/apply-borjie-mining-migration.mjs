#!/usr/bin/env node
/**
 * Applies every *.sql file in packages/database/drizzle/ in lexical order
 * against DATABASE_URL. Skips files already recorded in
 * drizzle.__drizzle_migrations (by filename, sans .sql extension).
 *
 * This shim exists because the canonical migration runner
 * (packages/database/src/run-migrations.ts) targets src/migrations/
 * (legacy property-domain), while the Borjie mining migrations live in
 * packages/database/drizzle/.
 *
 * Usage: node scripts/apply-borjie-mining-migration.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'packages', 'database', 'drizzle');

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  process.stderr.write('[apply-migration] DATABASE_URL not set\n');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

async function main() {
  process.stdout.write('[apply-migration] connected to database\n');

  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    )
  `);

  const MIGRATION_RE = /^\d{4}_.*\.sql$/;
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => MIGRATION_RE.test(f))
    .sort((a, b) => a.localeCompare(b));

  process.stdout.write(`[apply-migration] discovered ${files.length} migration(s)\n`);

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const hash = file.replace(/\.sql$/, '');
    const exists = await sql`
      SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
    `;
    if (exists.length > 0) {
      process.stdout.write(`[apply-migration] SKIP  ${file} (already applied)\n`);
      skipped += 1;
      continue;
    }

    process.stdout.write(`[apply-migration] APPLY ${file}\n`);
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

    try {
      await sql.unsafe(sqlText);
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash) VALUES (${hash})
      `;
      applied += 1;
      process.stdout.write(`[apply-migration] OK    ${file}\n`);
    } catch (err) {
      process.stderr.write(`[apply-migration] FAIL  ${file}\n`);
      process.stderr.write(`[apply-migration] error: ${err?.message ?? String(err)}\n`);
      if (err?.position) {
        process.stderr.write(`[apply-migration] position: ${err.position}\n`);
      }
      if (err?.query) {
        const snippet = err.query.slice(0, 500);
        process.stderr.write(`[apply-migration] query head: ${snippet}\n`);
      }
      throw err;
    }
  }

  process.stdout.write(`[apply-migration] applied=${applied} skipped=${skipped}\n`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    process.stderr.write(`[apply-migration] FATAL: ${err?.message ?? String(err)}\n`);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* swallow */
    }
    process.exit(2);
  });

/**
 * Migration uniqueness guard.
 *
 * Asserts that every SQL migration file under `packages/database/drizzle/`
 * has a unique four-digit numeric prefix. Two migrations sharing the same
 * number (e.g. `0029_cognitive_memory.sql` and `0029_wave_resilience.sql`)
 * cause undefined apply ordering and silent collisions in
 * `drizzle.__drizzle_migrations` once the runner has hashed one of them —
 * exactly the failure mode that triggered this hygiene wave.
 *
 * The legacy `_legacy_*.sql.skip` files are intentionally excluded because
 * they are not picked up by the runner (the `^\\d{4}_.*\\.sql$` allowlist
 * in `scripts/apply-borjie-mining-migration.mjs` rejects them outright).
 *
 * Owner: Mr. Mwikila (DB-1).
 */

import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'drizzle');
const MIGRATION_FILE_RE = /^(\d{4})_.+\.sql$/;

/**
 * Read every migration filename and return the parsed numeric prefix
 * along with the original name. Pure: throws only when a filename is
 * present but rejected by the allowlist (helps future contributors notice
 * accidentally malformed names).
 */
function readMigrationFiles(): readonly { readonly file: string; readonly prefix: string }[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- MIGRATIONS_DIR is a build-time constant
  const entries = readdirSync(MIGRATIONS_DIR);
  return entries
    .filter((name) => name.endsWith('.sql'))
    .map((file) => {
      const match = MIGRATION_FILE_RE.exec(file);
      if (!match) {
        throw new Error(
          `Migration filename '${file}' does not match ^\\d{4}_.+\\.sql$. ` +
            `Rename or move to *.sql.skip if intentionally excluded.`,
        );
      }
      const prefix = match[1];
      if (prefix === undefined) {
        throw new Error(`Migration filename '${file}' has no numeric prefix.`);
      }
      return { file, prefix };
    });
}

/**
 * Group migration files by their numeric prefix. Pure / immutable — no
 * Map mutation outside the local reducer scope.
 */
function groupByPrefix(
  files: readonly { readonly file: string; readonly prefix: string }[],
): ReadonlyMap<string, readonly string[]> {
  return files.reduce<Map<string, readonly string[]>>((acc, { file, prefix }) => {
    const existing = acc.get(prefix) ?? [];
    return new Map(acc).set(prefix, [...existing, file]);
  }, new Map());
}

describe('migration uniqueness guard (packages/database/drizzle)', () => {
  it('every migration has a unique 4-digit numeric prefix', () => {
    const files = readMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    const grouped = groupByPrefix(files);
    const collisions = [...grouped.entries()].filter(([, names]) => names.length > 1);

    if (collisions.length > 0) {
      const formatted = collisions
        .map(([prefix, names]) => `  ${prefix}: ${[...names].sort().join(', ')}`)
        .join('\n');
      throw new Error(
        `Migration prefix collisions detected:\n${formatted}\n\n` +
          `Resolve by renaming the alphabetically-larger collision target to ` +
          `the next free 4-digit slot. See chore(db) renumber commits from ` +
          `2026-05-27 for the precedent.`,
      );
    }

    expect(collisions).toEqual([]);
  });

  it('every migration filename matches the runner allowlist', () => {
    const files = readMigrationFiles();
    // readMigrationFiles() already throws on malformed names; the
    // explicit assertion here documents the intent for human readers.
    expect(files.every(({ file }) => MIGRATION_FILE_RE.test(file))).toBe(true);
  });
});

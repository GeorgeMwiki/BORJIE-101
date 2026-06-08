#!/usr/bin/env node
/**
 * check-migration-prefix-unique — forward-only migration prefix guard.
 *
 * Borjie migrations are immutable and apply in lexical filename order
 * (see packages/database/src/run-migrations.ts). Each file is named
 * `<numeric-prefix>[<letter-suffix>]_<slug>.sql`. The numeric prefix is
 * the ordering key; an OPTIONAL single trailing lowercase letter (e.g.
 * `0303b`) is the sanctioned way to slot a follow-on migration directly
 * after its sibling without renumbering the immutable chain.
 *
 * THE HAZARD this script blocks:
 *   Two files sharing the SAME bare numeric prefix with NO letter suffix
 *   (e.g. `0102_geology_capture.sql` + `0102_workforce_certifications.sql`).
 *   That is a forward-only discipline break — apply order between the two
 *   becomes an accident of the slug's lexical sort, and a third author who
 *   reuses `0102` again has no signal they are colliding.
 *
 * WHAT IS ALLOWED:
 *   - One bare numeric prefix per file (the normal case).
 *   - A numeric prefix PLUS distinct letter suffixes that form a clean
 *     letter-suffix family, e.g. `0303` + `0303b`, or `0096` + `0096b`.
 *     The bare-number member and its lettered siblings are deterministic
 *     under lexical sort (`0303` < `0303b` < `0303c`), so this is safe.
 *
 * WHAT IS BLOCKED (exit 1):
 *   - The same bare numeric prefix on more than one file, UNLESS that exact
 *     prefix is grandfathered in GRANDFATHERED_DUPLICATE_PREFIXES below.
 *   - The same numeric+letter token on more than one file (e.g. two
 *     `0303b_*.sql`) — an outright duplicate, never allowed.
 *
 * GRANDFATHERING:
 *   The `0102` pair is already APPLIED to live databases and migrations are
 *   immutable, so the files cannot be renumbered. The explicit allowlist
 *   constant lets the existing pair pass today while still FAILING the
 *   moment a NEW bare-numeric-prefix duplicate is introduced. Do NOT add to
 *   the allowlist to silence a fresh collision — use a letter suffix (e.g.
 *   `NNNNb`) on the new file instead.
 *
 * Usage:
 *   node scripts/check-migration-prefix-unique.mjs
 *     [--migrations-dir=packages/database/src/migrations]
 *
 * Exit codes:
 *   0  no offending duplicates (grandfathered pairs ignored)
 *   1  one or more new duplicate prefixes detected
 *   2  validator crashed (e.g. migrations dir missing)
 */

import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_MIGRATIONS_DIR = 'packages/database/src/migrations';

/**
 * Bare numeric prefixes that are KNOWN to appear on more than one file with
 * no letter suffix, are already applied, and therefore cannot be fixed by
 * renumbering. These are grandfathered: they pass, but any OTHER duplicate
 * still fails. Never extend this to hide a new collision.
 *
 *   0102 — `0102_geology_capture.sql` (drill-hole capture pipeline) and
 *          `0102_workforce_certifications.sql` (cert-expiry dedup) were both
 *          authored on 2026-05-28/29 and applied before the collision was
 *          caught. Lexical apply order is deterministic:
 *          `0102_geology_capture` sorts before `0102_workforce_certifications`
 *          ('g' < 'w'), and the two touch disjoint tables, so the fixed
 *          order is correct. Header comments in both files document this.
 */
const GRANDFATHERED_DUPLICATE_PREFIXES = Object.freeze(new Set(['0102']));

const MIGRATION_FILE_RE = /^(\d+)([a-z]?)_.+\.sql$/;

/**
 * Parse a migration filename into its numeric prefix and optional letter
 * suffix. Returns null for files that do not match the migration naming
 * convention (those are ignored, not failed).
 *
 * @param {string} filename
 * @returns {{ numeric: string, letter: string, token: string } | null}
 */
function parseMigrationName(filename) {
  const match = MIGRATION_FILE_RE.exec(filename);
  if (!match) {
    return null;
  }
  const numeric = match[1];
  const letter = match[2];
  return { numeric, letter, token: `${numeric}${letter}` };
}

/**
 * Group migration files by their bare numeric prefix and by their exact
 * numeric+letter token. Pure function: takes the list of filenames, returns
 * the maps needed to detect collisions.
 *
 * @param {readonly string[]} filenames
 * @returns {{
 *   byNumeric: Map<string, string[]>,
 *   byToken: Map<string, string[]>,
 * }}
 */
function groupMigrations(filenames) {
  const byNumeric = new Map();
  const byToken = new Map();

  for (const filename of filenames) {
    const parsed = parseMigrationName(filename);
    if (!parsed) {
      continue;
    }
    const numericGroup = byNumeric.get(parsed.numeric) ?? [];
    byNumeric.set(parsed.numeric, [...numericGroup, filename]);

    const tokenGroup = byToken.get(parsed.token) ?? [];
    byToken.set(parsed.token, [...tokenGroup, filename]);
  }

  return { byNumeric, byToken };
}

/**
 * Detect offending duplicate prefixes. A numeric prefix is offending when
 * two-or-more files map to the SAME exact token (numeric+letter) — an
 * outright dupe — OR when two-or-more files share a numeric prefix and at
 * least two of them are BARE (no letter suffix), which is the forward-only
 * break. Grandfathered numeric prefixes are excluded from the bare-collision
 * rule (but a literal same-token dupe is never grandfathered).
 *
 * A clean letter-suffix family (e.g. one bare `0303` + one `0303b`) is NOT
 * offending: every token is distinct and at most one member is bare.
 *
 * @param {{ byNumeric: Map<string, string[]>, byToken: Map<string, string[]> }} grouped
 * @param {ReadonlySet<string>} grandfathered
 * @returns {Array<{ kind: 'duplicate-token' | 'bare-collision', key: string, files: string[] }>}
 */
function detectOffenders(grouped, grandfathered) {
  const offenders = [];

  for (const [token, files] of grouped.byToken) {
    if (files.length <= 1) {
      continue;
    }
    // Two BARE `0102` files share the token "0102" (token === numeric, no
    // letter). That is exactly the grandfathered case, so honor the
    // allowlist here too. A genuine lettered same-token dupe (e.g. two
    // `0303b`) is never grandfathered — its token carries a letter, so it
    // can never be in the bare-numeric allowlist.
    if (grandfathered.has(token)) {
      continue;
    }
    offenders.push({
      kind: 'duplicate-token',
      key: token,
      files: [...files].sort(),
    });
  }

  for (const [numeric, files] of grouped.byNumeric) {
    if (files.length <= 1 || grandfathered.has(numeric)) {
      continue;
    }
    const bareFiles = files.filter((filename) => {
      const parsed = parseMigrationName(filename);
      return parsed !== null && parsed.letter === '';
    });
    // Already reported as duplicate-token above iff two bare share a token,
    // but two bare files of the same numeric ALWAYS share token === numeric,
    // so guard against double-reporting by skipping when a duplicate-token
    // for this exact numeric was already recorded.
    const alreadyReported = offenders.some(
      (o) => o.kind === 'duplicate-token' && o.key === numeric,
    );
    if (bareFiles.length > 1 && !alreadyReported) {
      offenders.push({
        kind: 'bare-collision',
        key: numeric,
        files: [...files].sort(),
      });
    }
  }

  return offenders.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Parse argv into options. Only `--migrations-dir=` is supported.
 *
 * @param {readonly string[]} argv
 * @returns {{ migrationsDir: string }}
 */
function parseArgs(argv) {
  let migrationsDir = DEFAULT_MIGRATIONS_DIR;
  for (const arg of argv) {
    if (arg.startsWith('--migrations-dir=')) {
      migrationsDir = arg.slice('--migrations-dir='.length);
    }
  }
  return { migrationsDir };
}

function main() {
  const { migrationsDir } = parseArgs(process.argv.slice(2));
  const absDir = resolve(ROOT, migrationsDir);

  let entries;
  try {
    entries = readdirSync(absDir);
  } catch (err) {
    throw new Error(
      `cannot read migrations dir "${absDir}": ${err.message || err}`,
    );
  }

  const sqlFiles = entries.filter((name) => name.endsWith('.sql'));
  const grouped = groupMigrations(sqlFiles);
  const offenders = detectOffenders(grouped, GRANDFATHERED_DUPLICATE_PREFIXES);

  if (offenders.length === 0) {
    const grandfatheredList = [...GRANDFATHERED_DUPLICATE_PREFIXES].sort();
    // eslint-disable-next-line no-console
    console.log(
      `migration-prefix-unique: PASS (${sqlFiles.length} migrations; ` +
        `grandfathered: ${grandfatheredList.join(', ') || 'none'})`,
    );
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error('migration-prefix-unique: FAIL');
  for (const offender of offenders) {
    const reason =
      offender.kind === 'duplicate-token'
        ? `identical token "${offender.key}" used by multiple files`
        : `bare numeric prefix "${offender.key}" reused without a letter suffix`;
    // eslint-disable-next-line no-console
    console.error(`  - ${reason}:`);
    for (const file of offender.files) {
      // eslint-disable-next-line no-console
      console.error(`      ${file}`);
    }
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix: give the NEW migration a letter suffix (e.g. "NNNNb_slug.sql") ' +
      'so apply order stays deterministic. Do NOT renumber an applied ' +
      'migration, and do NOT add to GRANDFATHERED_DUPLICATE_PREFIXES.',
  );
  process.exit(1);
}

// ESM main-guard — pure helpers are importable by tests without firing the
// CLI side-effects; main() only runs on direct CLI invocation.
const isCli =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  try {
    main();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`fatal: ${err.stack || err.message || err}`);
    process.exit(2);
  }
}

export {
  parseMigrationName,
  groupMigrations,
  detectOffenders,
  GRANDFATHERED_DUPLICATE_PREFIXES,
};

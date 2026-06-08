#!/usr/bin/env node
/**
 * Schema-to-migration drift gate.
 *
 * The footgun this closes: a Drizzle `pgTable(...)` declaration can land in
 * `packages/database/src/schemas/**` WITHOUT a matching `CREATE TABLE` in any
 * tracked migration. The schema then type-checks, the app code compiles, and
 * the table is silently absent on a fresh apply — exactly what happened to
 * `core_entity` (its only CREATE lived in an *archived* migration, invisible to
 * `migration-apply-fresh.yml`). There was NO CI gate detecting this class of
 * drift; this script is that gate.
 *
 * What it does:
 *   (a) Extracts every `pgTable('NAME', ...)` table name from
 *       `packages/database/src/schemas/**` (single-line AND multi-line forms).
 *   (b) Asserts each NAME has a matching
 *       `CREATE TABLE [IF NOT EXISTS] NAME` (case-insensitive; bare, quoted,
 *       or schema-qualified — e.g. `public.NAME` / `"public"."NAME"`)
 *       somewhere under `packages/database/drizzle/**` (the Drizzle baseline)
 *       OR `packages/database/src/migrations/**` (the numbered, letter-suffixed
 *       forward-only migration history).
 *   (c) Exits non-zero listing any table with zero CREATE.
 *
 * Tolerances:
 *   - The Drizzle baseline (`drizzle/**`) quotes every identifier; the numbered
 *     migrations use bare, quoted, and schema-qualified forms interchangeably.
 *     All are accepted.
 *   - Letter-suffixed migration filenames (e.g. `0096b_...`) are ordinary `.sql`
 *     files and are scanned like any other.
 *   - A table is "covered" if a CREATE appears in EITHER source tree, so a
 *     table created in the baseline and never re-created (or vice-versa) passes.
 *
 * It does NOT write to `packages/database/src/migrations/` — that tree is
 * read-only here (another lane owns new migration files).
 *
 * Usage:
 *   node scripts/check-schema-migration-coverage.mjs
 *   node scripts/check-schema-migration-coverage.mjs --report .audit/schema-migration-coverage.json
 *   node scripts/check-schema-migration-coverage.mjs --json
 *
 * Exit codes:
 *   0 — every schema table has a matching CREATE TABLE.
 *   1 — one or more schema tables are uncovered (drift detected).
 *   2 — harness error (e.g. schema dir missing).
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SCHEMAS_DIR = join(ROOT, 'packages', 'database', 'src', 'schemas');
const DRIZZLE_DIR = join(ROOT, 'packages', 'database', 'drizzle');
const MIGRATIONS_DIR = join(ROOT, 'packages', 'database', 'src', 'migrations');

// pgTable(<name>, ...) extractor. `\s` spans newlines, so this captures both
// `pgTable('t', {` and the multi-line `pgTable(\n  't',\n  {` form. Identical
// to the proven extractor in scripts/audit-rls-coverage.mjs.
const PGTABLE_RX =
  /pgTable\s*\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]\s*,/g;

// ───────────────────────────────────────────────────────────────────
// Filesystem walk.
// ───────────────────────────────────────────────────────────────────

function walkDir(dir, suffix, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkDir(full, suffix, out);
    else if (name.endsWith(suffix)) out.push(full);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────
// (a) Discover every pgTable declaration. Map<tableName, firstSchemaFileRel>.
// ───────────────────────────────────────────────────────────────────

function findSchemaTables() {
  const schemaFiles = walkDir(SCHEMAS_DIR, '.ts', []);
  const tables = new Map();
  for (const file of schemaFiles) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    PGTABLE_RX.lastIndex = 0;
    let m;
    while ((m = PGTABLE_RX.exec(src)) !== null) {
      const name = m[1];
      if (!tables.has(name)) tables.set(name, rel);
    }
  }
  return tables;
}

// ───────────────────────────────────────────────────────────────────
// (b) Concatenate every CREATE-TABLE source. We join drizzle/** and
//     migrations/** into one corpus; a table covered in either tree passes.
// ───────────────────────────────────────────────────────────────────

function readAllSql() {
  const files = [
    ...walkDir(DRIZZLE_DIR, '.sql', []),
    ...walkDir(MIGRATIONS_DIR, '.sql', []),
  ];
  return files.map((f) => readFileSync(f, 'utf8')).join('\n\n-- file-boundary --\n\n');
}

// Match `CREATE TABLE [IF NOT EXISTS] [<schema>.]NAME` where NAME may be bare
// or double-quoted and the optional schema qualifier may itself be quoted. The
// trailing `[\s("]` ensures we match the column list / qualifier and not a
// longer identifier that merely shares this prefix (e.g. core_entity vs
// core_entity_links).
function tableHasCreate(sql, table) {
  const rx = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?` +
      `(?:(?:"[a-zA-Z0-9_]+"|[a-zA-Z0-9_]+)\\.)?` +
      `"?${table}"?\\s*[\\s("]`,
    'i',
  );
  return rx.test(sql);
}

// ───────────────────────────────────────────────────────────────────
// CLI.
// ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { report: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a.startsWith('--report=')) out.report = a.slice('--report='.length);
    else if (a === '--json') out.json = true;
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function renderMarkdown(report) {
  const lines = [
    '# Schema → migration coverage',
    '',
    `Scanned: ${report.scannedAt}`,
    '',
    '| metric | value |',
    '|---|---|',
    `| schema tables (pgTable) | ${report.totals.schemaTables} |`,
    `| covered by a CREATE TABLE | ${report.totals.covered} |`,
    `| uncovered (drift) | ${report.totals.uncovered} |`,
    '',
  ];
  if (report.uncovered.length === 0) {
    lines.push('All schema tables have a matching CREATE TABLE. No drift.');
  } else {
    lines.push('## Uncovered tables (no CREATE TABLE in drizzle/** or migrations/**)');
    lines.push('');
    lines.push('| table | schema file |');
    lines.push('|---|---|');
    for (const u of report.uncovered) {
      lines.push(`| \`${u.table}\` | ${u.schemaFile} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);

  if (!existsSync(SCHEMAS_DIR)) {
    console.error(`check-schema-migration-coverage: schemas dir not found at ${SCHEMAS_DIR}`);
    process.exit(2);
  }

  const tables = findSchemaTables();
  const sql = readAllSql();

  const uncovered = [];
  for (const [table, schemaFile] of tables) {
    if (!tableHasCreate(sql, table)) {
      uncovered.push({ table, schemaFile });
    }
  }
  const sortedUncovered = [...uncovered].sort((a, b) => a.table.localeCompare(b.table));

  const report = {
    scanner: 'schema-migration-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      schemaTables: tables.size,
      covered: tables.size - sortedUncovered.length,
      uncovered: sortedUncovered.length,
    },
    uncovered: sortedUncovered,
  };

  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }

  const passed = sortedUncovered.length === 0;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `check-schema-migration-coverage: ${tables.size} schema tables, ` +
        `${report.totals.covered} covered, ${sortedUncovered.length} uncovered — ` +
        `${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const u of sortedUncovered) {
      console.error(`  [DRIFT] ${u.table} — no CREATE TABLE found (declared in ${u.schemaFile})`);
    }
    if (!passed) {
      console.error('');
      console.error(
        'Each table above is declared as a Drizzle pgTable but has no matching ' +
          'CREATE TABLE in packages/database/drizzle/** or ' +
          'packages/database/src/migrations/**. Add a forward-only migration that ' +
          'creates it, or fix the table name mismatch.',
      );
    }
  }

  process.exit(passed ? 0 : 1);
}

main();

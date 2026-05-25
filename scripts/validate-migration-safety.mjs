#!/usr/bin/env node
/**
 * Validate-migration-safety — NOT NULL backfill pre-deploy validator.
 *
 * Surfaced as MEDIUM in `.audit/deep-audit-2026-05-20.md` ("No NOT_NULL-
 * with-backfill validation pre-deploy script for migrations"). Migrations
 * that add `NOT NULL` to a column on an existing-data table without a
 * `DEFAULT` clause and without a backfill `UPDATE` can break production
 * the moment the runner reaches the `SET NOT NULL` statement on any row
 * that doesn't already have a value.
 *
 * What it checks, per SQL file under packages/database/src/migrations:
 *
 *   1. STATIC ANALYSIS
 *      a. Find every `ALTER TABLE ... ADD COLUMN ... NOT NULL`.
 *      b. Find every `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`.
 *      c. For each, classify:
 *           - HAS_DEFAULT     - column has a DEFAULT clause
 *           - HAS_BACKFILL    - earlier UPDATE statement targets the column
 *           - NEW_TABLE       - column was created in the same CREATE TABLE
 *                                in the same file (trivially safe)
 *           - UNSAFE          - none of the above
 *
 *   1b. DYNAMIC-SQL DETECTION (audit fix, HIGH)
 *      Migrations that hide NOT NULL inside a PL/pgSQL `DO $$ ... $$`
 *      block via `EXECUTE format(...)` or `EXECUTE '... NOT NULL ...'`
 *      were previously invisible to the static parser, which gave a
 *      false sense of safety (migration 0167 uses this idiom for
 *      idempotent column renames — that variant is safe, but the
 *      pattern is also a fair attack surface). Any `DO $$` block that
 *      co-occurs `EXECUTE` and `NOT NULL` is flagged UNSAFE unless the
 *      file declares `-- @safety: dynamic-not-null-reviewed` so a human
 *      has explicitly signed off.
 *
 *   2. LIVE DB CHECK (optional, when DATABASE_URL is set)
 *      For every ALTER on an existing table with no default + no backfill,
 *      connect to the target DB and SELECT count(*) FROM <table>
 *      WHERE <column> IS NULL. If > 0, the migration would fail
 *      against this DB.
 *
 * Severity model:
 *   PASS  - no NOT NULL adds, OR all adds have default / backfill / new-table
 *   WARN  - NOT NULL add with DEFAULT (review for default-vs-business-truth
 *           gap; the value is now correct from the DB's perspective but may
 *           not match the real domain value)
 *   FAIL  - NOT NULL add without default + table has rows + no backfill
 *           UPDATE in the migration (live DB check confirmed); OR
 *           NOT NULL add without default + no backfill (static-only run,
 *           no live DB connection); OR
 *           DO $$ ... EXECUTE ... NOT NULL ... $$ pattern without the
 *           `-- @safety: dynamic-not-null-reviewed` allowlist comment.
 *
 * CLI:
 *   node scripts/validate-migration-safety.mjs \
 *     --migrations-dir=packages/database/src/migrations \
 *     [--db-url=$DATABASE_URL] \
 *     [--fail-on=warn|fail] \
 *     [--output=json|markdown] \
 *     [--report=.audit/migration-safety.md]
 *
 * Exit codes:
 *   0  scan complete, severity below the --fail-on threshold
 *   1  scan complete, severity at or above the --fail-on threshold
 *   2  fatal error (filesystem / db connection / unparseable SQL)
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const DEFAULT_MIGRATIONS_DIR = 'packages/database/src/migrations';
const DEFAULT_FAIL_ON = 'fail';
const DEFAULT_OUTPUT = 'markdown';
const VALID_FAIL_ON = new Set(['warn', 'fail']);
const VALID_OUTPUT = new Set(['json', 'markdown']);

function parseArgs(argv) {
  const args = {
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    dbUrl: process.env.DATABASE_URL || '',
    failOn: DEFAULT_FAIL_ON,
    output: DEFAULT_OUTPUT,
    report: '',
  };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? 'true' : raw.slice(eq + 1);
    switch (key) {
      case 'migrations-dir':
        args.migrationsDir = value;
        break;
      case 'db-url':
        args.dbUrl = value;
        break;
      case 'fail-on':
        if (!VALID_FAIL_ON.has(value)) {
          throw new Error(
            `--fail-on must be one of: ${[...VALID_FAIL_ON].join(', ')}`,
          );
        }
        args.failOn = value;
        break;
      case 'output':
        if (!VALID_OUTPUT.has(value)) {
          throw new Error(
            `--output must be one of: ${[...VALID_OUTPUT].join(', ')}`,
          );
        }
        args.output = value;
        break;
      case 'report':
        args.report = value;
        break;
      case 'help':
      case 'h':
        printHelp();
        process.exit(0);
        break;
      default:
        // Tolerate unknown args so we can be wired into varied workflows.
        break;
    }
  }
  return args;
}

function printHelp() {
  const text = [
    'validate-migration-safety — NOT NULL backfill pre-deploy validator',
    '',
    'Usage:',
    '  node scripts/validate-migration-safety.mjs [flags]',
    '',
    'Flags:',
    '  --migrations-dir=<path>   default packages/database/src/migrations',
    '  --db-url=<url>            optional, fallback $DATABASE_URL',
    '  --fail-on=warn|fail       default fail',
    '  --output=json|markdown    default markdown',
    '  --report=<path>           optional, also write report to this path',
    '',
    'Exit codes:',
    '  0  below --fail-on threshold',
    '  1  at/above --fail-on threshold',
    '  2  fatal error',
  ].join('\n');
  // eslint-disable-next-line no-console
  console.log(text);
}

// ---------------------------------------------------------------------------
// SQL parsing
// ---------------------------------------------------------------------------

/**
 * Strip SQL comments so the regex passes don't catch column names mentioned
 * inside a `-- ...` line or a /* ... *\/ block. The character-level scanner
 * is the minimum needed to avoid false positives without pulling in a full
 * SQL parser.
 */
function stripComments(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const nx = sql[i + 1];
    // Line comment
    if (c === '-' && nx === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && nx === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // String literal — preserve but skip the contents so we don't tokenize
    // SQL keywords that happen to appear inside a quoted value.
    if (c === "'") {
      out += c;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") {
          i++;
          break;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += sql[i + 1];
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Quoted/unquoted SQL identifier. The repo uses snake_case bare identifiers
 * throughout so we don't try to handle dotted schema-qualified names beyond
 * stripping a leading `public.` prefix when present.
 */
const IDENT = `(?:"[^"]+"|\\w+)`;
const QUAL_TABLE = `(?:(?:${IDENT})\\.)?(${IDENT})`;

function unquoteIdent(raw) {
  if (!raw) return raw;
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

/**
 * Find every CREATE TABLE statement in the file and return the set of
 * (table_name -> [column_name]) it declares. Used to mark NEW_TABLE-scoped
 * columns as trivially safe.
 */
function extractCreatedTables(sql) {
  const created = new Map();
  // Match `CREATE TABLE [IF NOT EXISTS] <name> ( ... )` — capture the body
  // through depth-balanced parentheses. The regex is anchored on the
  // opening `CREATE TABLE` keyword and we scan forward for the matching
  // close paren to be tolerant of nested types like `numeric(10,2)`.
  const rx =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:\w+)\.)?(\w+|"[^"]+")\s*\(/gi;
  let m;
  while ((m = rx.exec(sql)) !== null) {
    const tableName = unquoteIdent(m[1]);
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < sql.length && depth > 0) {
      const c = sql[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const body = sql.slice(bodyStart, i - 1);
    // Split on top-level commas to enumerate column lines.
    const columns = [];
    let buf = '';
    let bd = 0;
    for (const c of body) {
      if (c === '(') bd++;
      else if (c === ')') bd--;
      if (c === ',' && bd === 0) {
        columns.push(buf.trim());
        buf = '';
      } else {
        buf += c;
      }
    }
    if (buf.trim()) columns.push(buf.trim());
    const colNames = [];
    for (const col of columns) {
      const first = col.match(/^(\w+|"[^"]+")\s/);
      if (!first) continue;
      const name = unquoteIdent(first[1]).toLowerCase();
      // Skip table-level constraints (PRIMARY KEY, FOREIGN KEY, etc.).
      if (
        /^(primary|foreign|unique|constraint|check|exclude|like)$/i.test(name)
      ) {
        continue;
      }
      colNames.push(name);
    }
    created.set(tableName.toLowerCase(), new Set(colNames));
  }
  return created;
}

/**
 * Find UPDATE statements that mention each (table, column) pair. Used to
 * mark a NOT NULL add as HAS_BACKFILL when a sibling UPDATE in the same
 * migration file populates the column.
 */
function extractBackfillTargets(sql) {
  // (tableName -> Set of columnNames being SET)
  const targets = new Map();
  const rx = /update\s+(?:only\s+)?(?:(?:\w+)\.)?(\w+|"[^"]+")\s+set\s+([\s\S]+?)(?:\s+where\b|\s*;)/gi;
  let m;
  while ((m = rx.exec(sql)) !== null) {
    const tableName = unquoteIdent(m[1]).toLowerCase();
    const setClause = m[2];
    // SET col = val, col2 = val2, ...
    const colRx = /(\w+)\s*=/g;
    let cm;
    const cols = targets.get(tableName) || new Set();
    while ((cm = colRx.exec(setClause)) !== null) {
      cols.add(cm[1].toLowerCase());
    }
    targets.set(tableName, cols);
  }
  return targets;
}

/**
 * Detect `ALTER TABLE ... ADD COLUMN ... NOT NULL` and
 * `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` statements in the SQL.
 * Returns an array of unresolved findings — classification happens in a
 * later pass that considers the rest of the file.
 */
function findNotNullStatements(sql) {
  const findings = [];

  // ADD COLUMN form. The repo uses both `ADD COLUMN <name> <type> ... NOT NULL`
  // and `ADD COLUMN IF NOT EXISTS <name> <type> ... NOT NULL`. We capture
  // the full column-clause through the next comma at depth 0 or the
  // closing semicolon of the ALTER.
  const addRx = new RegExp(
    `alter\\s+table(?:\\s+if\\s+exists)?\\s+${QUAL_TABLE}\\s+([\\s\\S]+?);`,
    'gi',
  );
  let m;
  while ((m = addRx.exec(sql)) !== null) {
    const table = unquoteIdent(m[1]).toLowerCase();
    const body = m[2];
    // ALTER TABLE can have multiple clauses separated by commas at depth 0.
    const clauses = splitTopLevel(body, ',');
    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      // ADD COLUMN form
      const addMatch = clause.match(
        /^add\s+column(?:\s+if\s+not\s+exists)?\s+(\w+|"[^"]+")\s+([\s\S]+)$/i,
      );
      if (addMatch) {
        const colName = unquoteIdent(addMatch[1]).toLowerCase();
        const rest = addMatch[2];
        const hasNotNull = /\bnot\s+null\b/i.test(rest);
        if (!hasNotNull) continue;
        const hasDefault = /\bdefault\s+/i.test(rest);
        findings.push({
          kind: 'add_column',
          table,
          column: colName,
          hasDefault,
          raw: clause,
        });
        continue;
      }
      // ALTER COLUMN ... SET NOT NULL form
      const setMatch = clause.match(
        /^alter\s+column\s+(\w+|"[^"]+")\s+set\s+not\s+null\b/i,
      );
      if (setMatch) {
        const colName = unquoteIdent(setMatch[1]).toLowerCase();
        findings.push({
          kind: 'set_not_null',
          table,
          column: colName,
          hasDefault: false,
          raw: clause,
        });
      }
    }
  }
  return findings;
}

function splitTopLevel(body, sep) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (const c of body) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.length) out.push(buf);
  return out;
}

// ---------------------------------------------------------------------------
// Dynamic-SQL detector — `DO $$ ... EXECUTE ... NOT NULL ... $$`
// ---------------------------------------------------------------------------

/**
 * Allowlist signal a migration author writes when a `DO $$` + `EXECUTE` +
 * `NOT NULL` co-occurrence is intentional (e.g. an idempotent rename
 * that happens to include a `NOT NULL` clause in the EXECUTE target).
 * Must appear as a SQL line-comment anywhere in the file. The token
 * is intentionally verbose so it cannot land accidentally — reviewers
 * see it in the diff.
 */
const DYNAMIC_NOT_NULL_ALLOWLIST_MARKER = '@safety: dynamic-not-null-reviewed';

/**
 * Does the RAW (pre-strip) SQL declare an explicit reviewer sign-off
 * for dynamic NOT NULL inside a DO block? We check against the raw
 * source because the marker lives in a `--` comment, which
 * `stripComments` removes before downstream analysis.
 */
export function hasDynamicNotNullAllowlist(rawSql) {
  if (typeof rawSql !== 'string') return false;
  return rawSql.includes(DYNAMIC_NOT_NULL_ALLOWLIST_MARKER);
}

/**
 * Find every Postgres dollar-quoted block (`DO $$ ... $$;` or
 * `DO $tag$ ... $tag$;`) and return its inner body. Used by the
 * dynamic-NOT-NULL detector to look inside PL/pgSQL EXECUTE strings
 * that the static ALTER TABLE parser cannot see.
 *
 * Tag support is minimal — Postgres allows arbitrary `$tag$` markers;
 * the BORJIE codebase only uses bare `$$` today, so we accept
 * `$$` plus optional non-empty `$word$` tags.
 */
export function findDoBlocks(sql) {
  if (typeof sql !== 'string') return [];
  const blocks = [];
  const rx = /\bdo\s*\$(\w*)\$([\s\S]*?)\$\1\$/gi;
  let m;
  while ((m = rx.exec(sql)) !== null) {
    blocks.push({ tag: m[1], body: m[2], index: m.index });
  }
  return blocks;
}

/**
 * Predicate test — does this `NOT NULL` look like a column constraint,
 * or like an `IS NOT NULL` filter predicate?
 *
 * SQL spells the constraint as `... NOT NULL ...` (often after a type:
 * `column_name text NOT NULL`, `SET NOT NULL`, `ALTER COLUMN x SET NOT
 * NULL`). The same letters appear in `WHERE col IS NOT NULL` and
 * `JOIN ... ON x IS NOT NULL`, which are partial-index predicates or
 * row filters — entirely safe.
 *
 * To avoid false positives in dynamic SQL (e.g. partial index creation
 * via EXECUTE), the detector requires AT LEAST ONE non-predicate
 * occurrence — i.e. a `NOT NULL` NOT preceded by `IS` (or `IS NOT` /
 * `WAS NOT` etc.) within a small window.
 *
 * Returns true if the body contains at least one constraint-shaped
 * NOT NULL.
 */
export function hasConstraintShapedNotNull(body) {
  if (typeof body !== 'string') return false;
  // Strip every `IS NOT NULL` predicate first — this kills the false
  // positives from partial-index WHERE clauses. We use a regex that
  // tolerates arbitrary whitespace between IS and NOT.
  const stripped = body.replace(/\bis\s+not\s+null\b/gi, '');
  return /\bnot\s+null\b/i.test(stripped);
}

/**
 * Scan the migration for `DO $$ ... EXECUTE ... NOT NULL ... $$` style
 * dynamic SQL. The static `findNotNullStatements` pass cannot reach
 * inside a PL/pgSQL string literal — without this detector a migration
 * can hide an unsafe `EXECUTE format('ALTER TABLE %I ALTER COLUMN %I
 * SET NOT NULL', ...)` and the script reports PASS.
 *
 * Returns an array of findings (one per DO block that co-occurs
 * EXECUTE + constraint-shaped NOT NULL). The classifier downstream
 * marks them FAIL unless the file declares the explicit allowlist
 * marker. We distinguish between constraint `NOT NULL` and predicate
 * `IS NOT NULL` so dynamic partial-index creation does not trip.
 */
export function findDynamicNotNullStatements(sql) {
  const blocks = findDoBlocks(sql);
  const findings = [];
  for (const block of blocks) {
    const body = block.body;
    // Require EXECUTE in the same block. We don't try to match against
    // the executed string surgically — any block that mixes EXECUTE
    // and a constraint-shaped NOT NULL is suspicious enough to warrant
    // human review.
    const hasExecute = /\bexecute\b/i.test(body);
    if (!hasExecute) continue;
    if (!hasConstraintShapedNotNull(body)) continue;
    // Capture a short snippet for the report. Trim aggressive whitespace
    // so the diff is readable.
    const snippet = body
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    findings.push({
      kind: 'do_block_execute_not_null',
      // No specific table/column — the dynamic SQL could target many.
      table: '<dynamic>',
      column: '<dynamic>',
      hasDefault: false,
      raw: `DO $${block.tag}$ ... $${block.tag}$`,
      snippet,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a finding given the surrounding context derived from the
 * migration file. Returns:
 *
 *   severity: 'pass' | 'warn' | 'fail'
 *   reason:   short human-readable explanation
 *   needsLiveCheck: boolean — true if the static analysis can't conclude
 *     pass/fail without a live DB query
 */
function classifyFinding(finding, ctx) {
  const { createdTables, backfillTargets } = ctx;

  const createdCols = createdTables.get(finding.table);
  if (createdCols && createdCols.has(finding.column)) {
    return {
      severity: 'pass',
      reason: 'NEW_TABLE: column declared in CREATE TABLE in this migration',
      needsLiveCheck: false,
    };
  }

  if (finding.hasDefault) {
    return {
      severity: 'warn',
      reason:
        'HAS_DEFAULT: column has DEFAULT clause — review for default-vs-business-truth gap',
      needsLiveCheck: false,
    };
  }

  const backfillCols = backfillTargets.get(finding.table);
  if (backfillCols && backfillCols.has(finding.column)) {
    return {
      severity: 'pass',
      reason: 'HAS_BACKFILL: UPDATE statement populates the column in this migration',
      needsLiveCheck: false,
    };
  }

  return {
    severity: 'fail',
    reason: 'UNSAFE: NOT NULL added without DEFAULT and without backfill UPDATE',
    needsLiveCheck: true,
  };
}

// ---------------------------------------------------------------------------
// Live DB check
// ---------------------------------------------------------------------------

/**
 * For each finding marked needsLiveCheck:true, run:
 *
 *   SELECT count(*) FROM <table> WHERE <column> IS NULL;
 *
 * If the table does not exist (e.g. a brand-new migration on an empty DB),
 * the finding becomes a static-only FAIL since we can't disprove the
 * runtime hazard. If the column does not yet exist, the finding becomes
 * PASS for live-data purposes (rows can't have a value in a column that
 * isn't there yet — the migration creates the column and then sets it,
 * which is the safe case the script wants to confirm).
 */
async function liveDbCheck(findings, dbUrl) {
  const checks = findings.filter((f) => f.needsLiveCheck);
  if (checks.length === 0) return findings;

  let pg;
  try {
    pg = await import('postgres');
  } catch {
    // Live DB check requested but `postgres` package not available — keep
    // findings as static-only FAILs. The caller's report makes the
    // distinction visible.
    for (const f of checks) {
      f.liveCheckSkipped = 'postgres package not installed';
    }
    return findings;
  }

  const sql = pg.default(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 5 });
  try {
    for (const f of checks) {
      try {
        const tableExists = await sql`
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = ${f.table}
          limit 1
        `;
        if (tableExists.length === 0) {
          f.liveCheckResult = 'table_missing';
          f.liveCheckDetail = 'table does not exist on target DB';
          continue;
        }
        const columnExists = await sql`
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${f.table}
            and column_name = ${f.column}
          limit 1
        `;
        if (columnExists.length === 0) {
          // Column has not been added yet — safe to NOT NULL once the ADD
          // COLUMN executes with no rows-without-value (since the ALTER
          // happens in the same migration).
          f.liveCheckResult = 'column_missing';
          f.liveCheckDetail =
            'column not yet on target DB — ALTER will run against the freshly-added column';
          // Demote: zero rows can be NULL in a column that doesn't exist yet.
          f.classification.severity = 'pass';
          f.classification.reason =
            'NEW_COLUMN_LIVE: column not yet present on target DB; ALTER lands the column then sets NOT NULL';
          continue;
        }
        const nullCountRows = await sql.unsafe(
          `select count(*)::int as null_count from "${f.table}" where "${f.column}" is null`,
        );
        const nullCount = Number(nullCountRows[0]?.null_count ?? 0);
        f.liveCheckResult = 'queried';
        f.liveCheckDetail = `${nullCount} row(s) with NULL ${f.column}`;
        f.nullCount = nullCount;
        if (nullCount === 0) {
          f.classification.severity = 'pass';
          f.classification.reason = 'LIVE_OK: 0 NULL rows on target DB';
        }
      } catch (err) {
        f.liveCheckResult = 'error';
        f.liveCheckDetail = err.message || String(err);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function listMigrationFiles(dir) {
  if (!existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Migration Safety Report');
  lines.push('');
  lines.push(`- Scanned: ${report.scanned} migration file(s)`);
  lines.push(`- Live DB check: ${report.liveDbChecked ? 'yes' : 'no'}`);
  lines.push(`- PASS: ${report.summary.pass}`);
  lines.push(`- WARN: ${report.summary.warn}`);
  lines.push(`- FAIL: ${report.summary.fail}`);
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('No NOT NULL adds detected. All migrations safe to deploy.');
    return lines.join('\n');
  }

  const failing = report.findings.filter((f) => f.severity === 'fail');
  const warning = report.findings.filter((f) => f.severity === 'warn');
  const passing = report.findings.filter((f) => f.severity === 'pass');

  if (failing.length) {
    lines.push('## FAIL — Blocks deploy');
    lines.push('');
    for (const f of failing) renderFinding(lines, f);
    lines.push('');
  }
  if (warning.length) {
    lines.push('## WARN — Review default-vs-business-truth gap');
    lines.push('');
    for (const f of warning) renderFinding(lines, f);
    lines.push('');
  }
  if (passing.length) {
    lines.push('## PASS — Safe NOT NULL adds');
    lines.push('');
    for (const f of passing) renderFinding(lines, f);
    lines.push('');
  }

  return lines.join('\n');
}

function renderFinding(lines, f) {
  lines.push(`- \`${f.file}\` — ${f.table}.${f.column} (${f.kind})`);
  lines.push(`  - ${f.reason}`);
  if (f.liveCheckDetail) {
    lines.push(`  - live: ${f.liveCheckDetail}`);
  }
}

function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${err.message}`);
    process.exit(2);
  }

  const migrationsDir = resolve(ROOT, args.migrationsDir);
  let files;
  try {
    files = listMigrationFiles(migrationsDir);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${err.message}`);
    process.exit(2);
  }

  const flatFindings = [];

  for (const file of files) {
    const rawSql = readFileSync(file, 'utf8');
    const sql = stripComments(rawSql);
    const createdTables = extractCreatedTables(sql);
    const backfillTargets = extractBackfillTargets(sql);
    const rawFindings = findNotNullStatements(sql);
    // Dynamic-SQL pass — looks INSIDE `DO $$ ... $$` blocks for an
    // EXECUTE that smuggles a NOT NULL the static parser can't see.
    // Run independently from the static pass so a file with no top-
    // level ALTER TABLE still gets scanned.
    const dynamicFindings = findDynamicNotNullStatements(sql);
    const allowlisted = hasDynamicNotNullAllowlist(rawSql);

    if (rawFindings.length === 0 && dynamicFindings.length === 0) continue;

    for (const finding of rawFindings) {
      const classification = classifyFinding(finding, {
        createdTables,
        backfillTargets,
      });
      flatFindings.push({
        file: relative(ROOT, file),
        kind: finding.kind,
        table: finding.table,
        column: finding.column,
        hasDefault: finding.hasDefault,
        ...classification,
        classification, // mutable handle for liveDbCheck demotion
      });
    }

    for (const finding of dynamicFindings) {
      // Dynamic SQL bypasses the static safety classifier. We can't
      // tell from the EXECUTE'd string whether the column exists, has
      // a default, or is being backfilled — so the only safe defaults
      // are FAIL (block deploy) or PASS-by-allowlist (human reviewed).
      const classification = allowlisted
        ? {
            severity: 'pass',
            reason:
              'DYNAMIC_ALLOWLISTED: DO $$ EXECUTE block with NOT NULL is human-reviewed (' +
              DYNAMIC_NOT_NULL_ALLOWLIST_MARKER +
              ')',
            needsLiveCheck: false,
          }
        : {
            severity: 'fail',
            reason:
              'DYNAMIC_UNSAFE: DO $$ EXECUTE block contains NOT NULL — static analyser cannot verify safety. ' +
              'Add `-- ' +
              DYNAMIC_NOT_NULL_ALLOWLIST_MARKER +
              '` to the file after human review, or rewrite to plain ALTER TABLE.',
            needsLiveCheck: false,
          };
      flatFindings.push({
        file: relative(ROOT, file),
        kind: finding.kind,
        table: finding.table,
        column: finding.column,
        hasDefault: finding.hasDefault,
        snippet: finding.snippet,
        ...classification,
        classification, // mutable handle for liveDbCheck demotion
      });
    }
  }

  // Optional live DB pass.
  let liveDbChecked = false;
  if (args.dbUrl) {
    liveDbChecked = true;
    try {
      await liveDbCheck(flatFindings, args.dbUrl);
      // Re-flatten classification.severity / .reason after possible demotion.
      for (const f of flatFindings) {
        f.severity = f.classification.severity;
        f.reason = f.classification.reason;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`error: live DB check failed: ${err.message || err}`);
      process.exit(2);
    }
  }

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const f of flatFindings) summary[f.severity]++;

  const report = {
    scanned: files.length,
    liveDbChecked,
    summary,
    findings: flatFindings.map((f) => ({
      file: f.file,
      kind: f.kind,
      table: f.table,
      column: f.column,
      severity: f.severity,
      reason: f.reason,
      hasDefault: f.hasDefault,
      liveCheckResult: f.liveCheckResult,
      liveCheckDetail: f.liveCheckDetail,
      nullCount: f.nullCount,
    })),
  };

  const rendered =
    args.output === 'json' ? renderJson(report) : renderMarkdown(report);

  // eslint-disable-next-line no-console
  console.log(rendered);

  if (args.report) {
    const reportPath = resolve(ROOT, args.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, rendered);
  }

  const threshold = args.failOn;
  const exitNonZero =
    summary.fail > 0 || (threshold === 'warn' && summary.warn > 0);
  process.exit(exitNonZero ? 1 : 0);
}

// ESM main-guard — only invoke main() when this file is run as a script
// (CLI invocation). Importing it from a test or another script must NOT
// trigger main(); the tests need the exported pure helpers without the
// CLI side-effects.
const isCli =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`fatal: ${err.stack || err.message || err}`);
    process.exit(2);
  });
}

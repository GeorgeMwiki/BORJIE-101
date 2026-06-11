#!/usr/bin/env node
/**
 * Universal RLS-coverage scanner.
 *
 * Reverse-port from LITFIN's `src/test/regression/rls-coverage-regression.test.ts`.
 *
 * Walks every Drizzle `pgTable(...)` declaration under
 * `packages/database/src/schemas/**` AND every `.sql` migration under
 * `packages/database/src/migrations/**`. For each table whose Drizzle
 * schema includes a `tenant_id` column (or one of the tenant-key
 * aliases), this scanner asserts:
 *
 *   1. There is a matching `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY`
 *      statement somewhere in the migration history (idempotent migrations
 *      that loop over a `tenant_tables[]` array also count).
 *   2. There is at least one `CREATE POLICY ... ON <name>` (or the
 *      table is created inside a loop that installs `tenant_isolation_*`
 *      policies for every member of the loop array).
 *
 * OR the table is in `scripts/__allowlists__/rls-coverage-allowlist.mjs`
 * with a documented reason.
 *
 * This catches the "new schema landed without an RLS migration" footgun
 * — exactly the regression LITFIN's scanner caught for `brain_nudges`
 * and `brain_sleep_runs`.
 *
 * Usage
 *   node scripts/audit-rls-coverage.mjs --report .audit/rls-coverage.json
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
import { RLS_ALLOWLIST } from './__allowlists__/rls-coverage-allowlist.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SCHEMAS_DIR = join(ROOT, 'packages', 'database', 'src', 'schemas');
const MIGRATIONS_DIR = join(ROOT, 'packages', 'database', 'src', 'migrations');
// The 72-file Drizzle baseline IS part of the canonical applied chain (it
// bootstraps the schema before the forward-only deltas in src/migrations run),
// so RLS it installs must count as coverage. Scanning only src/migrations made
// the scanner false-flag every table whose ENABLE/POLICY lives in the baseline.
const DRIZZLE_DIR = join(ROOT, 'packages', 'database', 'drizzle');

// Tenant-scoping column names. Match the Drizzle field declaration.
//
// D3 (2026-05-19 sweep) — extended to detect tenant-key ALIASES used by
// tables that scope by a custom tenant column (e.g. `owner_skills` uses
// `installed_by_tenant_id`; `org_memberships` uses `platform_tenant_id`).
// Without these aliases the scanner silently treated those tables as
// non-tenant tables; the regression gate could not flag them for missing
// RLS migrations.
const TENANT_COL_RX = [
  /\btenantId\s*:\s*text\(\s*['"]tenant_id['"]/,
  /\btenantId\s*:\s*uuid\(\s*['"]tenant_id['"]/,
  /\borgId\s*:\s*text\(\s*['"]org_id['"]/,
  /\borganizationId\s*:\s*text\(\s*['"]organization_id['"]/,
  /\btenant_id\s*:/,
  // Tenant key aliases (D3 — 2026-05-19 sweep).
  /\b(?:platformTenantId|platform_tenant_id)\s*:/,
  /\b(?:installedByTenantId|installed_by_tenant_id)\s*:/,
  /\b(?:authorTenantId|author_tenant_id)\s*:/,
  /\b(?:tenantIdentityId|tenant_identity_id)\s*:/,
];

// pgTable(<name>,...) extractor — captures the SQL table name string.
const PGTABLE_RX =
  /pgTable\s*\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]\s*,/g;

function walkDir(dir, suffix, out) {
  if (!existsSync(dir)) return;
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
}

// ───────────────────────────────────────────────────────────────────
// Discover tenant-scoped pgTable declarations.
// ───────────────────────────────────────────────────────────────────

function findTenantTables() {
  const schemaFiles = [];
  walkDir(SCHEMAS_DIR, '.ts', schemaFiles);
  // Map<tableName, schemaFileRel>
  const tables = new Map();
  for (const file of schemaFiles) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    // Split on pgTable declarations so each table sees only its own body.
    PGTABLE_RX.lastIndex = 0;
    const declarations = [];
    let m;
    while ((m = PGTABLE_RX.exec(src)) !== null) {
      declarations.push({ name: m[1], start: m.index });
    }
    for (let i = 0; i < declarations.length; i++) {
      const d = declarations[i];
      const end = i + 1 < declarations.length ? declarations[i + 1].start : src.length;
      const body = src.slice(d.start, end);
      if (TENANT_COL_RX.some((rx) => rx.test(body))) {
        tables.set(d.name, rel);
      }
    }
  }
  return tables;
}

// ───────────────────────────────────────────────────────────────────
// Parse all SQL migrations.
// ───────────────────────────────────────────────────────────────────

function readAllSql() {
  const paths = [];
  walkDir(MIGRATIONS_DIR, '.sql', paths);
  walkDir(DRIZZLE_DIR, '.sql', paths);
  const files = paths.map((f) => ({
    rel: relative(ROOT, f),
    body: readFileSync(f, 'utf8'),
  }));
  return {
    joined: files.map((f) => f.body).join('\n\n-- file-boundary --\n\n'),
    files,
  };
}

// A dynamic, array-driven RLS install — `FOREACH tbl IN ARRAY[...] LOOP
// EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl); ...`. The
// array variable's NAME varies across migrations (`tenant_tables`,
// `text_key_tables`, `core_entity_tables`, …), so we must NOT key off the
// variable name — we key off the `format('ALTER TABLE %I … ENABLE …')` shape
// (the actual coverage instruction) and credit every quoted table literal that
// appears inside an ARRAY[…] block in the SAME file.
// The format() string literal may be single-quoted ('…') OR dollar-quoted
// ($tag$…$tag$) — migration 0160 uses `format($pol$ CREATE POLICY %I …$pol$)`.
// Match either opener so a dollar-quoted loop is not mis-read as "no policy".
const DYN_ENABLE_RX =
  /format\(\s*(?:'|\$[a-zA-Z_]*\$)\s*ALTER\s+TABLE\s+(?:public\.)?%I[\s\S]{0,60}?ENABLE\s+ROW\s+LEVEL\s+SECURITY/i;
const DYN_POLICY_RX = /format\(\s*(?:'|\$[a-zA-Z_]*\$)\s*CREATE\s+POLICY/i;

/** Split a migration body into its `DO $tag$ … $tag$` block bodies. */
function doBlocks(body) {
  const blocks = [];
  const rx = /DO\s+(\$[a-zA-Z_]*\$)([\s\S]*?)\1/gi;
  let m;
  while ((m = rx.exec(body)) !== null) blocks.push(m[2]);
  return blocks;
}

/**
 * Table names from a table-list ARRAY[…] that drives an RLS loop, in either of
 * the two shapes this repo uses:
 *   1. declared:  `<var> text[] := ARRAY[ … ]`            (then FOREACH … IN ARRAY <var>)
 *   2. inline:    `FOREACH <v> IN ARRAY ARRAY[ … ]`        (and `IN ARRAY[ … ]`)
 * Restricting to these two openers is what keeps column-name arrays, GRANT
 * lists, and other inline `ARRAY[…]` literals from being mistaken for the
 * loop's table set.
 */
function tableListNames(block) {
  const names = new Set();
  const declRx =
    /(?:text\s*\[\s*\]\s*:=\s*ARRAY\s*\[|IN\s+ARRAY\s+ARRAY\s*\[|IN\s+ARRAY\s*\[)([\s\S]*?)\]/gi;
  let m;
  while ((m = declRx.exec(block)) !== null) {
    const litRx = /'([a-zA-Z_][a-zA-Z0-9_]*)'/g;
    let lm;
    while ((lm = litRx.exec(m[1])) !== null) names.add(lm[1]);
  }
  return names;
}

/**
 * Precompute the union of table names covered by an array-driven ENABLE / POLICY
 * loop, scoped PER `DO`-BLOCK (not per file): a table is credited only when the
 * SAME block both declares it in a `text[]` table-list AND runs the dynamic
 * `format(... %I ...)` ENABLE / CREATE POLICY over that list. This prevents a
 * GRANT array or a column-name array elsewhere in the file from false-crediting
 * a table that never actually gets RLS.
 */
function computeLoopCoverage(files) {
  const enableNames = new Set();
  const policyNames = new Set();
  for (const f of files) {
    for (const block of doBlocks(f.body)) {
      const hasEnable = DYN_ENABLE_RX.test(block);
      const hasPolicy = DYN_POLICY_RX.test(block);
      if (!hasEnable && !hasPolicy) continue;
      const names = tableListNames(block);
      if (hasEnable) for (const n of names) enableNames.add(n);
      if (hasPolicy) for (const n of names) policyNames.add(n);
    }
  }
  return { enableNames, policyNames };
}

function tableHasRlsEnabled(joined, loop, table) {
  // Direct: `ALTER TABLE [IF EXISTS] [public.]<table> ENABLE ROW LEVEL SECURITY`
  const direct = new RegExp(
    `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.|"public"\\.)?"?${table}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    'i',
  );
  if (direct.test(joined)) return true;
  // Array-loop installed (any array variable name).
  return loop.enableNames.has(table);
}

function tableHasPolicy(joined, loop, table) {
  // Direct CREATE POLICY ... ON <table>.
  const direct = new RegExp(
    `CREATE\\s+POLICY\\s+[^;]+\\s+ON\\s+(?:public\\.|"public"\\.)?"?${table}"?[\\s\\(]`,
    'i',
  );
  if (direct.test(joined)) return true;
  // Array-loop installed via a dynamic `format('CREATE POLICY …', …)`.
  return loop.policyNames.has(table);
}

// ───────────────────────────────────────────────────────────────────
// CLI.
// ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { report: null, summary: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = argv[++i];
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const tables = findTenantTables();
  const { joined, files } = readAllSql();
  const loop = computeLoopCoverage(files);
  const violations = [];
  const audited = [];

  for (const [name, schemaFile] of tables) {
    const allowReason = RLS_ALLOWLIST.get(name);
    const rls = tableHasRlsEnabled(joined, loop, name);
    const policy = tableHasPolicy(joined, loop, name);
    audited.push({ table: name, schemaFile, rls, policy, allowlisted: Boolean(allowReason) });
    if (allowReason) continue;
    if (!rls) {
      violations.push({
        table: name,
        schemaFile,
        reason: 'no ENABLE ROW LEVEL SECURITY found',
        severity: 'HIGH',
      });
      continue;
    }
    if (!policy) {
      violations.push({
        table: name,
        schemaFile,
        reason: 'RLS enabled but no CREATE POLICY found',
        severity: 'CRITICAL',
      });
    }
  }

  // Verify every allowlist entry refers to a real tenant table.
  const staleAllowlist = [];
  for (const t of RLS_ALLOWLIST.keys()) {
    if (!tables.has(t)) staleAllowlist.push(t);
  }

  const report = {
    scanner: 'rls-coverage',
    scannedAt: new Date().toISOString(),
    totals: {
      tenantTables: tables.size,
      rlsEnabled: audited.filter((a) => a.rls).length,
      policyDefined: audited.filter((a) => a.policy).length,
      allowlisted: audited.filter((a) => a.allowlisted).length,
      violations: violations.length,
    },
    violations,
    staleAllowlist,
  };

  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }
  if (args.summary) {
    ensureDir(args.summary);
    writeFileSync(args.summary, renderMarkdown(report));
  }

  const passed = violations.length === 0 && staleAllowlist.length === 0;
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(
      `audit-rls-coverage: ${tables.size} tenant tables, ${report.totals.rlsEnabled} RLS-enabled, ${report.totals.policyDefined} with policies, ${violations.length} violation(s) — ${passed ? 'PASS' : 'FAIL'}`,
    );
    for (const v of violations.slice(0, 30)) {
      console.error(`  [${v.severity}] ${v.table} (${v.schemaFile}): ${v.reason}`);
    }
    if (violations.length > 30) console.error(`  ... and ${violations.length - 30} more`);
    for (const s of staleAllowlist) console.error(`  [STALE ALLOWLIST] ${s} — not a tenant table`);
  }
  process.exit(passed ? 0 : 1);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# RLS-coverage audit');
  lines.push('');
  lines.push(`Scanned: ${report.scannedAt}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| tenant-scoped tables | ${report.totals.tenantTables} |`);
  lines.push(`| RLS enabled | ${report.totals.rlsEnabled} |`);
  lines.push(`| policies defined | ${report.totals.policyDefined} |`);
  lines.push(`| allowlisted | ${report.totals.allowlisted} |`);
  lines.push(`| violations | ${report.totals.violations} |`);
  lines.push('');
  if (report.violations.length > 0) {
    lines.push('## Violations');
    lines.push('');
    lines.push('| severity | table | schema file | reason |');
    lines.push('|---|---|---|---|');
    for (const v of report.violations) {
      lines.push(`| ${v.severity} | \`${v.table}\` | \`${v.schemaFile}\` | ${v.reason} |`);
    }
    lines.push('');
  }
  if (report.staleAllowlist.length > 0) {
    lines.push('## Stale allowlist entries');
    lines.push('');
    for (const t of report.staleAllowlist) lines.push(`- \`${t}\``);
  }
  return lines.join('\n');
}

main();

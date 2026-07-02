#!/usr/bin/env node
/**
 * Service-role-tenant-scope scanner — Borjie's OWN recurring bug class.
 *
 * The RLS-darkness / service-role-darkness bug (memory: reminders + dispatch
 * workers): a system job runs under service-role bypass
 * (`withServiceRoleContext(...)` or `{ serviceRole: true }`) and issues a
 * Drizzle query against a TENANT-SCOPED table WITHOUT an auth-derived
 * `tenantId` / `tenant_id` bind inside the same block. The result is silent
 * cross-tenant reach: under the `service_role_bypass` policy the query spans
 * EVERY tenant's rows; when the GUC isn't bound at all under FORCE-RLS it
 * reads ZERO rows (the worker goes dark). Either way it is a correctness +
 * isolation defect that no schema-level RLS-coverage check can catch, because
 * the RLS is present — it's the *application query* that forgot the filter.
 *
 * This is a STATIC detector (heuristic, no DB access). It:
 *
 *   1. Derives the set of tenant-scoped table names from the Drizzle schemas
 *      (any `pgTable('name', …)` whose column block declares `tenant_id`
 *      or a tenant-key alias) — same source of truth as the RLS scanner.
 *   2. Walks every server-side `.ts` in `services/*` and `packages/*` and
 *      finds each service-role block: a `withServiceRoleContext(` /
 *      `withTenantContext(…, { serviceRole: true })` callback body, OR a
 *      block that constructs a raw service-role client.
 *   3. Flags a block that issues a Drizzle statement whose target is a
 *      tenant-scoped table (`.from(t)`, `.update(t)`, `.delete(…).from`,
 *      `db.insert(t)`, `db.select().from(t)`) AND contains NO
 *      `tenantId` / `tenant_id` token anywhere in the block.
 *
 * A file+block is allow-listed via
 * `scripts/__allowlists__/service-role-tenant-scope-allowlist.mjs` when the
 * cross-tenant span is deliberate + safe.
 *
 * Exit codes:
 *   0 — no unguarded service-role query on a tenant-scoped table
 *   1 — at least one violation not in the allowlist
 *   2 — runtime error
 *
 * Usage
 *   node scripts/ci/audit-service-role-tenant-scope.mjs \
 *     [--root <dir>] [--report <path>] [--json]
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
import { SERVICE_ROLE_TENANT_SCOPE_ALLOWLIST } from '../__allowlists__/service-role-tenant-scope-allowlist.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const SCAN_ROOTS = ['services', 'packages'];
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '__tests__',
  'test',
  'tests',
  '__mocks__',
  'mocks',
  'fixtures',
  'coverage',
]);

// Tenant-key column tokens — mirrors scripts/audit-rls-coverage.mjs so the
// two scanners agree on what "tenant-scoped" means.
const TENANT_KEY_COL_PATTERNS = [
  /\btenantId\s*:\s*text\(\s*['"]tenant_id['"]/,
  /\btenantId\s*:\s*uuid\(\s*['"]tenant_id['"]/,
  /\btenant_id\s*:/,
  /\b(?:platformTenantId|platform_tenant_id)\s*:/,
  /\b(?:installedByTenantId|installed_by_tenant_id)\s*:/,
  /\b(?:authorTenantId|author_tenant_id)\s*:/,
  /\b(?:tenantIdentityId|tenant_identity_id)\s*:/,
];

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      walk(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function discoverFiles(root) {
  const acc = [];
  for (const sr of SCAN_ROOTS) walk(join(root, sr), acc);
  return acc;
}

// ---------------------------------------------------------------------------
// Tenant-scoped table names — derived from the Drizzle schemas.
// ---------------------------------------------------------------------------

function deriveTenantScopedTables(root) {
  const schemasDir = join(root, 'packages', 'database', 'src', 'schemas');
  const tables = new Set();
  const varToTable = new Map(); // pgTable var name → db table name
  const files = existsSync(schemasDir) ? walk(schemasDir, []) : [];
  const pgTableRe =
    /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*pgTable\(\s*['"]([A-Za-z0-9_]+)['"]\s*,\s*\{([\s\S]*?)\}\s*(?:,|\))/g;
  for (const f of files) {
    let src;
    try {
      src = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    let m;
    while ((m = pgTableRe.exec(src)) !== null) {
      const [, varName, tableName, colBlock] = m;
      const isTenantScoped = TENANT_KEY_COL_PATTERNS.some((re) =>
        re.test(colBlock),
      );
      if (isTenantScoped) {
        tables.add(tableName);
        varToTable.set(varName, tableName);
      }
    }
  }
  return { tables, varToTable };
}

// ---------------------------------------------------------------------------
// Service-role block extraction + query detection
// ---------------------------------------------------------------------------

// Locate every `withServiceRoleContext(` and `serviceRole: true` block. We
// extract a balanced-brace region starting at the opener so nested braces
// inside the callback don't truncate the block early.
function extractBlockAt(src, openIdx) {
  // Advance to the first `{` after openIdx.
  let i = src.indexOf('{', openIdx);
  if (i === -1) return null;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start); // unbalanced — return to EOF, still scannable
}

function findServiceRoleBlocks(src) {
  const blocks = [];
  const markers = [
    /withServiceRoleContext\s*\(/g,
    /serviceRole\s*:\s*true/g,
    // Raw service-role client construction — the LITFIN-style createServiceClient.
    /createServiceClient\s*\(/g,
    /createServiceRoleClient\s*\(/g,
  ];
  for (const re of markers) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const block = extractBlockAt(src, m.index);
      if (block) {
        blocks.push({ index: m.index, block });
      }
    }
  }
  return blocks;
}

// Does the block issue a Drizzle statement targeting a tenant-scoped table?
function findTenantTableTargets(block, tenantTables, varToTable) {
  const hits = new Set();
  // `.from(varOrExpr)`, `.update(varOrExpr)`, `.delete()` chains, `.insert(var)`.
  const targetRe =
    /\.(?:from|update|insert|delete)\(\s*([A-Za-z0-9_.]+)/g;
  let m;
  while ((m = targetRe.exec(block)) !== null) {
    const ref = m[1];
    // ref may be a schema var (e.g. reminders) or a dotted access
    // (schema.reminders). Take the last segment.
    const leaf = ref.split('.').pop();
    if (varToTable.has(leaf)) {
      hits.add(varToTable.get(leaf));
    } else if (tenantTables.has(leaf)) {
      // string table name used directly
      hits.add(leaf);
    }
  }
  // Also catch raw string table refs: .from('reminders').
  const strTargetRe =
    /\.(?:from|update|insert|delete|into)\(\s*['"]([A-Za-z0-9_]+)['"]/g;
  while ((m = strTargetRe.exec(block)) !== null) {
    if (tenantTables.has(m[1])) hits.add(m[1]);
  }
  return hits;
}

// A block is "bound" when it references a tenant-scope OR org-scope column.
// `org_memberships` and friends isolate by `organizationId` /
// `platformTenantId` / `tenantIdentityId` rather than a literal `tenant_id`,
// so a bind on any of those columns is a valid isolation predicate — not the
// darkness bug. Matches both camelCase (Drizzle) and snake_case (SQL) forms.
const TENANT_BIND_TOKEN_RE =
  /\btenant_id\b|\btenantId\b|\bplatform_tenant_id\b|\bplatformTenantId\b|\btenant_identity_id\b|\btenantIdentityId\b|\bauthor_tenant_id\b|\bauthorTenantId\b|\binstalled_by_tenant_id\b|\binstalledByTenantId\b|\borganization_id\b|\borganizationId\b|\borg_id\b|\borgId\b/;

function blockBindsTenant(block) {
  // A tenant/org bind is any reference to a scope column inside the block —
  // typically `eq(table.tenantId, ctx.tenantId)` or
  // `eq(table.organizationId, input.organizationId)`.
  return TENANT_BIND_TOKEN_RE.test(block);
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function isAllowlisted(relPath) {
  if (SERVICE_ROLE_TENANT_SCOPE_ALLOWLIST.has(relPath)) return true;
  // Prefix-key form `<path>#<label>` — allow any label entry for this file.
  for (const key of SERVICE_ROLE_TENANT_SCOPE_ALLOWLIST.keys()) {
    if (key === relPath || key.startsWith(`${relPath}#`)) return true;
  }
  return false;
}

function runScan({ root }) {
  const { tables, varToTable } = deriveTenantScopedTables(root);
  const files = discoverFiles(root);
  const violations = [];

  for (const file of files) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Cheap pre-filter: only files that mention service-role at all.
    if (
      !/withServiceRoleContext|serviceRole\s*:\s*true|createServiceClient|createServiceRoleClient/.test(
        src,
      )
    ) {
      continue;
    }
    const rel = relative(root, file);
    const blocks = findServiceRoleBlocks(src);
    for (const { index, block } of blocks) {
      const targets = findTenantTableTargets(block, tables, varToTable);
      if (targets.size === 0) continue; // no tenant-table query in this block
      if (blockBindsTenant(block)) continue; // has a tenant bind — safe
      if (isAllowlisted(rel)) continue;
      // Report the 1-based line of the block opener.
      const line = src.slice(0, index).split('\n').length;
      violations.push({
        file: rel,
        line,
        tables: [...targets],
        reason:
          'service-role query on tenant-scoped table with no tenantId/tenant_id bind',
      });
    }
  }

  return {
    scanner: 'audit-service-role-tenant-scope',
    scannedAt: new Date().toISOString(),
    tenantScopedTables: tables.size,
    filesScanned: files.length,
    violations,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { root: null, report: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--report') out.report = argv[++i];
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
  const root = args.root ? resolve(args.root) : DEFAULT_ROOT;
  const report = runScan({ root });

  if (args.report) {
    ensureDir(args.report);
    writeFileSync(args.report, JSON.stringify(report, null, 2));
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stderr.write(
      `audit-service-role-tenant-scope: ${report.filesScanned} file(s), ${report.tenantScopedTables} tenant-scoped table(s), ${report.violations.length} violation(s) — ${
        report.violations.length === 0 ? 'PASS' : 'FAIL'
      }\n`,
    );
    for (const v of report.violations) {
      process.stderr.write(
        `  [DARK] ${v.file}:${v.line} tables=${v.tables.join(',')} — ${v.reason}\n`,
      );
    }
  }

  process.exit(report.violations.length === 0 ? 0 : 1);
}

main();

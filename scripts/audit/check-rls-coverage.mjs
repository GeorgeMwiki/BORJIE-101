#!/usr/bin/env node
/**
 * check-rls-coverage — fails CI if a migration adds a tenant-scoped
 * CREATE TABLE without a matching RLS policy in the same migration OR
 * a follow-up migration sorted before this script runs.
 *
 * Two modes:
 *   1. `--mode=audit` (default): print the coverage report and exit 0
 *      regardless of gaps. Used by the security-audit workflow to
 *      collect data without blocking PRs.
 *   2. `--mode=enforce`: exit 1 when any tenant-scoped table is missing
 *      an RLS policy. Use this once the catch-up migration 0179 has
 *      landed so new gaps cannot regress.
 *
 * Output:
 *   stdout — human readable table
 *   --report=<path> — machine-readable JSON
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = resolve(ROOT, 'packages/database/src/migrations');

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:;|--)/gi;
const TENANT_COLUMN_RE =
  /^\s*(tenant_id|owner_tenant_id|installed_by_tenant_id|scope_tenant_id)\s+(TEXT|UUID|VARCHAR|CHARACTER\s+VARYING)/im;
const COVERED_TABLE_ARRAY_RE =
  /tenant_tables(?:_phase\d+)?\s+text\[\]\s*:=\s*ARRAY\s*\[([\s\S]*?)\]/gi;
const ARRAY_ITEM_RE = /'([a-zA-Z_][a-zA-Z0-9_]*)'/g;
const ALTER_RLS_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
const CREATE_POLICY_RE =
  /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

function parseArgs(argv) {
  const args = { mode: 'audit', report: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--mode=')) args.mode = a.split('=', 2)[1];
    else if (a.startsWith('--report=')) args.report = a.split('=', 2)[1];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: check-rls-coverage.mjs [--mode=audit|enforce] [--report=path]');
      process.exit(0);
    }
  }
  return args;
}

function listSqlFiles(dir) {
  return readdirSync(dir).filter((e) => e.endsWith('.sql')).sort();
}

function findTenantScopedTables() {
  const tables = [];
  const seen = new Set();
  for (const f of listSqlFiles(MIGRATIONS_DIR)) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    CREATE_TABLE_RE.lastIndex = 0;
    let m;
    while ((m = CREATE_TABLE_RE.exec(body)) !== null) {
      const name = (m[1] || '').toLowerCase();
      const cols = m[2] || '';
      const t = cols.match(TENANT_COLUMN_RE);
      if (!t || !name || seen.has(name)) continue;
      seen.add(name);
      tables.push({ table: name, tenantColumn: (t[1] || 'tenant_id').toLowerCase(), file: f });
    }
  }
  return tables.sort((a, b) => a.table.localeCompare(b.table));
}

function findCoveredTables() {
  const enabled = new Set();
  const withPolicy = new Set();
  const coveredBy = new Map();
  for (const f of listSqlFiles(MIGRATIONS_DIR)) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    ALTER_RLS_RE.lastIndex = 0;
    let m;
    while ((m = ALTER_RLS_RE.exec(body)) !== null) {
      const n = (m[1] || '').toLowerCase();
      if (n) { enabled.add(n); coveredBy.set(n, f); }
    }
    CREATE_POLICY_RE.lastIndex = 0;
    while ((m = CREATE_POLICY_RE.exec(body)) !== null) {
      const n = (m[1] || '').toLowerCase();
      if (n) { withPolicy.add(n); if (!coveredBy.has(n)) coveredBy.set(n, f); }
    }
    COVERED_TABLE_ARRAY_RE.lastIndex = 0;
    while ((m = COVERED_TABLE_ARRAY_RE.exec(body)) !== null) {
      const inner = m[1] || '';
      ARRAY_ITEM_RE.lastIndex = 0;
      let it;
      while ((it = ARRAY_ITEM_RE.exec(inner)) !== null) {
        const n = (it[1] || '').toLowerCase();
        if (n) {
          enabled.add(n);
          withPolicy.add(n);
          if (!coveredBy.has(n)) coveredBy.set(n, f);
        }
      }
    }
  }
  return { enabled, withPolicy, coveredBy };
}

function main() {
  const args = parseArgs(process.argv);
  const tables = findTenantScopedTables();
  const cov = findCoveredTables();
  const rows = tables.map((t) => ({
    table: t.table,
    tenantColumn: t.tenantColumn,
    createdInFile: t.file,
    hasRlsEnabled: cov.enabled.has(t.table),
    hasTenantPolicy: cov.withPolicy.has(t.table),
    coveredByFile: cov.coveredBy.get(t.table) || null,
  }));

  const uncovered = rows.filter((r) => !r.hasRlsEnabled || !r.hasTenantPolicy);
  const report = {
    scannedAt: new Date().toISOString(),
    totals: {
      tables: rows.length,
      withRls: rows.filter((r) => r.hasRlsEnabled).length,
      withPolicy: rows.filter((r) => r.hasTenantPolicy).length,
      uncovered: uncovered.length,
    },
    rows,
    uncovered,
  };

  console.log(`RLS coverage: ${report.totals.withPolicy}/${report.totals.tables} tables have a tenant-isolation policy`);
  if (uncovered.length > 0) {
    console.log(`\nUncovered tables (${uncovered.length}):`);
    for (const u of uncovered) {
      console.log(`  - ${u.table.padEnd(40)} (created in ${u.createdInFile})`);
    }
  }

  if (args.report) {
    const path = resolve(ROOT, args.report);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`\nreport: ${args.report}`);
  }

  if (args.mode === 'enforce' && uncovered.length > 0) {
    console.error(`\nFAIL: ${uncovered.length} tenant-scoped tables are missing RLS policies.`);
    process.exit(1);
  }
  process.exit(0);
}

main();

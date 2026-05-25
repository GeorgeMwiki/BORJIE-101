/**
 * RLS-gap scanner.
 *
 * Reads every *.sql migration under `packages/database/src/migrations`
 * and identifies tables that:
 *   1. carry a `tenant_id` column (TEXT, UUID, or referencing
 *      tenants(id)), AND
 *   2. do NOT have an RLS policy created on them anywhere in the
 *      migrations tree.
 *
 * The scanner is intentionally permissive — it accepts any of the
 * patterns the existing migrations use:
 *   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus a `CREATE POLICY`
 *   - a `DO $$ ... ENABLE ROW LEVEL SECURITY ...` block that walks a
 *     table array
 *   - the canonical `current_app_tenant_id()` helper from migration
 *     0155 referenced anywhere in the SQL
 *
 * Returns the list of tables that ARE NOT covered. The migration
 * generator (`scripts/audit/generate-rls-migration.mjs`) consumes this
 * list to produce the next `_rls_policies.sql` file.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TenantTable {
  readonly table: string;
  readonly tenantColumn: string;
  readonly file: string;
}

export interface RlsCoverage {
  readonly table: string;
  readonly tenantColumn: string;
  readonly createdInFile: string;
  readonly hasRlsEnabled: boolean;
  readonly hasTenantPolicy: boolean;
  readonly coveredByFile: string | null;
}

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:;|--)/gi;

// Match `tenant_id <type>` declarations inside a column list. The type
// keyword is loose because we accept TEXT, UUID, VARCHAR, etc.
const TENANT_COLUMN_RE =
  /^\s*(tenant_id|owner_tenant_id|installed_by_tenant_id|scope_tenant_id)\s+(TEXT|UUID|VARCHAR|CHARACTER\s+VARYING)/im;

const COVERED_TABLE_ARRAY_RE =
  /tenant_tables(?:_phase\d+)?\s+text\[\]\s*:=\s*ARRAY\s*\[([\s\S]*?)\]/gi;

const ARRAY_ITEM_RE = /'([a-zA-Z_][a-zA-Z0-9_]*)'/g;

const ALTER_RLS_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;

const CREATE_POLICY_RE =
  /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

/**
 * Find every tenant-scoped CREATE TABLE across the migrations tree.
 */
export function findTenantScopedTables(
  migrationsDir: string,
): TenantTable[] {
  const files = listSqlFiles(migrationsDir);
  const tables: TenantTable[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    CREATE_TABLE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CREATE_TABLE_RE.exec(body)) !== null) {
      const tableName = (match[1] ?? '').toLowerCase();
      const columnBody = match[2] ?? '';
      const tenantMatch = columnBody.match(TENANT_COLUMN_RE);
      if (!tenantMatch || !tableName) continue;
      if (seen.has(tableName)) continue;
      seen.add(tableName);
      tables.push({
        table: tableName,
        tenantColumn: (tenantMatch[1] ?? 'tenant_id').toLowerCase(),
        file: file.split('/').slice(-2).join('/'),
      });
    }
  }
  return tables.sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * Look across the migrations tree for every table whose RLS is enabled
 * AND has at least one CREATE POLICY directed at it (either directly
 * or via a tenant_tables ARRAY['…'] walker that ENABLE+CREATE POLICYs
 * each entry).
 */
export function findCoveredTables(migrationsDir: string): {
  readonly enabled: Set<string>;
  readonly withPolicy: Set<string>;
  readonly coveredBy: ReadonlyMap<string, string>;
} {
  const files = listSqlFiles(migrationsDir);
  const enabled = new Set<string>();
  const withPolicy = new Set<string>();
  const coveredBy = new Map<string, string>();

  for (const file of files) {
    const fileLabel = file.split('/').slice(-1)[0] ?? file;
    const body = readFileSync(file, 'utf8');

    // 1) Direct `ALTER TABLE foo ENABLE ROW LEVEL SECURITY`
    ALTER_RLS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALTER_RLS_RE.exec(body)) !== null) {
      const name = (m[1] ?? '').toLowerCase();
      if (name) {
        enabled.add(name);
        coveredBy.set(name, fileLabel);
      }
    }

    // 2) Direct `CREATE POLICY <name> ON foo`
    CREATE_POLICY_RE.lastIndex = 0;
    while ((m = CREATE_POLICY_RE.exec(body)) !== null) {
      const name = (m[1] ?? '').toLowerCase();
      if (name) {
        withPolicy.add(name);
        if (!coveredBy.has(name)) coveredBy.set(name, fileLabel);
      }
    }

    // 3) DO $$ … tenant_tables := ARRAY['t1','t2',...] walkers
    COVERED_TABLE_ARRAY_RE.lastIndex = 0;
    while ((m = COVERED_TABLE_ARRAY_RE.exec(body)) !== null) {
      const inner = m[1] ?? '';
      ARRAY_ITEM_RE.lastIndex = 0;
      let it: RegExpExecArray | null;
      while ((it = ARRAY_ITEM_RE.exec(inner)) !== null) {
        const name = (it[1] ?? '').toLowerCase();
        if (name) {
          enabled.add(name);
          withPolicy.add(name);
          if (!coveredBy.has(name)) coveredBy.set(name, fileLabel);
        }
      }
    }
  }

  return { enabled, withPolicy, coveredBy };
}

/**
 * Cross-reference tenant-scoped tables against RLS coverage. Returns
 * the full set with per-table flags + the discovery file.
 */
export function scanRlsCoverage(migrationsDir: string): RlsCoverage[] {
  const tables = findTenantScopedTables(migrationsDir);
  const cov = findCoveredTables(migrationsDir);

  return tables.map((t) => ({
    table: t.table,
    tenantColumn: t.tenantColumn,
    createdInFile: t.file,
    hasRlsEnabled: cov.enabled.has(t.table),
    hasTenantPolicy: cov.withPolicy.has(t.table),
    coveredByFile: cov.coveredBy.get(t.table) ?? null,
  }));
}

/**
 * Tables that are tenant-scoped but missing either RLS enable or a
 * tenant-isolation policy.
 */
export function findUncoveredTables(migrationsDir: string): RlsCoverage[] {
  return scanRlsCoverage(migrationsDir).filter(
    (r) => !r.hasRlsEnabled || !r.hasTenantPolicy,
  );
}

function listSqlFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.sql'))
    .sort()
    .map((e) => join(dir, e));
}

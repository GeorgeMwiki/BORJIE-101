import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findTenantScopedTables,
  findCoveredTables,
  scanRlsCoverage,
} from '../scanners/rls-gap-scanner.js';

let rootDir = '';

function writeSql(name: string, body: string): void {
  writeFileSync(join(rootDir, name), body, 'utf8');
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'audit-rls-'));
});

afterAll(() => {
  if (rootDir) rmSync(rootDir, { recursive: true, force: true });
});

describe('rls-gap-scanner', () => {
  it('finds tenant-scoped CREATE TABLE statements', () => {
    writeSql(
      '0001_init.sql',
      `CREATE TABLE IF NOT EXISTS leases (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        rent numeric(10, 2)
      );`,
    );
    writeSql(
      '0002_audit.sql',
      `CREATE TABLE public.audit_events (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        payload jsonb
      );`,
    );
    writeSql(
      '0003_no_tenant.sql',
      `CREATE TABLE platform_health (
        id text PRIMARY KEY,
        status text NOT NULL
      );`,
    );

    const tables = findTenantScopedTables(rootDir);
    const names = tables.map((t) => t.table).sort();
    expect(names).toEqual(['audit_events', 'leases']);
  });

  it('detects RLS coverage via direct ENABLE + CREATE POLICY', () => {
    writeSql(
      '0010_rls.sql',
      `ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
       CREATE POLICY tenant_isolation_select ON leases
         FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));`,
    );
    const cov = findCoveredTables(rootDir);
    expect(cov.enabled.has('leases')).toBe(true);
    expect(cov.withPolicy.has('leases')).toBe(true);
  });

  it('detects coverage via tenant_tables ARRAY[...] walker', () => {
    writeSql(
      '0011_phase2.sql',
      `DO $$
       DECLARE
         tbl text;
         tenant_tables_phase2 text[] := ARRAY['audit_events', 'new_table'];
       BEGIN
         FOREACH tbl IN ARRAY tenant_tables_phase2 LOOP
           EXECUTE 'ALTER TABLE ' || tbl || ' ENABLE ROW LEVEL SECURITY';
         END LOOP;
       END $$;`,
    );
    const cov = findCoveredTables(rootDir);
    expect(cov.enabled.has('audit_events')).toBe(true);
    expect(cov.enabled.has('new_table')).toBe(true);
  });

  it('marks uncovered tables in scanRlsCoverage', () => {
    writeSql(
      '0020_uncovered.sql',
      `CREATE TABLE public.uncovered_thing (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        data jsonb
      );`,
    );
    const all = scanRlsCoverage(rootDir);
    const uncovered = all.find((r) => r.table === 'uncovered_thing');
    expect(uncovered).toBeDefined();
    expect(uncovered?.hasRlsEnabled).toBe(false);
    expect(uncovered?.hasTenantPolicy).toBe(false);
  });
});

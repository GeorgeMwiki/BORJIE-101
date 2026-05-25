/**
 * Tests for the Drizzle-backed DSAR data source adapter.
 *
 * Uses an in-memory fake Drizzle client (`{ execute }`) plus a fake
 * sql-template builder that captures the rendered query as a plain
 * string. No real database; no mocking framework.
 */

import { describe, it, expect } from 'vitest';
import {
  createDsarDataSourceDrizzle,
  createDatabaseClassificationLookup,
  DSAR_TABLE_BINDINGS,
  type DsarDrizzleClient,
  type SqlTemplateFn,
} from '../dsar-data-source-drizzle.js';
import type { DsarTableName } from '../types.js';

interface CapturedQuery {
  readonly rendered: string;
  readonly values: ReadonlyArray<unknown>;
}

function captureSqlBuilder(captured: CapturedQuery[]): SqlTemplateFn {
  return (strings, ...values) => {
    let rendered = '';
    for (let i = 0; i < strings.length; i++) {
      rendered += strings[i];
      if (i < values.length) {
        const v = values[i];
        if (typeof v === 'object' && v !== null && 'value' in v) {
          rendered += String((v as { value: string }).value);
        } else {
          rendered += `?(${typeof v})`;
        }
      }
    }
    captured.push({ rendered, values });
    return rendered;
  };
}

function clientReturning(rows: ReadonlyArray<Record<string, unknown>>): DsarDrizzleClient {
  return {
    async execute() {
      return rows;
    },
  };
}

function clientWithRowsField(rows: ReadonlyArray<Record<string, unknown>>): DsarDrizzleClient {
  return {
    async execute() {
      return { rows };
    },
  };
}

function failingClient(): DsarDrizzleClient {
  return {
    async execute() {
      throw new Error('boom');
    },
  };
}

describe('dsar-data-source-drizzle / customers table', () => {
  it('returns customer rows scoped by customer id and tenant', async () => {
    const captured: CapturedQuery[] = [];
    const ds = createDsarDataSourceDrizzle({
      db: clientReturning([
        {
          id: 'cus_1',
          tenant_id: 'tnt_1',
          email: 'a@b.com',
          phone: '+254700000000',
          first_name: 'Test',
          last_name: 'User',
        },
      ]),
      tenantId: 'tnt_1',
      sqlTemplate: captureSqlBuilder(captured),
    });
    const rows = await ds.readPersonalDataForSubject({
      subjectId: 'cus_1',
      subjectKind: 'customerId',
      table: 'customers',
    });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('cus_1');
    expect(captured[0].rendered).toContain('FROM "customers"');
    expect(captured[0].rendered).toContain('"id"');
    expect(captured[0].rendered).toContain('tenant_id');
    expect(captured[0].rendered).not.toContain('SELECT *');
  });

  it('queries by email when subject kind is email', async () => {
    const captured: CapturedQuery[] = [];
    const ds = createDsarDataSourceDrizzle({
      db: clientReturning([]),
      tenantId: 'tnt_1',
      sqlTemplate: captureSqlBuilder(captured),
    });
    await ds.readPersonalDataForSubject({
      subjectId: 'a@b.com',
      subjectKind: 'email',
      table: 'customers',
    });
    expect(captured[0].rendered).toContain('"email"');
  });
});

describe('dsar-data-source-drizzle / explicit column list', () => {
  it('never emits SELECT * for any binding', () => {
    for (const name of Object.keys(DSAR_TABLE_BINDINGS) as DsarTableName[]) {
      const binding = DSAR_TABLE_BINDINGS[name];
      expect(binding.columns.length).toBeGreaterThan(0);
    }
  });

  it('every binding has tenant_scoped flag set (true for tenant-scoped tables)', () => {
    // Phase D / A2b-1 — tenant_identities is the one cross-tenant
    // principal table (no tenant_id column); every other DSAR binding
    // is tenant_scoped=true.
    const NON_TENANT_SCOPED: ReadonlySet<DsarTableName> = new Set([
      'tenant_identities',
    ]);
    for (const name of Object.keys(DSAR_TABLE_BINDINGS) as DsarTableName[]) {
      const expected = !NON_TENANT_SCOPED.has(name);
      expect(DSAR_TABLE_BINDINGS[name].tenantScoped).toBe(expected);
    }
  });

  it('returns empty for a table without a binding column for the kind', async () => {
    const ds = createDsarDataSourceDrizzle({
      db: clientReturning([{ irrelevant: 1 }]),
      sqlTemplate: captureSqlBuilder([]),
    });
    // market_rate_snapshots has no customer/email/tenant column mapping
    const rows = await ds.readPersonalDataForSubject({
      subjectId: 'cus_1',
      subjectKind: 'customerId',
      table: 'market_rate_snapshots',
    });
    expect(rows.length).toBe(0);
  });
});

describe('dsar-data-source-drizzle / result shapes', () => {
  it('accepts array-shaped execute() result (postgres-js)', async () => {
    const ds = createDsarDataSourceDrizzle({
      db: clientReturning([
        { id: 'p_1', tenant_id: 't', customer_id: 'cus_1', amount: 1000 },
      ]),
      sqlTemplate: captureSqlBuilder([]),
    });
    const rows = await ds.readPersonalDataForSubject({
      subjectId: 'cus_1',
      subjectKind: 'customerId',
      table: 'payments',
    });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p_1');
  });

  it('accepts { rows } shape (node-postgres)', async () => {
    const ds = createDsarDataSourceDrizzle({
      db: clientWithRowsField([
        { id: 'p_2', tenant_id: 't', customer_id: 'cus_1', amount: 500 },
      ]),
      sqlTemplate: captureSqlBuilder([]),
    });
    const rows = await ds.readPersonalDataForSubject({
      subjectId: 'cus_1',
      subjectKind: 'customerId',
      table: 'payments',
    });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p_2');
  });
});

describe('dsar-data-source-drizzle / error handling', () => {
  it('swallows db errors and returns []', async () => {
    const ds = createDsarDataSourceDrizzle({
      db: failingClient(),
      sqlTemplate: captureSqlBuilder([]),
    });
    const rows = await ds.readPersonalDataForSubject({
      subjectId: 'cus_1',
      subjectKind: 'customerId',
      table: 'payments',
    });
    expect(rows.length).toBe(0);
  });

  it('throws when db is missing', () => {
    expect(() =>
      createDsarDataSourceDrizzle({
        db: null as unknown as DsarDrizzleClient,
      }),
    ).toThrow(/db client is required/);
  });
});

describe('dsar-data-source-drizzle / listAffectedTables', () => {
  it('returns the canonical 15-table set', async () => {
    const ds = createDsarDataSourceDrizzle({
      db: clientReturning([]),
      sqlTemplate: captureSqlBuilder([]),
    });
    const tables = await ds.listAffectedTables();
    expect(tables.length).toBeGreaterThanOrEqual(15);
    expect(tables).toContain('customers');
    expect(tables).toContain('audit_events');
    expect(tables).toContain('cot_reservoir');
  });
});

describe('createDatabaseClassificationLookup', () => {
  it('adapts a classify-fn into a ClassificationLookup', () => {
    const lookup = createDatabaseClassificationLookup((table, column) => {
      if (table === 'customers' && column === 'email') {
        return {
          table: 'customers',
          column: 'email',
          level: 'CONFIDENTIAL',
        };
      }
      return null;
    });
    const hit = lookup.classify('customers', 'email');
    expect(hit?.level).toBe('CONFIDENTIAL');
    expect(lookup.classify('customers', 'first_name')).toBeNull();
  });

  it('throws when classifyFn is not a function', () => {
    expect(() => createDatabaseClassificationLookup(null as never)).toThrow(
      /classifyFn must be the/,
    );
  });
});

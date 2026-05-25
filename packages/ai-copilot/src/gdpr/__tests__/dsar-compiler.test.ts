/**
 * Tests for the DSAR compiler (GDPR Art. 20 / PDPA s.27).
 *
 * Uses real in-memory data sources — no mocking framework. Verifies:
 *   1. Empty subject id throws.
 *   2. Missing data source returns an empty bundle.
 *   3. Multi-table assembly walks every affected table.
 *   4. Per-field classifications are annotated when the lookup hits.
 *   5. Per-table failures fall into `partialErrors` (no crash).
 *   6. Bundle schema version + generatedAt are deterministic with
 *      injected clock.
 *   7. Subject-kind inference (email vs tenant id vs customer id).
 *   8. Canonical table order is stable across runs.
 *   9. Row objects are frozen — bundle cannot be mutated by callers.
 *  10. PM-specific tables (owner_statements, kra_mri_filings,
 *      gepg_transactions, cot_reservoir) make it into the bundle.
 */

import { describe, it, expect } from 'vitest';
import {
  compileDsar,
  createEmptyDsarDataSource,
  createNoopClassificationLookup,
  DSAR_BUNDLE_SCHEMA_VERSION,
  DSAR_TABLE_NAMES,
} from '../dsar-compiler.js';
import type {
  ClassificationLookup,
  DsarDataSource,
  DsarRow,
  DsarTableName,
  FieldClassificationLite,
} from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeFixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function makeInMemoryDataSource(
  rows: Partial<Record<DsarTableName, ReadonlyArray<DsarRow>>>,
  options: { failingTables?: ReadonlyArray<DsarTableName> } = {},
): DsarDataSource {
  const failing = new Set(options.failingTables ?? []);
  return {
    async readPersonalDataForSubject({ table }) {
      if (failing.has(table)) {
        throw new Error(`simulated read failure on ${table}`);
      }
      return rows[table] ?? [];
    },
    async listAffectedTables() {
      return Object.entries(rows)
        .filter(([, v]) => Array.isArray(v) && v.length > 0)
        .map(([k]) => k as DsarTableName);
    },
  };
}

function makeRegistryClassifications(
  entries: ReadonlyArray<FieldClassificationLite>,
): ClassificationLookup {
  const index = new Map<string, FieldClassificationLite>();
  for (const e of entries) {
    index.set(`${e.table}::${e.column}`, e);
  }
  return {
    classify(table, column) {
      return index.get(`${table}::${column}`) ?? null;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('dsar-compiler / compileDsar', () => {
  it('rejects empty subjectId', async () => {
    await expect(
      compileDsar({ subjectId: '' }, { now: makeFixedClock('2026-05-14T00:00:00Z') }),
    ).rejects.toThrow(/subjectId is required/);
  });

  it('rejects whitespace-only subjectId', async () => {
    await expect(
      compileDsar({ subjectId: '   ' }, { now: makeFixedClock('2026-05-14T00:00:00Z') }),
    ).rejects.toThrow(/subjectId is required/);
  });

  it('returns an empty bundle when no data source is wired', async () => {
    const bundle = await compileDsar(
      { subjectId: 'jane@example.com' },
      { now: makeFixedClock('2026-05-14T00:00:00Z') },
    );
    expect(bundle.schemaVersion).toBe(DSAR_BUNDLE_SCHEMA_VERSION);
    expect(bundle.subjectId).toBe('jane@example.com');
    expect(bundle.subjectKind).toBe('email');
    expect(bundle.generatedAt).toBe('2026-05-14T00:00:00.000Z');
    // Every canonical table is present as an empty array (degraded mode).
    for (const t of DSAR_TABLE_NAMES) {
      expect(bundle.tables[t]).toEqual([]);
      expect(bundle.counts[t]).toBe(0);
    }
    expect(bundle.classifications).toEqual({});
    expect(bundle.partialErrors).toEqual([]);
  });

  it('returns an empty bundle when the explicit empty source is injected', async () => {
    const bundle = await compileDsar(
      { subjectId: 'tenant_acme' },
      {
        dataSource: createEmptyDsarDataSource(),
        classifications: createNoopClassificationLookup(),
        now: makeFixedClock('2026-05-14T00:00:00Z'),
      },
    );
    // listAffectedTables returns [], so the canonical fallback list applies.
    expect(Object.keys(bundle.tables).sort()).toEqual([...DSAR_TABLE_NAMES].sort());
  });

  it('assembles rows from multiple tables in canonical order', async () => {
    const dataSource = makeInMemoryDataSource({
      customers: [{ id: 'c1', email: 'jane@example.com' }],
      leases: [
        { id: 'l1', customer_id: 'c1', rent_amount: 800_000 },
        { id: 'l2', customer_id: 'c1', rent_amount: 1_200_000 },
      ],
      payments: [{ id: 'p1', amount: 800_000, mpesa_phone: '+255710000111' }],
    });

    const bundle = await compileDsar(
      { subjectId: 'jane@example.com' },
      { dataSource, now: makeFixedClock('2026-05-14T00:00:00Z') },
    );

    expect(bundle.counts.customers).toBe(1);
    expect(bundle.counts.leases).toBe(2);
    expect(bundle.counts.payments).toBe(1);
    // Tables absent from the source remain absent from the output map.
    expect(bundle.tables.voice_turns).toBeUndefined();
    // Order in `tables` keys must follow DSAR_TABLE_NAMES.
    const keys = Object.keys(bundle.tables);
    const customersIdx = keys.indexOf('customers');
    const leasesIdx = keys.indexOf('leases');
    const paymentsIdx = keys.indexOf('payments');
    expect(customersIdx).toBeLessThan(leasesIdx);
    expect(leasesIdx).toBeLessThan(paymentsIdx);
  });

  it('annotates per-field classifications from the lookup', async () => {
    const dataSource = makeInMemoryDataSource({
      customers: [
        {
          id: 'c1',
          email: 'jane@example.com',
          phone: '+255710000111',
          first_name: 'Jane',
        },
      ],
      payments: [{ id: 'p1', amount: 750_000, mpesa_phone: '+255710000222' }],
    });

    const classifications = makeRegistryClassifications([
      { table: 'customers', column: 'email', level: 'CONFIDENTIAL' },
      { table: 'customers', column: 'phone', level: 'CONFIDENTIAL' },
      { table: 'customers', column: 'first_name', level: 'CONFIDENTIAL' },
      { table: 'payments', column: 'mpesa_phone', level: 'RESTRICTED' },
      // 'amount' deliberately omitted to verify unregistered columns are skipped.
    ]);

    const bundle = await compileDsar(
      { subjectId: 'jane@example.com' },
      { dataSource, classifications, now: makeFixedClock('2026-05-14T00:00:00Z') },
    );

    expect(bundle.classifications['customers.email']).toBe('CONFIDENTIAL');
    expect(bundle.classifications['customers.phone']).toBe('CONFIDENTIAL');
    expect(bundle.classifications['customers.first_name']).toBe('CONFIDENTIAL');
    expect(bundle.classifications['payments.mpesa_phone']).toBe('RESTRICTED');
    expect(bundle.classifications['payments.amount']).toBeUndefined();
    expect(bundle.classifications['customers.id']).toBeUndefined();
  });

  it('records per-table read failures into partialErrors without throwing', async () => {
    const dataSource = makeInMemoryDataSource(
      {
        customers: [{ id: 'c1', email: 'jane@example.com' }],
        leases: [{ id: 'l1', customer_id: 'c1' }],
      },
      { failingTables: ['leases'] },
    );

    const bundle = await compileDsar(
      { subjectId: 'jane@example.com' },
      { dataSource, now: makeFixedClock('2026-05-14T00:00:00Z') },
    );

    expect(bundle.counts.customers).toBe(1);
    expect(bundle.counts.leases).toBe(0);
    expect(bundle.partialErrors).toHaveLength(1);
    expect(bundle.partialErrors[0]?.table).toBe('leases');
    expect(bundle.partialErrors[0]?.message).toMatch(/simulated read failure/);
  });

  it('infers subjectKind from the subjectId shape', async () => {
    const dataSource = createEmptyDsarDataSource();
    const clock = makeFixedClock('2026-05-14T00:00:00Z');

    const email = await compileDsar(
      { subjectId: 'a@b.co' },
      { dataSource, now: clock },
    );
    const tenant = await compileDsar(
      { subjectId: 'tenant_acme_001' },
      { dataSource, now: clock },
    );
    const tShort = await compileDsar(
      { subjectId: 't_acme' },
      { dataSource, now: clock },
    );
    const customer = await compileDsar(
      { subjectId: 'cust_018f2a5e' },
      { dataSource, now: clock },
    );

    expect(email.subjectKind).toBe('email');
    expect(tenant.subjectKind).toBe('tenantId');
    expect(tShort.subjectKind).toBe('tenantId');
    expect(customer.subjectKind).toBe('customerId');
  });

  it('respects explicit subjectKind over inference', async () => {
    const bundle = await compileDsar(
      { subjectId: 'tenant_acme', subjectKind: 'customerId' },
      { now: makeFixedClock('2026-05-14T00:00:00Z') },
    );
    expect(bundle.subjectKind).toBe('customerId');
  });

  it('produces frozen row objects so callers cannot mutate the bundle', async () => {
    const dataSource = makeInMemoryDataSource({
      customers: [{ id: 'c1', email: 'jane@example.com' }],
    });

    const bundle = await compileDsar(
      { subjectId: 'jane@example.com' },
      { dataSource, now: makeFixedClock('2026-05-14T00:00:00Z') },
    );

    const firstRow = bundle.tables.customers?.[0] as Record<string, unknown> | undefined;
    expect(firstRow).toBeDefined();
    expect(Object.isFrozen(firstRow)).toBe(true);
    expect(Object.isFrozen(bundle.tables.customers)).toBe(true);
  });

  it('includes PM-specific tables when present (owner statements, KRA MRI, GEPG, CoT)', async () => {
    const dataSource = makeInMemoryDataSource({
      owner_statements: [
        { id: 'os1', period: '2026-04', net_payout: 9_500_000 },
      ],
      maintenance_tickets: [
        { id: 'mt1', priority: 'HIGH', summary: 'Leaking roof — Block A unit 12' },
      ],
      market_rate_snapshots: [
        { id: 'mrs1', captured_at: '2026-04-01', band: '650K-900K' },
      ],
      kra_mri_filings: [
        { id: 'kra1', period: '2026-03', amount_kes: 12_500 },
      ],
      gepg_transactions: [
        { id: 'gepg1', control_number: '991100012345' },
      ],
      cot_reservoir: [
        { id: 'cot1', sampled_at: '2026-04-10', trace_hash: 'sha256:abc' },
      ],
    });

    const bundle = await compileDsar(
      { subjectId: 'tenant_acme' },
      { dataSource, now: makeFixedClock('2026-05-14T00:00:00Z') },
    );

    expect(bundle.counts.owner_statements).toBe(1);
    expect(bundle.counts.maintenance_tickets).toBe(1);
    expect(bundle.counts.market_rate_snapshots).toBe(1);
    expect(bundle.counts.kra_mri_filings).toBe(1);
    expect(bundle.counts.gepg_transactions).toBe(1);
    expect(bundle.counts.cot_reservoir).toBe(1);
  });

  it('falls back to the canonical table list when listAffectedTables throws', async () => {
    const dataSource: DsarDataSource = {
      async readPersonalDataForSubject({ table }) {
        if (table === 'customers') return [{ id: 'c1' }];
        return [];
      },
      async listAffectedTables() {
        throw new Error('boom');
      },
    };

    const bundle = await compileDsar(
      { subjectId: 'jane@example.com' },
      { dataSource, now: makeFixedClock('2026-05-14T00:00:00Z') },
    );
    expect(bundle.counts.customers).toBe(1);
    // Other tables walked and empty — proves canonical fallback engaged.
    expect(bundle.counts.leases).toBe(0);
    expect(bundle.counts.payments).toBe(0);
  });
});

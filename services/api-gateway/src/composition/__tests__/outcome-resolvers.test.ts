/**
 * outcome-resolvers — unit tests for Wave CLOSED-LOOP-RESOLVERS.
 *
 * Each resolver is a thin Drizzle read; the tests stub the DB execute
 * function and assert:
 *   - the SQL text targets the expected table
 *   - the right shape of `observedOutcome` comes back
 *   - the right shape on missing / empty rows (null)
 *   - thrown DB errors degrade to null (caller handles via 'expired')
 *
 * Also covers `buildOutcomeResolvers()` registry — verifying that the
 * common entity-type slugs are wired and that unknown slugs fall through.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildOutcomeResolvers,
  createComplianceResolver,
  createFinancialResolver,
  createProductionResolver,
} from '../outcome-resolvers.js';

interface CapturedCall {
  readonly sql: string;
}

function makeStubDb(rowsByMarker: Record<string, ReadonlyArray<Record<string, unknown>>>) {
  const calls: CapturedCall[] = [];
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const sqlObj = q as {
        strings?: ReadonlyArray<string>;
        queryChunks?: ReadonlyArray<{ value?: string }>;
      };
      const text =
        sqlObj?.strings?.join(' ') ??
        sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
        '';
      calls.push({ sql: text });
      for (const [marker, rows] of Object.entries(rowsByMarker)) {
        if (text.includes(marker)) {
          return { rows };
        }
      }
      return { rows: [] };
    }),
  };
}

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Parameters<typeof createProductionResolver>[0]['logger'];

// ────────────────────────────────────────────────────────────────────
// production resolver
// ────────────────────────────────────────────────────────────────────

describe('createProductionResolver', () => {
  it('returns null when entityId is empty', async () => {
    const db = makeStubDb({});
    const resolver = createProductionResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'production',
      entityId: '',
      predictedOutcome: {},
    });
    expect(result).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns a populated snapshot when rows are present', async () => {
    const db = makeStubDb({
      production_tonnage_events: [
        {
          ore_tonnes: '1200.500',
          waste_tonnes: '400.250',
          event_count: 7,
          most_recent_at: '2026-05-30T12:00:00Z',
        },
      ],
    });
    const resolver = createProductionResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'production',
      entityId: 'site-uuid',
      predictedOutcome: { ore_tonnes: 1300 },
    });
    expect(result).not.toBeNull();
    expect(result?.observedOutcome).toMatchObject({
      ore_tonnes: 1200.5,
      waste_tonnes: 400.25,
      event_count: 7,
    });
    // strip_ratio = waste / ore, rounded to 3dp
    expect(result?.observedOutcome.strip_ratio).toBeCloseTo(0.333, 3);
    expect(result?.observedValueTzs).toBeNull();
    expect(result?.narrative).toContain('7 tonnage events');
  });

  it('degrades to null on DB error', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const resolver = createProductionResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'production',
      entityId: 'site-uuid',
      predictedOutcome: {},
    });
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// financial resolver
// ────────────────────────────────────────────────────────────────────

describe('createFinancialResolver', () => {
  it('aggregates credit/debit and emits net_tzs', async () => {
    const db = makeStubDb({
      ledger_entries: [
        {
          // Minor units = TZS * 100; 500_000_00 minor = 500_000 TZS
          credit_minor: '500000000',
          debit_minor: '100000000',
          entry_count: 12,
          most_recent_at: '2026-05-30T08:00:00Z',
        },
      ],
    });
    const resolver = createFinancialResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'ledger',
      entityId: 'account-uuid',
      predictedOutcome: { net_tzs: 4_000_000 },
    });
    expect(result?.observedOutcome).toMatchObject({
      credit_tzs: 5_000_000,
      debit_tzs: 1_000_000,
      net_tzs: 4_000_000,
      entry_count: 12,
    });
    expect(result?.observedValueTzs).toBe(4_000_000);
  });

  it('aggregates tenant-wide when entityId is empty', async () => {
    const db = makeStubDb({
      ledger_entries: [
        {
          credit_minor: '0',
          debit_minor: '0',
          entry_count: 0,
          most_recent_at: null,
        },
      ],
    });
    const resolver = createFinancialResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'cash_flow',
      entityId: '',
      predictedOutcome: {},
    });
    expect(result?.observedOutcome).toMatchObject({
      credit_tzs: 0,
      debit_tzs: 0,
      net_tzs: 0,
    });
    // SQL should NOT include the account_id equality clause
    expect(db.calls[0]?.sql ?? '').not.toMatch(/account_id = /);
  });

  it('degrades to null on DB error', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const resolver = createFinancialResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'ledger',
      entityId: '',
      predictedOutcome: {},
    });
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// compliance resolver
// ────────────────────────────────────────────────────────────────────

describe('createComplianceResolver', () => {
  it('returns null when filing row does not exist', async () => {
    const db = makeStubDb({ regulatory_filings: [] });
    const resolver = createComplianceResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'regulatory_filing',
      entityId: 'rf-uuid',
      predictedOutcome: { filed: true },
    });
    expect(result).toBeNull();
  });

  it('marks filed + on_time when submitted before due date', async () => {
    const db = makeStubDb({
      regulatory_filings: [
        {
          status: 'submitted',
          due_at: '2026-05-15T23:59:59Z',
          submitted_at: '2026-05-10T12:00:00Z',
          decided_outcome: null,
          fee_paid_tzs: '125000',
          regulator: 'tra',
          filing_type: 'royalty_monthly',
        },
      ],
    });
    const resolver = createComplianceResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'regulatory_filing',
      entityId: 'rf-uuid',
      predictedOutcome: { filed: true, on_time: true },
    });
    expect(result?.observedOutcome).toMatchObject({
      filed: true,
      on_time: true,
      status: 'submitted',
      regulator: 'tra',
      filing_type: 'royalty_monthly',
      fee_paid_tzs: 125000,
    });
    expect(result?.observedValueTzs).toBe(125000);
  });

  it('marks on_time false when filing missed the deadline', async () => {
    const db = makeStubDb({
      regulatory_filings: [
        {
          status: 'overdue',
          due_at: '2026-04-15T23:59:59Z',
          submitted_at: null,
          decided_outcome: null,
          fee_paid_tzs: '0',
          regulator: 'nemc',
          filing_type: 'eia',
        },
      ],
    });
    const resolver = createComplianceResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'regulatory_filing',
      entityId: 'rf-uuid',
      predictedOutcome: { filed: true },
    });
    expect(result?.observedOutcome.filed).toBe(false);
    expect(result?.observedOutcome.on_time).toBe(false);
    expect(result?.observedValueTzs).toBeNull();
  });

  it('degrades to null on DB error', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const resolver = createComplianceResolver({ db, logger: stubLogger });
    const result = await resolver({
      tenantId: 't1',
      entityType: 'regulatory_filing',
      entityId: 'rf-uuid',
      predictedOutcome: {},
    });
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// buildOutcomeResolvers registry
// ────────────────────────────────────────────────────────────────────

describe('buildOutcomeResolvers', () => {
  it('exposes production, financial, and compliance resolver categories', () => {
    const db = makeStubDb({});
    const registry = buildOutcomeResolvers({ db, logger: stubLogger });
    expect(typeof registry.production).toBe('function');
    expect(typeof registry.mining_production).toBe('function');
    expect(typeof registry.tonnage).toBe('function');
    expect(typeof registry.ledger).toBe('function');
    expect(typeof registry.cash_flow).toBe('function');
    expect(typeof registry.revenue).toBe('function');
    expect(typeof registry.compliance).toBe('function');
    expect(typeof registry.regulatory_filing).toBe('function');
    expect(typeof registry.licence_renewal).toBe('function');
  });

  it('does not include unknown slugs (worker falls through to expired)', () => {
    const db = makeStubDb({});
    const registry = buildOutcomeResolvers({ db, logger: stubLogger });
    expect((registry as Record<string, unknown>).mystery_box).toBeUndefined();
    expect((registry as Record<string, unknown>).unknown).toBeUndefined();
  });

  it('shares one resolver instance per category (referential)', () => {
    const db = makeStubDb({});
    const registry = buildOutcomeResolvers({ db, logger: stubLogger });
    expect(registry.production).toBe(registry.mining_production);
    expect(registry.production).toBe(registry.tonnage);
    expect(registry.ledger).toBe(registry.cash_flow);
    expect(registry.compliance).toBe(registry.regulatory_filing);
  });
});

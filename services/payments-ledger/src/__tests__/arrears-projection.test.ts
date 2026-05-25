import { describe, it, expect } from 'vitest';
import {
  createArrearsProjectionService,
  type LedgerReplayEntry,
} from '../arrears';

const projectionService = createArrearsProjectionService();

function entry(
  overrides: Partial<LedgerReplayEntry> & Pick<LedgerReplayEntry, 'id' | 'entryType' | 'amountMinorUnits'>
): LedgerReplayEntry {
  return {
    tenantId: 't1',
    customerId: 'c1',
    invoiceId: 'inv-1',
    currency: 'TZS',
    description: 'test',
    transactionDate: '2026-01-01T00:00:00Z',
    postedAt: '2026-01-01T00:00:00Z',
    relatedEntryId: null,
    ...overrides,
  };
}

describe('ArrearsProjectionService', () => {
  it('replays entries chronologically and computes balance', () => {
    const entries: LedgerReplayEntry[] = [
      entry({ id: 'e1', entryType: 'charge', amountMinorUnits: 100_000, postedAt: '2026-01-01T00:00:00Z' }),
      entry({ id: 'e2', entryType: 'payment', amountMinorUnits: -30_000, postedAt: '2026-01-10T00:00:00Z' }),
      entry({ id: 'e3', entryType: 'late_fee', amountMinorUnits: 5_000, postedAt: '2026-01-20T00:00:00Z' }),
    ];
    const p = projectionService.project({
      tenantId: 't1',
      arrearsCaseId: 'case-1',
      customerId: 'c1',
      currency: 'TZS',
      entries,
      asOf: new Date('2026-02-01T00:00:00Z'),
    });
    expect(p.balanceMinorUnits).toBe(75_000);
    expect(p.replayedEntryCount).toBe(3);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].chargedMinorUnits).toBe(105_000);
    expect(p.lines[0].paidMinorUnits).toBe(30_000);
  });

  it('applies waivers as NEW entries (ledger immutability)', () => {
    const entries: LedgerReplayEntry[] = [
      entry({ id: 'e1', entryType: 'charge', amountMinorUnits: 100_000 }),
      entry({
        id: 'e2',
        entryType: 'waiver',
        amountMinorUnits: -20_000,
        relatedEntryId: 'e1',
        postedAt: '2026-01-15T00:00:00Z',
      }),
    ];
    const p = projectionService.project({
      tenantId: 't1',
      arrearsCaseId: 'case-1',
      customerId: 'c1',
      currency: 'TZS',
      entries,
      asOf: new Date('2026-02-01T00:00:00Z'),
    });
    // Original charge remains visible; waiver reduces net balance.
    expect(p.balanceMinorUnits).toBe(80_000);
    expect(p.lines[0].chargedMinorUnits).toBe(100_000);
    expect(p.lines[0].adjustmentMinorUnits).toBe(-20_000);
    expect(p.lines[0].sourceEntryIds).toContain('e1');
    expect(p.lines[0].sourceEntryIds).toContain('e2');
  });

  it('filters out cross-tenant entries (isolation)', () => {
    const entries: LedgerReplayEntry[] = [
      entry({ id: 'e1', entryType: 'charge', amountMinorUnits: 100 }),
      entry({
        id: 'leaked',
        entryType: 'charge',
        amountMinorUnits: 999_999,
        tenantId: 't2', // different tenant
      }),
    ];
    const p = projectionService.project({
      tenantId: 't1',
      arrearsCaseId: 'case-1',
      customerId: 'c1',
      currency: 'TZS',
      entries,
      asOf: new Date('2026-02-01T00:00:00Z'),
    });
    expect(p.balanceMinorUnits).toBe(100);
    expect(p.replayedEntryCount).toBe(1);
  });

  it('buckets aging correctly', () => {
    const entries: LedgerReplayEntry[] = [
      entry({
        id: 'e1',
        entryType: 'charge',
        amountMinorUnits: 1000,
        transactionDate: '2025-10-01T00:00:00Z',
        postedAt: '2025-10-01T00:00:00Z',
      }),
    ];
    const p = projectionService.project({
      tenantId: 't1',
      arrearsCaseId: 'case-1',
      customerId: 'c1',
      currency: 'TZS',
      entries,
      asOf: new Date('2026-02-01T00:00:00Z'),
    });
    expect(p.agingBucket).toBe('91-180');
  });
});

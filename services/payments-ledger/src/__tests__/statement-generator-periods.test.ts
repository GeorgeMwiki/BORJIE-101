/**
 * StatementGenerator period-boundary tests.
 *
 * These lock in the UTC semantics so `new Date(y, m, d)` (local-time)
 * never silently creeps back in. A non-UTC server would previously
 * produce period boundaries shifted by the server's TZ offset, pulling
 * or pushing transactions across the month line.
 */
import { describe, it, expect } from 'vitest';
import { StatementGenerator } from '../services/statement.generator';

function makeGen() {
  return new StatementGenerator({
    getLedgerEntries: async () => [],
    getAccountBalance: async () => null,
    getOwnerAccounts: async () => [],
    getPropertyDetails: async () => null,
    saveStatement: async (s) => s,
    logger: { info: () => {}, error: () => {} },
  });
}

describe('StatementGenerator — period boundaries are UTC-based', () => {
  it('monthly period starts and ends at UTC instants', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getMonthlyPeriod(2026, 4);
    expect(periodStart.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-04-30T23:59:59.999Z');
  });

  it('monthly period for December is correctly bounded', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getMonthlyPeriod(2026, 12);
    expect(periodStart.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('monthly period handles February leap-year correctly', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getMonthlyPeriod(2024, 2);
    expect(periodStart.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2024-02-29T23:59:59.999Z');
  });

  it('monthly period handles February non-leap-year correctly', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getMonthlyPeriod(2026, 2);
    expect(periodStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('quarterly period Q1 is Jan-Mar in UTC', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getQuarterlyPeriod(2026, 1);
    expect(periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('quarterly period Q4 is Oct-Dec in UTC', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getQuarterlyPeriod(2026, 4);
    expect(periodStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('annual period spans full calendar year in UTC', () => {
    const gen = makeGen();
    const { periodStart, periodEnd } = gen.getAnnualPeriod(2026);
    expect(periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });
});

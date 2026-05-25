import { describe, expect, it } from 'vitest';
import { createInMemoryBudgetStore } from '../index.js';
import type { TenantBudget } from '../types.js';

const T = 't1';

function budget(overrides: Partial<TenantBudget> = {}): TenantBudget {
  return {
    tenantId: T,
    period: 'daily',
    capCents: 10_000,
    capTokens: 1_000_000,
    allowedTiers: ['haiku', 'sonnet', 'opus'],
    downgradeAtFraction: 0.85,
    ...overrides,
  };
}

describe('budget store', () => {
  it('round-trips a budget', async () => {
    const store = createInMemoryBudgetStore();
    await store.setBudget(budget());
    const out = await store.getBudget(T);
    expect(out?.tenantId).toBe(T);
    expect(out?.capCents).toBe(10_000);
  });

  it('returns null for unknown tenant', async () => {
    const store = createInMemoryBudgetStore();
    expect(await store.getBudget('unknown')).toBeNull();
  });

  it('returns zero usage when nothing recorded', async () => {
    const store = createInMemoryBudgetStore();
    const u = await store.getUsage(T, '2026-05-25');
    expect(u.usedCents).toBe(0);
    expect(u.usedTokens).toBe(0);
  });

  it('accumulates spend across calls', async () => {
    const store = createInMemoryBudgetStore();
    await store.recordSpend(T, '2026-05-25', 100, 1000, 'haiku');
    await store.recordSpend(T, '2026-05-25', 200, 2000, 'opus');
    const u = await store.getUsage(T, '2026-05-25');
    expect(u.usedCents).toBe(300);
    expect(u.usedTokens).toBe(3000);
    expect(u.highestTierUsed).toBe('opus');
  });

  it('isolates by periodKey', async () => {
    const store = createInMemoryBudgetStore();
    await store.recordSpend(T, '2026-05-25', 100, 1000, 'sonnet');
    await store.recordSpend(T, '2026-05-26', 50, 500, 'haiku');
    const a = await store.getUsage(T, '2026-05-25');
    const b = await store.getUsage(T, '2026-05-26');
    expect(a.usedCents).toBe(100);
    expect(b.usedCents).toBe(50);
  });

  it('inferring period from periodKey length', async () => {
    const store = createInMemoryBudgetStore();
    const day = await store.getUsage(T, '2026-05-25');
    const month = await store.getUsage(T, '2026-05');
    expect(day.period).toBe('daily');
    expect(month.period).toBe('monthly');
  });
});

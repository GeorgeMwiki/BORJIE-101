import { describe, expect, it } from 'vitest';
import {
  adjustCeiling,
  createInMemoryBudgetStore,
  emergencyUnlock,
  seedBudget,
} from '../index.js';

const T = 't1';

describe('seedBudget', () => {
  it('writes a budget and defaults downgrade fraction', async () => {
    const store = createInMemoryBudgetStore();
    const b = await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 10_000,
      capTokens: 1_000_000,
      allowedTiers: ['haiku'],
    });
    expect(b.downgradeAtFraction).toBe(0.85);
    const read = await store.getBudget(T);
    expect(read?.capCents).toBe(10_000);
  });

  it('overwrites an existing budget (idempotent)', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 1,
      capTokens: 1,
      allowedTiers: ['haiku'],
    });
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 2,
      capTokens: 2,
      allowedTiers: ['haiku'],
    });
    const read = await store.getBudget(T);
    expect(read?.capCents).toBe(2);
  });
});

describe('adjustCeiling', () => {
  it('adjusts only the fields supplied', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 10_000,
      capTokens: 1_000_000,
      allowedTiers: ['haiku', 'sonnet'],
    });
    const next = await adjustCeiling(store, {
      tenantId: T,
      capCents: 20_000,
    });
    expect(next.capCents).toBe(20_000);
    expect(next.capTokens).toBe(1_000_000);
    expect(next.allowedTiers).toEqual(['haiku', 'sonnet']);
  });

  it('throws when no budget exists', async () => {
    const store = createInMemoryBudgetStore();
    await expect(
      adjustCeiling(store, { tenantId: T, capCents: 1 }),
    ).rejects.toThrow(/no budget exists/);
  });

  it('can change allowedTiers + downgrade fraction', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 10_000,
      capTokens: 1_000_000,
      allowedTiers: ['haiku', 'sonnet', 'opus'],
    });
    const next = await adjustCeiling(store, {
      tenantId: T,
      allowedTiers: ['haiku'],
      downgradeAtFraction: 0.5,
    });
    expect(next.allowedTiers).toEqual(['haiku']);
    expect(next.downgradeAtFraction).toBeCloseTo(0.5, 5);
  });
});

describe('emergencyUnlock', () => {
  it('doubles caps by default', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 1_000,
      capTokens: 100_000,
      allowedTiers: ['haiku'],
    });
    const next = await emergencyUnlock(store, T);
    expect(next.capCents).toBe(2_000);
    expect(next.capTokens).toBe(200_000);
  });

  it('honours an explicit multiplier', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 1_000,
      capTokens: 100_000,
      allowedTiers: ['haiku'],
    });
    const next = await emergencyUnlock(store, T, 5);
    expect(next.capCents).toBe(5_000);
    expect(next.capTokens).toBe(500_000);
  });

  it('rejects multiplier <= 1', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 1_000,
      capTokens: 100_000,
      allowedTiers: ['haiku'],
    });
    await expect(emergencyUnlock(store, T, 1)).rejects.toThrow(/multiplier/);
    await expect(emergencyUnlock(store, T, 0)).rejects.toThrow(/multiplier/);
  });

  it('throws when tenant has no budget', async () => {
    const store = createInMemoryBudgetStore();
    await expect(emergencyUnlock(store, T)).rejects.toThrow(/cannot unlock/);
  });
});

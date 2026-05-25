import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryBudgetStore,
  createLLMBudgetGovernor,
  seedBudget,
} from '../index.js';
import type { AlertSink, TenantBudget } from '../types.js';

const T = 't1';
const fixed = () => new Date('2026-05-25T10:00:00.000Z');

async function bootstrap(overrides: Partial<TenantBudget> = {}) {
  const store = createInMemoryBudgetStore();
  await seedBudget(store, {
    tenantId: T,
    period: 'daily',
    capCents: 10_000,
    capTokens: 1_000_000,
    allowedTiers: ['haiku', 'sonnet', 'opus'],
    downgradeAtFraction: 0.85,
    ...overrides,
  });
  return { store, gov: createLLMBudgetGovernor({ store, now: fixed }) };
}

describe('governor.evaluateCall', () => {
  it('proceeds when well under cap', async () => {
    const { gov } = await bootstrap();
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'sonnet',
      estimatedTokens: 100,
    });
    expect(decision.kind).toBe('proceed');
  });

  it('passes through when no budget exists', async () => {
    const store = createInMemoryBudgetStore();
    const gov = createLLMBudgetGovernor({ store, now: fixed });
    const decision = await gov.evaluateCall({
      tenantId: 'unknown',
      model: 'opus',
      estimatedTokens: 1000,
    });
    expect(decision.kind).toBe('proceed');
  });

  it('blocks when usedCents already at cap', async () => {
    const { store, gov } = await bootstrap();
    await store.recordSpend(T, '2026-05-25', 10_000, 0, 'haiku');
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'sonnet',
      estimatedTokens: 100,
    });
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') expect(decision.reason).toBe('over-cap-cents');
  });

  it('blocks when usedTokens already at cap', async () => {
    const { store, gov } = await bootstrap({ capTokens: 1000 });
    await store.recordSpend(T, '2026-05-25', 0, 1000, 'haiku');
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'haiku',
      estimatedTokens: 1,
    });
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') expect(decision.reason).toBe('over-cap-tokens');
  });

  it('downgrades opus -> sonnet when approaching cap', async () => {
    const { store, gov } = await bootstrap({
      capCents: 1_000,
      downgradeAtFraction: 0.5,
    });
    await store.recordSpend(T, '2026-05-25', 400, 0, 'sonnet');
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'opus',
      estimatedTokens: 200,
    });
    expect(decision.kind).toBe('downgrade');
    if (decision.kind === 'downgrade') {
      expect(decision.requested).toBe('opus');
      expect(decision.downgradedTo).toBe('sonnet');
    }
  });

  it('downgrades when requested tier is not allowed', async () => {
    const { gov } = await bootstrap({ allowedTiers: ['haiku', 'sonnet'] });
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'opus',
      estimatedTokens: 100,
    });
    expect(decision.kind).toBe('downgrade');
    if (decision.kind === 'downgrade') {
      expect(decision.downgradedTo).toBe('sonnet');
      expect(decision.reason).toBe('tier-not-allowed');
    }
  });

  it('blocks no-tier-fits when no cheaper allowed', async () => {
    const { gov } = await bootstrap({ allowedTiers: ['opus'] });
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'haiku',
      estimatedTokens: 100,
    });
    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') expect(decision.reason).toBe('no-tier-fits');
  });

  it('emits downgrade event through alertSink', async () => {
    const sink: AlertSink = {
      emitDowngrade: vi.fn(),
      emitBlock: vi.fn(),
    };
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 1_000,
      capTokens: 1_000_000,
      allowedTiers: ['haiku', 'sonnet'],
      downgradeAtFraction: 0.85,
    });
    const gov = createLLMBudgetGovernor({ store, alertSink: sink, now: fixed });
    await gov.evaluateCall({
      tenantId: T,
      model: 'opus',
      estimatedTokens: 100,
    });
    expect(sink.emitDowngrade).toHaveBeenCalledTimes(1);
  });

  it('emits block event through alertSink', async () => {
    const sink: AlertSink = {
      emitDowngrade: vi.fn(),
      emitBlock: vi.fn(),
    };
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 100,
      capTokens: 1_000_000,
      allowedTiers: ['haiku'],
      downgradeAtFraction: 0.85,
    });
    await store.recordSpend(T, '2026-05-25', 100, 0, 'haiku');
    const gov = createLLMBudgetGovernor({ store, alertSink: sink, now: fixed });
    await gov.evaluateCall({
      tenantId: T,
      model: 'haiku',
      estimatedTokens: 1,
    });
    expect(sink.emitBlock).toHaveBeenCalledTimes(1);
  });

  it('block response includes resetsAt with next-day key', async () => {
    const { store, gov } = await bootstrap();
    await store.recordSpend(T, '2026-05-25', 10_000, 0, 'haiku');
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'sonnet',
      estimatedTokens: 100,
    });
    if (decision.kind !== 'block') throw new Error('expected block');
    expect(decision.resetsAt).toBe('2026-05-26');
  });

  it('block resetsAt rolls month boundary for daily period', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'daily',
      capCents: 100,
      capTokens: 1_000_000,
      allowedTiers: ['haiku'],
    });
    const gov = createLLMBudgetGovernor({
      store,
      now: () => new Date('2026-05-31T10:00:00.000Z'),
    });
    await store.recordSpend(T, '2026-05-31', 100, 0, 'haiku');
    const decision = await gov.evaluateCall({
      tenantId: T,
      model: 'haiku',
      estimatedTokens: 1,
    });
    if (decision.kind !== 'block') throw new Error('expected block');
    expect(decision.resetsAt).toBe('2026-06-01');
  });

  it('monthly period uses monthly periodKey', async () => {
    const store = createInMemoryBudgetStore();
    await seedBudget(store, {
      tenantId: T,
      period: 'monthly',
      capCents: 100_000,
      capTokens: 100_000_000,
      allowedTiers: ['haiku', 'sonnet'],
    });
    const gov = createLLMBudgetGovernor({ store, now: fixed });
    const snap = await gov.snapshot(T);
    expect(snap.periodKey).toBe('2026-05');
  });
});

describe('governor.recordSpend', () => {
  it('writes through to the store', async () => {
    const { store, gov } = await bootstrap();
    await gov.recordSpend({
      tenantId: T,
      model: 'sonnet',
      inputTokens: 500,
      outputTokens: 500,
    });
    const u = await store.getUsage(T, '2026-05-25');
    expect(u.usedTokens).toBe(1000);
    expect(u.usedCents).toBeGreaterThan(0);
  });

  it('no-ops when no budget configured', async () => {
    const store = createInMemoryBudgetStore();
    const gov = createLLMBudgetGovernor({ store, now: fixed });
    await gov.recordSpend({
      tenantId: 'unknown',
      model: 'opus',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    const u = await store.getUsage('unknown', '2026-05-25');
    expect(u.usedTokens).toBe(0);
  });
});

describe('governor.snapshot', () => {
  it('returns current usage', async () => {
    const { store, gov } = await bootstrap();
    await store.recordSpend(T, '2026-05-25', 5000, 50000, 'sonnet');
    const snap = await gov.snapshot(T);
    expect(snap.usedCents).toBe(5000);
    expect(snap.usedTokens).toBe(50000);
  });

  it('returns null budget when not seeded', async () => {
    const store = createInMemoryBudgetStore();
    const gov = createLLMBudgetGovernor({ store, now: fixed });
    const snap = await gov.snapshot('unknown');
    expect(snap.budget).toBeNull();
  });
});

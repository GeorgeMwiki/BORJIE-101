/**
 * privacy-budget-ledger.test.ts — per-tenant ε bookkeeping.
 */

import { describe, it, expect } from 'vitest';
import {
  PrivacyBudgetLedger,
  InMemoryPrivacyBudgetRepository,
  BudgetExceededError,
  DEFAULT_PLAN_TIER_BUDGETS,
} from '../privacy-budget-ledger.js';

describe('dp-memory/privacy-budget-ledger', () => {
  it('initialises a fresh tenant with the default budget', async () => {
    const ledger = new PrivacyBudgetLedger({ repository: new InMemoryPrivacyBudgetRepository() });
    const snap = await ledger.snapshot('t1');
    expect(snap.totalEpsilon).toBe(DEFAULT_PLAN_TIER_BUDGETS.default);
    expect(snap.usedEpsilon).toBe(0);
  });

  it('consume debits the budget incrementally', async () => {
    const ledger = new PrivacyBudgetLedger();
    await ledger.consume('t1', 0.25);
    const snap1 = await ledger.snapshot('t1');
    expect(snap1.usedEpsilon).toBeCloseTo(0.25);
    await ledger.consume('t1', 0.25);
    const snap2 = await ledger.snapshot('t1');
    expect(snap2.usedEpsilon).toBeCloseTo(0.5);
  });

  it('refuses consumption beyond the budget', async () => {
    const ledger = new PrivacyBudgetLedger();
    await ledger.consume('t1', 0.9);
    await expect(ledger.consume('t1', 0.5)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('check returns false when over budget, true when within', async () => {
    const ledger = new PrivacyBudgetLedger();
    await ledger.consume('t1', 0.5);
    expect(await ledger.check('t1', 0.4)).toBe(true);
    expect(await ledger.check('t1', 0.6)).toBe(false);
  });

  it('resetMonthly rolls expired windows and zeroes usedEpsilon', async () => {
    let now = new Date('2026-01-15T00:00:00Z');
    const ledger = new PrivacyBudgetLedger({
      now: () => now,
      repository: new InMemoryPrivacyBudgetRepository(),
    });
    await ledger.consume('t1', 0.7);
    expect((await ledger.snapshot('t1')).usedEpsilon).toBeCloseTo(0.7);
    // Advance the clock past the next month boundary.
    now = new Date('2026-03-02T00:00:00Z');
    const rolled = await ledger.resetMonthly();
    expect(rolled).toBe(1);
    const snap = await ledger.snapshot('t1');
    expect(snap.usedEpsilon).toBe(0);
  });

  it('applies plan-tier budgets via getPlanTier', async () => {
    const ledger = new PrivacyBudgetLedger({
      getPlanTier: (id) => (id === 't-big' ? 'enterprise' : 'free'),
    });
    const small = await ledger.snapshot('t-small');
    const big = await ledger.snapshot('t-big');
    expect(small.totalEpsilon).toBe(DEFAULT_PLAN_TIER_BUDGETS.free);
    expect(big.totalEpsilon).toBe(DEFAULT_PLAN_TIER_BUDGETS.enterprise);
  });

  it('rejects non-positive epsilons', async () => {
    const ledger = new PrivacyBudgetLedger();
    await expect(ledger.consume('t1', 0)).rejects.toThrow();
    await expect(ledger.check('t1', -1)).rejects.toThrow();
  });
});

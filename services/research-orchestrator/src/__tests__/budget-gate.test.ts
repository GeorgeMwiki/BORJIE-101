/**
 * Budget-gate tests — verify reserve/commit/release, owner-confirm
 * gate, latency clock, and the canSpend composition.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createBudgetGate,
  createCostTracker,
  createOwnerConfirmGate,
  NEVER_GATES,
} from '../budgets/budget-gate.js';

describe('createCostTracker', () => {
  it('reserves until budget is exhausted', async () => {
    const t = createCostTracker({ budget_usd_cents: 10 });
    expect(await t.tryReserve(5)).toBe(true);
    expect(await t.tryReserve(5)).toBe(true);
    expect(await t.tryReserve(1)).toBe(false);
  });

  it('commit moves reserved to committed; budget remains accurate', async () => {
    const t = createCostTracker({ budget_usd_cents: 10 });
    await t.tryReserve(5);
    await t.commit(3);
    expect(await t.spent()).toBe(3);
    // We over-reserved by 2, but committed only 3 — remaining budget
    // is 7 (10 - 3); a new 5-cent reservation should fit.
    expect(await t.tryReserve(5)).toBe(true);
  });

  it('release frees the reservation', async () => {
    const t = createCostTracker({ budget_usd_cents: 10 });
    await t.tryReserve(8);
    await t.release(8);
    expect(await t.tryReserve(10)).toBe(true);
  });
});

describe('createOwnerConfirmGate', () => {
  it('triggers when an unacknowledged gate is crossed', () => {
    const g = createOwnerConfirmGate({ gates_usd: [5, 15] });
    expect(g.needsConfirm(400)).toBe(false);
    expect(g.needsConfirm(500)).toBe(true);
    expect(g.needsConfirm(1500)).toBe(true);
  });

  it('skips gates the owner already acked', () => {
    const g = createOwnerConfirmGate({
      gates_usd: [5, 15],
      acknowledged_gates_usd: [5],
    });
    expect(g.needsConfirm(500)).toBe(false);
    expect(g.needsConfirm(1500)).toBe(true);
  });

  it('NEVER_GATES always returns false', () => {
    expect(NEVER_GATES.needsConfirm(9999)).toBe(false);
  });
});

describe('createBudgetGate — composition', () => {
  it('latency clock fires after the configured ms', () => {
    let nowVal = 0;
    const gate = createBudgetGate({
      budget_usd_cents: 100,
      latency_ms: 1000,
      now: () => nowVal,
    });
    gate.start();
    nowVal = 500;
    expect(gate.isLatencyExceeded()).toBe(false);
    nowVal = 1500;
    expect(gate.isLatencyExceeded()).toBe(true);
  });

  it('canSpend returns false when over a gate', async () => {
    const gate = createBudgetGate({
      budget_usd_cents: 2_500,
      latency_ms: 60_000,
      owner_confirm_gates_usd: [5, 15],
    });
    gate.start();
    expect(await gate.canSpend(100, 500)).toBe(false);
  });

  it('canSpend returns false when latency exceeded', async () => {
    let nowVal = 0;
    const gate = createBudgetGate({
      budget_usd_cents: 100,
      latency_ms: 1000,
      now: () => nowVal,
    });
    gate.start();
    nowVal = 5000;
    expect(await gate.canSpend(1, 0)).toBe(false);
  });

  it('canSpend reserves when under budget + within latency + no gate', async () => {
    const gate = createBudgetGate({
      budget_usd_cents: 100,
      latency_ms: 60_000,
    });
    gate.start();
    expect(await gate.canSpend(10, 0)).toBe(true);
    expect(await gate.canSpend(95, 0)).toBe(false);
  });
});

describe('createBudgetGate — elapsed clock', () => {
  it('elapsedMs is zero before start', () => {
    const gate = createBudgetGate({ budget_usd_cents: 0, latency_ms: 1 });
    expect(gate.elapsedMs()).toBe(0);
  });
});

describe('budget gate with spies', () => {
  it('tracks all spent calls', async () => {
    const gate = createBudgetGate({ budget_usd_cents: 100, latency_ms: 60_000 });
    const spy = vi.spyOn(gate.tracker, 'spent');
    gate.start();
    await gate.tracker.tryReserve(10);
    await gate.tracker.commit(8);
    await gate.tracker.spent();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

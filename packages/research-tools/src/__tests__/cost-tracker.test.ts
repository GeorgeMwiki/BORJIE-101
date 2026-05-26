/**
 * Cost-tracker + owner-confirm gate tests — threshold gating.
 */

import { describe, expect, it } from 'vitest';

import {
  createCostTracker,
  createOwnerConfirmGate,
  NEVER_GATES,
} from '../budgets/cost-tracker.js';

describe('createCostTracker', () => {
  it('allows reservation within budget', async () => {
    const t = createCostTracker({ budget_usd_cents: 100 });
    expect(await t.tryReserve(40)).toBe(true);
    expect(await t.tryReserve(50)).toBe(true);
  });

  it('refuses reservation that would exceed budget', async () => {
    const t = createCostTracker({ budget_usd_cents: 100 });
    expect(await t.tryReserve(60)).toBe(true);
    expect(await t.tryReserve(50)).toBe(false);
    expect(await t.spent()).toBe(0);
  });

  it('commits actual cost and releases over-reservation', async () => {
    const t = createCostTracker({ budget_usd_cents: 100 });
    await t.tryReserve(50);
    await t.commit(30);
    expect(await t.spent()).toBe(30);
    // Now there's 70 left in budget
    expect(await t.tryReserve(70)).toBe(true);
  });

  it('release frees up the reservation entirely', async () => {
    const t = createCostTracker({ budget_usd_cents: 100 });
    await t.tryReserve(50);
    await t.release(50);
    expect(await t.tryReserve(100)).toBe(true);
  });

  it('respects initial_spent_cents from resumed plans', async () => {
    const t = createCostTracker({
      budget_usd_cents: 100,
      initial_spent_cents: 80,
    });
    expect(await t.spent()).toBe(80);
    expect(await t.tryReserve(25)).toBe(false);
    expect(await t.tryReserve(20)).toBe(true);
  });

  it('coerces negative values to zero', async () => {
    const t = createCostTracker({ budget_usd_cents: -50 });
    expect(t.budget()).toBe(0);
    expect(await t.tryReserve(1)).toBe(false);
  });
});

describe('createOwnerConfirmGate', () => {
  it('returns false when spend is below all gates', () => {
    const gate = createOwnerConfirmGate({ gates_usd: [5, 15] });
    expect(gate.needsConfirm(100)).toBe(false); // $1, below $5
    expect(gate.needsConfirm(499)).toBe(false); // just under
  });

  it('returns true at $5 gate boundary', () => {
    const gate = createOwnerConfirmGate({ gates_usd: [5, 15] });
    expect(gate.needsConfirm(500)).toBe(true);
  });

  it('returns true at $15 gate', () => {
    const gate = createOwnerConfirmGate({ gates_usd: [5, 15] });
    expect(gate.needsConfirm(1_500)).toBe(true);
  });

  it('honors acknowledged gates', () => {
    const gate = createOwnerConfirmGate({
      gates_usd: [5, 15],
      acknowledged_gates_usd: [5],
    });
    expect(gate.needsConfirm(500)).toBe(false);
    expect(gate.needsConfirm(1_500)).toBe(true);
  });

  it('NEVER_GATES is always false', () => {
    expect(NEVER_GATES.needsConfirm(99_999)).toBe(false);
  });
});

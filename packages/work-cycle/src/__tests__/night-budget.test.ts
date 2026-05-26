/**
 * Tests for the budget gate (spec §7).
 */

import { describe, it, expect } from 'vitest';

import {
  capForMode,
  createBudgetGate,
  createInMemoryBudgetLedger,
  DEFAULT_BUDGET_CAPS,
} from '../budget/night-budget.js';

describe('night-budget / capForMode', () => {
  it('returns the configured cap per mode', () => {
    expect(capForMode('night', DEFAULT_BUDGET_CAPS)).toBe(500);
    expect(capForMode('idle', DEFAULT_BUDGET_CAPS)).toBe(2_000);
    expect(capForMode('active', DEFAULT_BUDGET_CAPS)).toBe(10_000);
    expect(capForMode('observe', DEFAULT_BUDGET_CAPS)).toBe(0);
  });
});

describe('night-budget / canAffordTick', () => {
  it('allows a $0 tick in any mode except observe', async () => {
    const gate = createBudgetGate({ ledger: createInMemoryBudgetLedger() });
    for (const mode of ['active', 'idle', 'night'] as const) {
      const d = await gate.canAffordTick({
        tenantId: 't',
        mode,
        estimatedCostCents: 0,
      });
      expect(d.allowed).toBe(true);
    }
  });

  it('allows a $0 observe tick', async () => {
    const gate = createBudgetGate({ ledger: createInMemoryBudgetLedger() });
    const d = await gate.canAffordTick({
      tenantId: 't',
      mode: 'observe',
      estimatedCostCents: 0,
    });
    expect(d.allowed).toBe(true);
  });

  it('blocks any spend in observe mode', async () => {
    const gate = createBudgetGate({ ledger: createInMemoryBudgetLedger() });
    const d = await gate.canAffordTick({
      tenantId: 't',
      mode: 'observe',
      estimatedCostCents: 1,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('mode_locked');
  });

  it('blocks once cap reached in night mode', async () => {
    const ledger = createInMemoryBudgetLedger();
    const gate = createBudgetGate({ ledger });
    // Spend up to the cap.
    await ledger.recordSpend({
      tenantId: 't',
      amountUsdCents: 499,
      atIso: new Date().toISOString(),
    });
    const ok = await gate.canAffordTick({
      tenantId: 't',
      mode: 'night',
      estimatedCostCents: 1,
    });
    expect(ok.allowed).toBe(true);
    const blocked = await gate.canAffordTick({
      tenantId: 't',
      mode: 'night',
      estimatedCostCents: 2,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('cap_reached');
  });

  it('respects custom caps', async () => {
    const ledger = createInMemoryBudgetLedger();
    const gate = createBudgetGate({
      ledger,
      caps: {
        nightDailyCapUsdCents: 10,
        idleDailyCapUsdCents: 100,
        activeDailyCapUsdCents: 1000,
      },
    });
    await ledger.recordSpend({
      tenantId: 't',
      amountUsdCents: 11,
      atIso: new Date().toISOString(),
    });
    const blocked = await gate.canAffordTick({
      tenantId: 't',
      mode: 'night',
      estimatedCostCents: 0,
    });
    expect(blocked.allowed).toBe(false);
  });

  it('ledger ignores spend older than 24h', async () => {
    const ledger = createInMemoryBudgetLedger();
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await ledger.recordSpend({
      tenantId: 't',
      amountUsdCents: 10000,
      atIso: stale,
    });
    expect(await ledger.spentLast24hCents('t')).toBe(0);
  });

  it('ledger respects fresh spend', async () => {
    const ledger = createInMemoryBudgetLedger();
    const fresh = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    await ledger.recordSpend({
      tenantId: 't',
      amountUsdCents: 250,
      atIso: fresh,
    });
    expect(await ledger.spentLast24hCents('t')).toBe(250);
  });

  it('recordSpend on the gate is a no-op when amount is 0', async () => {
    const ledger = createInMemoryBudgetLedger();
    const gate = createBudgetGate({ ledger });
    await gate.recordSpend({
      tenantId: 't',
      amountUsdCents: 0,
      atIso: new Date().toISOString(),
    });
    expect(await ledger.spentLast24hCents('t')).toBe(0);
  });

  it('recordSpend on the gate appends positive amounts', async () => {
    const ledger = createInMemoryBudgetLedger();
    const gate = createBudgetGate({ ledger });
    await gate.recordSpend({
      tenantId: 't',
      amountUsdCents: 42,
      atIso: new Date().toISOString(),
    });
    expect(await ledger.spentLast24hCents('t')).toBe(42);
  });
});

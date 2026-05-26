import { describe, it, expect } from 'vitest';
import { createEpsilonBudgetManager } from '../budget/epsilon-budget.js';
import { createInMemoryEpsilonBudgetsRepository } from '../repositories/epsilon-budgets-repository.js';
import { createInMemoryEpsilonLedgerRepository } from '../repositories/epsilon-ledger-repository.js';
import {
  EpsilonBudgetExhausted,
  StrategicLayerError,
} from '../types.js';

function makeManager(startMs = 1_800_000_000_000) {
  const budgetRepo = createInMemoryEpsilonBudgetsRepository();
  const ledgerRepo = createInMemoryEpsilonLedgerRepository();
  let nowMs = startMs;
  const manager = createEpsilonBudgetManager({
    budgetRepo,
    ledgerRepo,
    now: () => new Date(nowMs),
  });
  return {
    budgetRepo,
    ledgerRepo,
    manager,
    setNowMs: (ms: number) => (nowMs = ms),
  };
}

describe('EpsilonBudgetManager', () => {
  it('initialises a budget and exposes the full quota as remaining', async () => {
    const { manager } = makeManager();
    const budget = await manager.initialise({
      tenantId: 't1',
      periodStart: '2026-05-01',
      totalEpsilon: 4,
    });
    expect(budget.totalEpsilon).toBe(4);
    expect(budget.spentEpsilon).toBe(0);
    const remaining = await manager.remaining('t1', '2026-05-01');
    expect(remaining).toBe(4);
  });

  it('rejects malformed periodStart', async () => {
    const { manager } = makeManager();
    await expect(
      manager.initialise({
        tenantId: 't1',
        periodStart: '2026-05-15',
        totalEpsilon: 4,
      }),
    ).rejects.toBeInstanceOf(StrategicLayerError);
  });

  it('charges within the limit and decrements `remaining` accordingly', async () => {
    const { manager } = makeManager();
    await manager.initialise({
      tenantId: 't1',
      periodStart: '2026-05-01',
      totalEpsilon: 4,
    });
    const result = await manager.charge({
      tenantId: 't1',
      periodStart: '2026-05-01',
      chargeEpsilon: 0.5,
      opKind: 'federation_promote',
      opId: 'cell-001',
    });
    expect(result.remaining).toBeCloseTo(3.5);
    expect(result.entry.opKind).toBe('federation_promote');
    expect(result.entry.auditHash.length).toBe(64);
  });

  it('blocks a charge that would exhaust the budget', async () => {
    const { manager } = makeManager();
    await manager.initialise({
      tenantId: 't1',
      periodStart: '2026-05-01',
      totalEpsilon: 1,
    });
    await manager.charge({
      tenantId: 't1',
      periodStart: '2026-05-01',
      chargeEpsilon: 0.6,
      opKind: 'federation_promote',
      opId: 'cell-001',
    });
    await expect(
      manager.charge({
        tenantId: 't1',
        periodStart: '2026-05-01',
        chargeEpsilon: 0.5,
        opKind: 'federation_promote',
        opId: 'cell-002',
      }),
    ).rejects.toBeInstanceOf(EpsilonBudgetExhausted);
    // The failed charge MUST NOT show up in the budget.
    const remaining = await manager.remaining('t1', '2026-05-01');
    expect(remaining).toBeCloseTo(0.4);
  });

  it('is idempotent on (tenant, opKind, opId)', async () => {
    const { manager } = makeManager();
    await manager.initialise({
      tenantId: 't1',
      periodStart: '2026-05-01',
      totalEpsilon: 4,
    });
    const first = await manager.charge({
      tenantId: 't1',
      periodStart: '2026-05-01',
      chargeEpsilon: 0.5,
      opKind: 'federation_promote',
      opId: 'cell-001',
    });
    const second = await manager.charge({
      tenantId: 't1',
      periodStart: '2026-05-01',
      chargeEpsilon: 0.5,
      opKind: 'federation_promote',
      opId: 'cell-001',
    });
    expect(second.entry.id).toBe(first.entry.id);
    expect(await manager.remaining('t1', '2026-05-01')).toBeCloseTo(3.5);
  });

  it('composes Rényi ε linearly at fixed α (Mironov 2017 Theorem 1)', async () => {
    const { manager } = makeManager();
    // Reference vector — 8 independent charges of 0.125 at α=4 composes
    // to 1.0 under linear-additive composition.
    const charges = [0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125];
    const composed = manager.composeRenyi(charges, 4);
    expect(composed).toBeCloseTo(1.0, 10);

    // A second known vector — 0.3 + 0.4 + 0.1 = 0.8 at α=4.
    expect(manager.composeRenyi([0.3, 0.4, 0.1], 4)).toBeCloseTo(0.8, 10);

    // Composition is α-independent under linear sum (this is the WHOLE
    // point of fixed-α RDP composition).
    expect(manager.composeRenyi([0.3, 0.4, 0.1], 2)).toBeCloseTo(0.8, 10);

    // Mironov 2017 Proposition 3 — at α=4, δ=10^-6:
    //   ε_eff = 1.0 + log(10^6) / (4 - 1)
    //         = 1.0 + ln(10^6) / 3
    //         = 1.0 + 13.8155... / 3
    //         ≈ 1.0 + 4.6052
    //         ≈ 5.6052.
    const epsDelta = manager.toEpsilonDelta(1.0, 4, 1e-6);
    expect(epsDelta).toBeCloseTo(1.0 + Math.log(1e6) / 3, 10);
    expect(epsDelta).toBeGreaterThan(5.6);
    expect(epsDelta).toBeLessThan(5.7);
  });

  it('rejects an invalid α and δ for the Rényi conversion', async () => {
    const { manager } = makeManager();
    expect(() => manager.composeRenyi([0.5], 1)).toThrow(StrategicLayerError);
    expect(() => manager.toEpsilonDelta(0.5, 4, 0)).toThrow(StrategicLayerError);
    expect(() => manager.toEpsilonDelta(0.5, 4, 1)).toThrow(StrategicLayerError);
  });
});

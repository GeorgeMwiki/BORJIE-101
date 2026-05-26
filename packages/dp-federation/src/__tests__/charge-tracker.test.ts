import { describe, expect, it } from 'vitest';
import {
  BudgetExhaustedError,
  createChargeTracker,
} from '../charges/charge-tracker.js';
import { createInMemoryDpChargesRepository } from '../repositories/dp-charges-repository.js';
import type {
  AuditChainPort,
  ClockPort,
  EpsilonBudget,
  EpsilonBudgetPort,
  UuidPort,
} from '../types.js';

function makeClock(): ClockPort {
  return Object.freeze({
    nowIso: () => '2026-05-26T10:00:00.000Z',
    nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
  });
}

function makeUuid(): UuidPort {
  let n = 0;
  return Object.freeze({
    next: () => {
      n += 1;
      return `uuid-${n}`;
    },
  });
}

function makeHash(): AuditChainPort {
  return Object.freeze({
    hash: (prev, payload) =>
      `h-${prev ?? 'genesis'}-${JSON.stringify(payload).length}`,
  });
}

function makeBudget(epsilonTotal: number): EpsilonBudgetPort {
  return Object.freeze({
    get: async (tenantId, periodStart): Promise<EpsilonBudget> =>
      Object.freeze({
        tenantId,
        periodStart,
        epsilonTotal,
        deltaTotal: 1e-5,
      }),
  });
}

describe('createChargeTracker', () => {
  it('records a charge and reduces remaining budget', async () => {
    const tracker = createChargeTracker({
      chargesRepository: createInMemoryDpChargesRepository(),
      budgetPort: makeBudget(4),
      clock: makeClock(),
      uuid: makeUuid(),
      auditChain: makeHash(),
    });

    const outcome = await tracker.record({
      tenantId: 'tenant-a',
      periodStart: '2026-04-01',
      operation: 'dp-mean',
      opId: 'op-1',
      epsilonDelta: 0.5,
    });

    expect(outcome.charge.epsilonDelta).toBe(0.5);
    expect(outcome.remainingEpsilon).toBeCloseTo(3.5, 9);

    const remaining = await tracker.remaining(
      'tenant-a',
      '2026-04-01',
    );
    expect(remaining).toBeCloseTo(3.5, 9);
  });

  it('blocks when the budget would go negative', async () => {
    const tracker = createChargeTracker({
      chargesRepository: createInMemoryDpChargesRepository(),
      budgetPort: makeBudget(1),
      clock: makeClock(),
      uuid: makeUuid(),
      auditChain: makeHash(),
    });

    await expect(
      tracker.record({
        tenantId: 'tenant-a',
        periodStart: '2026-04-01',
        operation: 'dp-mean',
        opId: 'op-1',
        epsilonDelta: 2.0,
      }),
    ).rejects.toThrowError(BudgetExhaustedError);
  });

  it('is idempotent on duplicate opId', async () => {
    const tracker = createChargeTracker({
      chargesRepository: createInMemoryDpChargesRepository(),
      budgetPort: makeBudget(4),
      clock: makeClock(),
      uuid: makeUuid(),
      auditChain: makeHash(),
    });

    const a = await tracker.record({
      tenantId: 'tenant-a',
      periodStart: '2026-04-01',
      operation: 'dp-mean',
      opId: 'op-1',
      epsilonDelta: 0.5,
    });
    const b = await tracker.record({
      tenantId: 'tenant-a',
      periodStart: '2026-04-01',
      operation: 'dp-mean',
      opId: 'op-1',
      epsilonDelta: 0.5,
    });

    // Same charge returned twice — budget only debited once.
    expect(b.charge.id).toBe(a.charge.id);
    expect(b.remainingEpsilon).toBeCloseTo(3.5, 9);
  });

  it('rejects non-finite epsilonDelta', async () => {
    const tracker = createChargeTracker({
      chargesRepository: createInMemoryDpChargesRepository(),
      budgetPort: makeBudget(4),
      clock: makeClock(),
      uuid: makeUuid(),
      auditChain: makeHash(),
    });
    await expect(
      tracker.record({
        tenantId: 'tenant-a',
        periodStart: '2026-04-01',
        operation: 'dp-mean',
        opId: 'op-bad',
        epsilonDelta: Number.NaN,
      }),
    ).rejects.toThrow();
  });
});

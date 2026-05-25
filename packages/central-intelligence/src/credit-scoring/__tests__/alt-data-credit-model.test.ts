/**
 * Unit tests for the alternative-data credit scoring model.
 *
 * Synthetic-data only — no external calls. The model is a pure
 * deterministic transform over signals so all branches are exercised
 * with handcrafted inputs.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AltCreditInputSchema,
  ALT_CREDIT_MODEL_VERSION,
  bandFor,
  createAltCreditService,
  DEFAULT_ALT_CREDIT_WEIGHTS,
  scoreMpesaCashflow,
  scorePayrollRegularity,
  scoreUtilityOnTime,
  type AltCreditInput,
  type AltCreditScore,
  type AltCreditScoreRepository,
} from '../alt-data-credit-model.js';

function makeRepo(): {
  repo: AltCreditScoreRepository;
  saved: Array<AltCreditScore & { rawInputs: AltCreditInput }>;
} {
  const saved: Array<AltCreditScore & { rawInputs: AltCreditInput }> = [];
  return {
    saved,
    repo: {
      async saveScore(score) {
        saved.push(score);
      },
      async loadLatestScore(tenantId, customerId) {
        const matches = saved.filter(
          (s) => s.tenantId === tenantId && s.customerId === customerId,
        );
        return matches.length > 0 ? matches[matches.length - 1]! : null;
      },
    },
  };
}

const BASE_INPUT: AltCreditInput = {
  tenantId: 't-alpha',
  customerId: 'c-1',
  mpesa: { txCount30d: 20, distinctRecipients: 8 },
  utility: { paymentsObserved: 10, paymentsOnTime: 9 },
  payroll: { periodsObserved: 6, periodsOnSchedule: 6 },
};

describe('scoreMpesaCashflow', () => {
  it('zero tx → 0', () => {
    expect(scoreMpesaCashflow({ txCount30d: 0, distinctRecipients: 5 })).toBe(0);
  });

  it('30+ tx with diverse recipients saturates at 1000', () => {
    const s = scoreMpesaCashflow({ txCount30d: 60, distinctRecipients: 20 });
    expect(s).toBe(1000);
  });

  it('30 tx but only 1 recipient is penalised by multiplier', () => {
    const broad = scoreMpesaCashflow({ txCount30d: 30, distinctRecipients: 10 });
    const narrow = scoreMpesaCashflow({ txCount30d: 30, distinctRecipients: 1 });
    expect(narrow).toBeLessThan(broad);
  });
});

describe('scoreUtilityOnTime', () => {
  it('no history → neutral 500', () => {
    expect(scoreUtilityOnTime({ paymentsObserved: 0, paymentsOnTime: 0 })).toBe(
      500,
    );
  });

  it('100% on time → 1000', () => {
    expect(scoreUtilityOnTime({ paymentsObserved: 10, paymentsOnTime: 10 })).toBe(
      1000,
    );
  });

  it('0% on time → 0', () => {
    expect(scoreUtilityOnTime({ paymentsObserved: 10, paymentsOnTime: 0 })).toBe(
      0,
    );
  });

  it('partial on-time scales linearly', () => {
    expect(scoreUtilityOnTime({ paymentsObserved: 10, paymentsOnTime: 7 })).toBe(
      700,
    );
  });
});

describe('scorePayrollRegularity', () => {
  it('no payroll signal → 400', () => {
    expect(scorePayrollRegularity({ periodsObserved: 0, periodsOnSchedule: 0 })).toBe(
      400,
    );
  });

  it('all on schedule → 1000', () => {
    expect(scorePayrollRegularity({ periodsObserved: 6, periodsOnSchedule: 6 })).toBe(
      1000,
    );
  });

  it('zero on schedule → 0', () => {
    expect(scorePayrollRegularity({ periodsObserved: 6, periodsOnSchedule: 0 })).toBe(
      0,
    );
  });
});

describe('bandFor', () => {
  it('classifies scores into bands', () => {
    expect(bandFor(900)).toBe('excellent');
    expect(bandFor(700)).toBe('good');
    expect(bandFor(500)).toBe('fair');
    expect(bandFor(200)).toBe('poor');
    expect(bandFor(800)).toBe('excellent');
    expect(bandFor(650)).toBe('good');
    expect(bandFor(450)).toBe('fair');
  });
});

describe('createAltCreditService.score', () => {
  it('produces a blended score persisted to repo', async () => {
    const { repo, saved } = makeRepo();
    const svc = createAltCreditService({ repo });
    const out = await svc.score(BASE_INPUT);
    expect(out.score).toBeGreaterThan(0);
    expect(out.score).toBeLessThanOrEqual(1000);
    expect(out.modelVersion).toBe(ALT_CREDIT_MODEL_VERSION);
    expect(['poor', 'fair', 'good', 'excellent']).toContain(out.band);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.rawInputs).toEqual(BASE_INPUT);
  });

  it('strong signals across the board → excellent band', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    const out = await svc.score({
      ...BASE_INPUT,
      mpesa: { txCount30d: 60, distinctRecipients: 15 },
      utility: { paymentsObserved: 20, paymentsOnTime: 20 },
      payroll: { periodsObserved: 12, periodsOnSchedule: 12 },
    });
    expect(out.band).toBe('excellent');
  });

  it('weak signals across the board → poor band', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    const out = await svc.score({
      ...BASE_INPUT,
      mpesa: { txCount30d: 0, distinctRecipients: 0 },
      utility: { paymentsObserved: 10, paymentsOnTime: 0 },
      payroll: { periodsObserved: 6, periodsOnSchedule: 0 },
    });
    expect(out.band).toBe('poor');
  });

  it('uses provided clock for computedAt', async () => {
    const { repo } = makeRepo();
    const fixed = new Date('2026-05-15T10:00:00Z');
    const svc = createAltCreditService({ repo, clock: () => fixed });
    const out = await svc.score(BASE_INPUT);
    expect(out.computedAt).toBe(fixed.toISOString());
  });

  it('rejects on-time > observed for utility', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    await expect(
      svc.score({
        ...BASE_INPUT,
        utility: { paymentsObserved: 3, paymentsOnTime: 5 },
      }),
    ).rejects.toThrow(/paymentsOnTime cannot exceed/);
  });

  it('rejects on-schedule > observed for payroll', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    await expect(
      svc.score({
        ...BASE_INPUT,
        payroll: { periodsObserved: 3, periodsOnSchedule: 5 },
      }),
    ).rejects.toThrow(/periodsOnSchedule cannot exceed/);
  });

  it('rejects negative txCount via schema', () => {
    expect(
      AltCreditInputSchema.safeParse({
        ...BASE_INPUT,
        mpesa: { txCount30d: -1, distinctRecipients: 5 },
      }).success,
    ).toBe(false);
  });

  it('latest reads back the most recent score', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    await svc.score(BASE_INPUT);
    const latest = await svc.latest('t-alpha', 'c-1');
    expect(latest).not.toBeNull();
    expect(latest?.customerId).toBe('c-1');
  });

  it('latest returns null for unknown (tenant, customer)', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    const latest = await svc.latest('t-unknown', 'c-unknown');
    expect(latest).toBeNull();
  });

  it('default weights sum to 1.0', () => {
    const total =
      DEFAULT_ALT_CREDIT_WEIGHTS.mpesaCashflow +
      DEFAULT_ALT_CREDIT_WEIGHTS.utilityOnTime +
      DEFAULT_ALT_CREDIT_WEIGHTS.payrollRegularity;
    expect(total).toBeCloseTo(1.0);
  });

  it('throws when constructed with zero-weight bundle', () => {
    const { repo } = makeRepo();
    expect(() =>
      createAltCreditService({
        repo,
        weights: { mpesaCashflow: 0, utilityOnTime: 0, payrollRegularity: 0 },
      }),
    ).toThrow(/weights must sum/);
  });

  it('uses injected clock for determinism', async () => {
    const clock = vi.fn(() => new Date('2026-01-01T00:00:00Z'));
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo, clock });
    const a = await svc.score(BASE_INPUT);
    const b = await svc.score(BASE_INPUT);
    expect(a.computedAt).toBe(b.computedAt);
  });

  it('preserves sub-scores in output', async () => {
    const { repo } = makeRepo();
    const svc = createAltCreditService({ repo });
    const out = await svc.score(BASE_INPUT);
    expect(out.subScores.mpesaCashflow).toBeGreaterThan(0);
    expect(out.subScores.utilityOnTime).toBe(900);
    expect(out.subScores.payrollRegularity).toBe(1000);
  });
});

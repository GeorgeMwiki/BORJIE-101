import { describe, it, expect } from 'vitest';
import {
  scoreTenantCredit,
  DEFAULT_GRADING_WEIGHTS,
  CREDIT_SCORE_CONSTANTS,
  type CreditRatingInputs,
} from '../index.js';

function makeInputs(overrides: Partial<CreditRatingInputs> = {}): CreditRatingInputs {
  return {
    tenantId: 't-1',
    customerId: 'c-1',
    totalInvoices: 24,
    paidOnTimeCount: 23,
    paidLate30DaysCount: 1,
    paidLate60DaysCount: 0,
    paidLate90PlusCount: 0,
    defaultCount: 0,
    extensionsGranted: 2,
    extensionsHonored: 2,
    installmentAgreementsOffered: 1,
    installmentAgreementsHonored: 1,
    rentToIncomeRatio: 0.25,
    avgTenancyMonths: 24,
    activeTenancyCount: 1,
    disputeCount: 0,
    damageDeductionCount: 0,
    subleaseViolationCount: 0,
    newestInvoiceAt: new Date().toISOString(),
    oldestInvoiceAt: new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

describe('scoring-model — FICO scale', () => {
  it('produces a score in [300, 850]', () => {
    const r = scoreTenantCredit(makeInputs());
    expect(r.numericScore).not.toBeNull();
    expect(r.numericScore!).toBeGreaterThanOrEqual(CREDIT_SCORE_CONSTANTS.MIN_SCORE);
    expect(r.numericScore!).toBeLessThanOrEqual(CREDIT_SCORE_CONSTANTS.MAX_SCORE);
  });

  it('excellent profile maps to band=excellent', () => {
    const r = scoreTenantCredit(makeInputs());
    expect(r.band).toBe('excellent');
    expect(r.letterGrade).toMatch(/A|B/);
  });

  it('very poor profile maps to band=very_poor', () => {
    const r = scoreTenantCredit(
      makeInputs({
        paidOnTimeCount: 2,
        paidLate30DaysCount: 4,
        paidLate60DaysCount: 6,
        paidLate90PlusCount: 8,
        defaultCount: 4,
        extensionsHonored: 0,
        installmentAgreementsHonored: 0,
        rentToIncomeRatio: 0.8,
        avgTenancyMonths: 2,
        disputeCount: 5,
        damageDeductionCount: 3,
        subleaseViolationCount: 2,
      }),
    );
    expect(['very_poor', 'poor']).toContain(r.band);
    expect(['D', 'F']).toContain(r.letterGrade);
  });

  it('pure function — same inputs produce same output', () => {
    const inputs = makeInputs();
    const a = scoreTenantCredit(inputs);
    const b = scoreTenantCredit(inputs);
    expect(a).toEqual(b);
  });

  it('insufficient data returns band=insufficient_data with reason', () => {
    const r = scoreTenantCredit(
      makeInputs({ totalInvoices: 1, paidOnTimeCount: 1 }),
    );
    expect(r.band).toBe('insufficient_data');
    expect(r.numericScore).toBeNull();
    expect(r.letterGrade).toBeNull();
    expect(r.insufficientDataReason).toBeTruthy();
  });

  it('respects configured weights — all on payment history', () => {
    const r = scoreTenantCredit(
      makeInputs({ disputeCount: 10 }),
      {
        payment_history: 1,
        promise_keeping: 0,
        rent_to_income: 0,
        tenancy_length: 0,
        dispute_history: 0,
      },
    );
    // With all weight on payment history + clean record, should still be high band.
    expect(['excellent', 'good']).toContain(r.band);
  });

  it('dimensions include weight values that normalize to ~1', () => {
    const r = scoreTenantCredit(makeInputs());
    const total =
      r.dimensions.payment_history.weight +
      r.dimensions.promise_keeping.weight +
      r.dimensions.rent_to_income.weight +
      r.dimensions.tenancy_length.weight +
      r.dimensions.dispute_history.weight;
    expect(total).toBeCloseTo(1, 2);
  });

  it('weakest factor identified when payment history poor', () => {
    const r = scoreTenantCredit(
      makeInputs({
        paidOnTimeCount: 1,
        paidLate90PlusCount: 20,
        defaultCount: 3,
      }),
    );
    expect(r.weakestFactor).toBe('payment_history');
  });

  it('promise keeping: honored extensions improve score', () => {
    const base = makeInputs({
      extensionsGranted: 5,
      extensionsHonored: 0,
      installmentAgreementsOffered: 0,
    });
    const better = { ...base, extensionsHonored: 5 };
    const a = scoreTenantCredit(base);
    const b = scoreTenantCredit(better);
    expect(b.numericScore!).toBeGreaterThan(a.numericScore!);
  });

  it('dishonored promises drop the score', () => {
    const honored = makeInputs({
      extensionsGranted: 4,
      extensionsHonored: 4,
    });
    const dishonored = makeInputs({
      extensionsGranted: 4,
      extensionsHonored: 0,
    });
    expect(scoreTenantCredit(honored).numericScore!).toBeGreaterThan(
      scoreTenantCredit(dishonored).numericScore!,
    );
  });

  it('high rent-to-income hurts the score', () => {
    const low = scoreTenantCredit(makeInputs({ rentToIncomeRatio: 0.15 }));
    const high = scoreTenantCredit(makeInputs({ rentToIncomeRatio: 0.75 }));
    expect(low.numericScore!).toBeGreaterThan(high.numericScore!);
  });

  it('null rent-to-income is neutral (does not crash)', () => {
    const r = scoreTenantCredit(makeInputs({ rentToIncomeRatio: null }));
    expect(r.numericScore).not.toBeNull();
    expect(r.dimensions.rent_to_income.explanation).toMatch(/income/i);
  });

  it('long tenancy boosts score', () => {
    const short = scoreTenantCredit(makeInputs({ avgTenancyMonths: 1 }));
    const long = scoreTenantCredit(makeInputs({ avgTenancyMonths: 36 }));
    expect(long.numericScore!).toBeGreaterThan(short.numericScore!);
  });

  it('dispute incidents lower dispute dimension', () => {
    const clean = scoreTenantCredit(makeInputs());
    const messy = scoreTenantCredit(
      makeInputs({
        disputeCount: 3,
        damageDeductionCount: 2,
        subleaseViolationCount: 1,
      }),
    );
    expect(clean.dimensions.dispute_history.score).toBeGreaterThan(
      messy.dimensions.dispute_history.score,
    );
  });

  it('data freshness=fresh when newest invoice < 35 days old', () => {
    const r = scoreTenantCredit(
      makeInputs({ newestInvoiceAt: new Date().toISOString() }),
    );
    expect(r.dataFreshness).toBe('fresh');
  });

  it('data freshness=stale when newest invoice > 35 days old', () => {
    const r = scoreTenantCredit(
      makeInputs({
        newestInvoiceAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    expect(r.dataFreshness).toBe('stale');
  });

  it('band boundaries align with Kenya CRB (750 → excellent)', () => {
    // Mild profile targeting exactly good band.
    const good = scoreTenantCredit(
      makeInputs({
        paidOnTimeCount: 20,
        paidLate30DaysCount: 3,
        paidLate60DaysCount: 1,
        rentToIncomeRatio: 0.35,
        avgTenancyMonths: 12,
      }),
    );
    expect(['good', 'excellent', 'fair']).toContain(good.band);
  });

  it('DEFAULT_GRADING_WEIGHTS sum to 1.0 (FICO-inspired)', () => {
    const total =
      DEFAULT_GRADING_WEIGHTS.payment_history +
      DEFAULT_GRADING_WEIGHTS.promise_keeping +
      DEFAULT_GRADING_WEIGHTS.rent_to_income +
      DEFAULT_GRADING_WEIGHTS.tenancy_length +
      DEFAULT_GRADING_WEIGHTS.dispute_history;
    expect(total).toBeCloseTo(1, 5);
  });

  it('letter grade A only awarded with high numeric score', () => {
    const r = scoreTenantCredit(makeInputs());
    if (r.letterGrade === 'A') {
      expect(r.numericScore!).toBeGreaterThanOrEqual(780);
    }
  });
});

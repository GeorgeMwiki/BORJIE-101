/**
 * Dynamic rent optimizer tests (Agent PhL).
 *
 *   1. Happy: LLM returns a number below the regulatory cap, row persists,
 *      approval queue gets called with the recommendation.
 *   2. Cap breach: LLM returns a number exceeding the cap → clamped,
 *      cap_breached = true, statute citation appended.
 *   3. Budget exceeded: ledger.assertWithinBudget throws → handler returns
 *      structured BUDGET_EXCEEDED result (no LLM call).
 */

import { describe, it, expect, vi } from 'vitest';
import { createDynamicRentOptimizer } from '../dynamic-pricing/optimizer.js';
import type {
  ApprovalQueuePort,
  PricingInputs,
  PricingLLMPort,
  RentRecommendation,
  RentRecommendationRepository,
} from '../dynamic-pricing/types.js';
import { AiBudgetExceededError } from '../../cost-ledger.js';

function makeRepo(): {
  repo: RentRecommendationRepository;
  rows: RentRecommendation[];
} {
  const rows: RentRecommendation[] = [];
  return {
    rows,
    repo: {
      async insert(row) {
        rows.push(row);
        return row;
      },
      async listByUnit() {
        return [];
      },
    },
  };
}

function makeInputs(overrides: Partial<PricingInputs> = {}): PricingInputs {
  return {
    tenantId: 'tnt_1',
    unitId: 'unit_1',
    propertyId: 'prop_1',
    countryCode: 'TZ',
    currentRentMinor: 500_000, // 500 TZS (minor units)
    currencyCode: 'TZS',
    market: {
      id: 'mkt_1',
      unitId: 'unit_1',
      currencyCode: 'TZS',
      ourRentMinor: 500_000,
      marketMedianMinor: 600_000,
      marketP25Minor: 550_000,
      marketP75Minor: 650_000,
      sampleSize: 42,
      driftFlag: 'below_market',
      observedAt: '2026-04-01T00:00:00Z',
    },
    occupancy: {
      unitId: 'unit_1',
      windowDays: 365,
      occupancyPct: 0.95,
      vacancyDays: 18,
      rollupHash: 'rh_abc',
    },
    churn: {
      id: 'chr_1',
      customerId: 'cus_1',
      unitId: 'unit_1',
      churnProbability: 0.15,
      horizonDays: 180,
    },
    inspection: {
      id: 'ins_1',
      unitId: 'unit_1',
      conditionGrade: 'B',
      issuesCount: 2,
      observedAt: '2026-03-01T00:00:00Z',
    },
    seasonalityMonth: 4,
    ...overrides,
  };
}

describe('DynamicRentOptimizer', () => {
  it('happy path: LLM recommendation within cap → stored + queued', async () => {
    const { repo, rows } = makeRepo();

    const llm: PricingLLMPort = {
      async propose() {
        return {
          recommendedRentMinor: 530_000, // 6% bump, within any reasonable cap
          confidence: 0.82,
          explanation:
            'Market median is 600k; we are at 500k; raise toward median.',
          modelVersion: 'test-sonnet-1',
          inputTokens: 100,
          outputTokens: 40,
          costUsdMicro: 2_000,
        };
      },
    };

    const approvalQueue: ApprovalQueuePort = {
      async queueRentChange() {
        return { approvalRequestId: 'apr_42' };
      },
    };

    const optimizer = createDynamicRentOptimizer({
      llm,
      repo,
      approvalQueue,
      rentControl: () => ({ maxIncreasePct: 10, sourceCitation: 'TZ-RCA' }),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });

    const res = await optimizer.propose(makeInputs());

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.recommendation.recommendedRentMinor).toBe(530_000);
    expect(res.data.recommendation.capBreached).toBe(false);
    expect(res.data.recommendation.regulatoryCapPct).toBe(10);
    expect(res.data.recommendation.citations.length).toBeGreaterThan(0);
    expect(res.data.recommendation.modelVersion).toBe('test-sonnet-1');
    expect(res.data.recommendation.promptHash).toMatch(/^ph_/);
    expect(res.data.approvalRequestId).toBe('apr_42');
    expect(rows).toHaveLength(1);
  });

  it('guardrail: LLM proposal above regulatory cap is clamped', async () => {
    const { repo, rows } = makeRepo();

    const llm: PricingLLMPort = {
      async propose() {
        return {
          recommendedRentMinor: 900_000, // 80% bump — well over the 10% cap
          confidence: 0.9,
          explanation: 'Raise aggressively to market',
          modelVersion: 'test-sonnet-1',
          inputTokens: 100,
          outputTokens: 40,
          costUsdMicro: 2_000,
        };
      },
    };

    const optimizer = createDynamicRentOptimizer({
      llm,
      repo,
      rentControl: () => ({ maxIncreasePct: 10, sourceCitation: 'TZ-RCA' }),
      now: () => new Date('2026-04-20T00:00:00Z'),
    });

    const res = await optimizer.propose(makeInputs());
    expect(res.success).toBe(true);
    if (!res.success) return;
    // 500k * 1.10 = 550k ceiling
    expect(res.data.recommendation.recommendedRentMinor).toBe(550_000);
    expect(res.data.recommendation.capBreached).toBe(true);
    expect(
      res.data.recommendation.citations.some((c) => c.kind === 'statute'),
    ).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('budget guardrail: ledger.assertWithinBudget throws → BUDGET_EXCEEDED', async () => {
    const { repo } = makeRepo();
    const llm: PricingLLMPort = {
      propose: vi.fn(),
    };

    const ledger: any = {
      async assertWithinBudget() {
        throw new AiBudgetExceededError({
          tenantId: 'tnt_1',
          monthlyCapUsdMicro: 10_000,
          currentSpendUsdMicro: 10_000,
        });
      },
      async recordUsage() {
        /* noop */
      },
    };

    const optimizer = createDynamicRentOptimizer({
      ledger,
      llm,
      repo,
      rentControl: () => ({ maxIncreasePct: null }),
    });

    const res = await optimizer.propose(makeInputs());
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.code).toBe('BUDGET_EXCEEDED');
    expect(llm.propose).not.toHaveBeenCalled();
  });
});

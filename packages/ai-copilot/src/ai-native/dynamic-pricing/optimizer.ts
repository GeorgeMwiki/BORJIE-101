/**
 * Dynamic rent optimizer — the proposer.
 *
 * Pipeline per unit:
 *   1. Budget-guard (ledger.assertWithinBudget)
 *   2. Jurisdiction lookup (rent-increase cap, if any)
 *   3. LLM proposal (PricingLLMPort)
 *   4. Regulatory clamp (never exceed cap)
 *   5. Build immutable recommendation with citations + provenance
 *   6. Persist to rent_recommendations
 *   7. Queue into ApprovalService (never auto-apply)
 *
 * Everything is pure on top of the injected ports. The repo + LLM + approval
 * queue are swapped out for in-memory fakes in the unit tests.
 */

import type { CostLedger } from '../../cost-ledger.js';
import { assertBudget, recordAiUsage } from '../phl-common/budget.js';
import {
  type Citation,
  generateId,
  promptHashDjb2,
  type AiNativeResult,
} from '../phl-common/types.js';
import type {
  ApprovalQueuePort,
  PricingInputs,
  PricingLLMPort,
  RentControlLookup,
  RentRecommendation,
  RentRecommendationRepository,
} from './types.js';

export interface DynamicPricingDeps {
  readonly ledger?: CostLedger;
  readonly llm: PricingLLMPort;
  readonly repo: RentRecommendationRepository;
  readonly approvalQueue?: ApprovalQueuePort;
  readonly rentControl: RentControlLookup;
  readonly now?: () => Date;
}

export interface DynamicRentOptimizer {
  propose(
    inputs: PricingInputs,
    options?: { readonly correlationId?: string; readonly autoQueue?: boolean },
  ): Promise<
    AiNativeResult<{
      readonly recommendation: RentRecommendation;
      readonly approvalRequestId: string | null;
    }>
  >;
}

function buildPrompt(inputs: PricingInputs): string {
  // Deterministic string representation so promptHash is stable across
  // serializer noise. Keep ordered fields.
  const lines: string[] = [
    `tenant:${inputs.tenantId}`,
    `unit:${inputs.unitId}`,
    `country:${inputs.countryCode}`,
    `currency:${inputs.currencyCode}`,
    `current_rent_minor:${inputs.currentRentMinor}`,
    inputs.market
      ? `market:${inputs.market.driftFlag ?? 'unknown'}|median=${
          inputs.market.marketMedianMinor ?? 'n/a'
        }|p25=${inputs.market.marketP25Minor ?? 'n/a'}|p75=${
          inputs.market.marketP75Minor ?? 'n/a'
        }|n=${inputs.market.sampleSize}`
      : 'market:absent',
    inputs.occupancy
      ? `occupancy:pct=${inputs.occupancy.occupancyPct.toFixed(3)}|vacancyDays=${inputs.occupancy.vacancyDays}`
      : 'occupancy:absent',
    inputs.churn
      ? `churn:p=${inputs.churn.churnProbability.toFixed(3)}|horizon=${inputs.churn.horizonDays}`
      : 'churn:absent',
    inputs.inspection
      ? `inspection:grade=${inputs.inspection.conditionGrade}|issues=${inputs.inspection.issuesCount}`
      : 'inspection:absent',
    `seasonality:${inputs.seasonalityMonth ?? 'absent'}`,
  ];
  return lines.join('\n');
}

function addDays(from: Date, days: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildCitations(inputs: PricingInputs): readonly Citation[] {
  const out: Citation[] = [];
  if (inputs.market) {
    out.push({
      kind: 'market_signal',
      ref: inputs.market.id,
      note: `drift=${inputs.market.driftFlag ?? 'unknown'} n=${inputs.market.sampleSize}`,
    });
  }
  if (inputs.occupancy) {
    out.push({
      kind: 'occupancy_rollup',
      ref: inputs.occupancy.rollupHash,
      note: `window=${inputs.occupancy.windowDays}d`,
    });
  }
  if (inputs.churn) {
    out.push({
      kind: 'churn_prediction',
      ref: inputs.churn.id,
      note: `p=${inputs.churn.churnProbability.toFixed(2)}`,
    });
  }
  if (inputs.inspection) {
    out.push({
      kind: 'inspection_finding',
      ref: inputs.inspection.id,
      note: `grade=${inputs.inspection.conditionGrade}`,
    });
  }
  if (inputs.seasonalityMonth) {
    out.push({
      kind: 'seasonality',
      ref: `month:${inputs.seasonalityMonth}`,
    });
  }
  return Object.freeze(out);
}

export function createDynamicRentOptimizer(
  deps: DynamicPricingDeps,
): DynamicRentOptimizer {
  const now = deps.now ?? (() => new Date());

  return {
    async propose(inputs, options) {
      // 1) Validate
      if (!inputs.tenantId || !inputs.unitId) {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'tenantId and unitId are required',
        };
      }
      if (inputs.currentRentMinor < 0) {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'currentRentMinor must be non-negative',
        };
      }

      // 2) Budget guard
      const context = {
        tenantId: inputs.tenantId,
        operation: 'ai-native.dynamic-pricing.propose',
        correlationId: options?.correlationId,
      };
      try {
        await assertBudget(deps, context);
      } catch (err) {
        if (
          err instanceof Error &&
          (err as { code?: string }).code === 'AI_BUDGET_EXCEEDED'
        ) {
          return {
            success: false,
            code: 'BUDGET_EXCEEDED',
            message: err.message,
          };
        }
        throw err;
      }

      // 3) Global-first jurisdiction lookup — every caller MUST supply country
      const cap = deps.rentControl(inputs.countryCode);

      // 4) LLM proposal
      const prompt = buildPrompt(inputs);
      const hash = promptHashDjb2(prompt);
      let raw;
      try {
        raw = await deps.llm.propose({ inputs, promptHash: hash });
      } catch (err) {
        return {
          success: false,
          code: 'UPSTREAM_ERROR',
          message:
            err instanceof Error ? err.message : 'pricing LLM upstream error',
        };
      }

      // 5) Record usage
      await recordAiUsage(deps, context, {
        provider: 'ai-native',
        model: raw.modelVersion,
        inputTokens: raw.inputTokens,
        outputTokens: raw.outputTokens,
        costUsdMicro: raw.costUsdMicro,
      });

      // 6) Regulatory clamp
      let clamped = raw.recommendedRentMinor;
      let capBreached = false;
      if (
        cap.maxIncreasePct !== null &&
        cap.maxIncreasePct >= 0 &&
        inputs.currentRentMinor > 0
      ) {
        const ceiling =
          inputs.currentRentMinor +
          Math.floor(
            (inputs.currentRentMinor * cap.maxIncreasePct) / 100,
          );
        if (clamped > ceiling) {
          clamped = ceiling;
          capBreached = true;
        }
      }

      // 7) Build recommendation
      const deltaPct =
        inputs.currentRentMinor === 0
          ? 0
          : ((clamped - inputs.currentRentMinor) / inputs.currentRentMinor) *
            100;

      const citations: Citation[] = [...buildCitations(inputs)];
      if (capBreached && cap.sourceCitation) {
        citations.push({
          kind: 'statute',
          ref: cap.sourceCitation,
          note: `rent-increase cap clamped LLM output`,
        });
      }

      const rec: RentRecommendation = Object.freeze({
        id: generateId('rrec'),
        tenantId: inputs.tenantId,
        unitId: inputs.unitId,
        propertyId: inputs.propertyId ?? null,
        currencyCode: inputs.currencyCode,
        currentRentMinor: inputs.currentRentMinor,
        recommendedRentMinor: clamped,
        deltaPct,
        confidence: Math.max(0, Math.min(1, raw.confidence)),
        suggestedReviewDate: toYmd(addDays(now(), 90)),
        citations: Object.freeze(citations),
        regulatoryCapPct: cap.maxIncreasePct,
        capBreached,
        explanation: raw.explanation,
        modelVersion: raw.modelVersion,
        promptHash: hash,
        status: 'proposed',
        createdAt: now().toISOString(),
      });

      // 8) Persist
      await deps.repo.insert(rec);

      // 9) Queue into ApprovalService (never auto-apply)
      let approvalRequestId: string | null = null;
      if ((options?.autoQueue ?? true) && deps.approvalQueue) {
        const queued = await deps.approvalQueue.queueRentChange({
          tenantId: inputs.tenantId,
          unitId: inputs.unitId,
          currentRentMinor: inputs.currentRentMinor,
          recommendedRentMinor: clamped,
          currencyCode: inputs.currencyCode,
          recommendationId: rec.id,
          explanation: raw.explanation,
          citations,
        });
        approvalRequestId = queued?.approvalRequestId ?? null;
      }

      return {
        success: true,
        data: { recommendation: rec, approvalRequestId },
      };
    },
  };
}

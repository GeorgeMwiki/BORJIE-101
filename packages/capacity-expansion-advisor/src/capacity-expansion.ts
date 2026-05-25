/**
 * Capacity-expansion advisor — pure NPV / IRR / payback computation
 * across a set of named expansion scenarios, ranked by NPV.
 */

import {
  expansionAnalyzeInputSchema,
  expansionRecommendationContextSchema,
  type EvidenceRef,
  type ExpansionAnalysis,
  type ExpansionAnalyzeInput,
  type ExpansionRecommendation,
  type ExpansionRecommendationContext,
  type ExpansionScenarioInput,
  type ScenarioOutcome,
} from './types.js';
import { NOOP_LOGGER, type Logger } from './ports.js';

export interface CapacityExpansionAdvisorDeps {
  readonly logger?: Logger;
}

export interface CapacityExpansionAdvisor {
  analyze(input: ExpansionAnalyzeInput): Promise<ExpansionAnalysis>;
  recommend(
    context: ExpansionRecommendationContext,
  ): Promise<ReadonlyArray<ExpansionRecommendation>>;
}

export function createCapacityExpansionAdvisor(
  deps: CapacityExpansionAdvisorDeps = {},
): CapacityExpansionAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  return {
    async analyze(rawInput) {
      const input = expansionAnalyzeInputSchema.parse(rawInput);
      logger.info('capacity-expansion.analyze.start', {
        scenarios: input.scenarios.length,
        discountRate: input.discountRate,
      });
      const outcomes = input.scenarios.map((s) =>
        scoreScenario(s, input.discountRate),
      );
      const ranked = [...outcomes]
        .sort((a, b) => b.npv - a.npv)
        .map((o) => o.id);
      const analysis: ExpansionAnalysis = {
        currency: input.currency,
        discountRate: input.discountRate,
        outcomes,
        rankedByNpv: ranked,
        computedAtISO: new Date().toISOString(),
      };
      logger.info('capacity-expansion.analyze.done', {
        top: ranked[0] ?? null,
      });
      return analysis;
    },
    async recommend(rawContext) {
      const context = expansionRecommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('capacity-expansion.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

// ─── Scoring ──────────────────────────────────────────────────────

export function scoreScenario(
  scenario: ExpansionScenarioInput,
  discountRate: number,
): ScenarioOutcome {
  const npv = computeNpv(scenario.upfrontCapex, scenario.incrementalCashflows, discountRate);
  const irr = computeIrr(scenario.upfrontCapex, scenario.incrementalCashflows);
  const payback = computePaybackYears(scenario.upfrontCapex, scenario.incrementalCashflows);
  const totalIncrementalTonnes =
    scenario.incrementalTonnesPerYear * scenario.incrementalCashflows.length;
  return {
    id: scenario.id,
    kind: scenario.kind,
    label: scenario.label,
    npv,
    irr,
    paybackYears: payback,
    totalIncrementalTonnes,
    upfrontCapex: scenario.upfrontCapex,
  };
}

export function computeNpv(
  upfront: number,
  cashflows: ReadonlyArray<number>,
  rate: number,
): number {
  let npv = -upfront;
  for (let t = 0; t < cashflows.length; t++) {
    const cf = cashflows[t] ?? 0;
    npv += cf / Math.pow(1 + rate, t + 1);
  }
  return npv;
}

/**
 * Bisection IRR solver — robust enough for monotonic inflows; returns
 * null for cashflow profiles where no IRR exists in [-0.99, 5].
 */
export function computeIrr(
  upfront: number,
  cashflows: ReadonlyArray<number>,
): number | null {
  let lo = -0.99;
  let hi = 5;
  const npvAt = (r: number) => computeNpv(upfront, cashflows, r);
  let fLo = npvAt(lo);
  let fHi = npvAt(hi);
  if (Number.isNaN(fLo) || Number.isNaN(fHi)) return null;
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fMid * fLo < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export function computePaybackYears(
  upfront: number,
  cashflows: ReadonlyArray<number>,
): number | null {
  let cumulative = 0;
  for (let t = 0; t < cashflows.length; t++) {
    const cf = cashflows[t] ?? 0;
    cumulative += cf;
    if (cumulative >= upfront) {
      // Interpolate within the year for fractional payback.
      const prevCumulative = cumulative - cf;
      const fraction = cf === 0 ? 0 : (upfront - prevCumulative) / cf;
      return t + fraction;
    }
  }
  return null;
}

// ─── Recommendations ──────────────────────────────────────────────

export function deriveRecommendations(
  context: ExpansionRecommendationContext,
): ReadonlyArray<ExpansionRecommendation> {
  const { analysis, policy } = context;
  const out: ExpansionRecommendation[] = [];
  for (const outcome of analysis.outcomes) {
    if (outcome.npv < policy.minNpv) continue;
    if (outcome.paybackYears !== null && outcome.paybackYears > policy.maxPaybackYears) continue;
    out.push({
      id: `expand-${outcome.id}`,
      scenarioId: outcome.id,
      title: `Expansion candidate: ${outcome.label}`,
      rationale:
        `NPV ${outcome.npv.toFixed(0)} ${analysis.currency}, ` +
        `IRR ${outcome.irr === null ? 'n/a' : (outcome.irr * 100).toFixed(1) + '%'}, ` +
        `payback ${outcome.paybackYears === null ? 'beyond-horizon' : outcome.paybackYears.toFixed(1) + 'y'}.`,
      severity: 'info',
      evidence: [evidence('scenario', `scenario.${outcome.id}`)],
    });
  }
  // Always surface the top-ranked scenario, even if borderline.
  const top = analysis.rankedByNpv[0];
  if (top !== undefined && !out.some((r) => r.scenarioId === top)) {
    const topOutcome = analysis.outcomes.find((o) => o.id === top);
    if (topOutcome !== undefined) {
      out.push({
        id: `expand-top-${top}`,
        scenarioId: top,
        title: `Top NPV scenario: ${topOutcome.label}`,
        rationale:
          'Top-ranked by NPV but did not clear the policy floor — review ' +
          'capex assumptions and revisit with cost-engineer-advisor.',
        severity: 'medium',
        evidence: [evidence('scenario', `scenario.${top}`)],
      });
    }
  }
  return out;
}

function evidence(kind: EvidenceRef['kind'], pointer: string): EvidenceRef {
  return { id: `${kind}:${pointer}`, kind, pointer };
}

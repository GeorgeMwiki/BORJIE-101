/**
 * simulate — top-level entry. Build alternatives, run them in
 * parallel against a sandbox, score, rank, and produce a DiffView.
 */

import type {
  BusinessContext,
  ProposedAction,
  RankedOutcomes,
  ScoredOutcome,
  SimulateOptions,
} from '../types.js';
import { createSandbox } from '../sandbox/sandbox-runtime.js';
import {
  runScenariosParallel,
  type ParallelInvocation,
} from './parallel-run.js';
import { scoreOutcome, rankByObjective } from '../scoring/outcome-scorer.js';
import { paretoFrontier } from '../scoring/pareto-frontier.js';
import { renderDiffView } from './diff-view-renderer.js';
import { getScenario, listScenarios } from '../scenarios/scenario-builder.js';
import type { AnyScenario } from '../scenarios/scenario.js';

export interface AlternativePlan {
  readonly scenario: AnyScenario;
  readonly input: unknown;
}

export interface SimulateInputs {
  readonly action: ProposedAction;
  readonly context: BusinessContext;
  readonly alternatives?: ReadonlyArray<AlternativePlan>;
  readonly options?: SimulateOptions;
}

function buildDefaultAlternatives(
  action: ProposedAction,
  context: BusinessContext,
): ReadonlyArray<AlternativePlan> {
  // If the action.kind matches a scenario name, build a single-
  // alternative plan from the payload. Otherwise return the first
  // 3 library scenarios with synthesised inputs derived from the
  // business context. This is a fallback that keeps `simulate`
  // useful from a bare ProposedAction.
  const direct = getScenario(action.kind);
  if (direct) {
    return [{ scenario: direct, input: action.payload }];
  }
  const fallback = listScenarios()
    .slice(0, 3)
    .map((s): AlternativePlan => ({
      scenario: s,
      input: synthesiseInput(s, context),
    }));
  return fallback;
}

function synthesiseInput(
  scenario: AnyScenario,
  context: BusinessContext,
): unknown {
  // Best-effort defaults so the fallback path produces *something*.
  switch (scenario.name) {
    case 'raise-rent':
      return {
        unitIds: context.units.slice(0, Math.min(3, context.units.length)).map((u) => u.unitId),
        pctIncrease: 0.05,
        effectiveDateMs: context.nowMs + 30 * 24 * 60 * 60 * 1000,
        microMarketVacancyRate: 0.05,
        marketDemandIndex: 1,
      };
    case 'refinance':
      return {
        outstandingPrincipal: 500_000,
        oldRateApr: 0.085,
        newRateApr: 0.07,
        remainingTermMonths: 180,
        originationFeePct: 0.015,
      };
    case 'acquire-property':
      return {
        unitCount: 5,
        expectedMonthlyRentPerUnit: 50_000,
        purchasePrice: 8_000_000,
        financedPct: 0.7,
        expectedOccupancy: 0.9,
      };
    case 'fire-vendor':
      return {
        vendorId: 'v-current',
        currentNoShowRate: 0.2,
        replacementExpectedNoShowRate: 0.05,
        onboardingDays: 14,
        priceDeltaPct: 0,
      };
    case 'water-main-crisis':
      return {
        affectedUnitIds: context.units.slice(0, Math.min(3, context.units.length)).map((u) => u.unitId),
        repairCost: 250_000,
        repairDays: 5,
        abatementPctOfRent: 0.5,
        vendorCount: 2,
      };
    case 'lease-renewal-batch':
      return {
        decisions: context.tenants.slice(0, 3).map((t) => ({
          tenantId: t.tenantId,
          pctIncrease: 0.03,
        })),
        microMarketVacancyRate: 0.05,
      };
    default:
      return {};
  }
}

export async function simulate(inputs: SimulateInputs): Promise<RankedOutcomes> {
  const { context } = inputs;
  const seed = inputs.options?.seed ?? 42;
  const { sandbox } = await createSandbox({ mode: 'in-memory' });
  try {
    const plans =
      inputs.alternatives ?? buildDefaultAlternatives(inputs.action, context);
    if (plans.length === 0) {
      return {
        ranked: [],
        diffView: renderDiffView([]),
        paretoFront: [],
      };
    }
    const ctx = { business: context, sandbox, seed };
    const invocations: ParallelInvocation[] = plans.map((p) => ({
      scenario: p.scenario,
      input: p.input,
    }));
    const outcomes = await runScenariosParallel(invocations, ctx);
    const scored: ScoredOutcome[] = outcomes.map((o) =>
      scoreOutcome(o, context.ownerIntent),
    );
    const ranked = rankByObjective(scored);
    const front = paretoFrontier(scored);
    return {
      ranked,
      diffView: renderDiffView(ranked),
      paretoFront: front,
    };
  } finally {
    await sandbox.dispose();
  }
}

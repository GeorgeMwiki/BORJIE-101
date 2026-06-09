/**
 * Causal-inference brain tool — Wave-3 closure of the DARK
 * `@borjie/causal-inference` organ (MASTER_WIRING_CLOSURE_PLAN.md).
 *
 * Before this wiring the package barrel exported a full four-step causal
 * pipeline (Granger / back-door / front-door / DiD / synthetic-control /
 * RDD / counterfactual + refutation) and was a declared dep of
 * `@borjie/market-intelligence`, but the only references anywhere were
 * comment-only `LATER(wire)` lines in `sell-signals.ts` — no runtime
 * import, no kernel binding. This module makes the organ REACHABLE as a
 * single persona-aware brain tool:
 *
 *   - `mwikila.causal.infer`
 *        Runs ONE pure-TS, offline-capable mining-causal estimator over a
 *        caller-supplied series / panel and returns the real
 *        `TreatmentEffect` (point estimate + 95% CI + sample size + the
 *        identification strategy + a free-text diagnostic). Two methods:
 *          - `fuel-price`    → Granger causality (fuel-price → production).
 *          - `shift-schedule`→ 2×2 differences-in-differences
 *                              (compressed shift → incident rate).
 *        The heavy PCMCI+/DoWhy estimators stay behind the package's
 *        Python-sidecar ports and are intentionally NOT exposed here —
 *        these two degrade-to-pure-TS methods need no sidecar and no LLM.
 *        LOW stakes, READ-only, sensor/propose-only — NEVER actuates.
 *
 * HARD-RULE compliance (closure plan):
 *   - Env flag: `BORJIE_CAUSAL_INFERENCE_ENABLED` (default OFF — heavy
 *     compute; opt-in after a staging canary).
 *   - Budget bound: `BORJIE_CAUSAL_BUDGET_MS` (default 2500ms) via the
 *     shared `runOrganWithBudget` guard. A slow estimator can NEVER stall
 *     a brain turn — it resolves a typed `budget-exceeded` skip.
 *   - Fail-safe: any organ error resolves to a typed skip; never throws.
 *   - Evidence-required (CLAUDE.md): every estimate carries the
 *     identification strategy + sample size + the diagnostic as its
 *     evidence chain. Correlation is NOT presented as causation: the
 *     diagnostic states the identifying assumption that must hold.
 *   - Sensor/propose-only: no sovereign rail, no actuation.
 *
 * @module services/api-gateway/src/composition/brain-tools/causal-inference-tools
 */

import { z } from 'zod';
import {
  fuelPriceImpact,
  shiftScheduleImpact,
  type MiningCausalRunSummary,
} from '@borjie/causal-inference';

import type { PersonaToolDescriptor } from './types.js';
import {
  organFlagDefaultOff,
  resolveBudgetMs,
  runOrganWithBudget,
} from './organ-budget-guard.js';

export const CAUSAL_INFERENCE_FLAG = 'BORJIE_CAUSAL_INFERENCE_ENABLED';
export const CAUSAL_BUDGET_MS_KEY = 'BORJIE_CAUSAL_BUDGET_MS';
const DEFAULT_CAUSAL_BUDGET_MS = 2_500;

const OWNER_ADMIN_MANAGER: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist' | 'T3_module_manager'
> = ['T1_owner_strategist', 'T2_admin_strategist', 'T3_module_manager'];

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const DiDObservationSchema = z.object({
  treated: z.boolean(),
  post: z.boolean(),
  outcome: z.number().finite(),
});

const CausalInferInput = z
  .object({
    method: z.enum(['fuel-price', 'shift-schedule']),
    /** fuel-price (Granger): the two aligned time series. */
    fuelPriceSeries: z.array(z.number().finite()).max(5_000).optional(),
    productionSeries: z.array(z.number().finite()).max(5_000).optional(),
    maxLag: z.number().int().positive().max(24).optional(),
    /** shift-schedule (DiD): the 2×2 panel of observations. */
    panel: z.array(DiDObservationSchema).max(20_000).optional(),
  })
  .strict();

const TreatmentEffectSchema = z.object({
  treatment: z.string(),
  outcome: z.string(),
  identification: z.string(),
  estimate: z.number(),
  ciLow: z.number(),
  ciHigh: z.number(),
  standardError: z.number().optional(),
  sampleSize: z.number(),
});

const CausalInferOutput = z.object({
  status: z.enum(['ok', 'skipped', 'invalid_input']),
  question: z.string().nullable(),
  effect: TreatmentEffectSchema.nullable(),
  /** How the estimate was identified — the assumption that must hold. */
  diagnostic: z.string().nullable(),
  /** Evidence chain (CLAUDE.md): identification + sample size + diagnostic. */
  evidenceIds: z.array(z.string()),
  note: z.string().optional(),
});

type CausalInferInputT = z.infer<typeof CausalInferInput>;

// ─────────────────────────────────────────────────────────────────────
// Estimator dispatch — pure, throws on missing-arg (caught by the guard).
// ─────────────────────────────────────────────────────────────────────

function runEstimator(input: CausalInferInputT): MiningCausalRunSummary {
  if (input.method === 'fuel-price') {
    if (
      input.fuelPriceSeries === undefined ||
      input.productionSeries === undefined
    ) {
      throw new Error('fuel-price requires fuelPriceSeries + productionSeries');
    }
    return fuelPriceImpact({
      fuelPriceSeries: input.fuelPriceSeries,
      productionSeries: input.productionSeries,
      ...(input.maxLag !== undefined ? { maxLag: input.maxLag } : {}),
    });
  }
  if (input.panel === undefined || input.panel.length === 0) {
    throw new Error('shift-schedule requires a non-empty panel');
  }
  return shiftScheduleImpact({ panel: input.panel });
}

// ─────────────────────────────────────────────────────────────────────
// mwikila.causal.infer
// ─────────────────────────────────────────────────────────────────────

export const causalInferTool: PersonaToolDescriptor<
  typeof CausalInferInput,
  typeof CausalInferOutput
> = {
  id: 'mwikila.causal.infer',
  name: 'Causal inference — mining treatment effect',
  description:
    'Estimate whether one operational lever CAUSED a change in an outcome ' +
    '(not merely correlated). Two offline, pure-TS methods: `fuel-price` ' +
    '(Granger causality — did fuel-price moves precede production-volume ' +
    'changes, given two aligned time series) and `shift-schedule` (2×2 ' +
    'differences-in-differences — did the compressed shift roll-out change ' +
    'the lost-time-injury rate, given a treated/control × pre/post panel). ' +
    'Use when the owner asks "did X cause Y", "was that the royalty change ' +
    'or just seasonality", or any equivalent causal-attribution question ' +
    'AND the underlying series / panel is available. Returns the real ' +
    'treatment-effect estimate with a 95% CI and the identifying ' +
    'assumption that must hold — it states assumptions, it does not claim ' +
    'certainty. READ-only, LOW stakes, propose-only. Backed by the ' +
    '@borjie/causal-inference reference estimators.',
  personaSlugs: OWNER_ADMIN_MANAGER,
  inputSchema: CausalInferInput,
  outputSchema: CausalInferOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const env = process.env;
    const outcome = await runOrganWithBudget(
      {
        enabled: organFlagDefaultOff(env, CAUSAL_INFERENCE_FLAG),
        budgetMs: resolveBudgetMs(
          env,
          CAUSAL_BUDGET_MS_KEY,
          DEFAULT_CAUSAL_BUDGET_MS,
        ),
      },
      () => runEstimator(input),
    );

    if (!outcome.ok) {
      const note =
        outcome.reason === 'disabled'
          ? 'causal-inference organ disabled (set BORJIE_CAUSAL_INFERENCE_ENABLED=1)'
          : outcome.reason === 'budget-exceeded'
            ? `causal compute exceeded budget (${outcome.elapsedMs}ms)`
            : (outcome.detail ?? 'causal compute failed');
      return {
        status: outcome.reason === 'organ-error' ? 'invalid_input' : 'skipped',
        question: null,
        effect: null,
        diagnostic: null,
        evidenceIds: [],
        note,
      };
    }

    const summary = outcome.value;
    // Evidence chain — identification strategy + sample size + the
    // identifying-assumption diagnostic. This is what makes the causal
    // claim auditable rather than a bare number.
    const evidenceIds = [
      `causal-identification:${summary.identification}`,
      `causal-sample-size:${summary.effect.sampleSize}`,
      `causal-treatment:${summary.treatment}`,
      `causal-outcome:${summary.outcome}`,
    ];

    return {
      status: 'ok' as const,
      question: summary.question,
      effect: {
        treatment: summary.effect.treatment,
        outcome: summary.effect.outcome,
        identification: summary.effect.identification,
        estimate: summary.effect.estimate,
        ciLow: summary.effect.ciLow,
        ciHigh: summary.effect.ciHigh,
        ...(summary.effect.standardError !== undefined
          ? { standardError: summary.effect.standardError }
          : {}),
        sampleSize: summary.effect.sampleSize,
      },
      diagnostic: summary.diagnostic,
      evidenceIds,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalogue export
// ─────────────────────────────────────────────────────────────────────

export const CAUSAL_INFERENCE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  causalInferTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);

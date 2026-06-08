/**
 * FX / Treasury Agent — live FX, sell-vs-stockpile simulator, BoT gold
 * window, 27-March-2026 USD cliff tracker (AGENT_PROMPT_LIBRARY §16,
 * §26) DEEPENED with a deterministic treasury-covenant engine and a
 * board-bounded hedging stance grounded in the commercial book
 * (`Docs/research/mining-estate-operating-model.md` §7.2 / §5.4):
 *   - DSCR ≥ ~1.5x, LLCR 1.7–2.0x, PLCR > 2.0x lender-coverage covenants,
 *   - reserve-tail ratio ≥ 30 % (mine outlives the loan),
 *   - DSRA sizing + shortfall, Equator Principles / IFC PS E&S gate,
 *   - hedge book that covers committed debt service / capex against price
 *     falls while preserving upside — operational, never speculative.
 *
 * AUTHORITY MODEL: in `covenants` mode the assessment + hedge stance are
 * computed by the pure `assessCovenants` / `recommendHedgeStance` engines
 * and those deterministic blocks OVERWRITE whatever the LLM echoed — the
 * model narrates, the engine decides the ratios and the stance.
 *
 * MONEY MATH NOTE: this junior only ADVISES. No covenant computation,
 * DSRA top-up, hedge, or debt-service payment here moves money. Any DSRA
 * funding, hedge margin, or debt-service payment must route through
 * `LedgerService.post()` (double-entry, SoD: proposer != approver !=
 * recorder) — never a direct write.
 *
 * Schema gap: `fx_snapshots`, `sell_vs_stockpile_advice` raw SQL.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  isoToday,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';
import {
  assessCovenants,
  recommendHedgeStance,
  DEFAULT_COVENANT_THRESHOLDS,
  type CovenantInputs,
  type CovenantThresholds,
  type HedgingInputs,
} from './treasury-covenants.js';

export const FxTreasuryMode = z.enum([
  'rate_check',
  'sell_vs_stockpile',
  'usd_cliff_tracker',
  'set_aside_status',
  'nsr_compare',
  'covenants',
]);

// ─────────────────────────────────────────────────────────────────────
// Covenant + hedging term-sheet inputs (drive the deterministic engines)
// ─────────────────────────────────────────────────────────────────────

export const CovenantInputsSchema = z.object({
  cfads_period: z.number(),
  debt_service_period: z.number().nonnegative(),
  npv_cfads_loan_life: z.number(),
  npv_cfads_project_life: z.number(),
  debt_outstanding: z.number().nonnegative(),
  reserves_at_final_repayment: z.number().nonnegative(),
  total_reserves: z.number().nonnegative(),
  dsra_balance: z.number().nonnegative(),
  dsra_required_months: z.number().nonnegative().optional(),
  period_months: z.number().positive().optional(),
  equator_principles_cleared: z.boolean().optional(),
  /** Currency the facility is denominated in — rendered via formatCurrency, never hard-coded. */
  currency_code: z.string().min(1),
});
export type CovenantInputsBlock = z.infer<typeof CovenantInputsSchema>;

export const CovenantThresholdsSchema = z.object({
  dscr_min: z.number().positive(),
  llcr_min: z.number().positive(),
  plcr_min: z.number().positive(),
  reserve_tail_min_pct: z.number().nonnegative(),
});

export const HedgingInputsSchema = z.object({
  committed_outflow: z.number().nonnegative(),
  exposed_revenue: z.number().nonnegative(),
  already_hedged_notional: z.number().nonnegative(),
  board_max_hedge_ratio: z.number().min(0).max(1),
  current_dscr: z.number(),
  dscr_min: z.number().positive().optional(),
});
export type HedgingInputsBlock = z.infer<typeof HedgingInputsSchema>;

export const FxTreasuryInputSchema = z.object({
  tenantId: z.string().min(1),
  mode: FxTreasuryMode,
  parcel_id: z.string().optional(),
  mineral: z.string().optional(),
  mass_g_or_t: z.number().positive().optional(),
  grade_g_per_t_or_pct: z.number().nonnegative().optional(),
  current_bot_rate_tzs_per_usd: z.number().positive(),
  lbma_or_lme_price_usd: z.number().positive().optional(),
  cost_of_carry_pct_per_month: z.number().nonnegative().default(0.015),
  days_horizon: z.number().int().positive().default(30),
  /** Lender-coverage facility inputs (covenants mode). */
  covenant_inputs: CovenantInputsSchema.optional(),
  /** Optional per-facility covenant thresholds (defaults to dossier §7.2). */
  covenant_thresholds: CovenantThresholdsSchema.optional(),
  /** Hedge-book exposure inputs (covenants mode). */
  hedging_inputs: HedgingInputsSchema.optional(),
});
export type FxTreasuryInput = z.infer<typeof FxTreasuryInputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Deterministic covenant + hedge blocks carried on the output
// ─────────────────────────────────────────────────────────────────────

const RatioResultSchema = z.object({
  value: z.number(),
  threshold: z.number(),
  status: z.enum(['pass', 'breach']),
  headroom: z.number(),
});

export const CovenantAssessmentSchema = z.object({
  currency_code: z.string().min(1),
  dscr: RatioResultSchema,
  llcr: RatioResultSchema,
  plcr: RatioResultSchema,
  reserve_tail: RatioResultSchema,
  dsra: z.object({
    balance: z.number(),
    required: z.number(),
    shortfall: z.number(),
    status: z.enum(['pass', 'breach']),
  }),
  es_gate_cleared: z.boolean(),
  any_breach: z.boolean(),
  breaches: z.array(z.string()),
});
export type CovenantAssessmentBlock = z.infer<typeof CovenantAssessmentSchema>;

export const HedgingRecommendationSchema = z.object({
  target_hedge_ratio: z.number(),
  current_hedge_ratio: z.number(),
  recommended_incremental_notional: z.number(),
  stance: z.enum(['increase_cover', 'hold', 'reduce_cover', 'no_action']),
  board_cap_respected: z.boolean(),
  instruments_suggested: z.array(z.string()),
  rationale: z.string(),
});
export type HedgingRecommendationBlock = z.infer<typeof HedgingRecommendationSchema>;

export const FxTreasuryOutput = AuditedOutputBase.extend({
  mode: FxTreasuryMode,
  bot_route_nsr_tzs: z.number().nonnegative().optional(),
  export_route_nsr_tzs: z.number().nonnegative().optional(),
  recommendation: z.enum(['sell_bot', 'sell_export', 'stockpile', 'hold_pending_evidence']),
  set_aside_ratio_pct: z.number().min(0).max(100).optional(),
  set_aside_blocks_export: z.boolean().optional(),
  usd_contracts_to_convert: z.array(z.object({ contract_id: z.string(), days_to_cliff: z.number().int() })).default([]),
  cliff_date: z.literal('2026-03-27'),
  days_to_cliff: z.number().int(),
  /** Deterministic lender-coverage assessment — null outside covenants mode. */
  covenant_assessment: CovenantAssessmentSchema.nullable().default(null),
  /** Deterministic board-bounded hedge stance — null outside covenants mode. */
  hedging_recommendation: HedgingRecommendationSchema.nullable().default(null),
});
export type FxTreasuryOutput = z.infer<typeof FxTreasuryOutput>;

export const FX_TREASURY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'FX / Treasury Agent',
  mandate:
    'Live FX, sell-vs-stockpile (BoT 24h-cash vs export 30+ day), 20 % set-aside ratio tracking, the 27-March-2026 ' +
    'USD-cliff playbook for legacy contracts, and lender-coverage covenant monitoring (DSCR/LLCR/PLCR, reserve-tail, ' +
    'DSRA) with a board-bounded hedging stance. In covenants mode the deterministic engine is authoritative — narrate ' +
    'it, do not invent ratios.',
  tools:
    'fetch_rate, fetch_mineral_price, audit_usd_contracts, draft_tzs_addendum, sell_vs_stockpile, nsr, set_aside_status, ' +
    'assess_covenants, recommend_hedge_stance.',
  evidence:
    'Cite GN 198/2025 for every USD-related refusal. Cite BoT mid-rate timestamp for every TZS-USD conversion. Cite the ' +
    'facility agreement clause backing each covenant threshold and the board hedging-policy reference for the hedge cap.',
  outputSchema:
    '{ "mode": FxTreasuryMode, "bot_route_nsr_tzs"?: number, "export_route_nsr_tzs"?: number, ' +
    '"recommendation": "sell_bot"|"sell_export"|"stockpile"|"hold_pending_evidence", ' +
    '"set_aside_ratio_pct"?: number, "set_aside_blocks_export"?: boolean, ' +
    '"usd_contracts_to_convert": [...], "cliff_date": "2026-03-27", "days_to_cliff": int, ' +
    '"covenant_assessment": {...}|null, "hedging_recommendation": {...}|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain:
    'advisory + advisory writes; never executes a sale, funds a DSRA, places a hedge, or moves money; any money event routes via LedgerService.post()',
  hardRules: [
    'Never advise non-TZS pricing for a domestic transaction (GN 198/2025).',
    'Never advise sale that violates 20 % set-aside (export permit will be denied).',
    'Never advise speculative FX or commodity trading — operational hedges only (cover committed debt service / capex, preserve upside).',
    'BoT route economics: 4 % royalty / 0 % inspection / 0 % VAT / 24h TZS settlement.',
    'Surface every covenant breach (DSCR < 1.5x, reserve-tail < 30 %, DSRA shortfall) proactively — do not bury it.',
    'Hedge ratio must respect the board-approved policy cap; never recommend cover above it.',
  ],
});

function buildUserPrompt(input: FxTreasuryInput): string {
  const today = new Date(isoToday());
  const cliff = new Date('2026-03-27');
  const daysToCliff = Math.floor((cliff.getTime() - today.getTime()) / 86_400_000);
  return [
    `TENANT: ${input.tenantId}  MODE: ${input.mode}  TODAY: ${isoToday()}  DAYS_TO_CLIFF: ${daysToCliff}`,
    `BoT RATE: ${input.current_bot_rate_tzs_per_usd} TZS/USD`,
    input.parcel_id ? `PARCEL: ${input.parcel_id}` : '',
    input.mineral ? `MINERAL: ${input.mineral}` : '',
    input.mass_g_or_t !== undefined ? `MASS: ${input.mass_g_or_t}` : '',
    input.grade_g_per_t_or_pct !== undefined ? `GRADE: ${input.grade_g_per_t_or_pct}` : '',
    input.lbma_or_lme_price_usd !== undefined ? `LBMA/LME: ${input.lbma_or_lme_price_usd} USD` : '',
    `COST_OF_CARRY: ${(input.cost_of_carry_pct_per_month * 100).toFixed(2)} %/month  HORIZON_DAYS: ${input.days_horizon}`,
    input.covenant_inputs
      ? `COVENANT_INPUTS (${input.covenant_inputs.currency_code}):\n${JSON.stringify(input.covenant_inputs, null, 2).slice(0, 2_500)}`
      : '',
    input.hedging_inputs ? `HEDGING_INPUTS:\n${JSON.stringify(input.hedging_inputs, null, 2).slice(0, 1_500)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Run the pure covenant engine and shape the authoritative block (currency-agnostic). */
function computeCovenantBlock(
  inputs: CovenantInputsBlock,
  thresholds: CovenantThresholds | undefined,
): CovenantAssessmentBlock {
  const engineInputs: CovenantInputs = {
    cfads_period: inputs.cfads_period,
    debt_service_period: inputs.debt_service_period,
    npv_cfads_loan_life: inputs.npv_cfads_loan_life,
    npv_cfads_project_life: inputs.npv_cfads_project_life,
    debt_outstanding: inputs.debt_outstanding,
    reserves_at_final_repayment: inputs.reserves_at_final_repayment,
    total_reserves: inputs.total_reserves,
    dsra_balance: inputs.dsra_balance,
    ...(inputs.dsra_required_months !== undefined
      ? { dsra_required_months: inputs.dsra_required_months }
      : {}),
    ...(inputs.period_months !== undefined ? { period_months: inputs.period_months } : {}),
    ...(inputs.equator_principles_cleared !== undefined
      ? { equator_principles_cleared: inputs.equator_principles_cleared }
      : {}),
  };
  const a = assessCovenants(engineInputs, thresholds ?? DEFAULT_COVENANT_THRESHOLDS);
  return {
    currency_code: inputs.currency_code,
    dscr: { ...a.dscr },
    llcr: { ...a.llcr },
    plcr: { ...a.plcr },
    reserve_tail: { ...a.reserve_tail },
    dsra: { ...a.dsra },
    es_gate_cleared: a.es_gate_cleared,
    any_breach: a.any_breach,
    breaches: [...a.breaches],
  };
}

/** Run the pure hedge-stance engine and shape the authoritative block. */
function computeHedgeBlock(inputs: HedgingInputsBlock): HedgingRecommendationBlock {
  const engineInputs: HedgingInputs = {
    committed_outflow: inputs.committed_outflow,
    exposed_revenue: inputs.exposed_revenue,
    already_hedged_notional: inputs.already_hedged_notional,
    board_max_hedge_ratio: inputs.board_max_hedge_ratio,
    current_dscr: inputs.current_dscr,
    ...(inputs.dscr_min !== undefined ? { dscr_min: inputs.dscr_min } : {}),
  };
  const h = recommendHedgeStance(engineInputs);
  return {
    target_hedge_ratio: h.target_hedge_ratio,
    current_hedge_ratio: h.current_hedge_ratio,
    recommended_incremental_notional: h.recommended_incremental_notional,
    stance: h.stance,
    board_cap_respected: h.board_cap_respected,
    instruments_suggested: [...h.instruments_suggested],
    rationale: h.rationale,
  };
}

export function createFxTreasuryAgent(deps: JuniorDeps) {
  return {
    async processInput(input: FxTreasuryInput): Promise<FxTreasuryOutput> {
      const validated = FxTreasuryInputSchema.parse(input);
      const llm = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'fx-treasury-agent',
        schema: FxTreasuryOutput,
        systemPrompt: FX_TREASURY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      // Deterministic authority: in covenants mode the engines, not the
      // LLM, own the ratios and the hedge stance.
      const isCovenants = validated.mode === 'covenants';
      const covenantAssessment =
        isCovenants && validated.covenant_inputs
          ? computeCovenantBlock(validated.covenant_inputs, validated.covenant_thresholds)
          : null;
      const hedgingRecommendation =
        isCovenants && validated.hedging_inputs ? computeHedgeBlock(validated.hedging_inputs) : null;

      const output: FxTreasuryOutput = {
        ...llm,
        covenant_assessment: covenantAssessment,
        hedging_recommendation: hedgingRecommendation,
      };

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const fxSnapshots = schemas?.fxSnapshots as unknown;
          if (fxSnapshots) {
            await deps.db
              .insert(fxSnapshots)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                mode: validated.mode,
                botRateTzsPerUsd:
                  validated.current_bot_rate_tzs_per_usd !== undefined &&
                  validated.current_bot_rate_tzs_per_usd !== null
                    ? String(validated.current_bot_rate_tzs_per_usd)
                    : null,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('fx-treasury-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type FxTreasuryAgent = ReturnType<typeof createFxTreasuryAgent>;

export function createDefaultFxTreasuryAgent(): FxTreasuryAgent {
  let cached: FxTreasuryAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createFxTreasuryAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

/**
 * FX / Treasury Agent — live FX, sell-vs-stockpile simulator, BoT gold
 * window, 27-March-2026 USD cliff tracker (AGENT_PROMPT_LIBRARY §16,
 * §26) PLUS the deterministic project-finance covenant engine
 * (commercial-book §7.2): DSCR / LLCR / PLCR, reserve-tail, DSRA, and a
 * board-policy-bounded hedging stance (§5.4).
 *
 * The `covenants` mode runs `assessCovenants` + `recommendHedgeStance`
 * locally (no LLM); the LLM narrates the breach playbook around the
 * deterministic numbers.
 *
 * MONEY MATH NOTE: this junior only ADVISES. No DSRA top-up, hedge, or
 * debt-service payment moves money here. Any such money movement must
 * route through `LedgerService.post()` (double-entry, SoD: proposer (this
 * agent) != approver (four-eye) != recorder (ledger)) — never a direct
 * write.
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
// Covenant + hedging inputs (deterministic project-finance engine, §7.2/§5.4)
// ─────────────────────────────────────────────────────────────────────

export const CovenantThresholdsSchema = z.object({
  dscr_min: z.number().positive(),
  llcr_min: z.number().positive(),
  plcr_min: z.number().positive(),
  reserve_tail_min_pct: z.number().min(0).max(100),
});

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
  /** Currency the cash amounts are denominated in (rendered via formatCurrency by callers). */
  currency_code: z.string().min(1),
  thresholds: CovenantThresholdsSchema.optional(),
});
export type CovenantInputsInput = z.infer<typeof CovenantInputsSchema>;

export const HedgingInputsSchema = z.object({
  committed_outflow: z.number().nonnegative(),
  exposed_revenue: z.number().nonnegative(),
  already_hedged_notional: z.number().nonnegative(),
  board_max_hedge_ratio: z.number().min(0).max(1),
  current_dscr: z.number(),
  dscr_min: z.number().positive().optional(),
});
export type HedgingInputsInput = z.infer<typeof HedgingInputsSchema>;

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
  /** Required for mode='covenants' — drives the deterministic DSCR/LLCR/PLCR/reserve-tail/DSRA assessment. */
  covenant_inputs: CovenantInputsSchema.optional(),
  /** Optional hedging book state — drives the board-bounded hedge stance. */
  hedging_inputs: HedgingInputsSchema.optional(),
});
export type FxTreasuryInput = z.infer<typeof FxTreasuryInputSchema>;

const RatioResultSchema = z.object({
  value: z.number(),
  threshold: z.number(),
  status: z.enum(['pass', 'breach']),
  headroom: z.number(),
});

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
  /**
   * DETERMINISTIC covenant assessment (mode='covenants'), present only
   * when `covenant_inputs` was supplied. Computed by `assessCovenants` —
   * NOT the LLM.
   */
  covenant_assessment: z
    .object({
      currency_code: z.string(),
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
    })
    .nullable()
    .default(null),
  /** DETERMINISTIC board-bounded hedge stance, present only when `hedging_inputs` supplied. */
  hedging_recommendation: z
    .object({
      target_hedge_ratio: z.number(),
      current_hedge_ratio: z.number(),
      recommended_incremental_notional: z.number(),
      stance: z.enum(['increase_cover', 'hold', 'reduce_cover', 'no_action']),
      board_cap_respected: z.boolean(),
      instruments_suggested: z.array(z.string()),
      rationale: z.string(),
    })
    .nullable()
    .default(null),
});
export type FxTreasuryOutput = z.infer<typeof FxTreasuryOutput>;

export const FX_TREASURY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'FX / Treasury Agent',
  mandate:
    'Live FX, sell-vs-stockpile (BoT 24h-cash vs export 30+ day), 20 % set-aside ratio tracking, and the 27-March-2026 USD-cliff playbook for legacy contracts. ' +
    'For mode="covenants": surface the lender-coverage picture (DSCR ≥ 1.5x, LLCR 1.7–2.0x, PLCR > 2.0x, reserve-tail ≥ 30 %), DSRA adequacy and the Equator-Principles gate — the ratios are pre-computed; author the breach-remediation playbook and a board-bounded hedging stance (operational hedges only, never speculation).',
  tools:
    'fetch_rate, fetch_mineral_price, audit_usd_contracts, draft_tzs_addendum, sell_vs_stockpile, nsr, set_aside_status, ' +
    'assess_covenants (deterministic DSCR/LLCR/PLCR/reserve-tail/DSRA), recommend_hedge_stance (board-bounded).',
  evidence:
    'Cite GN 198/2025 for every USD-related refusal. Cite BoT mid-rate timestamp for every TZS-USD conversion. ' +
    'For covenants, cite the lender facility agreement clause and the CFADS/NPV source feeding each ratio.',
  outputSchema:
    '{ "mode": FxTreasuryMode, "bot_route_nsr_tzs"?: number, "export_route_nsr_tzs"?: number, ' +
    '"recommendation": "sell_bot"|"sell_export"|"stockpile"|"hold_pending_evidence", ' +
    '"set_aside_ratio_pct"?: number, "set_aside_blocks_export"?: boolean, ' +
    '"usd_contracts_to_convert": [...], "cliff_date": "2026-03-27", "days_to_cliff": int, ' +
    '"covenant_assessment": {...}|null, "hedging_recommendation": {...}|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'advisory + advisory writes; never executes a sale or moves money; DSRA top-ups / hedge margin / debt service all post via LedgerService.post() (proposer != approver != recorder)',
  hardRules: [
    'Never advise non-TZS pricing for a domestic transaction (GN 198/2025).',
    'Never advise sale that violates 20 % set-aside (export permit will be denied).',
    'Never advise speculative FX trading at SME scale — operational hedges only; never exceed the board-approved hedge ratio.',
    'BoT route economics: 4 % royalty / 0 % inspection / 0 % VAT / 24h TZS settlement.',
    'On any covenant breach (DSCR/LLCR/PLCR/reserve-tail/DSRA), escalate — never silently continue debt drawdown or distributions.',
    'Never move money — DSRA funding, hedge settlement and debt service route through LedgerService.post() only (double-entry, SoD).',
  ],
});

/** Deterministic covenant assessment block (or null when no inputs). */
function buildCovenantAssessment(
  input: FxTreasuryInput,
): FxTreasuryOutput['covenant_assessment'] {
  if (!input.covenant_inputs) return null;
  const { currency_code, thresholds, ...rest } = input.covenant_inputs;
  const effective: CovenantThresholds = thresholds ?? DEFAULT_COVENANT_THRESHOLDS;
  const a = assessCovenants(rest as CovenantInputs, effective);
  return {
    currency_code,
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

/** Deterministic board-bounded hedge stance (or null when no inputs). */
function buildHedgingRecommendation(
  input: FxTreasuryInput,
): FxTreasuryOutput['hedging_recommendation'] {
  if (!input.hedging_inputs) return null;
  const h = recommendHedgeStance(input.hedging_inputs as HedgingInputs);
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

function buildUserPrompt(
  input: FxTreasuryInput,
  covenants: FxTreasuryOutput['covenant_assessment'],
  hedging: FxTreasuryOutput['hedging_recommendation'],
): string {
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
    covenants
      ? `DETERMINISTIC_COVENANT_ASSESSMENT (pre-computed — echo verbatim in "covenant_assessment"):\n${JSON.stringify(covenants, null, 2).slice(0, 2_500)}`
      : '',
    hedging
      ? `DETERMINISTIC_HEDGE_STANCE (pre-computed — echo verbatim in "hedging_recommendation"):\n${JSON.stringify(hedging, null, 2).slice(0, 1_500)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createFxTreasuryAgent(deps: JuniorDeps) {
  return {
    async processInput(input: FxTreasuryInput): Promise<FxTreasuryOutput> {
      const validated = FxTreasuryInputSchema.parse(input);
      // Deterministic project-finance math is computed locally — it is
      // the source of truth; the LLM only narrates the playbook.
      const covenants = buildCovenantAssessment(validated);
      const hedging = buildHedgingRecommendation(validated);
      const llmOutput = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'fx-treasury-agent',
        schema: FxTreasuryOutput,
        systemPrompt: FX_TREASURY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated, covenants, hedging),
        maxTokens: 2500,
      });
      // Overwrite the echoed blocks with the authoritative deterministic
      // computation — never trust the LLM for covenant / hedge money math.
      const output: FxTreasuryOutput = {
        ...llmOutput,
        covenant_assessment: covenants,
        hedging_recommendation: hedging,
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

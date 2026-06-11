/**
 * Sales / Off-take Agent — net price per parcel, buyer comparison,
 * payment trace (AGENT_PROMPT_LIBRARY §17) PLUS the deterministic
 * off-take settlement engine (commercial-book §5.1/§5.3): quality specs,
 * precious-metals payabilities, TC/RC, deleterious-element penalties →
 * NET (not gross) payable revenue.
 *
 * The DETERMINISTIC `offtake_settlement` block is computed locally by
 * `computeOfftakeSettlement` (no LLM) whenever `offtake_terms` is
 * supplied; the LLM still authors the qualitative buyer recommendation.
 *
 * MONEY MATH NOTE: this junior only ADVISES. The NET figure never posts
 * to a ledger here. Any binding settlement must route through
 * `LedgerService.post()` (double-entry, SoD: proposer != approver !=
 * recorder) — never a direct write.
 *
 * Writes via typed `db.insert(salesAdvice)` (migration 0011).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';
import {
  computeOfftakeSettlement,
  realisationBandFlag,
  type OfftakeTerms,
} from './offtake-settlement.js';

export const BuyerSchema = z.object({
  buyer_id: z.string().min(1),
  name: z.string().min(1),
  route: z.enum(['BoT', 'GGRL', 'MPMR', 'EyesOfAfrica', 'MTC', 'Geneva', 'Tucson', 'HK_BK', 'CN_KR_EU']),
  gross_price_per_unit_usd: z.number().positive().optional(),
  gross_price_per_unit_tzs: z.number().positive().optional(),
  payment_terms_days: z.number().int().nonnegative(),
  deductions_pct: z.number().min(0).max(100).default(0),
  inspection_fees_pct: z.number().min(0).max(100).default(0),
});

export const ParcelSchema = z.object({
  parcel_id: z.string().min(1),
  source_pml: z.string().min(1),
  mineral: z.string().min(1),
  mass_g_or_t: z.number().positive(),
  grade_g_per_t_or_pct: z.number().nonnegative().optional(),
  photos_evidence_ids: z.array(z.string()).default([]),
});

// ─────────────────────────────────────────────────────────────────────
// Off-take settlement (deterministic) — quality specs + TC/RC + penalties
// ─────────────────────────────────────────────────────────────────────

export const PayableMetalSchema = z.object({
  metal: z.string().min(1),
  grade_fraction: z.number().min(0).max(1).optional(),
  grade_g_per_t: z.number().nonnegative().optional(),
  payable_fraction: z.number().min(0).max(1),
  min_deduction_unit: z.number().nonnegative().optional(),
  reference_price_per_unit: z.number().nonnegative(),
  pricing_basis: z.enum(['mass_fraction', 'per_gram']),
});

export const DeleteriousPenaltySchema = z.object({
  element: z.string().min(1),
  assay_ppm: z.number().nonnegative(),
  threshold_ppm: z.number().nonnegative(),
  charge_per_ppm_over: z.number().nonnegative(),
  reject_above_ppm: z.number().nonnegative().optional(),
});

export const OfftakeTermsSchema = z.object({
  dmt: z.number().positive(),
  tc_per_dmt: z.number().nonnegative(),
  rc_per_payable_unit: z.record(z.string(), z.number().nonnegative()).default({}),
  metals: z.array(PayableMetalSchema).min(1),
  penalties: z.array(DeleteriousPenaltySchema).default([]),
  freight_insurance_total: z.number().nonnegative().optional(),
  /** Currency the term sheet is denominated in (rendered via formatCurrency by callers). */
  currency_code: z.string().min(1),
});
export type OfftakeTermsInput = z.infer<typeof OfftakeTermsSchema>;

export const SalesInputSchema = z.object({
  tenantId: z.string().min(1),
  parcel: ParcelSchema,
  buyers: z.array(BuyerSchema).min(1),
  current_bot_rate_tzs_per_usd: z.number().positive(),
  cash_constrained: z.boolean().default(false),
  /** Optional off-take term sheet — when present, NET settlement is computed deterministically. */
  offtake_terms: OfftakeTermsSchema.optional(),
});
export type SalesInput = z.infer<typeof SalesInputSchema>;

export const SalesOutput = AuditedOutputBase.extend({
  parcel_id: z.string(),
  buyer_comparison: z.array(
    z.object({
      buyer_id: z.string(),
      net_price_tzs: z.number().nonnegative(),
      cash_conversion_days: z.number().int().nonnegative(),
      deductions_tzs: z.number().nonnegative(),
    }),
  ),
  recommended_buyer_id: z.string().min(1),
  recommendation_reason: z.string().min(1),
  mtc_preflight_required: z.boolean(),
  mtc_documents_needed: z.array(z.string()),
  /**
   * DETERMINISTIC NET-revenue settlement, present only when `offtake_terms`
   * was supplied. Computed by `computeOfftakeSettlement` — NOT the LLM.
   */
  offtake_settlement: z
    .object({
      currency_code: z.string(),
      gross_value: z.number(),
      tc_charge: z.number(),
      rc_charge_total: z.number(),
      penalty_charge_total: z.number(),
      freight_insurance_total: z.number(),
      net_payable_value: z.number(),
      payable_pct_of_gross: z.number(),
      realisation_band: z.enum(['below_band', 'in_band', 'above_band']),
      cargo_rejectable: z.boolean(),
      metal_lines: z.array(
        z.object({
          metal: z.string(),
          contained_units: z.number(),
          payable_units: z.number(),
          gross_value: z.number(),
          rc_charge: z.number(),
          net_value: z.number(),
        }),
      ),
      penalty_lines: z.array(
        z.object({
          element: z.string(),
          ppm_over_threshold: z.number(),
          penalty_charge: z.number(),
          cargo_rejectable: z.boolean(),
        }),
      ),
    })
    .nullable()
    .default(null),
});
export type SalesOutput = z.infer<typeof SalesOutput>;

export const SALES_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Sales / Off-take Agent',
  mandate:
    'Compute net price per buyer (post-deductions, post-FX), recommend route, and pre-flight MTC paperwork for gold/tin/diamond/tanzanite/gemstones. ' +
    'For concentrate off-take, structure quality specs, precious-metals payabilities, TC/RC and deleterious-element penalties to compute NET (not gross) payable revenue (~85–96.5 % of reference after TC/RC). ' +
    'The NET settlement figures are pre-computed deterministically; explain WHY the chosen buyer/term-sheet wins and flag any out-of-band realisation.',
  tools:
    'list_parcels, list_buyers, net_price_compare, offtake_settlement (deterministic NET = gross − TC − RC − penalties), ' +
    'assemble_mtc_pack, book_gmo_inspection, capture_weighbridge, driver_letter, payment_trace.',
  evidence:
    'Cite the source_pml chain-of-custody and the photos_evidence_ids for every parcel. Cite the BoT rate timestamp for FX conversion. ' +
    'For off-take settlement, cite the assay certificate and the term-sheet payability / TC-RC / penalty schedule used.',
  outputSchema:
    '{ "parcel_id": string, "buyer_comparison": [...], "recommended_buyer_id": string, ' +
    '"recommendation_reason": string, "mtc_preflight_required": boolean, "mtc_documents_needed": string[], ' +
    '"offtake_settlement": {...}|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'advisory; never books or commits a sale autonomously; NET figures advise only — binding settlement posts via LedgerService.post()',
  hardRules: [
    'For cash-constrained operators, weight shortest cash-conversion cycle highest.',
    'MTC pre-flight required for gold / tin / diamond / tanzanite / gemstones.',
    'Always include weighbridge photo capture in the on-loading flow.',
    'Always quote NET (post TC/RC/penalty) payable revenue, never gross, for concentrate off-take.',
    'Never advise accepting a cargo whose deleterious assay exceeds the term-sheet rejection ceiling.',
    'Never post a settlement directly — any binding money movement routes through LedgerService.post() (double-entry, SoD).',
  ],
});

/**
 * Run the deterministic NET-revenue engine over the supplied term sheet.
 * Returns the schema-shaped settlement block (currency-tagged) or null
 * when no `offtake_terms` were provided.
 */
function buildOfftakeSettlement(input: SalesInput): SalesOutput['offtake_settlement'] {
  if (!input.offtake_terms) return null;
  const { currency_code, ...rest } = input.offtake_terms;
  const settlement = computeOfftakeSettlement(rest as OfftakeTerms);
  return {
    currency_code,
    gross_value: settlement.gross_value,
    tc_charge: settlement.tc_charge,
    rc_charge_total: settlement.rc_charge_total,
    penalty_charge_total: settlement.penalty_charge_total,
    freight_insurance_total: settlement.freight_insurance_total,
    net_payable_value: settlement.net_payable_value,
    payable_pct_of_gross: settlement.payable_pct_of_gross,
    realisation_band: realisationBandFlag(settlement.payable_pct_of_gross),
    cargo_rejectable: settlement.cargo_rejectable,
    metal_lines: settlement.metal_lines.map((l) => ({ ...l })),
    penalty_lines: settlement.penalty_lines.map((l) => ({ ...l })),
  };
}

function buildUserPrompt(
  input: SalesInput,
  settlement: SalesOutput['offtake_settlement'],
): string {
  return [
    `TENANT: ${input.tenantId}  PARCEL: ${input.parcel.parcel_id}  MINERAL: ${input.parcel.mineral}`,
    `MASS: ${input.parcel.mass_g_or_t}  GRADE: ${input.parcel.grade_g_per_t_or_pct ?? 'n/a'}`,
    `BoT_RATE: ${input.current_bot_rate_tzs_per_usd} TZS/USD  CASH_CONSTRAINED: ${input.cash_constrained}`,
    `BUYERS:`,
    JSON.stringify(input.buyers, null, 2).slice(0, 3_500),
    settlement
      ? `DETERMINISTIC_OFFTAKE_SETTLEMENT (NET, pre-computed — echo verbatim in "offtake_settlement"):\n${JSON.stringify(settlement, null, 2).slice(0, 3_000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createSalesOfftakeAgent(deps: JuniorDeps) {
  return {
    async processInput(input: SalesInput): Promise<SalesOutput> {
      const validated = SalesInputSchema.parse(input);
      // Deterministic NET settlement is computed locally — it is the
      // source of truth; the LLM only narrates around it.
      const settlement = buildOfftakeSettlement(validated);
      const llmOutput = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'sales-offtake-agent',
        schema: SalesOutput,
        systemPrompt: SALES_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated, settlement),
        maxTokens: 2500,
      });
      // Overwrite the (possibly hallucinated) echoed block with the
      // authoritative deterministic settlement — never trust the LLM for
      // money math.
      const output: SalesOutput = { ...llmOutput, offtake_settlement: settlement };

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const salesAdvice = schemas?.salesAdvice as unknown;
          if (salesAdvice) {
            await deps.db
              .insert(salesAdvice)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                parcelId: validated.parcel.parcel_id,
                recommendedBuyerId: output.recommended_buyer_id,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('sales-offtake-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type SalesOfftakeAgent = ReturnType<typeof createSalesOfftakeAgent>;

export function createDefaultSalesOfftakeAgent(): SalesOfftakeAgent {
  let cached: SalesOfftakeAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createSalesOfftakeAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

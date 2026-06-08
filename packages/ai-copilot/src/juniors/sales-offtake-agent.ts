/**
 * Sales / Off-take Agent — net price per parcel, buyer comparison,
 * payment trace (AGENT_PROMPT_LIBRARY §17) DEEPENED with a deterministic
 * NET-revenue off-take settlement engine grounded in the commercial book
 * (`Docs/research/mining-estate-operating-model.md` §5.1 / §5.3):
 *   - concentrate quality specs + precious-metals payabilities,
 *   - treatment & refining charges (TC/RC),
 *   - deleterious-element penalties (As, Hg, Sb …),
 *   - NET (not gross) payable revenue, ~85–96.5 % of LME after TC/RC.
 *
 * AUTHORITY MODEL: when `offtake_terms` are supplied, the settlement is
 * computed by the pure `computeOfftakeSettlement` engine and that
 * deterministic block OVERWRITES whatever the LLM echoed — the model
 * narrates, the engine decides the money math. No fabricated settlement
 * survives.
 *
 * MONEY MATH NOTE: this junior only ADVISES. The settlement it computes
 * never posts to a ledger. Any binding off-take settlement must route
 * through `LedgerService.post()` (double-entry, SoD: proposer != approver
 * != recorder) — never a direct write.
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
// Off-take term sheet (drives the deterministic NET-revenue engine)
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
  rc_per_payable_unit: z.record(z.string(), z.number().nonnegative()),
  metals: z.array(PayableMetalSchema).min(1),
  penalties: z.array(DeleteriousPenaltySchema).default([]),
  freight_insurance_total: z.number().nonnegative().optional(),
  /** Currency the term sheet is denominated in — rendered via formatCurrency, never hard-coded. */
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

// ─────────────────────────────────────────────────────────────────────
// Deterministic settlement block carried on the output (authoritative)
// ─────────────────────────────────────────────────────────────────────

export const OfftakeSettlementSchema = z.object({
  currency_code: z.string().min(1),
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
});
export type OfftakeSettlementBlock = z.infer<typeof OfftakeSettlementSchema>;

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
  /** Deterministic NET-revenue settlement — null when no off-take terms supplied. */
  offtake_settlement: OfftakeSettlementSchema.nullable().default(null),
});
export type SalesOutput = z.infer<typeof SalesOutput>;

export const SALES_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Sales / Off-take Agent',
  mandate:
    'Compute NET (not gross) price per buyer (post TC/RC, post deleterious penalties, post-deductions, post-FX), ' +
    'recommend route, and pre-flight MTC paperwork for gold/tin/diamond/tanzanite/gemstones. When an off-take term ' +
    'sheet is supplied the deterministic settlement engine is authoritative — narrate it, do not invent it.',
  tools:
    'list_parcels, list_buyers, net_price_compare, offtake_settlement, assemble_mtc_pack, book_gmo_inspection, ' +
    'capture_weighbridge, driver_letter, payment_trace.',
  evidence:
    'Cite the source_pml chain-of-custody and the photos_evidence_ids for every parcel. Cite the BoT rate timestamp ' +
    'for FX conversion. Cite the off-take term-sheet clause (TC/RC, payability, penalty schedule) backing the settlement.',
  outputSchema:
    '{ "parcel_id": string, "buyer_comparison": [...], "recommended_buyer_id": string, ' +
    '"recommendation_reason": string, "mtc_preflight_required": boolean, "mtc_documents_needed": string[], ' +
    '"offtake_settlement": {...}|null, "confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'advisory; never books or commits a sale autonomously; any binding settlement routes via LedgerService.post()',
  hardRules: [
    'Compute NET revenue, never gross — TC/RC + deleterious penalties + freight come off the top (~85–96.5 % of LME).',
    'For cash-constrained operators, weight shortest cash-conversion cycle highest.',
    'MTC pre-flight required for gold / tin / diamond / tanzanite / gemstones.',
    'Always include weighbridge photo capture in the on-loading flow.',
    'Flag any cargo whose deleterious assay exceeds the rejection ceiling — do not recommend shipping a rejectable cargo.',
  ],
});

function buildUserPrompt(input: SalesInput): string {
  return [
    `TENANT: ${input.tenantId}  PARCEL: ${input.parcel.parcel_id}  MINERAL: ${input.parcel.mineral}`,
    `MASS: ${input.parcel.mass_g_or_t}  GRADE: ${input.parcel.grade_g_per_t_or_pct ?? 'n/a'}`,
    `BoT_RATE: ${input.current_bot_rate_tzs_per_usd} TZS/USD  CASH_CONSTRAINED: ${input.cash_constrained}`,
    `BUYERS:`,
    JSON.stringify(input.buyers, null, 2).slice(0, 3_500),
    input.offtake_terms
      ? `OFFTAKE_TERMS (${input.offtake_terms.currency_code}):\n${JSON.stringify(input.offtake_terms, null, 2).slice(0, 3_000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Run the pure NET-revenue engine over the supplied term sheet and shape
 * the authoritative settlement block. Currency-agnostic: the term sheet's
 * own `currency_code` flows through; no TZS/USD is hard-coded.
 */
function computeSettlementBlock(terms: OfftakeTermsInput): OfftakeSettlementBlock {
  const engineTerms: OfftakeTerms = {
    dmt: terms.dmt,
    tc_per_dmt: terms.tc_per_dmt,
    rc_per_payable_unit: terms.rc_per_payable_unit,
    metals: terms.metals.map((m) => ({
      metal: m.metal,
      payable_fraction: m.payable_fraction,
      reference_price_per_unit: m.reference_price_per_unit,
      pricing_basis: m.pricing_basis,
      ...(m.grade_fraction !== undefined ? { grade_fraction: m.grade_fraction } : {}),
      ...(m.grade_g_per_t !== undefined ? { grade_g_per_t: m.grade_g_per_t } : {}),
      ...(m.min_deduction_unit !== undefined ? { min_deduction_unit: m.min_deduction_unit } : {}),
    })),
    penalties: terms.penalties.map((p) => ({
      element: p.element,
      assay_ppm: p.assay_ppm,
      threshold_ppm: p.threshold_ppm,
      charge_per_ppm_over: p.charge_per_ppm_over,
      ...(p.reject_above_ppm !== undefined ? { reject_above_ppm: p.reject_above_ppm } : {}),
    })),
    ...(terms.freight_insurance_total !== undefined
      ? { freight_insurance_total: terms.freight_insurance_total }
      : {}),
  };
  const s = computeOfftakeSettlement(engineTerms);
  return {
    currency_code: terms.currency_code,
    gross_value: s.gross_value,
    tc_charge: s.tc_charge,
    rc_charge_total: s.rc_charge_total,
    penalty_charge_total: s.penalty_charge_total,
    freight_insurance_total: s.freight_insurance_total,
    net_payable_value: s.net_payable_value,
    payable_pct_of_gross: s.payable_pct_of_gross,
    realisation_band: realisationBandFlag(s.payable_pct_of_gross),
    cargo_rejectable: s.cargo_rejectable,
    metal_lines: s.metal_lines.map((l) => ({ ...l })),
    penalty_lines: s.penalty_lines.map((l) => ({ ...l })),
  };
}

export function createSalesOfftakeAgent(deps: JuniorDeps) {
  return {
    async processInput(input: SalesInput): Promise<SalesOutput> {
      const validated = SalesInputSchema.parse(input);
      const llm = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'sales-offtake-agent',
        schema: SalesOutput,
        systemPrompt: SALES_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      // Deterministic authority: the engine, not the LLM, owns the money math.
      const settlement = validated.offtake_terms
        ? computeSettlementBlock(validated.offtake_terms)
        : null;
      const output: SalesOutput = { ...llm, offtake_settlement: settlement };

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

/**
 * Sales / Off-take Agent — net price per parcel, buyer comparison,
 * payment trace (AGENT_PROMPT_LIBRARY §17).
 *
 * Schema gap: `sales_advice` raw SQL; TODO(phase-3).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

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

export const SalesInputSchema = z.object({
  tenantId: z.string().min(1),
  parcel: ParcelSchema,
  buyers: z.array(BuyerSchema).min(1),
  current_bot_rate_tzs_per_usd: z.number().positive(),
  cash_constrained: z.boolean().default(false),
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
});
export type SalesOutput = z.infer<typeof SalesOutput>;

export const SALES_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Sales / Off-take Agent',
  mandate:
    'Compute net price per buyer (TZS, post-deductions, post-FX), recommend route, and pre-flight MTC paperwork for gold/tin/diamond/tanzanite/gemstones.',
  tools:
    'list_parcels, list_buyers, net_price_compare, assemble_mtc_pack, book_gmo_inspection, capture_weighbridge, driver_letter, payment_trace.',
  evidence:
    'Cite the source_pml chain-of-custody and the photos_evidence_ids for every parcel. Cite the BoT rate timestamp for FX conversion.',
  outputSchema:
    '{ "parcel_id": string, "buyer_comparison": [...], "recommended_buyer_id": string, ' +
    '"recommendation_reason": string, "mtc_preflight_required": boolean, "mtc_documents_needed": string[], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'advisory; never books or commits a sale autonomously',
  hardRules: [
    'For cash-constrained operators, weight shortest cash-conversion cycle highest.',
    'MTC pre-flight required for gold / tin / diamond / tanzanite / gemstones.',
    'Always include weighbridge photo capture in the on-loading flow.',
  ],
});

function buildUserPrompt(input: SalesInput): string {
  return [
    `TENANT: ${input.tenantId}  PARCEL: ${input.parcel.parcel_id}  MINERAL: ${input.parcel.mineral}`,
    `MASS: ${input.parcel.mass_g_or_t}  GRADE: ${input.parcel.grade_g_per_t_or_pct ?? 'n/a'}`,
    `BoT_RATE: ${input.current_bot_rate_tzs_per_usd} TZS/USD  CASH_CONSTRAINED: ${input.cash_constrained}`,
    `BUYERS:`,
    JSON.stringify(input.buyers, null, 2).slice(0, 3_500),
  ].join('\n');
}

export function createSalesOfftakeAgent(deps: JuniorDeps) {
  return {
    async processInput(input: SalesInput): Promise<SalesOutput> {
      const validated = SalesInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'sales-offtake-agent',
        schema: SalesOutput,
        systemPrompt: SALES_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const json = JSON.stringify(output);
          // TODO(phase-3): typed insert against `sales_advice`.
          await deps.db.execute(
            sql`INSERT INTO sales_advice
                  (id, tenant_id, parcel_id, recommended_buyer_id, summary, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.parcel.parcel_id},
                        ${output.recommended_buyer_id}, ${json}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
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

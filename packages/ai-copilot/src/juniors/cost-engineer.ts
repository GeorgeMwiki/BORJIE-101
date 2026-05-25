/**
 * Cost Engineer Agent — P&L, unit economics, break-even sensitivity
 * (AGENT_PROMPT_LIBRARY §15).
 *
 * Schema gap: `unit_economics_snapshots` raw SQL; TODO(phase-3).
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

export const CostBucket = z.object({
  actual_tzs: z.number().nonnegative(),
  forecast_tzs: z.number().nonnegative(),
  committed_tzs: z.number().nonnegative(),
  unpaid_tzs: z.number().nonnegative(),
  disputed_tzs: z.number().nonnegative(),
  hidden_tzs: z.number().nonnegative(),
  document_blocked_tzs: z.number().nonnegative(),
});

export const CostEngineerInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  mineral: z.string().min(1),
  period_iso: z.string().regex(/^\d{4}-\d{2}$/),
  tonnes_rom: z.number().nonnegative(),
  tonnes_milled: z.number().nonnegative(),
  metres_advanced: z.number().nonnegative(),
  bcm_overburden: z.number().nonnegative(),
  recoverable_units: z.number().nonnegative(), // g for Au, t for Cu, ct for diamond
  recoverable_unit_label: z.string(),
  costs: CostBucket,
  current_price_per_unit_tzs: z.number().positive(),
});
export type CostEngineerInput = z.infer<typeof CostEngineerInputSchema>;

export const CostEngineerOutput = AuditedOutputBase.extend({
  unit_economics: z.object({
    tzs_per_metre: z.number().nonnegative(),
    tzs_per_bcm: z.number().nonnegative(),
    tzs_per_tonne_rom: z.number().nonnegative(),
    tzs_per_tonne_milled: z.number().nonnegative(),
    tzs_per_recoverable_unit: z.number().nonnegative(),
  }),
  break_even: z.object({
    be_price_tzs: z.number().nonnegative(),
    be_grade_pct_or_g_t: z.number().nonnegative(),
    sensitivity: z.array(
      z.object({ delta_pct: z.number(), result_pct_change: z.number() }),
    ),
  }),
  cash_runway_days: z.object({ best: z.number(), base: z.number(), worst: z.number() }),
  forecast: z.object({ d7: z.number(), d30: z.number(), d90: z.number() }),
  by_product_credits_tzs: z.number().nonnegative().default(0),
  smelter_payable_pct: z.number().min(0).max(100).optional(),
});
export type CostEngineerOutput = z.infer<typeof CostEngineerOutput>;

export const COST_ENGINEER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Cost Engineer Agent',
  mandate:
    'Compute unit economics, break-even with sensitivity, cash-runway scenarios (best/base/worst), 7/30/90-day forecasts.',
  tools: 'unit_economics, break_even, burn_rate, cash_runway, funding_requirement, smelter_payable.',
  evidence:
    'Cite each cost bucket (actual/forecast/committed/unpaid/disputed/hidden/document-blocked) used in unit economics. ' +
    'Cite the per-mineral file for by-product credits and payable terms (Cu 96-97 %, Pb 95 %, Zn 85 %, Co 60-65 %).',
  outputSchema:
    '{ "unit_economics": {...}, "break_even": {...}, "cash_runway_days": {...}, "forecast": {...}, ' +
    '"by_product_credits_tzs": number, "smelter_payable_pct"?: number, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'computational + advisory; never moves money',
  hardRules: [
    'Always model by-product credits (Au-Ag in Cu, Co-Ni-PGE in Ni sulphide, REE in apatite).',
    'Always model penalty elements (As, Sb, Hg, F, Cl, U) for concentrate sales.',
    'Never report in USD for a domestic transaction (GN 198/2025).',
    'A 0.5 g/t grade variation moves break-even ~15 % for typical SME gold — surface the sensitivity.',
  ],
});

function buildUserPrompt(input: CostEngineerInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  MINERAL: ${input.mineral}  PERIOD: ${input.period_iso}`,
    `PRODUCTION: ROM=${input.tonnes_rom}t MILLED=${input.tonnes_milled}t METRES=${input.metres_advanced}m BCM=${input.bcm_overburden} RECOV=${input.recoverable_units} ${input.recoverable_unit_label}`,
    `PRICE: ${input.current_price_per_unit_tzs} TZS/${input.recoverable_unit_label}`,
    `COSTS:`,
    JSON.stringify(input.costs, null, 2),
  ].join('\n');
}

export function createCostEngineerAgent(deps: JuniorDeps) {
  return {
    async processInput(input: CostEngineerInput): Promise<CostEngineerOutput> {
      const validated = CostEngineerInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'cost-engineer',
        schema: CostEngineerOutput,
        systemPrompt: COST_ENGINEER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 3000,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const json = JSON.stringify(output);
          // TODO(phase-3): typed insert against `unit_economics_snapshots`.
          await deps.db.execute(
            sql`INSERT INTO unit_economics_snapshots
                  (id, tenant_id, site_id, period, summary, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.siteId},
                        ${validated.period_iso}, ${json}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('cost-engineer: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type CostEngineerAgent = ReturnType<typeof createCostEngineerAgent>;

export function createDefaultCostEngineerAgent(): CostEngineerAgent {
  let cached: CostEngineerAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createCostEngineerAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

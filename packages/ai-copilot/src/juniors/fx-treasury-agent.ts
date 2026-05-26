/**
 * FX / Treasury Agent — live FX, sell-vs-stockpile simulator, BoT gold
 * window, 27-March-2026 USD cliff tracker (AGENT_PROMPT_LIBRARY §16,
 * §26).
 *
 * Schema gap: `fx_snapshots`, `sell_vs_stockpile_advice` raw SQL.
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  isoToday,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const FxTreasuryMode = z.enum([
  'rate_check',
  'sell_vs_stockpile',
  'usd_cliff_tracker',
  'set_aside_status',
  'nsr_compare',
]);

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
});
export type FxTreasuryInput = z.infer<typeof FxTreasuryInputSchema>;

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
});
export type FxTreasuryOutput = z.infer<typeof FxTreasuryOutput>;

export const FX_TREASURY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'FX / Treasury Agent',
  mandate:
    'Live FX, sell-vs-stockpile (BoT 24h-cash vs export 30+ day), 20 % set-aside ratio tracking, and the 27-March-2026 USD-cliff playbook for legacy contracts.',
  tools:
    'fetch_rate, fetch_mineral_price, audit_usd_contracts, draft_tzs_addendum, sell_vs_stockpile, nsr, set_aside_status.',
  evidence:
    'Cite GN 198/2025 for every USD-related refusal. Cite BoT mid-rate timestamp for every TZS-USD conversion.',
  outputSchema:
    '{ "mode": FxTreasuryMode, "bot_route_nsr_tzs"?: number, "export_route_nsr_tzs"?: number, ' +
    '"recommendation": "sell_bot"|"sell_export"|"stockpile"|"hold_pending_evidence", ' +
    '"set_aside_ratio_pct"?: number, "set_aside_blocks_export"?: boolean, ' +
    '"usd_contracts_to_convert": [...], "cliff_date": "2026-03-27", "days_to_cliff": int, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'advisory + advisory writes; never executes a sale or moves money',
  hardRules: [
    'Never advise non-TZS pricing for a domestic transaction (GN 198/2025).',
    'Never advise sale that violates 20 % set-aside (export permit will be denied).',
    'Never advise speculative FX trading at SME scale — operational hedges only.',
    'BoT route economics: 4 % royalty / 0 % inspection / 0 % VAT / 24h TZS settlement.',
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
  ]
    .filter(Boolean)
    .join('\n');
}

export function createFxTreasuryAgent(deps: JuniorDeps) {
  return {
    async processInput(input: FxTreasuryInput): Promise<FxTreasuryOutput> {
      const validated = FxTreasuryInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'fx-treasury-agent',
        schema: FxTreasuryOutput,
        systemPrompt: FX_TREASURY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `fx_snapshots`.
          await deps.db.execute(
            sql`INSERT INTO fx_snapshots
                  (id, tenant_id, mode, bot_rate_tzs_per_usd, summary, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.mode},
                        ${validated.current_bot_rate_tzs_per_usd}, ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
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

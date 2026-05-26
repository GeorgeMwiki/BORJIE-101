/**
 * Asset / Fleet Agent — utilisation, service-due flags, predictive
 * maintenance (AGENT_PROMPT_LIBRARY §13).
 *
 * Schema gap: `asset_status_snapshots` raw SQL; TODO(#30).
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

export const AssetKind = z.enum([
  'excavator',
  'truck',
  'compressor',
  'genset',
  'pump',
  'drill_rig',
  'loader',
  'dozer',
  'crusher',
]);

export const AssetSchema = z.object({
  asset_id: z.string().min(1),
  kind: AssetKind,
  model: z.string().optional(),
  ownership: z.enum(['owned', 'leased', 'rented']),
  site_id: z.string().optional(),
  hours_used_total: z.number().nonnegative(),
  hours_since_last_service: z.number().nonnegative(),
  next_service_at_hours: z.number().nonnegative(),
  fuel_l_per_hour: z.number().nonnegative().optional(),
  downtime_last_30d_hours: z.number().nonnegative().default(0),
  oil_analysis_flag: z.enum(['ok', 'caution', 'critical']).default('ok'),
  vibration_flag: z.enum(['ok', 'caution', 'critical']).default('ok'),
});

export const AssetFleetInputSchema = z.object({
  tenantId: z.string().min(1),
  assets: z.array(AssetSchema).min(1),
  utilisation_forecast_hours: z.number().nonnegative().optional(),
});
export type AssetFleetInput = z.infer<typeof AssetFleetInputSchema>;

export const AssetFleetOutput = AuditedOutputBase.extend({
  fleet_health: z.enum(['green', 'amber', 'red']),
  utilisation_pct: z.number().min(0).max(100),
  service_due_now: z.array(z.string()),
  service_due_in_7d: z.array(z.string()),
  predictive_maintenance_alerts: z.array(
    z.object({ asset_id: z.string(), kind: z.string(), severity: z.enum(['caution', 'critical']) }),
  ),
  rent_vs_buy_pending: z.array(z.string()),
  recommendations: z.array(z.string()),
});
export type AssetFleetOutput = z.infer<typeof AssetFleetOutput>;

export const ASSET_FLEET_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Asset / Fleet Agent',
  mandate:
    'Track utilisation, flag service-due assets, surface predictive-maintenance alerts, list rent-vs-buy candidates.',
  tools: 'list_assets, compute_cost_per_hour, rent_vs_buy, match_factor, predictive_maintenance.',
  evidence: 'Cite the OEM service interval (250 / 500 / 1000 / 2000 hours) for every service_due call. Cite oil/vibration flag source.',
  outputSchema:
    '{ "fleet_health": "green"|"amber"|"red", "utilisation_pct": number, "service_due_now": string[], ' +
    '"service_due_in_7d": string[], "predictive_maintenance_alerts": [...], "rent_vs_buy_pending": string[], ' +
    '"recommendations": string[], "confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'advisory; never schedules service or rents without owner approval',
  hardRules: [
    'Excavator below 0.85 match-factor → flag.',
    'Critical oil or vibration flag → recommend immediate stop + inspection.',
    'Cost-per-hour must always include fuel + lube + tyres + parts + labour + capex amortisation.',
  ],
});

function buildUserPrompt(input: AssetFleetInput): string {
  return [
    `TENANT: ${input.tenantId}  ASSETS: ${input.assets.length}`,
    input.utilisation_forecast_hours !== undefined
      ? `FORECAST_HOURS_NEXT_30D: ${input.utilisation_forecast_hours}`
      : '',
    JSON.stringify(input.assets, null, 2).slice(0, 5_000),
  ]
    .filter(Boolean)
    .join('\n');
}

export function createAssetFleetAgent(deps: JuniorDeps) {
  return {
    async processInput(input: AssetFleetInput): Promise<AssetFleetOutput> {
      const validated = AssetFleetInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'asset-fleet-agent',
        schema: AssetFleetOutput,
        systemPrompt: ASSET_FLEET_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const assetStatusSnapshots = schemas?.assetStatusSnapshots as unknown;
          if (assetStatusSnapshots) {
            await deps.db
              .insert(assetStatusSnapshots)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                fleetHealth: output.fleet_health,
                utilisationPct: String(output.utilisation_pct),
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('asset-fleet-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type AssetFleetAgent = ReturnType<typeof createAssetFleetAgent>;

export function createDefaultAssetFleetAgent(): AssetFleetAgent {
  let cached: AssetFleetAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createAssetFleetAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

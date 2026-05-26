/**
 * Maintenance Agent — fuel logs, machine hours, maintenance events
 * (AGENT_PROMPT_LIBRARY §14).
 *
 * Writes via typed `db.insert(juniorMaintenanceEvents)` (migration
 * 0011). The formal `maintenanceEvents` + `fuelLogs` tables in
 * assets-fleet are populated by the worker app, not this junior.
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

export const FuelLog = z.object({
  log_id: z.string().min(1),
  asset_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  litres: z.number().nonnegative(),
  hours_at_fill: z.number().nonnegative(),
  cost_tzs: z.number().nonnegative(),
});

export const DowntimeEvent = z.object({
  event_id: z.string().min(1),
  asset_id: z.string().min(1),
  start_iso: z.string(),
  end_iso: z.string().optional(),
  code: z.enum(['mechanical', 'electrical', 'hydraulic', 'tyre', 'operator', 'planned']),
  description: z.string(),
});

export const MaintenanceInputSchema = z.object({
  tenantId: z.string().min(1),
  asset_id: z.string().min(1),
  oem: z.enum(['Caterpillar', 'Komatsu', 'AtlasCopco', 'Cummins', 'Perkins', 'Volvo', 'Sandvik', 'Sino', 'other']),
  model: z.string().optional(),
  total_hours: z.number().nonnegative(),
  fuel_logs: z.array(FuelLog).default([]),
  downtime_events: z.array(DowntimeEvent).default([]),
});
export type MaintenanceInput = z.infer<typeof MaintenanceInputSchema>;

export const MaintenanceOutput = AuditedOutputBase.extend({
  asset_id: z.string(),
  next_service_interval_hours: z.number().nonnegative(),
  hours_until_service: z.number(),
  fuel_burn_l_per_hour: z.number().nonnegative(),
  downtime_hours_last_30d: z.number().nonnegative(),
  downtime_cost_estimate_usd: z.number().nonnegative(),
  parts_list: z.array(z.string()),
  oil_analysis_recommended: z.boolean(),
  vibration_puck_recommended: z.boolean(),
});
export type MaintenanceOutput = z.infer<typeof MaintenanceOutput>;

export const MAINTENANCE_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Maintenance Agent',
  mandate:
    'Per-asset maintenance engineer: OEM hour-based service schedule, fuel-burn computation, ' +
    'downtime cost estimation, oil-analysis + vibration-puck recommendations.',
  tools: 'fuel_log_query, downtime_query, oem_schedule_lookup.',
  evidence:
    'Cite the OEM service-interval table (250/500/1000/2000 h) and the fuel-log IDs underpinning the burn rate.',
  outputSchema:
    '{ "asset_id": string, "next_service_interval_hours": number, "hours_until_service": number, ' +
    '"fuel_burn_l_per_hour": number, "downtime_hours_last_30d": number, "downtime_cost_estimate_usd": number, ' +
    '"parts_list": string[], "oil_analysis_recommended": boolean, "vibration_puck_recommended": boolean, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'advisory; never approves parts order without procurement-agent + owner sign-off',
  hardRules: [
    'Always recommend oil-analysis every 250 h on critical assets.',
    'Downtime cost USD/hour: haul-truck class ~20 000; SME excavator opportunity 200-500/h.',
    'Flag if hours_until_service is negative — overdue.',
  ],
});

function buildUserPrompt(input: MaintenanceInput): string {
  return [
    `TENANT: ${input.tenantId}  ASSET: ${input.asset_id}  OEM: ${input.oem}  MODEL: ${input.model ?? 'unknown'}`,
    `TOTAL_HOURS: ${input.total_hours}`,
    `FUEL_LOGS (${input.fuel_logs.length}):`,
    JSON.stringify(input.fuel_logs, null, 2).slice(0, 2_500),
    `DOWNTIME_EVENTS (${input.downtime_events.length}):`,
    JSON.stringify(input.downtime_events, null, 2).slice(0, 2_500),
  ].join('\n');
}

export function createMaintenanceAgent(deps: JuniorDeps) {
  return {
    async processInput(input: MaintenanceInput): Promise<MaintenanceOutput> {
      const validated = MaintenanceInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'maintenance-agent',
        schema: MaintenanceOutput,
        systemPrompt: MAINTENANCE_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2200,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const juniorMaintenanceEvents = schemas?.juniorMaintenanceEvents as unknown;
          if (juniorMaintenanceEvents) {
            await deps.db
              .insert(juniorMaintenanceEvents)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                assetId: validated.asset_id,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('maintenance-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type MaintenanceAgent = ReturnType<typeof createMaintenanceAgent>;

export function createDefaultMaintenanceAgent(): MaintenanceAgent {
  let cached: MaintenanceAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMaintenanceAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

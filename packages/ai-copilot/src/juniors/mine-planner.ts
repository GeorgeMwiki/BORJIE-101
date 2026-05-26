/**
 * Mine Planner — site polygon planning, equipment match-factor, shift
 * plan generation (AGENT_PROMPT_LIBRARY §9).
 *
 * Writes via typed `db.insert(siteLayouts)` (migration 0011).
 * `weeklyPlans` is also typed and available for callers that want to
 * normalise the embedded weekly_plan JSONB into its own row.
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

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const PolygonPoint = z.object({ lat: z.number(), lng: z.number() });

export const FleetItem = z.object({
  asset_id: z.string().min(1),
  kind: z.enum(['excavator', 'truck', 'compressor', 'genset', 'pump', 'drill_rig']),
  capacity_t: z.number().positive().optional(),
  bucket_m3: z.number().positive().optional(),
  service_rate_t_per_hr: z.number().positive().optional(),
});

export const MinePlannerInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  mineral: z.string().min(1),
  polygon: z.array(PolygonPoint).min(3),
  fleet: z.array(FleetItem),
  geology_score: z.number().min(0).max(1),
  horizon_weeks: z.number().int().positive().default(1),
});
export type MinePlannerInput = z.infer<typeof MinePlannerInputSchema>;

export const SiteSection = z.object({
  name: z.enum([
    'start_area',
    'camp',
    'fuel_store',
    'tools_store',
    'magazine',
    'ore_stockpile',
    'waste_dump',
    'qc_sampling',
    'wash_bay',
    'assembly_point',
    'water_buffer_60m',
    'rehab_nursery',
  ]),
  polygon: z.array(PolygonPoint).min(3),
});

export const MinePlannerOutput = AuditedOutputBase.extend({
  site_id: z.string(),
  sections: z.array(SiteSection).min(1),
  weekly_plan: z.object({
    target_tonnes: z.number().nonnegative(),
    faces: z.array(z.string()),
    assignments: z.array(z.object({ asset_id: z.string(), face: z.string(), hours: z.number().positive() })),
    blasts: z.array(z.object({ date: z.string(), face: z.string(), permit_status: z.string() })),
  }),
  match_factor: z.number().nonnegative(),
  bottleneck: z.enum(['shovel', 'truck', 'none']),
  mechanisation_allowed: z.boolean(),
  recommendations: z.array(z.string()),
});
export type MinePlannerOutput = z.infer<typeof MinePlannerOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const MINE_PLANNER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Mine Planner',
  mandate:
    'Section the site polygon, compute the match-factor, and produce a 1-page weekly plan.',
  tools:
    'fetch_sentinel2(polygon, date), sectionise_site(site, mineral), weekly_plan(site), ' +
    'forecast_overburden_ore(site, horizon_days), match_factor(site, fleet).',
  evidence:
    'Cite the geology score that gates mechanisation. Cite NAWAPO 60-m water-source buffer when ' +
    'placing the water_buffer_60m section. Cite IFC Mining EHS / ICMM CCM for camp + magazine placement.',
  outputSchema:
    '{ "site_id": string, "sections": SiteSection[], "weekly_plan": {...}, "match_factor": number, ' +
    '"bottleneck": "shovel"|"truck"|"none", "mechanisation_allowed": boolean, ' +
    '"recommendations": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'plan generation only — never books equipment or fires blasts',
  hardRules: [
    'Never place camp, stockpile, or excavator within 60 m of a water source (NAWAPO 2002).',
    'Set mechanisation_allowed = false when geology_score < 0.70 without confirmed vein continuity.',
    'Match factor optimum is 0.85-1.00; flag when out of range.',
    'Refuse blasting advice; only track lawful permits.',
  ],
});

function buildUserPrompt(input: MinePlannerInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  MINERAL: ${input.mineral}`,
    `GEOLOGY_SCORE: ${input.geology_score.toFixed(2)}`,
    `POLYGON (${input.polygon.length} vertices):`,
    JSON.stringify(input.polygon).slice(0, 1_500),
    `FLEET (${input.fleet.length} assets):`,
    JSON.stringify(input.fleet, null, 2).slice(0, 2_000),
    `HORIZON_WEEKS: ${input.horizon_weeks}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createMinePlanner(deps: JuniorDeps) {
  return {
    async processInput(input: MinePlannerInput): Promise<MinePlannerOutput> {
      const validated = MinePlannerInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'mine-planner',
        schema: MinePlannerOutput,
        systemPrompt: MINE_PLANNER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 3000,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const siteLayouts = schemas?.siteLayouts as unknown;
          if (siteLayouts) {
            await deps.db
              .insert(siteLayouts)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                siteId: validated.siteId,
                sections: output.sections,
                weeklyPlan: output.weekly_plan,
                matchFactor: String(output.match_factor),
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('mine-planner: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type MinePlanner = ReturnType<typeof createMinePlanner>;

export function createDefaultMinePlanner(): MinePlanner {
  let cached: MinePlanner | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMinePlanner(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

/**
 * Geology Agent — vein triangulation stub, 3D site model, geology score
 * per site (0-1 ladder per AGENT_PROMPT_LIBRARY §6).
 *
 * Schema gap: no `geology_scores` or `vein_models` Drizzle schemas yet.
 * Raw SQL; TODO(#30).
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

export const VeinIntersect = z.object({
  hole_id: z.string().min(1),
  collar_lat: z.number(),
  collar_lng: z.number(),
  collar_elevation_m: z.number(),
  azimuth_deg: z.number().min(0).max(360),
  dip_deg: z.number().min(0).max(90),
  intersect_depth_m: z.number().nonnegative(),
  apparent_width_cm: z.number().nonnegative(),
  grade_g_per_t: z.number().nonnegative().optional(),
});

export const GeologyAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  mineral: z.string().min(1),
  observations: z.object({
    visual_outcrop: z.boolean().default(false),
    surface_samples_assayed: z.number().int().nonnegative().default(0),
    hand_shafts: z.number().int().nonnegative().default(0),
    rc_holes: z.number().int().nonnegative().default(0),
    diamond_core_metres: z.number().nonnegative().default(0),
    competent_person_signoff: z.boolean().default(false),
  }),
  vein_intersects: z.array(VeinIntersect).default([]),
  district: z.string().optional(),
});
export type GeologyAgentInput = z.infer<typeof GeologyAgentInputSchema>;

export const GeologyAgentOutput = AuditedOutputBase.extend({
  site_id: z.string(),
  geology_score: z.number().min(0).max(1),
  score_band: z.enum(['rumour', 'visual', 'sampled', 'shafted', 'triangulated', 'rc_drilled', 'jorc_compliant']),
  next_step: z.object({
    method: z.string(),
    cost_tzs: z.number().nonnegative(),
    expected_score_lift: z.number().min(0).max(1),
  }),
  vein_model_stub: z
    .object({
      length_m: z.number().nonnegative(),
      width_m: z.number().nonnegative(),
      dip_deg: z.number(),
      strike_deg: z.number(),
      volume_m3: z.number().nonnegative(),
      plane_fit_quality: z.enum(['none', 'poor', 'fair', 'good']),
    })
    .nullable(),
  jorc_caveat: z.string().min(1),
});
export type GeologyAgentOutput = z.infer<typeof GeologyAgentOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const GEOLOGY_AGENT_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Geology Agent',
  mandate:
    'Compute a Geological Confidence Score (0-1) per site using the AGENT_PROMPT_LIBRARY ladder, ' +
    'fit a vein plane when ≥ 3 intersects exist, and recommend the lowest-cost next step that ' +
    'meaningfully raises the score.',
  tools:
    'compute_confidence_score(site_id), recommend_next_step(site_id), consult_mineral_dossier(mineral), ' +
    'triangulate_vein(holes), estimate_tonnage(vein, density, grade).',
  evidence:
    'Cite the per-mineral file used (research/minerals/01 gold, research/minerals/02 base metals, etc.) ' +
    'and cite the specific vein-intersect hole_ids feeding the plane fit.',
  outputSchema:
    '{ "site_id": string, "geology_score": number(0..1), "score_band": "rumour"|"visual"|"sampled"|...|"jorc_compliant", ' +
    '"next_step": {...}, "vein_model_stub": {...}|null, "jorc_caveat": string, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'advisory only — never instructs blasting, mercury, or explosives',
  hardRules: [
    'Never advise mechanisation (excavator) above a geology score of 0.70 without confirmed vein continuity.',
    'Never advise mercury without retort + banded washing area + Minamata-compliant audit.',
    'Flag NORM minerals (U, Th, monazite); refuse to advise commercial extraction without IAEA-equivalent compliance.',
    'Refuse to fit a plane on < 3 vein intersects.',
  ],
});

function buildUserPrompt(input: GeologyAgentInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  MINERAL: ${input.mineral}`,
    `OBS:`,
    JSON.stringify(input.observations, null, 2),
    `VEIN_INTERSECTS (${input.vein_intersects.length}):`,
    JSON.stringify(input.vein_intersects, null, 2).slice(0, 4_000),
    input.district ? `DISTRICT: ${input.district}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createGeologyAgent(deps: JuniorDeps) {
  return {
    async processInput(input: GeologyAgentInput): Promise<GeologyAgentOutput> {
      const validated = GeologyAgentInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'geology-agent',
        schema: GeologyAgentOutput,
        systemPrompt: GEOLOGY_AGENT_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const veinJson = JSON.stringify(output.vein_model_stub);
          // TODO(#30): typed insert against `geology_scores` + `vein_models`.
          await deps.db.execute(
            sql`INSERT INTO geology_scores
                  (id, tenant_id, site_id, mineral, score, score_band, vein_model, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.siteId}, ${validated.mineral},
                        ${output.geology_score}, ${output.score_band}, ${veinJson}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('geology-agent: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return output;
    },
  };
}
export type GeologyAgent = ReturnType<typeof createGeologyAgent>;

export function createDefaultGeologyAgent(): GeologyAgent {
  let cached: GeologyAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createGeologyAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

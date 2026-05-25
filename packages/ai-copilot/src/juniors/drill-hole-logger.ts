/**
 * Drill-hole Logger — accepts {hole_id, GPS, kind, layers, sample_tag}
 * from the worker app, validates the structure, writes
 * `drill_holes` + `drill_hole_layers` rows, and returns the parsed log
 * plus any QA flags spotted by Claude.
 *
 * AGENT_PROMPT_LIBRARY §7 — refuse tonnage estimation when holes do not
 * triangulate. Always carry the JORC/43-101 caveat.
 *
 * Schema gap: `drill_holes` + `drill_hole_layers` are described in
 * DATA_MODEL.md but the Drizzle schemas do not exist yet. Raw SQL.
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  deterministicId,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const HoleKindSchema = z.enum([
  'pit',
  'shaft',
  'rc',
  'diamond',
  'hand_augur',
  'trench',
  'channel',
]);

export const GpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  elevation_m: z.number().optional(),
});

export const LayerInputSchema = z.object({
  depth_from_m: z.number().nonnegative(),
  depth_to_m: z.number().positive(),
  lithology: z.string().min(1),
  colour: z.string().optional(),
  grain_size: z.string().optional(),
  vein_intersect: z.boolean().default(false),
  vein_width_cm: z.number().nonnegative().optional(),
  vein_dip_deg: z.number().min(0).max(90).optional(),
  host_rock: z.string().optional(),
  mineralisation_indicators: z.array(z.string()).default([]),
  sample_bag_no: z.string().optional(),
  photo_url: z.string().url().optional(),
}).refine((l) => l.depth_to_m > l.depth_from_m, {
  message: 'depth_to_m must exceed depth_from_m',
});
export type LayerInput = z.infer<typeof LayerInputSchema>;

export const DrillHoleInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  holeId: z.string().min(1),
  kind: HoleKindSchema,
  gps: GpsSchema,
  azimuth_deg: z.number().min(0).max(360).optional(),
  dip_deg: z.number().min(0).max(90).optional(),
  layers: z.array(LayerInputSchema).min(1, 'at least one layer required'),
  sample_tag: z.string().optional(),
  supervisor_fingerprint_event_id: z.string().optional(),
});
export type DrillHoleInput = z.infer<typeof DrillHoleInputSchema>;

export const DrillHoleOutput = AuditedOutputBase.extend({
  hole_id: z.string().min(1),
  total_depth_m: z.number().positive(),
  vein_intersects: z.number().int().nonnegative(),
  qa_flags: z.array(z.string()).default([]),
  next_step_recommendation: z.string().min(1),
  jorc_caveat: z.string().min(1),
  layer_ids: z.array(z.string()),
});
export type DrillHoleOutput = z.infer<typeof DrillHoleOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const DRILL_HOLE_LOGGER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Drill-hole Logger',
  mandate:
    'Validate a structured drill-hole log (pit/shaft/RC/diamond/hand-augur/trench/channel), return ' +
    'QA flags, count vein intersects, and recommend the next investigation step.',
  tools:
    'create_hole(site_id, kind, collar), log_layer(hole_id, depth_from, depth_to, fields, photo), ' +
    'attach_sample(hole_id, depth, sample_tag, photo).',
  evidence:
    'Cite the layer index + vein-intersect field for each vein call. Photos count as evidence_ids when present.',
  outputSchema:
    '{ "hole_id": string, "total_depth_m": number, "vein_intersects": int, "qa_flags": string[], ' +
    '"next_step_recommendation": string, "jorc_caveat": string, "layer_ids": string[], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'logs structured data; never estimates tonnage without triangulation',
  hardRules: [
    'Refuse to estimate tonnage if holes do not actually triangulate (parallel holes → no plane fit).',
    'Always include the JORC/43-101 caveat: "Not a JORC-compliant Mineral Resource Estimate without Competent Person sign-off."',
    'Flag overlapping depth ranges in QA flags.',
  ],
});

function buildUserPrompt(input: DrillHoleInput): string {
  return [
    `HOLE_ID: ${input.holeId}`,
    `SITE_ID: ${input.siteId}`,
    `KIND: ${input.kind}`,
    `GPS: lat=${input.gps.lat} lng=${input.gps.lng}${input.gps.elevation_m !== undefined ? ` elev=${input.gps.elevation_m}m` : ''}`,
    input.azimuth_deg !== undefined ? `AZIMUTH: ${input.azimuth_deg}°  DIP: ${input.dip_deg ?? 90}°` : '',
    `LAYERS_JSON:`,
    JSON.stringify(input.layers, null, 2).slice(0, 4_000),
    input.sample_tag ? `SAMPLE_TAG: ${input.sample_tag}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createDrillHoleLogger(deps: JuniorDeps) {
  return {
    async processInput(input: DrillHoleInput): Promise<DrillHoleOutput> {
      const validated = DrillHoleInputSchema.parse(input);

      // Pre-compute the layer_ids deterministically so the LLM has them.
      const layerIds = validated.layers.map((_l, i) =>
        deterministicId('lay', validated.holeId, String(i)),
      );

      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'drill-hole-logger',
        schema: DrillHoleOutput,
        systemPrompt: DRILL_HOLE_LOGGER_SYSTEM_PROMPT,
        userPrompt:
          buildUserPrompt(validated) +
          `\nPRE-ASSIGNED LAYER_IDS (in order): ${JSON.stringify(layerIds)}`,
        maxTokens: 1500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const gpsJson = JSON.stringify(validated.gps);
          // TODO(phase-3): typed inserts against `drill_holes` + `drill_hole_layers`.
          await deps.db.execute(
            sql`INSERT INTO drill_holes
                  (id, tenant_id, site_id, hole_id, kind, gps, azimuth_deg, dip_deg,
                   total_depth_m, vein_intersects, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.siteId}, ${validated.holeId},
                        ${validated.kind}, ${gpsJson}::jsonb,
                        ${validated.azimuth_deg ?? null}, ${validated.dip_deg ?? null},
                        ${output.total_depth_m}, ${output.vein_intersects}, NOW())
                ON CONFLICT (hole_id) DO NOTHING`,
          );
          for (let i = 0; i < validated.layers.length; i++) {
            const layer = validated.layers[i];
            const fields = JSON.stringify(layer);
            await deps.db.execute(
              sql`INSERT INTO drill_hole_layers
                    (id, hole_id, idx, depth_from_m, depth_to_m, vein_intersect, fields)
                  VALUES (${layerIds[i]}, ${validated.holeId}, ${i},
                          ${layer.depth_from_m}, ${layer.depth_to_m},
                          ${layer.vein_intersect ?? false}, ${fields}::jsonb)
                  ON CONFLICT (id) DO NOTHING`,
            );
          }
        } catch (err) {
          deps.logger?.warn('drill-hole-logger: db write skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return output;
    },
  };
}
export type DrillHoleLogger = ReturnType<typeof createDrillHoleLogger>;

export function createDefaultDrillHoleLogger(): DrillHoleLogger {
  let cached: DrillHoleLogger | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createDrillHoleLogger(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

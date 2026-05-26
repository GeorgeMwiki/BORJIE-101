/**
 * Metallurgy Agent — mineral processing recommendations, recovery rate
 * analysis. Sits between Lab/Assay (head grade) and Sales (concentrate
 * pricing).
 *
 * Schema gap: `metallurgy_recommendations` raw SQL; TODO(#30).
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

export const MineralFamily = z.enum([
  'gold',
  'copper',
  'lead_zinc',
  'nickel',
  'cobalt',
  'tin',
  'lithium',
  'rare_earth',
  'graphite',
  'iron_ore',
  'gemstone',
  'diamond',
  'uranium',
]);

export const FlowsheetStep = z.enum([
  'crushing',
  'milling',
  'gravity',
  'flotation',
  'cyanide_leach',
  'gravity_only',
  'borax_smelt',
  'glycine_leach',
  'magnetic_separation',
  'electrostatic',
  'dms',
  'cob_optical',
  'solvent_extraction',
  'electrowinning',
  'merrill_crowe',
  'cip',
  'cil',
]);

export const MetallurgyInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  mineral_family: MineralFamily,
  head_grade_g_per_t_or_pct: z.number().nonnegative(),
  ore_mineralogy_notes: z.string().optional(),
  budget_constrained: z.boolean().default(true),
  artisanal_scale: z.boolean().default(true),
  has_water_source_within_60m: z.boolean().default(false),
  current_flowsheet: z.array(FlowsheetStep).default([]),
  recovery_observed_pct: z.number().min(0).max(100).optional(),
});
export type MetallurgyInput = z.infer<typeof MetallurgyInputSchema>;

export const MetallurgyOutput = AuditedOutputBase.extend({
  recommended_flowsheet: z.array(FlowsheetStep).min(1),
  expected_recovery_pct: z.number().min(0).max(100),
  capex_band_tzs: z.object({ low: z.number().nonnegative(), mid: z.number().nonnegative(), high: z.number().nonnegative() }),
  opex_per_tonne_tzs: z.number().nonnegative(),
  mercury_free_alternatives: z.array(z.string()),
  cyanide_required: z.boolean(),
  cyanide_management_notes: z.string().nullable(),
  by_product_recovery_opportunities: z.array(z.string()),
});
export type MetallurgyOutput = z.infer<typeof MetallurgyOutput>;

export const METALLURGY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Metallurgy Agent',
  mandate:
    'Recommend an appropriate processing flowsheet by mineral family and scale; estimate recovery, capex band, opex/tonne; surface mercury-free alternatives.',
  tools: 'consult_mineral_dossier, simulate_recovery, capex_opex_estimate, by_product_check.',
  evidence:
    'Cite the per-mineral file used (research/minerals/0X) for every flowsheet decision and recovery estimate.',
  outputSchema:
    '{ "recommended_flowsheet": FlowsheetStep[], "expected_recovery_pct": number, ' +
    '"capex_band_tzs": {low,mid,high}, "opex_per_tonne_tzs": number, "mercury_free_alternatives": string[], ' +
    '"cyanide_required": boolean, "cyanide_management_notes": string|null, ' +
    '"by_product_recovery_opportunities": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'design advisory; never instructs commissioning without metallurgist sign-off',
  hardRules: [
    'For ASM gold: recommend gravity + borax direct-smelt or glycine ahead of mercury or cyanide.',
    'If has_water_source_within_60m, refuse on-site cyanidation; route to compliance-agent.',
    'Always include cyanide_management_notes with ICMC alignment when cyanide_required.',
    'For diamond, recommend DMS bulk sample over assay.',
  ],
});

function buildUserPrompt(input: MetallurgyInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  FAMILY: ${input.mineral_family}`,
    `HEAD_GRADE: ${input.head_grade_g_per_t_or_pct}  ARTISANAL: ${input.artisanal_scale}  BUDGET_CONSTRAINED: ${input.budget_constrained}`,
    `WATER_WITHIN_60M: ${input.has_water_source_within_60m}`,
    `CURRENT_FLOWSHEET: ${JSON.stringify(input.current_flowsheet)}`,
    input.recovery_observed_pct !== undefined ? `OBSERVED_RECOVERY_PCT: ${input.recovery_observed_pct}` : '',
    input.ore_mineralogy_notes ? `MINERALOGY: ${input.ore_mineralogy_notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createMetallurgyAgent(deps: JuniorDeps) {
  return {
    async processInput(input: MetallurgyInput): Promise<MetallurgyOutput> {
      const validated = MetallurgyInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'metallurgy-agent',
        schema: MetallurgyOutput,
        systemPrompt: METALLURGY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const metallurgyRecommendations = schemas?.metallurgyRecommendations as unknown;
          if (metallurgyRecommendations) {
            await deps.db
              .insert(metallurgyRecommendations)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                siteId: validated.siteId,
                mineralFamily: validated.mineral_family,
                expectedRecoveryPct: String(output.expected_recovery_pct),
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('metallurgy-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type MetallurgyAgent = ReturnType<typeof createMetallurgyAgent>;

export function createDefaultMetallurgyAgent(): MetallurgyAgent {
  let cached: MetallurgyAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMetallurgyAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

/**
 * Metallurgy Agent — mineral processing recommendations, recovery rate
 * analysis. Sits between Lab/Assay (head grade) and Sales (concentrate
 * pricing).
 *
 * DEEPENED (per CAPABILITY_SPEC_WAVE3 "Conversion Engine"): the agent no
 * longer trusts the LLM for the load-bearing numbers. A pure deterministic
 * engine (`metallurgy-knowledge.ts`) grounds:
 *   - flowsheet recommendation by mineral family + scale (gravity /
 *     flotation / CIL / heap / tank leach / DMS / magnetic / SX-EW),
 *   - head-grade vs cut-off verdict (per-mineral grade unit, not gold-only),
 *   - the metallurgical-recovery KPI diagnosis vs the per-family envelope,
 *   - throughput diagnosis (Bond third law + ISO-14224 availability).
 * The LLM port supplies reasoning/copy; the agent OVERWRITES every
 * deterministic field with the engine's truth and MERGES the engine's
 * evidence_ids into the audit chain so the Auditor can trace each verdict.
 *
 * Grounded in:
 *   - Docs/research/mining-estate-operating-model.md §3.3 (processing /
 *     beneficiation, recovery as the yield KPI, TZ in-country value-add),
 *   - Docs/research/mining-machinery-advisory.md §3.5 / §2 (gravity-ahead-
 *     of-CIL, CIL = leach + adsorb, mill ~95% availability, MTBF/MTTR).
 *
 * Writes via typed `db.insert(metallurgyRecommendations)` (migration 0011).
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
  assessHeadGrade,
  diagnoseRecovery,
  diagnoseThroughput,
  getMineralProfile,
  HeadGradeVerdict,
  MINERAL_FAMILIES,
  RecoveryVerdict,
  SEPARATION_ROUTES,
  type HeadGradeAssessment,
  type MineralFamilyId,
  type RecoveryDiagnosis,
  type SeparationRoute,
  type ThroughputDiagnosis,
} from './metallurgy-knowledge.js';

// ─────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────

export const MineralFamily = z.enum(MINERAL_FAMILIES);

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
  'heap_leach',
  'tank_leach',
  'hand_sort',
]);
export type FlowsheetStep = z.infer<typeof FlowsheetStep>;

/** Plant telemetry for a throughput diagnosis (all optional at the boundary). */
export const PlantTelemetrySchema = z.object({
  installed_mill_kw: z.number().positive(),
  feed_f80_um: z.number().positive(),
  product_p80_um: z.number().positive(),
  observed_tph: z.number().nonnegative().optional(),
  mtbf_h: z.number().positive().optional(),
  mttr_h: z.number().nonnegative().optional(),
});
export type PlantTelemetry = z.infer<typeof PlantTelemetrySchema>;

export const MetallurgyInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  mineral_family: MineralFamily,
  head_grade_g_per_t_or_pct: z.number().nonnegative(),
  /** Price-derived cut-off from the mine-planner; overrides the dossier floor. */
  effective_cutoff: z.number().positive().optional(),
  ore_mineralogy_notes: z.string().optional(),
  budget_constrained: z.boolean().default(true),
  artisanal_scale: z.boolean().default(true),
  has_water_source_within_60m: z.boolean().default(false),
  current_flowsheet: z.array(FlowsheetStep).default([]),
  recovery_observed_pct: z.number().min(0).max(100).optional(),
  /** Optional plant telemetry — when present a throughput diagnosis is run. */
  plant: PlantTelemetrySchema.optional(),
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
  // Deterministic diagnosis fields — the agent OWNS these, not the LLM.
  head_grade_verdict: HeadGradeVerdict,
  recovery_verdict: RecoveryVerdict,
  recovery_envelope_pct: z.object({ low: z.number(), high: z.number() }),
  throughput_diagnosis: z
    .object({
      specific_energy_kwh_per_t: z.number(),
      power_limited_tph: z.number(),
      availability: z.number(),
      effective_nameplate_tph: z.number(),
      utilisation_vs_nameplate: z.number().nullable(),
      verdict: z.enum(['no_baseline', 'underperforming', 'at_nameplate']),
      bottleneck: z.string(),
      evidence_id: z.string(),
    })
    .nullable(),
});
export type MetallurgyOutput = z.infer<typeof MetallurgyOutput>;

// ─────────────────────────────────────────────────────────────────────
// Deterministic flowsheet recommender (pure)
// ─────────────────────────────────────────────────────────────────────

/**
 * Map an abstract separation route (knowledge layer) to the concrete
 * FlowsheetStep vocabulary the rest of Borjie speaks.
 */
const ROUTE_TO_STEP: Readonly<Record<SeparationRoute, FlowsheetStep>> = {
  gravity: 'gravity',
  flotation: 'flotation',
  cil: 'cil',
  cip: 'cip',
  heap_leach: 'heap_leach',
  tank_leach: 'tank_leach',
  magnetic_separation: 'magnetic_separation',
  electrostatic: 'electrostatic',
  dms: 'dms',
  solvent_extraction: 'solvent_extraction',
};

/**
 * Build a deterministic, audit-traceable flowsheet from the per-mineral
 * preferred routes. Always front-loads comminution (crush→mill) except
 * for gem/diamond families where high-energy crushing fractures value
 * crystals (dossier machinery-advisory §3.5 / op-model §3.3), and always
 * appends a value-addition tail for gold (borax direct-smelt, mercury-free)
 * per the ASM hard rule.
 */
export function recommendFlowsheet(
  family: MineralFamilyId,
  opts: { readonly hasWaterWithin60m: boolean } = { hasWaterWithin60m: false },
): ReadonlyArray<FlowsheetStep> {
  const profile = getMineralProfile(family);
  const crystalFragile = family === 'diamond' || family === 'gemstone';

  const head: ReadonlyArray<FlowsheetStep> = crystalFragile
    ? ['crushing']
    : ['crushing', 'milling'];

  const routeSteps = profile.preferredRoutes
    .map((r) => ROUTE_TO_STEP[r])
    // Refuse on-site cyanidation near water (hard rule); CIL/CIP are the
    // cyanide-bearing routes for gold.
    .filter((step) =>
      opts.hasWaterWithin60m ? step !== 'cil' && step !== 'cip' : true,
    );

  const tail: ReadonlyArray<FlowsheetStep> =
    family === 'gold'
      ? ['borax_smelt']
      : crystalFragile
        ? ['hand_sort']
        : [];

  const seen = new Set<FlowsheetStep>();
  const ordered: FlowsheetStep[] = [];
  for (const step of [...head, ...routeSteps, ...tail]) {
    if (!seen.has(step)) {
      seen.add(step);
      ordered.push(step);
    }
  }
  // Guarantee a non-empty flowsheet for the schema (min(1)).
  return ordered.length > 0 ? ordered : ['gravity'];
}

// ─────────────────────────────────────────────────────────────────────
// Pure aggregate diagnosis (no IO, no LLM) — the deterministic spine
// ─────────────────────────────────────────────────────────────────────

export interface MetallurgyDiagnosis {
  readonly mineral_family: MineralFamilyId;
  readonly grade_unit: HeadGradeAssessment['grade_unit'];
  readonly head_grade: HeadGradeAssessment;
  readonly recovery: RecoveryDiagnosis;
  readonly throughput: ThroughputDiagnosis | null;
  readonly preferred_routes: ReadonlyArray<SeparationRoute>;
  readonly recommended_flowsheet: ReadonlyArray<FlowsheetStep>;
  readonly cyanide_relevant: boolean;
  readonly norm: boolean;
  readonly evidence_ids: ReadonlyArray<string>;
}

/**
 * Aggregate the per-mineral head-grade, recovery and throughput
 * diagnoses plus the recommended flowsheet into one deterministic,
 * audit-ready object. Pure: depends only on the validated input and the
 * knowledge base. evidence_ids are deduplicated and always non-empty
 * (every profile carries a real evidence_id), so the Auditor's
 * empty-chain rejection can never be tripped by this layer.
 */
export function runMetallurgyDiagnosis(input: MetallurgyInput): MetallurgyDiagnosis {
  const family = input.mineral_family;
  const profile = getMineralProfile(family);

  const headGrade = assessHeadGrade(
    family,
    input.head_grade_g_per_t_or_pct,
    input.effective_cutoff,
  );
  const recovery = diagnoseRecovery(family, input.recovery_observed_pct ?? null);
  const throughput = input.plant
    ? diagnoseThroughput({
        family,
        installed_mill_kw: input.plant.installed_mill_kw,
        feed_f80_um: input.plant.feed_f80_um,
        product_p80_um: input.plant.product_p80_um,
        ...(input.plant.observed_tph !== undefined
          ? { observed_tph: input.plant.observed_tph }
          : {}),
        ...(input.plant.mtbf_h !== undefined ? { mtbf_h: input.plant.mtbf_h } : {}),
        ...(input.plant.mttr_h !== undefined ? { mttr_h: input.plant.mttr_h } : {}),
      })
    : null;
  const recommendedFlowsheet = recommendFlowsheet(family, {
    hasWaterWithin60m: input.has_water_source_within_60m,
  });

  const evidenceIds = dedupe([
    profile.evidenceId,
    headGrade.evidence_id,
    recovery.evidence_id,
    ...(throughput ? [throughput.evidence_id] : []),
  ]);

  return {
    mineral_family: family,
    grade_unit: headGrade.grade_unit,
    head_grade: headGrade,
    recovery,
    throughput,
    preferred_routes: profile.preferredRoutes,
    recommended_flowsheet: recommendedFlowsheet,
    cyanide_relevant: profile.cyanideRelevant,
    norm: profile.norm,
    evidence_ids: evidenceIds,
  };
}

function dedupe(xs: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(xs.filter((x) => x.length > 0))];
}

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const METALLURGY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Metallurgy Agent',
  mandate:
    'Recommend an appropriate processing flowsheet by mineral family and scale; estimate recovery, capex band, opex/tonne; surface mercury-free alternatives. ' +
    'A deterministic engine has ALREADY computed the head-grade verdict, recovery-KPI diagnosis, throughput diagnosis and the per-mineral preferred flowsheet — DO NOT contradict those numbers; explain and contextualise them.',
  tools: 'consult_mineral_dossier, simulate_recovery, capex_opex_estimate, by_product_check.',
  evidence:
    'Cite the per-mineral file used (research/minerals/0X) for every flowsheet decision and recovery estimate; the deterministic engine already attaches per-mineral evidence_ids.',
  outputSchema:
    '{ "recommended_flowsheet": FlowsheetStep[], "expected_recovery_pct": number, ' +
    '"capex_band_tzs": {low,mid,high}, "opex_per_tonne_tzs": number, "mercury_free_alternatives": string[], ' +
    '"cyanide_required": boolean, "cyanide_management_notes": string|null, ' +
    '"by_product_recovery_opportunities": string[], "head_grade_verdict": string, "recovery_verdict": string, ' +
    '"recovery_envelope_pct": {low,high}, "throughput_diagnosis": object|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'design advisory; never instructs commissioning without metallurgist sign-off',
  hardRules: [
    'For ASM gold: recommend gravity + borax direct-smelt or glycine ahead of mercury or cyanide.',
    'If has_water_source_within_60m, refuse on-site cyanidation; route to compliance-agent.',
    'Always include cyanide_management_notes with ICMC alignment when cyanide_required.',
    'For diamond, recommend DMS bulk sample over assay.',
    'Per-mineral parameter awareness: never apply a gold flowsheet/recovery envelope to a non-gold family.',
  ],
});

function buildUserPrompt(input: MetallurgyInput, diagnosis: MetallurgyDiagnosis): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  FAMILY: ${input.mineral_family}`,
    `HEAD_GRADE: ${input.head_grade_g_per_t_or_pct} ${diagnosis.grade_unit}  ARTISANAL: ${input.artisanal_scale}  BUDGET_CONSTRAINED: ${input.budget_constrained}`,
    `WATER_WITHIN_60M: ${input.has_water_source_within_60m}`,
    `CURRENT_FLOWSHEET: ${JSON.stringify(input.current_flowsheet)}`,
    input.recovery_observed_pct !== undefined ? `OBSERVED_RECOVERY_PCT: ${input.recovery_observed_pct}` : '',
    input.ore_mineralogy_notes ? `MINERALOGY: ${input.ore_mineralogy_notes}` : '',
    `DETERMINISTIC_DIAGNOSIS (authoritative — do not contradict):`,
    JSON.stringify(
      {
        head_grade_verdict: diagnosis.head_grade.verdict,
        recovery_verdict: diagnosis.recovery.verdict,
        recovery_envelope_pct: {
          low: diagnosis.recovery.envelope_low_pct,
          high: diagnosis.recovery.envelope_high_pct,
        },
        recommended_flowsheet: diagnosis.recommended_flowsheet,
        preferred_routes: diagnosis.preferred_routes,
        cyanide_relevant: diagnosis.cyanide_relevant,
        norm: diagnosis.norm,
        throughput: diagnosis.throughput,
      },
      null,
      2,
    ).slice(0, 4_000),
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic override — overwrite LLM echo, merge audit evidence
// ─────────────────────────────────────────────────────────────────────

/**
 * Take the LLM's free-form output and overwrite every load-bearing
 * deterministic field with the engine's truth. The LLM keeps authorship
 * of copy (rationale, capex/opex estimates, management notes), but never
 * of the head-grade/recovery/throughput verdicts or the per-mineral
 * recovery envelope. evidence_ids from the deterministic engine are
 * merged in (deduped) so the audit chain traces every overwritten field.
 */
function applyDeterministicOverride(
  llm: MetallurgyOutput,
  diagnosis: MetallurgyDiagnosis,
): MetallurgyOutput {
  return {
    ...llm,
    head_grade_verdict: diagnosis.head_grade.verdict,
    recovery_verdict: diagnosis.recovery.verdict,
    recovery_envelope_pct: {
      low: diagnosis.recovery.envelope_low_pct,
      high: diagnosis.recovery.envelope_high_pct,
    },
    throughput_diagnosis: diagnosis.throughput,
    evidence_ids: [...new Set([...llm.evidence_ids, ...diagnosis.evidence_ids])],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createMetallurgyAgent(deps: JuniorDeps) {
  return {
    /** Synchronous, pure per-mineral diagnosis — no Claude call needed. */
    diagnose(input: MetallurgyInput): MetallurgyDiagnosis {
      return runMetallurgyDiagnosis(MetallurgyInputSchema.parse(input));
    },

    async processInput(input: MetallurgyInput): Promise<MetallurgyOutput> {
      const validated = MetallurgyInputSchema.parse(input);
      const diagnosis = runMetallurgyDiagnosis(validated);

      const llmOutput = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'metallurgy-agent',
        schema: MetallurgyOutput,
        systemPrompt: METALLURGY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated, diagnosis),
        maxTokens: 2500,
      });

      const output = applyDeterministicOverride(llmOutput, diagnosis);

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
    diagnose(input) {
      // Pure path needs no resolved db/claude; build a throwaway agent.
      return createMetallurgyAgent(defaultJuniorDeps()).diagnose(input);
    },
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

// Re-export the deterministic vocabulary so downstream callers (and the
// Wire phase) can reach the per-mineral route set from the agent module.
export { MINERAL_FAMILIES, SEPARATION_ROUTES };

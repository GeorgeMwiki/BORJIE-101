/**
 * Metallurgy Agent — mineral processing recommendations, recovery rate
 * analysis. Sits between Lab/Assay (head grade) and Sales (concentrate
 * pricing).
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
  MINERAL_PROFILES,
  assessHeadGrade,
  diagnoseRecovery,
  diagnoseThroughput,
  getMineralProfile,
  type HeadGradeAssessment,
  type MineralFamilyId,
  type RecoveryDiagnosis,
  type ThroughputDiagnosis,
} from './metallurgy-knowledge.js';

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

/**
 * Optional plant-throughput telemetry. When supplied, the deterministic
 * diagnosis layer computes power-limited capacity (Bond third law) and the
 * mechanical-availability haircut without any LLM call.
 */
export const PlantThroughputSchema = z.object({
  installed_mill_kw: z.number().positive(),
  feed_f80_um: z.number().positive(),
  product_p80_um: z.number().positive(),
  observed_tph: z.number().nonnegative().optional(),
  mtbf_h: z.number().positive().optional(),
  mttr_h: z.number().nonnegative().optional(),
});
export type PlantThroughput = z.infer<typeof PlantThroughputSchema>;

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
  /** Price-derived cut-off from the mine-planner; overrides the dossier floor. */
  effective_cutoff_grade: z.number().nonnegative().optional(),
  /** Plant telemetry for throughput-vs-nameplate diagnosis. */
  plant: PlantThroughputSchema.optional(),
});
export type MetallurgyInput = z.infer<typeof MetallurgyInputSchema>;

/** Verdicts the deterministic layer echoes into the audited output. */
export const HeadGradeVerdictEnum = z.enum(['below_cutoff', 'marginal', 'economic', 'high_grade']);
export const RecoveryVerdictEnum = z.enum(['no_baseline', 'below_envelope', 'in_envelope', 'at_best_practice']);

export const MetallurgyOutput = AuditedOutputBase.extend({
  recommended_flowsheet: z.array(FlowsheetStep).min(1),
  expected_recovery_pct: z.number().min(0).max(100),
  capex_band_tzs: z.object({ low: z.number().nonnegative(), mid: z.number().nonnegative(), high: z.number().nonnegative() }),
  opex_per_tonne_tzs: z.number().nonnegative(),
  mercury_free_alternatives: z.array(z.string()),
  cyanide_required: z.boolean(),
  cyanide_management_notes: z.string().nullable(),
  by_product_recovery_opportunities: z.array(z.string()),
  /**
   * Deterministic diagnosis block — the agent OVERWRITES these from the
   * knowledge base after the LLM returns, so the head-grade / recovery /
   * throughput verdicts are reproducible and Auditor-traceable, never
   * hallucinated. Defaulted so the LLM need not emit them.
   */
  head_grade_verdict: HeadGradeVerdictEnum.default('marginal'),
  recovery_verdict: RecoveryVerdictEnum.default('no_baseline'),
  recovery_envelope_pct: z.object({ low: z.number(), high: z.number() }).default({ low: 0, high: 0 }),
  throughput_diagnosis: z
    .object({
      power_limited_tph: z.number().nonnegative(),
      availability: z.number().min(0).max(1),
      effective_nameplate_tph: z.number().nonnegative(),
      utilisation_vs_nameplate: z.number().nullable(),
      bottleneck: z.string(),
    })
    .nullable()
    .default(null),
});
export type MetallurgyOutput = z.infer<typeof MetallurgyOutput>;

/**
 * Pure deterministic diagnosis — flowsheet-route ladder + head-grade vs
 * cut-off + recovery KPI + throughput, with no LLM and no DB. Callers
 * (and the Auditor) can run this independently of the Claude port.
 */
export const MetallurgyDiagnosis = z.object({
  mineral_family: MineralFamily,
  grade_unit: z.string(),
  preferred_routes: z.array(z.string()).min(1),
  head_grade: z.custom<HeadGradeAssessment>(),
  recovery: z.custom<RecoveryDiagnosis>(),
  throughput: z.custom<ThroughputDiagnosis>().nullable(),
  norm_flag: z.boolean(),
  cyanide_relevant: z.boolean(),
  evidence_ids: z.array(z.string()).min(1),
});
export type MetallurgyDiagnosis = z.infer<typeof MetallurgyDiagnosis>;

export const METALLURGY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Metallurgy Agent',
  mandate:
    'Recommend an appropriate processing flowsheet PER MINERAL FAMILY and scale (gravity / flotation / CIL / CIP / heap / tank leach / DMS / magnetic / electrostatic / SX), estimate recovery, capex band and opex/tonne, diagnose recovery-and-throughput vs the per-mineral best-practice envelope, judge head grade vs cut-off, and surface mercury-free alternatives. You are NOT gold-only — every family carries its own grade unit, recovery envelope and Bond Work Index.',
  tools:
    'consult_mineral_dossier(family), simulate_recovery(family, route), assess_head_grade(grade, cutoff), diagnose_throughput(installed_kw, f80, p80, mtbf, mttr), capex_opex_estimate, by_product_check.',
  evidence:
    'Cite the per-mineral file used (research/minerals/0X) for every flowsheet decision, recovery estimate and cut-off judgement. The DETERMINISTIC ENVELOPE supplied in the user prompt is the ground truth — keep expected_recovery_pct inside it and recommend from preferred_routes unless mineralogy justifies otherwise (state why).',
  outputSchema:
    '{ "recommended_flowsheet": FlowsheetStep[], "expected_recovery_pct": number, ' +
    '"capex_band_tzs": {low,mid,high}, "opex_per_tonne_tzs": number, "mercury_free_alternatives": string[], ' +
    '"cyanide_required": boolean, "cyanide_management_notes": string|null, ' +
    '"by_product_recovery_opportunities": string[], "head_grade_verdict": "below_cutoff"|"marginal"|"economic"|"high_grade", ' +
    '"recovery_verdict": "no_baseline"|"below_envelope"|"in_envelope"|"at_best_practice", ' +
    '"recovery_envelope_pct": {low,high}, "throughput_diagnosis": {...}|null, ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.75,
  autonomyDomain: 'design advisory; never instructs commissioning without metallurgist sign-off',
  hardRules: [
    'For ASM gold: recommend gravity + borax direct-smelt or glycine ahead of mercury or cyanide.',
    'If has_water_source_within_60m, refuse on-site cyanidation; route to compliance-agent.',
    'Always include cyanide_management_notes with ICMC alignment when cyanide_required.',
    'For diamond, recommend DMS bulk sample over assay.',
    'Never propose cyanidation for a non-cyanide-relevant family (only gold among the supported families).',
    'For NORM families (uranium, rare_earth/monazite): refuse to advise commercial extraction without IAEA-equivalent radiation-protection licensing; route to compliance-agent.',
    'Keep expected_recovery_pct within the supplied per-mineral envelope; if proposing a route off the preferred list, justify it from mineralogy.',
    'For gemstone/diamond, never recommend high-energy comminution that fractures crystals.',
  ],
});

/**
 * Run the pure deterministic diagnosis (no LLM, no DB). Exposed on the
 * agent as `diagnose(...)` and reused to ground the LLM prompt + to
 * overwrite the LLM's diagnosis fields with reproducible verdicts.
 */
export function runMetallurgyDiagnosis(input: MetallurgyInput): MetallurgyDiagnosis {
  const family = input.mineral_family as MineralFamilyId;
  const profile = getMineralProfile(family);
  const headGrade = assessHeadGrade(family, input.head_grade_g_per_t_or_pct, input.effective_cutoff_grade);
  const recovery = diagnoseRecovery(family, input.recovery_observed_pct ?? null);
  const throughput = input.plant ? diagnoseThroughput({ family, ...input.plant }) : null;
  const evidenceIds = dedupe([
    profile.evidenceId,
    headGrade.evidence_id,
    recovery.evidence_id,
    ...(throughput ? [throughput.evidence_id] : []),
  ]);
  return {
    mineral_family: family,
    grade_unit: profile.gradeUnit,
    preferred_routes: [...profile.preferredRoutes],
    head_grade: headGrade,
    recovery,
    throughput,
    norm_flag: profile.norm,
    cyanide_relevant: profile.cyanideRelevant,
    evidence_ids: evidenceIds,
  };
}

function buildUserPrompt(input: MetallurgyInput, diagnosis: MetallurgyDiagnosis): string {
  const profile = MINERAL_PROFILES[input.mineral_family as MineralFamilyId];
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}  FAMILY: ${input.mineral_family}`,
    `HEAD_GRADE: ${input.head_grade_g_per_t_or_pct} ${profile.gradeUnit}  ARTISANAL: ${input.artisanal_scale}  BUDGET_CONSTRAINED: ${input.budget_constrained}`,
    `WATER_WITHIN_60M: ${input.has_water_source_within_60m}`,
    `CURRENT_FLOWSHEET: ${JSON.stringify(input.current_flowsheet)}`,
    input.recovery_observed_pct !== undefined ? `OBSERVED_RECOVERY_PCT: ${input.recovery_observed_pct}` : '',
    input.ore_mineralogy_notes ? `MINERALOGY: ${input.ore_mineralogy_notes}` : '',
    ``,
    `DETERMINISTIC ENVELOPE (ground truth — do not contradict):`,
    `  preferred_routes: ${profile.preferredRoutes.join(' > ')}`,
    `  recovery_envelope_pct: ${profile.recoveryLowPct}-${profile.recoveryHighPct}`,
    `  cut_off_band (${profile.gradeUnit}): floor=${diagnosis.head_grade.cutoff_floor} typical=${diagnosis.head_grade.cutoff_typical}`,
    `  head_grade_verdict: ${diagnosis.head_grade.verdict}  recovery_verdict: ${diagnosis.recovery.verdict}`,
    `  cyanide_relevant: ${profile.cyanideRelevant}  NORM: ${profile.norm}`,
    `  route_note: ${profile.note}`,
    diagnosis.throughput
      ? `  throughput: power_limited=${diagnosis.throughput.power_limited_tph}tph effective_nameplate=${diagnosis.throughput.effective_nameplate_tph}tph bottleneck="${diagnosis.throughput.bottleneck}"`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function dedupe(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

export function createMetallurgyAgent(deps: JuniorDeps) {
  return {
    /**
     * Pure, reproducible diagnosis — no LLM, no DB. Safe to call for
     * KPI sensors (recovery / throughput) and cut-off checks.
     */
    diagnose(input: MetallurgyInput): MetallurgyDiagnosis {
      return runMetallurgyDiagnosis(MetallurgyInputSchema.parse(input));
    },

    async processInput(input: MetallurgyInput): Promise<MetallurgyOutput> {
      const validated = MetallurgyInputSchema.parse(input);
      const diagnosis = runMetallurgyDiagnosis(validated);
      const llm = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'metallurgy-agent',
        schema: MetallurgyOutput,
        systemPrompt: METALLURGY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated, diagnosis),
        maxTokens: 2500,
      });

      // Deterministic verdicts OVERRIDE the LLM's self-reported diagnosis
      // (reproducible, Auditor-traceable) and the deterministic
      // evidence_ids are appended so the chain is never empty.
      const output: MetallurgyOutput = {
        ...llm,
        head_grade_verdict: diagnosis.head_grade.verdict,
        recovery_verdict: diagnosis.recovery.verdict,
        recovery_envelope_pct: {
          low: diagnosis.recovery.envelope_low_pct,
          high: diagnosis.recovery.envelope_high_pct,
        },
        throughput_diagnosis: diagnosis.throughput
          ? {
              power_limited_tph: diagnosis.throughput.power_limited_tph,
              availability: diagnosis.throughput.availability,
              effective_nameplate_tph: diagnosis.throughput.effective_nameplate_tph,
              utilisation_vs_nameplate: diagnosis.throughput.utilisation_vs_nameplate,
              bottleneck: diagnosis.throughput.bottleneck,
            }
          : null,
        evidence_ids: dedupe([...llm.evidence_ids, ...diagnosis.evidence_ids]),
      };

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
    // diagnose is pure — no deps to resolve.
    diagnose(input) {
      return runMetallurgyDiagnosis(MetallurgyInputSchema.parse(input));
    },
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

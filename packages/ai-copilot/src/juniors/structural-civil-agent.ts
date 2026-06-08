/**
 * Structural / Civil Agent — limit-state sanity + tailings-dam (TSF)
 * surveillance for the estate's construction programme.
 *
 * Grounded in `Docs/research/construction-built-environment.md` §6 (Eurocode
 * EN 1990–1999 / ACI 318 limit-state design, ULS/SLS, geotechnics) and §7
 * (GISTM 2020 — consequence classification, EoR/RTFE/ITRB accountability,
 * observational-method monitoring). The highest-value construction gap: no
 * existing junior owns structural integrity or tailings-dam safety.
 *
 * Two capabilities on one junior:
 *   • `processInput` (structural sanity) — EN 1990 / ACI 318 factored
 *     load-combination + ULS/SLS utilisation triage; flags marginal/failed
 *     designs to a registered Engineer of Record. NEVER issues a design.
 *   • `processTsf` (GISTM surveillance) — consequence classification +
 *     observational-method banding. ENFORCES the GISTM Topic-IV inviolable
 *     deterministically (fail-closed) BEFORE the LLM port: an Extreme /
 *     Very-High facility without a named Accountable Executive + Engineer of
 *     Record + RTFE + ITRB is rejected — never reason-resolved away.
 *
 * Deterministic math lives in `structural-engine.ts`; the LLM port narrates
 * over verified outputs and never confabulates safety numbers. Advisory only:
 * a registered EoR signs; this junior analyses and escalates.
 *
 * Writes via typed `db.insert(riskSnapshots)` (migration 0011) when present.
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
  checkLimitState,
  classifyConsequence,
  evaluateSurveillance,
  type ConsequenceResult,
  type LimitStateResult,
  type SurveillanceResult,
} from './structural-engine.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas — structural limit-state sanity (§6)
// ─────────────────────────────────────────────────────────────────────

export const StructuralCivilInputSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  element_id: z.string().min(1),
  element_type: z.enum(['beam', 'column', 'slab', 'foundation', 'retaining_wall', 'plant_support']),
  design_code: z.enum(['eurocode', 'aci318']),
  permanent_action: z.number().nonnegative(),
  variable_action: z.number().nonnegative(),
  design_resistance: z.number().positive(),
  sls_deflection_mm: z.number().nonnegative(),
  sls_deflection_limit_mm: z.number().positive(),
});
export type StructuralCivilInput = z.infer<typeof StructuralCivilInputSchema>;

export const StructuralCivilOutput = AuditedOutputBase.extend({
  element_id: z.string(),
  design_code: z.enum(['eurocode', 'aci318']),
  limit_state: z.object({
    design_action: z.number(),
    uls_utilisation: z.number(),
    uls_pass: z.boolean(),
    sls_utilisation: z.number(),
    sls_pass: z.boolean(),
    verdict: z.enum(['pass', 'fail', 'marginal']),
  }),
  /** True for fail/marginal — must route to a registered Engineer of Record. */
  eor_review_required: z.boolean(),
  engineer_commentary: z.string().min(1),
});
export type StructuralCivilOutput = z.infer<typeof StructuralCivilOutput>;

// ─────────────────────────────────────────────────────────────────────
// Schemas — TSF / GISTM surveillance (§7)
// ─────────────────────────────────────────────────────────────────────

const NamedRole = z.object({ role: z.string().min(1), named_person: z.string().min(1) });

const SurveillanceReadingSchema = z.object({
  instrument: z.enum(['piezometer', 'inclinometer', 'survey_monument', 'insar']),
  id: z.string().min(1),
  value: z.number(),
  trigger_level: z.number(),
  action_level: z.number(),
});

export const TsfInputSchema = z.object({
  tenantId: z.string().min(1),
  facilityId: z.string().min(1),
  potential_loss_of_life: z.number().nonnegative(),
  damage_band: z.enum(['minor', 'moderate', 'major', 'severe', 'catastrophic']),
  construction_method: z.enum(['upstream', 'downstream', 'centreline']),
  /** Named GISTM Topic-IV accountability roles for this facility. */
  named_roles: z.array(NamedRole).default([]),
  readings: z.array(SurveillanceReadingSchema).min(1),
});
export type TsfInput = z.infer<typeof TsfInputSchema>;

export const TsfVerdict = z.enum(['conformant', 'monitor', 'escalate', 'blocked']);

export const TsfOutput = AuditedOutputBase.extend({
  facility_id: z.string(),
  consequence_class: z.enum(['low', 'significant', 'high', 'very_high', 'extreme']),
  required_roles: z.array(z.string()),
  itrb_required: z.boolean(),
  missing_roles: z.array(z.string()),
  surveillance_band: z.enum(['green', 'amber', 'red']),
  verdict: TsfVerdict,
  upstream_method_flag: z.boolean(),
  tsf_commentary: z.string().min(1),
});
export type TsfOutput = z.infer<typeof TsfOutput>;

// ─────────────────────────────────────────────────────────────────────
// Prompts (LLM port narrates over verified engine outputs)
// ─────────────────────────────────────────────────────────────────────

export const STRUCTURAL_CIVIL_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Structural / Civil Agent',
  mandate:
    'Triage a structural/civil element against the limit-state code (Eurocode EN 1990 or ACI 318). The factored ' +
    'load combination and ULS/SLS utilisation are ALREADY computed — narrate the COMPUTED verdict, never recompute. ' +
    'You provide a SANITY CHECK, not a design: any fail or marginal verdict MUST route to a registered Engineer of Record.',
  tools: 'check_limit_state(EN 1990 / ACI 318), classify_geotech_risk(EN 1997).',
  evidence:
    'Cite the design code clause (EN 1990 Eq. 6.10 STR / ACI 318 §5.3) and the element_id feeding the check. ' +
    'Cite construction-built-environment.md §6.',
  outputSchema:
    '{ "element_id": string, "design_code": "eurocode"|"aci318", "limit_state": {...}, "eor_review_required": boolean, ' +
    '"engineer_commentary": string, "confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.8,
  autonomyDomain: 'advisory sanity-check only — NEVER issues a structural design; a registered EoR signs.',
  hardRules: [
    'Never recompute or override the COMPUTED limit-state figures — they are the verified source of truth.',
    'Never declare a structure safe on a sanity check alone; fail/marginal verdicts route to a registered Engineer of Record.',
    'Treat ULS (collapse) as non-negotiable; an ULS exceedance is always a fail, never "acceptable".',
    'Apply the observational method (EN 1997) where ground uncertainty is high.',
  ],
});

export const TSF_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Structural / Civil Agent (Tailings / GISTM)',
  mandate:
    'Assess a tailings storage facility against GISTM 2020. Consequence class, required accountability roles, missing ' +
    'roles and the observational-method surveillance band are ALREADY computed and the Topic-IV inviolable is enforced ' +
    'deterministically — narrate the COMPUTED verdict. A dam can kill thousands; treat this as the highest-consequence ' +
    'construction in the estate.',
  tools: 'classify_consequence(GISTM Topic I/IV), evaluate_surveillance(observational method §7.2).',
  evidence:
    'Cite GISTM Topic IV (accountability), Principle 15 (disclosure) and the instrument ids driving the surveillance band. ' +
    'Cite construction-built-environment.md §7.',
  outputSchema:
    '{ "facility_id": string, "consequence_class": string, "required_roles": string[], "itrb_required": boolean, ' +
    '"missing_roles": string[], "surveillance_band": "green"|"amber"|"red", "verdict": "conformant"|"monitor"|"escalate"|"blocked", ' +
    '"upstream_method_flag": boolean, "tsf_commentary": string, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'advisory + HARD GATE — an Extreme/Very-High facility without the named GISTM Topic-IV roles is blocked.',
  hardRules: [
    'GISTM INVIOLABLE: never declare an Extreme or Very-High facility conformant without a named Accountable Executive, Engineer of Record, RTFE and ITRB.',
    'Never recompute the consequence class or surveillance band — they are the verified source of truth.',
    'A red surveillance band (action-level exceedance) always escalates — never downgrade it.',
    'Flag upstream construction for liquefaction risk (post-Brumadinho).',
  ],
});

// ─────────────────────────────────────────────────────────────────────
// User-prompt builders
// ─────────────────────────────────────────────────────────────────────

function buildStructuralUserPrompt(input: StructuralCivilInput, computed: LimitStateResult): string {
  return [
    `TENANT: ${input.tenantId}  PROJECT: ${input.projectId}  ELEMENT: ${input.element_id} (${input.element_type})`,
    `DESIGN_CODE: ${input.design_code}`,
    `COMPUTED LIMIT-STATE (verified, do not alter):`,
    JSON.stringify(computed, null, 2),
  ].join('\n');
}

function buildTsfUserPrompt(input: TsfInput, consequence: ConsequenceResult, surveillance: SurveillanceResult, missing: ReadonlyArray<string>): string {
  return [
    `TENANT: ${input.tenantId}  FACILITY: ${input.facilityId}  METHOD: ${input.construction_method}`,
    `COMPUTED CONSEQUENCE (verified, do not alter):`,
    JSON.stringify(consequence, null, 2),
    `COMPUTED SURVEILLANCE (verified, do not alter):`,
    JSON.stringify(surveillance, null, 2),
    `MISSING_ROLES: ${JSON.stringify(missing)}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createStructuralCivilAgent(deps: JuniorDeps) {
  return {
    /** §6 structural limit-state sanity check. */
    async processInput(input: StructuralCivilInput): Promise<StructuralCivilOutput> {
      const validated = StructuralCivilInputSchema.parse(input);
      const computed = checkLimitState(validated.design_code, validated);

      const narrated = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'structural-civil-agent',
        schema: StructuralCivilOutput,
        systemPrompt: STRUCTURAL_CIVIL_SYSTEM_PROMPT,
        userPrompt: buildStructuralUserPrompt(validated, computed),
        maxTokens: 1800,
      });

      const output: StructuralCivilOutput = {
        ...narrated,
        element_id: validated.element_id,
        design_code: validated.design_code,
        limit_state: {
          design_action: computed.design_action,
          uls_utilisation: computed.uls_utilisation,
          uls_pass: computed.uls_pass,
          sls_utilisation: computed.sls_utilisation,
          sls_pass: computed.sls_pass,
          verdict: computed.verdict,
        },
        eor_review_required: computed.verdict !== 'pass',
      };

      await persistRisk(deps, validated.tenantId, validated.projectId, 'structural', output);
      return output;
    },

    /**
     * §7 GISTM tailings surveillance. The Topic-IV accountability inviolable
     * is enforced DETERMINISTICALLY and FAIL-CLOSED before the LLM port: an
     * Extreme/Very-High facility missing any named required role is `blocked`
     * regardless of what the model would say.
     */
    async processTsf(input: TsfInput): Promise<TsfOutput> {
      const validated = TsfInputSchema.parse(input);
      const consequence = classifyConsequence(validated);
      const surveillance = evaluateSurveillance(validated.readings);

      const namedRoleSet = new Set(validated.named_roles.map((r) => r.role));
      const missingRoles = consequence.required_roles.filter((r) => !namedRoleSet.has(r));

      // Deterministic GISTM Topic-IV gate (fail-closed) — never reason-resolved.
      const inviolableBreached = consequence.itrb_required && missingRoles.length > 0;
      const verdict: z.infer<typeof TsfVerdict> = inviolableBreached
        ? 'blocked'
        : surveillance.band === 'red'
          ? 'escalate'
          : surveillance.band === 'amber'
            ? 'monitor'
            : 'conformant';

      const narrated = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'structural-civil-agent-tsf',
        schema: TsfOutput,
        systemPrompt: TSF_SYSTEM_PROMPT,
        userPrompt: buildTsfUserPrompt(validated, consequence, surveillance, missingRoles),
        maxTokens: 1800,
      });

      // Engine outputs + the gated verdict are authoritative over the model.
      const output: TsfOutput = {
        ...narrated,
        facility_id: validated.facilityId,
        consequence_class: consequence.consequence_class,
        required_roles: [...consequence.required_roles],
        itrb_required: consequence.itrb_required,
        missing_roles: missingRoles,
        surveillance_band: surveillance.band,
        verdict,
        upstream_method_flag: consequence.upstream_method_flag,
      };

      await persistRisk(deps, validated.tenantId, validated.facilityId, 'tsf', output);
      return output;
    },
  };
}
export type StructuralCivilAgent = ReturnType<typeof createStructuralCivilAgent>;

async function persistRisk(
  deps: JuniorDeps,
  tenantId: string,
  siteId: string,
  kind: string,
  summary: unknown,
): Promise<void> {
  if (!deps.db) return;
  try {
    const schemas = await loadJuniorSchemas();
    const riskSnapshots = schemas?.riskSnapshots as unknown;
    if (riskSnapshots) {
      await deps.db
        .insert(riskSnapshots)
        .values({ id: randomUUID(), tenantId, siteId, kind, summary })
        .onConflictDoNothing();
    }
  } catch (err) {
    deps.logger?.warn('structural-civil-agent: db write skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createDefaultStructuralCivilAgent(): StructuralCivilAgent {
  let cached: StructuralCivilAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createStructuralCivilAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
    async processTsf(input) {
      return (await get()).processTsf(input);
    },
  };
}

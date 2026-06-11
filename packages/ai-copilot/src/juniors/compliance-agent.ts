/**
 * Compliance Agent — regulator citation library lookup, action
 * checklist generation (AGENT_PROMPT_LIBRARY §21).
 *
 * DEEPENED (Wave-3 Licence-to-Operate pillar): in addition to the
 * Tanzania regulator-verdict path, the agent now runs an ESG / disclosure
 * mode that DETERMINISTICALLY assembles the voluntary-standard register
 * (ICMM PE conformance, IRMA level, GISTM tailings-role gate, ISSB/GRI/
 * TNFD/EITI disclosure packs, OECD due-diligence, IAS 37 closure
 * financial assurance) from `Docs/research/mining-esg-compliance.md`, then
 * OVERRIDES any LLM-echoed figure with the computed truth. The GISTM
 * Extreme/Very-High role gate and the closure-financial-assurance check
 * surface HIGH-risk inviolable breaches for the policy-gate/inviolable
 * kernel (the kernel owns the literal refusal — this agent only flags).
 *
 * Writes via typed `db.insert(complianceVerdicts)` (migration 0011).
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
  assembleDisclosurePack,
  checkFinancialAssurance,
  gateTailingsRoles,
  scheduleAssuranceCycle,
  scoreIcmmRegister,
  type DisclosurePackInput,
  type FinancialAssuranceInput,
  type PerformanceExpectation,
  type StandardKey,
  type TailingsFacility,
} from './esg-disclosure.js';

export const RegulatorBody = z.enum([
  'Tumemadini',
  'NEMC',
  'BoT',
  'TRA',
  'GePG',
  'OSHA',
  'BRELA',
  'NIDA',
  'LGA',
  'Minister_Lands',
  'Minister_Minerals',
  'TARURA',
  'TANROADS',
  'TBS',
]);

export const ProposedAction = z.object({
  action_kind: z.string().min(1),
  description: z.string().min(1),
  amount_tzs: z.number().nonnegative().optional(),
  cross_border: z.boolean().default(false),
  involves_mercury: z.boolean().default(false),
  involves_explosives: z.boolean().default(false),
  involves_water_within_60m: z.boolean().default(false),
  near_protected_area: z.boolean().default(false),
});

export const ComplianceInputSchema = z.object({
  tenantId: z.string().min(1),
  action: ProposedAction,
  context: z.record(z.string(), z.unknown()).default({}),
});
export type ComplianceInput = z.infer<typeof ComplianceInputSchema>;

export const Citation = z.object({
  rule_key: z.string().min(1),
  passage: z.string().min(1),
  source_url: z.string().optional(),
  gazette_number: z.string().optional(),
  date: z.string().optional(),
});

export const ComplianceOutput = AuditedOutputBase.extend({
  compliant: z.boolean(),
  blocking_regulators: z.array(RegulatorBody).default([]),
  citations: z.array(Citation).min(1, 'must cite at least one rule'),
  required_actions: z.array(
    z.object({ action: z.string(), regulator: RegulatorBody, due: z.string().optional() }),
  ),
  cross_border_alignment: z
    .object({ oecd_annex_ii: z.boolean(), icmm_ccm: z.boolean(), ifc_mining_ehs: z.boolean() })
    .optional(),
});
export type ComplianceOutput = z.infer<typeof ComplianceOutput>;

export const COMPLIANCE_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Compliance Agent',
  mandate:
    'Cross-check the proposed action against Mining Act 2010, EMA 2004, Land Act 1999, Village Land Act 1999, BoT GN 198/2025, CSR Reg 2023, Local Content Reg 2018 + GN 563/2025, OSHA 2003, Explosives Cap.45, OECD Due Diligence (3T+Gold), ICMM CCM, IFC Mining EHS.',
  tools: 'check_action, citation_lookup, ingest_gazette, list_regulator_updates.',
  evidence:
    'Every citation MUST include the specific Act § or the Gazette number + date. Cross-border calls MUST carry the OECD Annex II + ICMM + IFC alignment statement.',
  outputSchema:
    '{ "compliant": boolean, "blocking_regulators": RegulatorBody[], "citations": Citation[], ' +
    '"required_actions": [...], "cross_border_alignment"?: {...}, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'verdict only; never executes filings',
  hardRules: [
    'Block any action within 60 m of a water source (NAWAPO 2002).',
    'Block any mercury operational advice that increases exposure (Minamata).',
    'Block PML transfer to a non-citizen.',
    'Block USD pricing on domestic TZ transactions (GN 198/2025).',
  ],
  extras:
    'NOTE: the `citations` field uses the structured Citation schema above; the base envelope `citations` ' +
    'is a string[] — Auditor will accept either as long as both reference the same regulator.',
});

function buildUserPrompt(input: ComplianceInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `PROPOSED_ACTION:`,
    JSON.stringify(input.action, null, 2),
    `CONTEXT:`,
    JSON.stringify(input.context, null, 2).slice(0, 3_000),
  ].join('\n');
}

export function createComplianceAgent(deps: JuniorDeps) {
  return {
    async processInput(input: ComplianceInput): Promise<ComplianceOutput> {
      const validated = ComplianceInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'compliance-agent',
        schema: ComplianceOutput,
        systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const complianceVerdicts = schemas?.complianceVerdicts as unknown;
          if (complianceVerdicts) {
            await deps.db
              .insert(complianceVerdicts)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                actionKind: validated.action.action_kind,
                compliant: output.compliant,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('compliance-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type ComplianceAgent = ReturnType<typeof createComplianceAgent>;

export function createDefaultComplianceAgent(): ComplianceAgent {
  let cached: ComplianceAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createComplianceAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

// ═════════════════════════════════════════════════════════════════════
// ESG / disclosure assembler (Wave-3) — deterministic register + packs.
//
// A distinct junior surface from the regulator-verdict path above. It
// assembles the voluntary-standard register and disclosure packs, gates
// GISTM tailings roles, schedules assurance cycles, and checks closure
// financial assurance — all DETERMINISTICALLY. The Claude call only adds
// a narrative rationale + evidence chain; every number is computed here
// and overrides the LLM echo. Registered separately by the Wire phase.
// ═════════════════════════════════════════════════════════════════════

export const PerformanceExpectationSchema = z.object({
  principle: z.number().int().min(1).max(10),
  pe_id: z.string().min(1),
  outcome: z.enum(['meets', 'partially_meets', 'does_not_meet', 'not_applicable']),
});

export const ConsequenceClassSchema = z.enum(['low', 'significant', 'high', 'very_high', 'extreme']);

export const TailingsFacilitySchema = z.object({
  facility_id: z.string().min(1),
  consequence_class: ConsequenceClassSchema,
  accountable_executive: z.string().optional(),
  engineer_of_record: z.string().optional(),
  rtfe: z.string().optional(),
  itrb_in_place: z.boolean().optional(),
  principle15_disclosure_published: z.boolean().optional(),
});

export const StandardKeySchema = z.enum([
  'ICMM',
  'IRMA',
  'GISTM',
  'TSM',
  'ISSB_S1_S2',
  'GRI_14',
  'SASB_EM_MM',
  'EITI',
  'TNFD',
  'OECD_DD',
  'CLOSURE_IAS37',
]);

export const DisclosurePackRequestSchema = z.object({
  standard: StandardKeySchema,
  provided: z
    .array(
      z.object({
        component: z.string().min(1),
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export const AssuranceCycleRequestSchema = z.object({
  standard: StandardKeySchema,
  days_since_last: z.number().int().nonnegative().optional(),
  cadence_days: z.number().int().positive().optional(),
});

export const FinancialAssuranceRequestSchema = z.object({
  closure_cost_estimate: z.number().nonnegative(),
  assurance_instrument_value: z.number().nonnegative(),
  currency_code: z.string().min(1),
});

export const EsgDisclosureInputSchema = z.object({
  tenantId: z.string().min(1),
  asset_id: z.string().min(1),
  /** IRMA achievement level claimed (audited externally — agent records, doesn't award). */
  irma_level: z.enum(['none', 'transparency', '50', '75', '100']).default('none'),
  icmm_register: z.array(PerformanceExpectationSchema).default([]),
  tailings_facilities: z.array(TailingsFacilitySchema).default([]),
  disclosure_requests: z.array(DisclosurePackRequestSchema).default([]),
  assurance_cycles: z.array(AssuranceCycleRequestSchema).default([]),
  financial_assurance: FinancialAssuranceRequestSchema.nullable().default(null),
});
export type EsgDisclosureInput = z.infer<typeof EsgDisclosureInputSchema>;

export const EsgDisclosureOutput = AuditedOutputBase.extend({
  asset_id: z.string(),
  irma_level: z.string(),
  icmm: z
    .object({
      applicable: z.number().nonnegative(),
      meets: z.number().nonnegative(),
      partially_meets: z.number().nonnegative(),
      does_not_meet: z.number().nonnegative(),
      conformance_pct: z.number().min(0).max(100),
      gap_pe_ids: z.array(z.string()),
    })
    .nullable()
    .default(null),
  tailings_gates: z
    .array(
      z.object({
        facility_id: z.string(),
        consequence_class: ConsequenceClassSchema,
        itrb_required: z.boolean(),
        missing_roles: z.array(z.string()),
        conformant: z.boolean(),
        inviolable_breach: z.boolean(),
      }),
    )
    .default([]),
  disclosure_packs: z
    .array(
      z.object({
        standard: StandardKeySchema,
        required_components: z.array(z.string()),
        ready_components: z.array(z.string()),
        missing_components: z.array(z.string()),
        readiness_pct: z.number().min(0).max(100),
        publishable: z.boolean(),
        evidence_chain: z.array(z.string()),
      }),
    )
    .default([]),
  assurance_schedule: z
    .array(
      z.object({
        standard: StandardKeySchema,
        cadence_days: z.number().int().positive(),
        days_until_due: z.number().int(),
        overdue: z.boolean(),
        never_validated: z.boolean(),
      }),
    )
    .default([]),
  financial_assurance: z
    .object({
      currency_code: z.string(),
      closure_cost_estimate: z.number().nonnegative(),
      assurance_instrument_value: z.number().nonnegative(),
      shortfall: z.number().nonnegative(),
      coverage_pct: z.number().min(0).max(100),
      assurance_present: z.boolean(),
      inviolable_breach: z.boolean(),
    })
    .nullable()
    .default(null),
  /** HIGH-risk inviolable breaches for the policy-gate/inviolable kernel. */
  inviolable_breaches: z.array(z.string()).default([]),
  immediate_alerts: z.array(z.string()).default([]),
});
export type EsgDisclosureOutput = z.infer<typeof EsgDisclosureOutput>;

export const ESG_DISCLOSURE_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'ESG / Disclosure Assembler',
  mandate:
    'Maintain the voluntary-standard register (ICMM PEs, IRMA level, GISTM tailings roles, TSM protocols) and assemble double-materiality disclosure packs (ISSB S1/S2 Scope1/2/3, GRI 14 impact, SASB financial, EITI beneficial-ownership + payments-to-government, TNFD LEAP, OECD due-diligence) plus IAS 37 closure financial assurance. Report asset-level, not group-averaged.',
  tools:
    'score_icmm_register, gate_tailings_roles, assemble_disclosure_pack, schedule_assurance_cycle, check_financial_assurance.',
  evidence:
    'Every disclosure component is "ready" only with >=1 evidence_id. Cite the standard clause for each conformance score. GISTM Extreme/Very-High facilities MUST cite the named Accountable Executive + Engineer of Record + ITRB.',
  outputSchema:
    '{ "asset_id": string, "irma_level": string, "icmm": {...}|null, "tailings_gates": [...], ' +
    '"disclosure_packs": [...], "assurance_schedule": [...], "financial_assurance": {...}|null, ' +
    '"inviolable_breaches": string[], "immediate_alerts": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'assembly + scoring only; never files a disclosure, awards an IRMA level, or commits financial assurance',
  hardRules: [
    'No Extreme/Very-High TSF is conformant without a named Accountable Executive + Engineer of Record + ITRB (GISTM) — flag as an inviolable breach.',
    'Rehabilitation financial assurance must ALWAYS be present and cover the third-party closure cost (IAS 37) — any shortfall is an inviolable breach.',
    'A disclosure component with zero evidence_ids is NOT ready — never report it publishable.',
    'Report double materiality (GRI impact + SASB/ISSB financial), asset-by-asset, never group-averaged.',
  ],
});

function buildEsgUserPrompt(input: EsgDisclosureInput): string {
  return [
    `TENANT: ${input.tenantId}  ASSET: ${input.asset_id}  IRMA_LEVEL: ${input.irma_level}`,
    `ICMM_PEs (${input.icmm_register.length}):`,
    JSON.stringify(input.icmm_register, null, 2).slice(0, 2_500),
    `TAILINGS_FACILITIES (${input.tailings_facilities.length}):`,
    JSON.stringify(input.tailings_facilities, null, 2).slice(0, 2_500),
    `DISCLOSURE_REQUESTS (${input.disclosure_requests.length}):`,
    JSON.stringify(input.disclosure_requests, null, 2).slice(0, 2_500),
  ].join('\n');
}

export function createEsgDisclosureAgent(deps: JuniorDeps) {
  return {
    async processInput(input: EsgDisclosureInput): Promise<EsgDisclosureOutput> {
      const validated = EsgDisclosureInputSchema.parse(input);
      const llm = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'esg-disclosure-agent',
        schema: EsgDisclosureOutput,
        systemPrompt: ESG_DISCLOSURE_SYSTEM_PROMPT,
        userPrompt: buildEsgUserPrompt(validated),
        maxTokens: 3000,
      });

      // ── Deterministic authority: compute every register/pack value and
      //    OVERRIDE the LLM echo. The model only owns rationale + evidence.
      const icmm =
        validated.icmm_register.length > 0
          ? scoreIcmmRegister(validated.icmm_register as ReadonlyArray<PerformanceExpectation>)
          : null;

      const tailingsGates = validated.tailings_facilities.map((f) =>
        gateTailingsRoles(f as TailingsFacility),
      );

      const disclosurePacks = validated.disclosure_requests.map((r) =>
        assembleDisclosurePack(r as DisclosurePackInput),
      );

      const assuranceSchedule = validated.assurance_cycles.map((c) =>
        scheduleAssuranceCycle({
          standard: c.standard as StandardKey,
          ...(c.days_since_last !== undefined ? { days_since_last: c.days_since_last } : {}),
          ...(c.cadence_days !== undefined ? { cadence_days: c.cadence_days } : {}),
        }),
      );

      const financialAssurance = validated.financial_assurance
        ? checkFinancialAssurance(validated.financial_assurance as FinancialAssuranceInput)
        : null;

      // ── Collect HIGH-risk inviolable breaches + un-buffered alerts.
      const breaches: string[] = [];
      const alerts = new Set<string>(llm.immediate_alerts);
      for (const g of tailingsGates) {
        if (g.inviolable_breach) {
          const msg = `GISTM ${g.consequence_class} TSF ${g.facility_id} missing ${g.missing_roles.join(', ')} — no Extreme/Very-High TSF without ITRB + EoR + Accountable Executive.`;
          breaches.push(msg);
          alerts.add(msg);
        }
      }
      if (financialAssurance?.inviolable_breach) {
        const msg = financialAssurance.assurance_present
          ? `Closure financial-assurance shortfall of ${financialAssurance.shortfall} ${financialAssurance.currency_code} (coverage ${financialAssurance.coverage_pct}%) — must cover third-party closure cost (IAS 37).`
          : `No closure financial assurance posted (${financialAssurance.currency_code}) — rehabilitation assurance must ALWAYS be present.`;
        breaches.push(msg);
        alerts.add(msg);
      }

      const output: EsgDisclosureOutput = {
        ...llm,
        asset_id: validated.asset_id,
        irma_level: validated.irma_level,
        icmm: icmm ? { ...icmm, gap_pe_ids: [...icmm.gap_pe_ids] } : null,
        tailings_gates: tailingsGates.map((g) => ({
          facility_id: g.facility_id,
          consequence_class: g.consequence_class,
          itrb_required: g.itrb_required,
          missing_roles: [...g.missing_roles],
          conformant: g.conformant,
          inviolable_breach: g.inviolable_breach,
        })),
        disclosure_packs: disclosurePacks.map((p) => ({
          standard: p.standard,
          required_components: [...p.required_components],
          ready_components: [...p.ready_components],
          missing_components: [...p.missing_components],
          readiness_pct: p.readiness_pct,
          publishable: p.publishable,
          evidence_chain: [...p.evidence_chain],
        })),
        assurance_schedule: assuranceSchedule.map((s) => ({
          standard: s.standard,
          cadence_days: s.cadence_days,
          days_until_due: s.days_until_due,
          overdue: s.overdue,
          never_validated: s.never_validated,
        })),
        financial_assurance: financialAssurance,
        inviolable_breaches: breaches,
        immediate_alerts: [...alerts],
      };

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const complianceVerdicts = schemas?.complianceVerdicts as unknown;
          if (complianceVerdicts) {
            await deps.db
              .insert(complianceVerdicts)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                actionKind: 'esg_disclosure_pack',
                compliant: breaches.length === 0,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('esg-disclosure-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type EsgDisclosureAgent = ReturnType<typeof createEsgDisclosureAgent>;

export function createDefaultEsgDisclosureAgent(): EsgDisclosureAgent {
  let cached: EsgDisclosureAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createEsgDisclosureAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}

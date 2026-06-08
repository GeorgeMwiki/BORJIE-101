/**
 * ESG / Disclosure Assembler Agent — turns a per-asset standards
 * register (ICMM PEs, IRMA achievement level, GISTM TSF conformance,
 * ISSB S1/S2 + Scope 1/2/3, EITI payments-to-government) into a
 * disclosure-readiness pack with deterministic conformance scoring and
 * HIGH-risk inviolable flags.
 *
 * Grounded in `Docs/research/mining-esg-compliance.md`:
 *   - §1.1 ICMM 10 Mining Principles + Performance Expectations
 *     (3-yr self-assessment + VSP third-party validation; per-PE outcome
 *     'Meets'/'Partially Meets'/'Does Not Meet'/'Not Applicable').
 *   - §1.2 IRMA achievement levels (Transparency → 50 → 75 → 100; critical
 *     requirements must be met for any non-Transparency level).
 *   - §1.3 GISTM consequence class (Low→Extreme) + mandatory roles
 *     (Accountable Executive, EoR, RTFE, ITRB for Extreme/Very High);
 *     P15 facility disclosure.
 *   - §2.1 ISSB IFRS S1/S2 four pillars + Scope 1/2/3 (material Scope 3
 *     across all 15 GHG-Protocol categories).
 *   - §2.3 EITI 2023 (beneficial ownership + contracts + reconciled
 *     payments-to-government).
 *
 * DETERMINISTIC FIRST: the conformance %, the readiness band, the
 * GISTM-role completeness check and the inviolable flags are computed in
 * pure code (no LLM, no network). The LLM is used ONLY to draft the
 * narrative disclosure-pack summary, and the deterministic facts are
 * always authoritative. On LLM failure the agent ships a deterministic
 * envelope — disclosure readiness never goes dark.
 *
 * HIGH-risk guardrail mapping (advisory flags only — this junior NEVER
 * edits the kernel `inviolable.ts`/`policy-gate.ts`): an Extreme/Very-High
 * TSF missing ITRB/EoR/Accountable Executive, or a missing closure
 * financial-assurance instrument, raises an `inviolable_flag` keyed to a
 * kernel policy prefix. The policy-gate/Master Brain consume these.
 *
 * Writes via typed `db.insert(complianceVerdicts)` (migration 0011) —
 * reusing the compliance verdict table; falls back silently if absent.
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
// Input register schemas
// ─────────────────────────────────────────────────────────────────────

/** ICMM Performance-Expectation outcome per the validation framework. */
export const PeOutcome = z.enum(['meets', 'partially_meets', 'does_not_meet', 'not_applicable']);
export type PeOutcome = z.infer<typeof PeOutcome>;

export const IcmmPeRecord = z.object({
  /** Principle number 1-10. */
  principle: z.number().int().min(1).max(10),
  pe_id: z.string().min(1),
  outcome: PeOutcome,
  /** ISO date of last self-assessment (3-yr cadence per §1.1). */
  self_assessed_iso: z.string().nullable().default(null),
  /** True when a qualified VSP third-party validated this PE. */
  third_party_validated: z.boolean().default(false),
  evidence_id: z.string().optional(),
});
export type IcmmPeRecord = z.infer<typeof IcmmPeRecord>;

/** IRMA achievement level + critical-requirement status (§1.2). */
export const IrmaStatus = z.object({
  level_claimed: z.enum(['none', 'ready', 'transparency', 'irma_50', 'irma_75', 'irma_100']),
  requirements_met: z.number().int().nonnegative().default(0),
  requirements_total: z.number().int().positive().default(400),
  /** Critical requirements must ALL be met for any non-Transparency level. */
  critical_requirements_met: z.boolean().default(false),
  evidence_id: z.string().optional(),
});
export type IrmaStatus = z.infer<typeof IrmaStatus>;

/** GISTM consequence class (§1.3) — drives mandatory-role requirements. */
export const ConsequenceClass = z.enum(['low', 'significant', 'high', 'very_high', 'extreme']);
export type ConsequenceClass = z.infer<typeof ConsequenceClass>;

export const TailingsFacility = z.object({
  facility_id: z.string().min(1),
  consequence_class: ConsequenceClass,
  /** Named single senior officer accountable for facility safety. */
  accountable_executive: z.string().nullable().default(null),
  engineer_of_record: z.string().nullable().default(null),
  responsible_tailings_facility_engineer: z.string().nullable().default(null),
  /** Independent Tailings Review Board — required for Extreme/Very High. */
  itrb_appointed: z.boolean().default(false),
  /** GISTM Principle 15 facility-level public disclosure published. */
  p15_disclosure_published: z.boolean().default(false),
  evidence_id: z.string().optional(),
});
export type TailingsFacility = z.infer<typeof TailingsFacility>;

/** ISSB IFRS S1/S2 four-pillar + Scope 1/2/3 readiness (§2.1). */
export const IssbStatus = z.object({
  governance_disclosed: z.boolean().default(false),
  strategy_scenario_analysis: z.boolean().default(false),
  risk_management_disclosed: z.boolean().default(false),
  metrics_targets_disclosed: z.boolean().default(false),
  scope1_tco2e: z.number().nonnegative().nullable().default(null),
  scope2_tco2e: z.number().nonnegative().nullable().default(null),
  scope3_tco2e: z.number().nonnegative().nullable().default(null),
  /** Count of the 15 GHG-Protocol Scope-3 categories disclosed. */
  scope3_categories_disclosed: z.number().int().min(0).max(15).default(0),
  evidence_id: z.string().optional(),
});
export type IssbStatus = z.infer<typeof IssbStatus>;

/** EITI 2023 transparency readiness (§2.3). */
export const EitiStatus = z.object({
  beneficial_ownership_disclosed: z.boolean().default(false),
  contracts_disclosed: z.boolean().default(false),
  /** Material payments-to-government reconciled for the period. */
  payments_to_government_reconciled: z.boolean().default(false),
  evidence_id: z.string().optional(),
});
export type EitiStatus = z.infer<typeof EitiStatus>;

/** Closure financial assurance (§3.1) — an inviolable per the spec. */
export const ClosureAssurance = z.object({
  closure_plan_present: z.boolean().default(false),
  /** IAS 37 provision booked for decommissioning/restoration. */
  ias37_provision_booked: z.boolean().default(false),
  /** Financial-assurance instrument (bond) sized to third-party cost. */
  financial_assurance_present: z.boolean().default(false),
  evidence_id: z.string().optional(),
});
export type ClosureAssurance = z.infer<typeof ClosureAssurance>;

export const EsgDisclosureInputSchema = z.object({
  tenantId: z.string().min(1),
  assetId: z.string().min(1),
  /** Reporting period label, e.g. "FY2026". */
  period: z.string().min(1),
  /** Target audience shapes the pack emphasis (impact vs financial). */
  audience: z.enum(['regulator', 'lender', 'offtaker', 'board', 'community']).default('board'),
  icmm_pes: z.array(IcmmPeRecord).default([]),
  irma: IrmaStatus.optional(),
  tailings_facilities: z.array(TailingsFacility).default([]),
  issb: IssbStatus.optional(),
  eiti: EitiStatus.optional(),
  closure: ClosureAssurance.optional(),
  as_of_iso: z.string().optional(),
});
export type EsgDisclosureInput = z.infer<typeof EsgDisclosureInputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Output schema
// ─────────────────────────────────────────────────────────────────────

export const FrameworkReadiness = z.object({
  framework: z.enum(['ICMM', 'IRMA', 'GISTM', 'ISSB', 'EITI', 'CLOSURE']),
  /** 0-100 deterministic conformance/readiness score. */
  score_pct: z.number().min(0).max(100),
  band: z.enum(['not_started', 'partial', 'substantial', 'conformant']),
  gaps: z.array(z.string()),
  evidence_ids: z.array(z.string()),
});
export type FrameworkReadiness = z.infer<typeof FrameworkReadiness>;

export const InviolableFlag = z.object({
  /** Kernel policy-gate / inviolable prefix this maps to (advisory only). */
  policy_prefix: z.enum(['kill_switch', 'four_eye', 'sovereign', 'none']),
  rule: z.string(),
  reason: z.string(),
  evidence_id: z.string(),
});
export type InviolableFlag = z.infer<typeof InviolableFlag>;

export const EsgDisclosureOutput = AuditedOutputBase.extend({
  asset_id: z.string(),
  period: z.string(),
  /** Per-framework deterministic readiness. */
  frameworks: z.array(FrameworkReadiness),
  /** Mean readiness across applicable frameworks. */
  overall_readiness_pct: z.number().min(0).max(100),
  overall_band: z.enum(['not_started', 'partial', 'substantial', 'conformant']),
  /** HIGH-risk inviolable flags for the kernel to enforce. */
  inviolable_flags: z.array(InviolableFlag),
  /** Audience-shaped narrative disclosure pack. */
  disclosure_pack: z.string().min(1),
  required_actions: z.array(z.string()),
});
export type EsgDisclosureOutput = z.infer<typeof EsgDisclosureOutput>;

// ─────────────────────────────────────────────────────────────────────
// Deterministic conformance engine (pure — no LLM, no network)
// ─────────────────────────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;

function bandFor(scorePct: number): FrameworkReadiness['band'] {
  if (scorePct <= 0) return 'not_started';
  if (scorePct < 50) return 'partial';
  if (scorePct < 100) return 'substantial';
  return 'conformant';
}

/**
 * ICMM PE conformance: applicable PEs only (NA excluded). 'meets' = 1.0,
 * 'partially_meets' = 0.5, 'does_not_meet' = 0. Third-party VSP validation
 * (§1.1) is required for full conformance — un-validated 'meets' is capped.
 */
function scoreIcmm(pes: ReadonlyArray<IcmmPeRecord>): FrameworkReadiness {
  const applicable = pes.filter((p) => p.outcome !== 'not_applicable');
  const evidence = applicable.map((p) => p.evidence_id).filter((e): e is string => Boolean(e));
  const gaps: string[] = [];
  if (applicable.length === 0) {
    return { framework: 'ICMM', score_pct: 0, band: 'not_started', gaps: ['No applicable ICMM Performance Expectations on register.'], evidence_ids: evidence };
  }
  let earned = 0;
  for (const p of applicable) {
    const base = p.outcome === 'meets' ? 1 : p.outcome === 'partially_meets' ? 0.5 : 0;
    // Full credit only if third-party validated (VSP); else cap at 0.8 of base.
    const credit = p.third_party_validated ? base : base * 0.8;
    earned += credit;
    if (p.outcome === 'does_not_meet') gaps.push(`Principle ${p.principle} PE ${p.pe_id}: Does Not Meet.`);
    else if (p.outcome === 'partially_meets') gaps.push(`Principle ${p.principle} PE ${p.pe_id}: Partially Meets.`);
    else if (!p.third_party_validated) gaps.push(`Principle ${p.principle} PE ${p.pe_id}: not VSP-validated.`);
  }
  const scorePct = round1((earned / applicable.length) * 100);
  return { framework: 'ICMM', score_pct: scorePct, band: bandFor(scorePct), gaps, evidence_ids: evidence };
}

/** IRMA readiness (§1.2) — critical requirements gate any non-Transparency level. */
function scoreIrma(irma: IrmaStatus | undefined): FrameworkReadiness {
  if (!irma) return { framework: 'IRMA', score_pct: 0, band: 'not_started', gaps: ['No IRMA status on register.'], evidence_ids: [] };
  const evidence = irma.evidence_id ? [irma.evidence_id] : [];
  const gaps: string[] = [];
  const ratio = irma.requirements_total > 0 ? irma.requirements_met / irma.requirements_total : 0;
  let scorePct = round1(ratio * 100);
  if (!irma.critical_requirements_met && irma.level_claimed !== 'none' && irma.level_claimed !== 'ready' && irma.level_claimed !== 'transparency') {
    gaps.push('Critical requirements NOT all met — cannot achieve IRMA 50/75/100.');
    scorePct = Math.min(scorePct, 49); // capped below "substantial" until criticals met
  }
  if (irma.level_claimed === 'none') gaps.push('No IRMA level claimed.');
  return { framework: 'IRMA', score_pct: scorePct, band: bandFor(scorePct), gaps, evidence_ids: evidence };
}

/** True when GISTM requires an ITRB (Extreme / Very High consequence). */
function gistmRequiresItrb(c: ConsequenceClass): boolean {
  return c === 'extreme' || c === 'very_high';
}

/**
 * GISTM conformance (§1.3) across facilities. Each facility scores on
 * mandatory-role completeness + P15 disclosure. Extreme/Very-High without
 * ITRB+EoR+Accountable Executive is a hard non-conformance (and an
 * inviolable flag — see collectInviolableFlags).
 */
function scoreGistm(facilities: ReadonlyArray<TailingsFacility>): FrameworkReadiness {
  if (facilities.length === 0) {
    return { framework: 'GISTM', score_pct: 100, band: 'conformant', gaps: ['No tailings facilities — GISTM not applicable.'], evidence_ids: [] };
  }
  const evidence: string[] = [];
  const gaps: string[] = [];
  let total = 0;
  for (const f of facilities) {
    if (f.evidence_id) evidence.push(f.evidence_id);
    const checks: Array<[boolean, string]> = [
      [Boolean(f.accountable_executive), 'Accountable Executive'],
      [Boolean(f.engineer_of_record), 'Engineer of Record'],
      [Boolean(f.responsible_tailings_facility_engineer), 'RTFE'],
      [f.p15_disclosure_published, 'Principle-15 disclosure'],
    ];
    if (gistmRequiresItrb(f.consequence_class)) {
      checks.push([f.itrb_appointed, 'ITRB']);
    }
    const passed = checks.filter(([ok]) => ok).length;
    const facilityScore = (passed / checks.length) * 100;
    total += facilityScore;
    for (const [ok, label] of checks) {
      if (!ok) gaps.push(`Facility ${f.facility_id} (${f.consequence_class}): missing ${label}.`);
    }
  }
  const scorePct = round1(total / facilities.length);
  return { framework: 'GISTM', score_pct: scorePct, band: bandFor(scorePct), gaps, evidence_ids: evidence };
}

/** ISSB S1/S2 readiness (§2.1) — four pillars + Scope 1/2/3 + Scope-3 categories. */
function scoreIssb(issb: IssbStatus | undefined): FrameworkReadiness {
  if (!issb) return { framework: 'ISSB', score_pct: 0, band: 'not_started', gaps: ['No ISSB status on register.'], evidence_ids: [] };
  const evidence = issb.evidence_id ? [issb.evidence_id] : [];
  const gaps: string[] = [];
  const pillars: Array<[boolean, string]> = [
    [issb.governance_disclosed, 'Governance pillar'],
    [issb.strategy_scenario_analysis, 'Strategy + scenario analysis'],
    [issb.risk_management_disclosed, 'Risk & opportunity management'],
    [issb.metrics_targets_disclosed, 'Metrics & targets'],
  ];
  const scopes: Array<[boolean, string]> = [
    [issb.scope1_tco2e !== null, 'Scope 1 emissions'],
    [issb.scope2_tco2e !== null, 'Scope 2 emissions'],
    [issb.scope3_tco2e !== null, 'Scope 3 emissions'],
  ];
  // Scope 3 across all 15 categories is the heavy lift (§2.1) — weighted.
  const scope3Coverage = issb.scope3_categories_disclosed / 15;
  const pillarScore = pillars.filter(([ok]) => ok).length / pillars.length;
  const scopeScore = scopes.filter(([ok]) => ok).length / scopes.length;
  // 40% pillars, 40% scope presence, 20% scope-3 category coverage.
  const scorePct = round1((pillarScore * 0.4 + scopeScore * 0.4 + scope3Coverage * 0.2) * 100);
  for (const [ok, label] of [...pillars, ...scopes]) if (!ok) gaps.push(`Missing ${label}.`);
  if (scope3Coverage < 1) gaps.push(`Scope 3 only ${issb.scope3_categories_disclosed}/15 GHG-Protocol categories disclosed.`);
  return { framework: 'ISSB', score_pct: scorePct, band: bandFor(scorePct), gaps, evidence_ids: evidence };
}

/** EITI 2023 readiness (§2.3). */
function scoreEiti(eiti: EitiStatus | undefined): FrameworkReadiness {
  if (!eiti) return { framework: 'EITI', score_pct: 0, band: 'not_started', gaps: ['No EITI status on register.'], evidence_ids: [] };
  const evidence = eiti.evidence_id ? [eiti.evidence_id] : [];
  const checks: Array<[boolean, string]> = [
    [eiti.beneficial_ownership_disclosed, 'Beneficial-ownership disclosure'],
    [eiti.contracts_disclosed, 'Contract disclosure'],
    [eiti.payments_to_government_reconciled, 'Reconciled payments-to-government'],
  ];
  const passed = checks.filter(([ok]) => ok).length;
  const scorePct = round1((passed / checks.length) * 100);
  const gaps = checks.filter(([ok]) => !ok).map(([, label]) => `Missing ${label}.`);
  return { framework: 'EITI', score_pct: scorePct, band: bandFor(scorePct), gaps, evidence_ids: evidence };
}

/** Closure financial assurance readiness (§3.1). */
function scoreClosure(closure: ClosureAssurance | undefined): FrameworkReadiness {
  if (!closure) return { framework: 'CLOSURE', score_pct: 0, band: 'not_started', gaps: ['No closure/financial-assurance status on register.'], evidence_ids: [] };
  const evidence = closure.evidence_id ? [closure.evidence_id] : [];
  const checks: Array<[boolean, string]> = [
    [closure.closure_plan_present, 'Closure plan'],
    [closure.ias37_provision_booked, 'IAS 37 provision'],
    [closure.financial_assurance_present, 'Financial-assurance instrument'],
  ];
  const passed = checks.filter(([ok]) => ok).length;
  const scorePct = round1((passed / checks.length) * 100);
  const gaps = checks.filter(([ok]) => !ok).map(([, label]) => `Missing ${label}.`);
  return { framework: 'CLOSURE', score_pct: scorePct, band: bandFor(scorePct), gaps, evidence_ids: evidence };
}

export function assembleFrameworkReadiness(input: EsgDisclosureInput): ReadonlyArray<FrameworkReadiness> {
  return [
    scoreIcmm(input.icmm_pes),
    scoreIrma(input.irma),
    scoreGistm(input.tailings_facilities),
    scoreIssb(input.issb),
    scoreEiti(input.eiti),
    scoreClosure(input.closure),
  ];
}

/**
 * HIGH-risk inviolables (§6 checklist) mapped to kernel policy prefixes —
 * advisory flags ONLY; the kernel's policy-gate/inviolable enforces.
 *   - Extreme/Very-High TSF missing ITRB/EoR/Accountable Executive →
 *     kill_switch (catastrophic-irreversible; no operation permitted).
 *   - Closure financial assurance absent → four_eye (must be present;
 *     no contract may exclude rehabilitation assurance).
 */
export function collectInviolableFlags(input: EsgDisclosureInput): ReadonlyArray<InviolableFlag> {
  const flags: InviolableFlag[] = [];
  for (const f of input.tailings_facilities) {
    if (gistmRequiresItrb(f.consequence_class)) {
      const missing: string[] = [];
      if (!f.itrb_appointed) missing.push('ITRB');
      if (!f.engineer_of_record) missing.push('Engineer of Record');
      if (!f.accountable_executive) missing.push('Accountable Executive');
      if (missing.length > 0) {
        flags.push({
          policy_prefix: 'kill_switch',
          rule: 'no_extreme_tsf_without_itrb_eor_accountable_executive',
          reason: `${f.consequence_class} TSF ${f.facility_id} missing ${missing.join(', ')} — GISTM §1.3; operation prohibited.`,
          evidence_id: f.evidence_id ?? f.facility_id,
        });
      }
    }
  }
  if (input.closure && !input.closure.financial_assurance_present) {
    flags.push({
      policy_prefix: 'four_eye',
      rule: 'closure_financial_assurance_always_present',
      reason: 'Closure financial-assurance instrument absent — §3.1; the public purse must never fund an abandoned mine.',
      evidence_id: input.closure.evidence_id ?? `${input.assetId}_closure`,
    });
  }
  return flags;
}

// ─────────────────────────────────────────────────────────────────────
// Prompt (narrative disclosure-pack only — scores are deterministic)
// ─────────────────────────────────────────────────────────────────────

export const ESG_DISCLOSURE_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'ESG / Disclosure Assembler',
  mandate:
    'Assemble an audience-shaped disclosure pack from a per-asset ESG register. The per-framework readiness scores ' +
    '(ICMM/IRMA/GISTM/ISSB/EITI/CLOSURE), the overall readiness and the inviolable flags are computed DETERMINISTICALLY ' +
    'and given to you — never restate or override a number. Write the narrative pack: GRI = impact materiality (regulator/' +
    'community), ISSB/SASB = financial materiality (investor/lender); report double materiality where both apply.',
  tools:
    'load_register(asset), score_framework(framework), assemble_pack(audience), eiti_reconcile(period), gistm_role_check(facility).',
  evidence:
    'Cite the standard clause for every readiness statement (e.g. "ICMM §1.1 PE validation", "GISTM Principle 15", ' +
    '"ISSB IFRS S2 Scope-3 15-category rule", "EITI Requirement 2.5 beneficial ownership"). Cite the register evidence_id per framework.',
  outputSchema:
    '{ "asset_id": string, "period": string, "frameworks": [...], "overall_readiness_pct": number, "overall_band": string, ' +
    '"inviolable_flags": [...], "disclosure_pack": string, "required_actions": string[], "confidence": number, ' +
    '"rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'assembly + readiness reporting only; never files a disclosure or signs a validation — the owner commits',
  hardRules: [
    'Never restate a readiness score differently from the deterministic value supplied.',
    'Never claim conformance for a framework whose register entry is absent.',
    'Flag any Extreme/Very-High TSF missing ITRB/EoR/Accountable Executive as a kill_switch inviolable.',
    'Flag any missing closure financial-assurance instrument as a four_eye inviolable.',
    'Report double materiality (impact + financial) for board/lender/regulator audiences.',
  ],
});

function buildUserPrompt(
  input: EsgDisclosureInput,
  frameworks: ReadonlyArray<FrameworkReadiness>,
  flags: ReadonlyArray<InviolableFlag>,
  overall: { pct: number; band: string },
): string {
  return [
    `TENANT: ${input.tenantId}  ASSET: ${input.assetId}  PERIOD: ${input.period}  AUDIENCE: ${input.audience}`,
    `DETERMINISTIC_FRAMEWORK_READINESS (authoritative — do not change):`,
    JSON.stringify(frameworks, null, 2),
    `DETERMINISTIC_OVERALL: ${overall.pct}% (${overall.band})`,
    `DETERMINISTIC_INVIOLABLE_FLAGS (authoritative):`,
    JSON.stringify(flags, null, 2),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic narrative fallback
// ─────────────────────────────────────────────────────────────────────

function deterministicPack(
  input: EsgDisclosureInput,
  frameworks: ReadonlyArray<FrameworkReadiness>,
  overall: { pct: number; band: string },
): string {
  const lines = frameworks.map(
    (f) => `${f.framework}: ${f.score_pct}% (${f.band})${f.gaps.length ? ` — ${f.gaps.length} gap(s)` : ''}`,
  );
  return (
    `ESG disclosure readiness for ${input.assetId} (${input.period}, audience=${input.audience}): ` +
    `overall ${overall.pct}% (${overall.band}). ` +
    lines.join('; ') +
    '. Double materiality applies: GRI/impact + ISSB/financial.'
  );
}

function deterministicActions(
  frameworks: ReadonlyArray<FrameworkReadiness>,
  flags: ReadonlyArray<InviolableFlag>,
): string[] {
  const actions: string[] = [];
  for (const flag of flags) {
    actions.push(`INVIOLABLE (${flag.policy_prefix}): ${flag.reason}`);
  }
  for (const f of frameworks) {
    if (f.band === 'not_started') actions.push(`Stand up ${f.framework} register entry.`);
    else if (f.band === 'partial') actions.push(`Close ${f.gaps.length} ${f.framework} gap(s) to reach substantial readiness.`);
  }
  return actions;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createEsgDisclosureAgent(deps: JuniorDeps) {
  return {
    async processInput(input: EsgDisclosureInput): Promise<EsgDisclosureOutput> {
      const validated = EsgDisclosureInputSchema.parse(input);

      // 1) Deterministic truth.
      const frameworks = assembleFrameworkReadiness(validated);
      const flags = collectInviolableFlags(validated);
      // Overall = mean across frameworks that are on the register (exclude
      // not-applicable GISTM-empty edge handled by its 100% conformant band).
      const applicable = frameworks.filter(
        (f) => !(f.framework === 'GISTM' && validated.tailings_facilities.length === 0),
      );
      const overallPct =
        applicable.length > 0
          ? round1(applicable.reduce((s, f) => s + f.score_pct, 0) / applicable.length)
          : 0;
      const overallBand = bandFor(overallPct);

      const evidenceIds = [
        ...frameworks.flatMap((f) => f.evidence_ids),
        ...flags.map((fl) => fl.evidence_id),
      ];
      const baseEvidence = evidenceIds.length > 0 ? [...new Set(evidenceIds)] : [`${validated.assetId}_esg_register`];

      // 2) LLM narrative (best-effort) — deterministic fallback on failure.
      let pack = deterministicPack(validated, frameworks, { pct: overallPct, band: overallBand });
      let actions = deterministicActions(frameworks, flags);
      let citations = [
        'mining-esg-compliance.md §1.1 ICMM PE validation',
        'mining-esg-compliance.md §1.3 GISTM mandatory roles + P15',
        'mining-esg-compliance.md §2.1 ISSB Scope-3 15-category rule',
        'mining-esg-compliance.md §2.3 EITI beneficial ownership',
      ];
      let rationale = `Deterministic readiness ${overallPct}% (${overallBand}) across ${applicable.length} framework(s); ${flags.length} inviolable flag(s).`;
      try {
        const llm = await runClaudeJunior({
          claude: deps.claude,
          logger: deps.logger,
          juniorName: 'esg-disclosure-agent',
          schema: EsgDisclosureOutput,
          systemPrompt: ESG_DISCLOSURE_SYSTEM_PROMPT,
          userPrompt: buildUserPrompt(validated, frameworks, flags, { pct: overallPct, band: overallBand }),
          maxTokens: 2500,
        });
        if (llm.disclosure_pack.trim().length > 0) pack = llm.disclosure_pack;
        if (llm.required_actions.length > 0) actions = llm.required_actions;
        if (llm.citations.length > 0) citations = llm.citations;
        if (llm.rationale.trim().length > 0) rationale = llm.rationale;
      } catch (err) {
        deps.logger?.warn('esg-disclosure-agent: LLM narrative skipped — using deterministic pack', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const output: EsgDisclosureOutput = {
        asset_id: validated.assetId,
        period: validated.period,
        frameworks: [...frameworks],
        overall_readiness_pct: overallPct,
        overall_band: overallBand,
        inviolable_flags: [...flags],
        disclosure_pack: pack,
        required_actions: actions,
        confidence: flags.length > 0 ? 0.95 : 0.9,
        rationale,
        evidence_ids: baseEvidence,
        citations,
      };

      await persistVerdict(deps, validated, output);
      return output;
    },
  };
}
export type EsgDisclosureAgent = ReturnType<typeof createEsgDisclosureAgent>;

async function persistVerdict(
  deps: JuniorDeps,
  validated: EsgDisclosureInput,
  output: EsgDisclosureOutput,
): Promise<void> {
  if (!deps.db) return;
  try {
    const schemas = await loadJuniorSchemas();
    const complianceVerdicts = schemas?.complianceVerdicts as unknown;
    if (complianceVerdicts) {
      await deps.db
        .insert(complianceVerdicts)
        .values({
          id: randomUUID(),
          tenantId: validated.tenantId,
          actionKind: `esg_disclosure:${validated.audience}`,
          compliant: output.inviolable_flags.length === 0,
          summary: output,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    deps.logger?.warn('esg-disclosure-agent: db write skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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

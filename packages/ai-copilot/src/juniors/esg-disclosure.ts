/**
 * ESG / disclosure assembler — DETERMINISTIC voluntary-standard register
 * + GISTM tailings-role gate + disclosure-pack readiness math.
 *
 * Pure, side-effect-free functions implementing the licence-to-operate
 * disclosure spine from `Docs/research/mining-esg-compliance.md`:
 *
 *   - §1.1 ICMM Mining Principles: 10 Principles + Performance Expectations
 *     scored Meets / Partially / Does-Not-Meet / NA on a 3-YEAR
 *     self-assessment + 3rd-party VSP validation cycle.
 *   - §1.2 IRMA achievement levels: Transparency -> 50 -> 75 -> 100
 *     (critical requirements gate any non-Transparency level).
 *   - §1.3 GISTM: consequence classification Low -> Significant -> High
 *     -> Very High -> Extreme drives the MANDATORY-ROLE set. Extreme &
 *     Very High require a named Accountable Executive + Engineer of
 *     Record + Responsible Tailings Facility Engineer + Independent
 *     Tailings Review Board; lower classes need AE + EoR + RTFE + senior
 *     independent review. New TSFs default to Extreme design criteria.
 *   - §1.4 TSM: 8 protocols graded Level C -> AAA, externally verified
 *     every 3 years.
 *   - §2.1 ISSB IFRS S1/S2: 4 pillars (Governance / Strategy / Risk &
 *     Opportunity Mgmt / Metrics & Targets) + Scope 1/2/3 (all 15 S3
 *     categories) + scenario analysis + transition plan.
 *   - §2.2 GRI 14 Mining (impact materiality, eff. 1-Jan-2026) + SASB
 *     EM-MM (financial materiality) = DOUBLE materiality.
 *   - §2.3 EITI 2023: beneficial ownership + contract disclosure +
 *     payments-to-government reconciliation (8 requirements).
 *   - §2.4 TNFD LEAP: 14 disclosures across the same 4 pillars.
 *   - §3.1 closure: IAS 37 provision + financial-assurance bond ALWAYS
 *     present (an inviolable — no contract without rehabilitation
 *     financial assurance).
 *
 * This module ASSEMBLES and SCORES; it never files a disclosure, signs a
 * validation, or commits money. Every assembled pack must carry >=1
 * evidence_id and is rejectable by the Auditor on an empty evidence chain
 * (the esg/compliance agent layer enforces that).
 *
 * Locale-/currency-agnostic: standard keys are stable machine identifiers
 * (callers render EN/SW labels); the lone money figure (financial
 * assurance) is paired with a caller-supplied currency_code and is never
 * hard-coded to TZS/USD.
 */

// ─────────────────────────────────────────────────────────────────────
// Standard taxonomy
// ─────────────────────────────────────────────────────────────────────

export type StandardKey =
  | 'ICMM'
  | 'IRMA'
  | 'GISTM'
  | 'TSM'
  | 'ISSB_S1_S2'
  | 'GRI_14'
  | 'SASB_EM_MM'
  | 'EITI'
  | 'TNFD'
  | 'OECD_DD'
  | 'CLOSURE_IAS37';

/** Frameworks that share the TCFD/ISSB four-pillar architecture. */
export const FOUR_PILLAR_FRAMEWORKS: ReadonlyArray<StandardKey> = ['ISSB_S1_S2', 'TNFD'];

export const ISSB_PILLARS: ReadonlyArray<string> = [
  'governance',
  'strategy',
  'risk_opportunity_management',
  'metrics_targets',
];

export const GHG_SCOPES: ReadonlyArray<string> = ['scope_1', 'scope_2', 'scope_3'];

/** Number of GHG-Protocol Scope-3 categories ISSB requires when material. */
export const SCOPE3_CATEGORY_COUNT = 15;

// ─────────────────────────────────────────────────────────────────────
// ICMM Performance-Expectation scoring (§1.1)
// ─────────────────────────────────────────────────────────────────────

export type PeOutcome = 'meets' | 'partially_meets' | 'does_not_meet' | 'not_applicable';

export interface PerformanceExpectation {
  readonly principle: number; // 1..10
  readonly pe_id: string;
  readonly outcome: PeOutcome;
}

export interface IcmmRegisterResult {
  readonly applicable: number;
  readonly meets: number;
  readonly partially_meets: number;
  readonly does_not_meet: number;
  /** % of applicable PEs scored "meets". */
  readonly conformance_pct: number;
  /** PE ids that are partially_meets or does_not_meet — the pre-empt list. */
  readonly gap_pe_ids: ReadonlyArray<string>;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Score an ICMM PE register; NA expectations drop out of the denominator. */
export function scoreIcmmRegister(
  pes: ReadonlyArray<PerformanceExpectation>,
): IcmmRegisterResult {
  const applicablePes = pes.filter((p) => p.outcome !== 'not_applicable');
  const meets = applicablePes.filter((p) => p.outcome === 'meets').length;
  const partially = applicablePes.filter((p) => p.outcome === 'partially_meets').length;
  const doesNot = applicablePes.filter((p) => p.outcome === 'does_not_meet').length;
  const applicable = applicablePes.length;
  return {
    applicable,
    meets,
    partially_meets: partially,
    does_not_meet: doesNot,
    conformance_pct: applicable > 0 ? round1((meets / applicable) * 100) : 0,
    gap_pe_ids: applicablePes
      .filter((p) => p.outcome !== 'meets')
      .map((p) => p.pe_id),
  };
}

// ─────────────────────────────────────────────────────────────────────
// GISTM tailings-role gate (§1.3) — the highest-risk inviolable surface
// ─────────────────────────────────────────────────────────────────────

export type ConsequenceClass = 'low' | 'significant' | 'high' | 'very_high' | 'extreme';

/** Classes that mandate a full Independent Tailings Review Board (ITRB). */
export const ITRB_REQUIRED_CLASSES: ReadonlyArray<ConsequenceClass> = ['very_high', 'extreme'];

export interface TailingsFacility {
  readonly facility_id: string;
  readonly consequence_class: ConsequenceClass;
  /** Named single senior officer accountable for the facility. */
  readonly accountable_executive?: string;
  /** Named Engineer of Record (required for EVERY facility). */
  readonly engineer_of_record?: string;
  /** Named Responsible Tailings Facility Engineer. */
  readonly rtfe?: string;
  /** Whether an ITRB (or senior independent review for lower classes) is in place. */
  readonly itrb_in_place?: boolean;
  /** Whether Principle-15 facility-level public disclosure is published. */
  readonly principle15_disclosure_published?: boolean;
}

export interface TailingsRoleGate {
  readonly facility_id: string;
  readonly consequence_class: ConsequenceClass;
  readonly itrb_required: boolean;
  readonly missing_roles: ReadonlyArray<string>;
  /**
   * TRUE only when every mandatory role is named AND (for Very-High/
   * Extreme) the ITRB is in place. A FALSE here on an Extreme/Very-High
   * facility maps to the HIGH-risk inviolable "no Extreme TSF without
   * ITRB + EoR + Accountable Executive" — the policy-gate/inviolable
   * kernel owns the literal refusal; this gate surfaces the breach.
   */
  readonly conformant: boolean;
  /** TRUE if the facility breaches the Extreme/Very-High ITRB inviolable. */
  readonly inviolable_breach: boolean;
}

/**
 * Deterministically gate a tailings facility against its consequence-class
 * role requirements. EVERY facility needs AE + EoR + RTFE; Very-High and
 * Extreme additionally need an ITRB. Principle-15 disclosure is required
 * of all classes (surfaced as a missing role when absent).
 */
export function gateTailingsRoles(f: TailingsFacility): TailingsRoleGate {
  const itrbRequired = ITRB_REQUIRED_CLASSES.includes(f.consequence_class);
  const missing: string[] = [];
  if (!f.accountable_executive?.trim()) missing.push('accountable_executive');
  if (!f.engineer_of_record?.trim()) missing.push('engineer_of_record');
  if (!f.rtfe?.trim()) missing.push('rtfe');
  if (!f.itrb_in_place) missing.push(itrbRequired ? 'itrb' : 'senior_independent_review');
  if (!f.principle15_disclosure_published) missing.push('principle15_disclosure');

  // The inviolable bites for Extreme/Very-High when AE, EoR, or the ITRB
  // is absent (Principle-15 disclosure is a transparency gap, not a
  // dam-safety inviolable breach on its own).
  const inviolableBreach =
    itrbRequired &&
    (!f.accountable_executive?.trim() ||
      !f.engineer_of_record?.trim() ||
      !f.itrb_in_place);

  return {
    facility_id: f.facility_id,
    consequence_class: f.consequence_class,
    itrb_required: itrbRequired,
    missing_roles: missing,
    conformant: missing.length === 0,
    inviolable_breach: inviolableBreach,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Disclosure-pack readiness (§2) — double-materiality assembly
// ─────────────────────────────────────────────────────────────────────

export interface DisclosureEvidence {
  /** Stable component key, e.g. "scope_3", "beneficial_ownership", "strategy". */
  readonly component: string;
  /** Provenance ids backing the component (>=1 to count as ready). */
  readonly evidence_ids: ReadonlyArray<string>;
}

export interface DisclosurePackInput {
  readonly standard: StandardKey;
  /** Components supplied with their backing evidence. */
  readonly provided: ReadonlyArray<DisclosureEvidence>;
}

export interface DisclosurePackResult {
  readonly standard: StandardKey;
  readonly required_components: ReadonlyArray<string>;
  readonly ready_components: ReadonlyArray<string>;
  readonly missing_components: ReadonlyArray<string>;
  readonly readiness_pct: number;
  readonly publishable: boolean;
  /** Flattened, de-duplicated evidence chain across all ready components. */
  readonly evidence_chain: ReadonlyArray<string>;
}

/** Required components per disclosure standard (the assembly checklist). */
export const DISCLOSURE_COMPONENTS: Readonly<Record<StandardKey, ReadonlyArray<string>>> = {
  ICMM: ['pe_self_assessment', 'vsp_validation', 'annual_disclosure'],
  IRMA: ['self_assessment', 'independent_audit', 'achievement_level'],
  GISTM: ['consequence_classification', 'roles_register', 'principle15_disclosure', 'monitoring'],
  TSM: ['protocol_self_assessment', 'external_verification', 'ceo_letter'],
  ISSB_S1_S2: [
    'governance',
    'strategy',
    'risk_opportunity_management',
    'metrics_targets',
    'scope_1',
    'scope_2',
    'scope_3',
    'scenario_analysis',
    'transition_plan',
  ],
  GRI_14: ['impact_materiality', 'tailings_topic', 'asm_topic', 'conflict_area_topic', 'payments_to_government'],
  SASB_EM_MM: ['financial_materiality', 'industry_metrics', 'activity_metrics'],
  EITI: ['beneficial_ownership', 'contract_disclosure', 'payments_to_government', 'production_export'],
  TNFD: ['governance', 'strategy', 'risk_impact_management', 'metrics_targets', 'leap_assessment'],
  OECD_DD: ['management_system', 'risk_assessment', 'response_strategy', 'third_party_audit', 'public_report'],
  CLOSURE_IAS37: ['closure_plan', 'cost_estimate', 'ias37_provision', 'financial_assurance'],
};

/**
 * Assemble + score a single-standard disclosure pack. A component is
 * "ready" only when it carries >=1 evidence_id (evidence-required rule).
 * The pack is publishable only when every required component is ready.
 */
export function assembleDisclosurePack(input: DisclosurePackInput): DisclosurePackResult {
  const required = DISCLOSURE_COMPONENTS[input.standard] ?? [];
  const providedMap = new Map<string, ReadonlyArray<string>>();
  for (const p of input.provided) {
    const ids = (p.evidence_ids ?? []).filter((e) => e && e.trim().length > 0);
    providedMap.set(p.component, ids);
  }

  const ready: string[] = [];
  const missing: string[] = [];
  const evidenceChain = new Set<string>();
  for (const comp of required) {
    const ids = providedMap.get(comp);
    if (ids && ids.length > 0) {
      ready.push(comp);
      for (const id of ids) evidenceChain.add(id);
    } else {
      missing.push(comp);
    }
  }

  return {
    standard: input.standard,
    required_components: required,
    ready_components: ready,
    missing_components: missing,
    readiness_pct: required.length > 0 ? round1((ready.length / required.length) * 100) : 0,
    publishable: required.length > 0 && missing.length === 0,
    evidence_chain: [...evidenceChain],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Assurance-cycle scheduler (§1.1 / §1.4 — 3-year cadence) + closure
// financial-assurance shortfall (§3.1)
// ─────────────────────────────────────────────────────────────────────

/** Standard 3-year assurance cadence (ICMM self-assessment, TSM verification). */
export const TRIENNIAL_DAYS = 365 * 3;

export interface AssuranceCycleInput {
  readonly standard: StandardKey;
  /** Days since the last validation/verification (undefined = never run). */
  readonly days_since_last?: number;
  /** Cadence in days (default triennial). */
  readonly cadence_days?: number;
}

export interface AssuranceCycleResult {
  readonly standard: StandardKey;
  readonly cadence_days: number;
  readonly days_until_due: number; // negative = overdue
  readonly overdue: boolean;
  readonly never_validated: boolean;
}

export function scheduleAssuranceCycle(input: AssuranceCycleInput): AssuranceCycleResult {
  const cadence = input.cadence_days ?? TRIENNIAL_DAYS;
  const never = input.days_since_last === undefined;
  const since = input.days_since_last ?? 0;
  const daysUntilDue = never ? -cadence : cadence - since;
  return {
    standard: input.standard,
    cadence_days: cadence,
    days_until_due: daysUntilDue,
    overdue: never || daysUntilDue < 0,
    never_validated: never,
  };
}

export interface FinancialAssuranceInput {
  /** Third-party closure cost estimate (consolidated CCE). */
  readonly closure_cost_estimate: number;
  /** Financial-assurance instrument value currently posted (bond/guarantee). */
  readonly assurance_instrument_value: number;
  /** Caller-supplied currency code — NEVER hard-coded TZS/USD. */
  readonly currency_code: string;
}

export interface FinancialAssuranceResult {
  readonly currency_code: string;
  readonly closure_cost_estimate: number;
  readonly assurance_instrument_value: number;
  readonly shortfall: number;
  readonly coverage_pct: number;
  /**
   * The inviolable: rehabilitation financial assurance must ALWAYS be in
   * place and at least cover the third-party closure cost. A shortfall
   * (or zero instrument) trips this.
   */
  readonly assurance_present: boolean;
  readonly inviolable_breach: boolean;
}

/**
 * Deterministically check closure financial assurance against the
 * third-party closure cost (IAS 37 / §3.1). Any shortfall is an
 * inviolable breach — the public purse must never fund an abandoned mine.
 */
export function checkFinancialAssurance(
  input: FinancialAssuranceInput,
): FinancialAssuranceResult {
  const cce = Math.max(0, input.closure_cost_estimate);
  const instrument = Math.max(0, input.assurance_instrument_value);
  const shortfall = Math.max(0, cce - instrument);
  const coverage = cce > 0 ? round1((instrument / cce) * 100) : 100;
  const present = instrument > 0;
  return {
    currency_code: input.currency_code,
    closure_cost_estimate: cce,
    assurance_instrument_value: instrument,
    shortfall,
    coverage_pct: coverage,
    assurance_present: present,
    inviolable_breach: shortfall > 0 || !present,
  };
}

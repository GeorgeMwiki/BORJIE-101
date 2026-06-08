/**
 * Structural / civil engineering engine — PURE, deterministic limit-state
 * and TSF-surveillance math grounded in the construction dossier
 * (`Docs/research/construction-built-environment.md` §6, §7).
 *
 * This is SANITY-CHECK depth, not a substitute for a registered Engineer of
 * Record. It encodes the load-combination and utilisation arithmetic an MD
 * uses to triage a design and a tailings-dam surveillance record — flagging
 * what must go to a registered engineer — never to issue a design.
 *
 *   • §6.1 Eurocode limit-state — EN 1990 factored load combination
 *     (1.35·Gk + 1.5·Qk, persistent/transient STR), ULS/SLS utilisation
 *   • §6.2 ACI 318 — strength-design factored combination (1.2·D + 1.6·L)
 *   • §7.1 GISTM consequence classification (Low → Extreme) driving the
 *     mandatory accountability roles + monitoring intensity
 *   • §7.2 observational-method surveillance band from piezometric / phreatic
 *     and deformation readings vs trigger levels
 *
 * No I/O, no Claude, no DB. Arithmetic + rule tables only, so the GISTM
 * inviolables and structural checks are unit-testable and the LLM port can
 * narrate over verified outputs instead of confabulating safety numbers.
 */

// ─────────────────────────────────────────────────────────────────────
// §6 — Limit-state design (Eurocode EN 1990 / ACI 318)
// ─────────────────────────────────────────────────────────────────────

export type DesignCode = 'eurocode' | 'aci318';

export interface LimitStateInput {
  /** Permanent / dead characteristic action (e.g. kN or kN·m). */
  readonly permanent_action: number;
  /** Variable / live characteristic action (same unit as permanent). */
  readonly variable_action: number;
  /** Design resistance of the member/section (same unit). */
  readonly design_resistance: number;
  /** Unfactored serviceability deflection (mm). */
  readonly sls_deflection_mm: number;
  /** Allowable serviceability deflection limit, e.g. span/250 (mm). */
  readonly sls_deflection_limit_mm: number;
}

export interface LimitStateResult {
  readonly code: DesignCode;
  /** Factored design action (the demand). */
  readonly design_action: number;
  /** EN 1990 partial factors applied. */
  readonly factors: { readonly permanent: number; readonly variable: number };
  /** ULS utilisation = design_action / design_resistance. >1 fails. */
  readonly uls_utilisation: number;
  readonly uls_pass: boolean;
  /** SLS utilisation = deflection / limit. >1 fails. */
  readonly sls_utilisation: number;
  readonly sls_pass: boolean;
  readonly verdict: 'pass' | 'fail' | 'marginal';
}

// EN 1990 Eq. 6.10 STR/GEO persistent & transient (unfavourable).
const EUROCODE_GAMMA_G = 1.35;
const EUROCODE_GAMMA_Q = 1.5;
// ACI 318 §5.3 strength-design basic combination U = 1.2D + 1.6L.
const ACI_GAMMA_D = 1.2;
const ACI_GAMMA_L = 1.6;
// Above this utilisation (but <=1) a design is flagged "marginal" for EoR review.
const MARGINAL_THRESHOLD = 0.95;

/**
 * §6.1/§6.2 factored limit-state check. Returns ULS strength utilisation
 * and SLS deflection utilisation; verdict is `fail` if either limit state
 * is exceeded, `marginal` if either sits in the EoR-review band, else `pass`.
 */
export function checkLimitState(code: DesignCode, input: LimitStateInput): LimitStateResult {
  if (input.design_resistance <= 0) {
    throw new Error('structural-engine.checkLimitState: design_resistance must be > 0');
  }
  if (input.sls_deflection_limit_mm <= 0) {
    throw new Error('structural-engine.checkLimitState: sls_deflection_limit_mm must be > 0');
  }
  const factors =
    code === 'eurocode'
      ? { permanent: EUROCODE_GAMMA_G, variable: EUROCODE_GAMMA_Q }
      : { permanent: ACI_GAMMA_D, variable: ACI_GAMMA_L };

  const design_action = round3(
    input.permanent_action * factors.permanent + input.variable_action * factors.variable,
  );
  const uls_utilisation = round3(design_action / input.design_resistance);
  const sls_utilisation = round3(input.sls_deflection_mm / input.sls_deflection_limit_mm);
  const uls_pass = uls_utilisation <= 1;
  const sls_pass = sls_utilisation <= 1;

  let verdict: LimitStateResult['verdict'];
  if (!uls_pass || !sls_pass) verdict = 'fail';
  else if (uls_utilisation >= MARGINAL_THRESHOLD || sls_utilisation >= MARGINAL_THRESHOLD) verdict = 'marginal';
  else verdict = 'pass';

  return {
    code,
    design_action,
    factors,
    uls_utilisation,
    uls_pass,
    sls_utilisation,
    sls_pass,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────
// §7.1 — GISTM tailings consequence classification
// ─────────────────────────────────────────────────────────────────────

export type ConsequenceClass = 'low' | 'significant' | 'high' | 'very_high' | 'extreme';

export interface ConsequenceInput {
  /** Estimated potential loss of life downstream of a credible breach. */
  readonly potential_loss_of_life: number;
  /** Environmental / economic damage band the operator has assessed. */
  readonly damage_band: 'minor' | 'moderate' | 'major' | 'severe' | 'catastrophic';
  /** Tailings construction method — upstream is the most failure-prone (§7.2). */
  readonly construction_method: 'upstream' | 'downstream' | 'centreline';
}

export interface ConsequenceResult {
  readonly consequence_class: ConsequenceClass;
  /** Roles GISTM Topic IV mandates for this class. */
  readonly required_roles: ReadonlyArray<string>;
  /** True when the GISTM Topic IV inviolable (AE + EoR + RTFE + ITRB) applies. */
  readonly itrb_required: boolean;
  /** True when Principle-15 public disclosure is mandated. */
  readonly public_disclosure_required: boolean;
  /** Flag the post-Brumadinho liquefaction concern for upstream construction. */
  readonly upstream_method_flag: boolean;
}

const DAMAGE_RANK: Record<ConsequenceInput['damage_band'], number> = {
  minor: 0,
  moderate: 1,
  major: 2,
  severe: 3,
  catastrophic: 4,
};

/**
 * §7.1/§7.2 consequence classification. Class is driven by the WORSE of the
 * potential-loss-of-life ladder and the damage band (requirements scale with
 * the consequence of failure). Very-High / Extreme classes trip the GISTM
 * Topic-IV accountability inviolable (Accountable Executive + Engineer of
 * Record + RTFE + Independent Tailings Review Board).
 */
export function classifyConsequence(input: ConsequenceInput): ConsequenceResult {
  if (input.potential_loss_of_life < 0) {
    throw new Error('structural-engine.classifyConsequence: potential_loss_of_life must be >= 0');
  }
  const byLife: ConsequenceClass =
    input.potential_loss_of_life >= 100
      ? 'extreme'
      : input.potential_loss_of_life >= 10
        ? 'very_high'
        : input.potential_loss_of_life >= 1
          ? 'high'
          : input.potential_loss_of_life > 0
            ? 'significant'
            : 'low';

  const DAMAGE_BAND_TO_CLASS = [
    'low',
    'significant',
    'high',
    'very_high',
    'extreme',
  ] as const satisfies readonly ConsequenceClass[];
  const byDamage: ConsequenceClass = DAMAGE_BAND_TO_CLASS[DAMAGE_RANK[input.damage_band]]!;

  const consequence_class = maxClass(byLife, byDamage);
  const itrb_required = consequence_class === 'very_high' || consequence_class === 'extreme';

  const required_roles = [
    'Accountable Executive',
    'Engineer of Record (EoR)',
    'Responsible Tailings Facility Engineer (RTFE)',
    ...(itrb_required ? ['Independent Tailings Review Board (ITRB)'] : []),
  ];

  return {
    consequence_class,
    required_roles,
    itrb_required,
    public_disclosure_required: true, // GISTM Principle 15 — all facilities.
    upstream_method_flag: input.construction_method === 'upstream',
  };
}

// ─────────────────────────────────────────────────────────────────────
// §7.2 — Observational-method surveillance band
// ─────────────────────────────────────────────────────────────────────

export interface SurveillanceReading {
  readonly instrument: 'piezometer' | 'inclinometer' | 'survey_monument' | 'insar';
  readonly id: string;
  readonly value: number;
  /** Designer-set trigger (alert) level. */
  readonly trigger_level: number;
  /** Designer-set action (alarm) level — higher consequence than trigger. */
  readonly action_level: number;
}

export type SurveillanceBand = 'green' | 'amber' | 'red';

export interface SurveillanceResult {
  readonly band: SurveillanceBand;
  readonly exceedances: ReadonlyArray<{ readonly id: string; readonly band: SurveillanceBand }>;
  readonly action_required: boolean;
}

/**
 * §7.2 observational-method evaluation. Each reading is banded against its
 * designer trigger/action levels; the facility band is the WORST reading
 * (any action-level exceedance → red → EAP/EoR escalation, any trigger-level
 * exceedance → amber → increased monitoring).
 */
export function evaluateSurveillance(readings: ReadonlyArray<SurveillanceReading>): SurveillanceResult {
  if (readings.length === 0) {
    throw new Error('structural-engine.evaluateSurveillance: at least one reading required');
  }
  const exceedances = readings
    .map((r) => ({
      id: r.id,
      band: (r.value >= r.action_level ? 'red' : r.value >= r.trigger_level ? 'amber' : 'green') as SurveillanceBand,
    }))
    .filter((e) => e.band !== 'green');

  const band: SurveillanceBand = exceedances.some((e) => e.band === 'red')
    ? 'red'
    : exceedances.some((e) => e.band === 'amber')
      ? 'amber'
      : 'green';

  return { band, exceedances, action_required: band === 'red' };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const CLASS_ORDER: ReadonlyArray<ConsequenceClass> = ['low', 'significant', 'high', 'very_high', 'extreme'];

function maxClass(a: ConsequenceClass, b: ConsequenceClass): ConsequenceClass {
  return CLASS_ORDER.indexOf(a) >= CLASS_ORDER.indexOf(b) ? a : b;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/**
 * Safety / HSE metrics — DETERMINISTIC injury-frequency + ICMM Critical
 * Control Management (CCM) verification math.
 *
 * Pure, side-effect-free functions implementing the licence-to-operate
 * safety discipline from `Docs/research/mining-esg-compliance.md`:
 *   - ICMM Mining Principle 5 (§1.1): "pursue continual improvement and
 *     ultimately the ELIMINATION of fatalities, injuries and occupational
 *     disease" — HSE is a hard constraint, not a tradeable KPI.
 *   - ICMM Critical Control Management (CCM) + bowtie (§5 codebase map):
 *     a Critical Control is the LAST line of defence against a Material
 *     Unwanted Event (MUE). Each control needs a named owner, a defined
 *     performance standard, and FIELD verification at the required
 *     frequency; a control whose verification has lapsed or last failed
 *     is "unverified"/"failed" — not "effective".
 *
 * Injury-frequency rates use the industry-standard "per million hours
 * worked" convention (ICMM / OSHA / TSM Safety & Health protocol):
 *   - TRIFR = Total Recordable Injuries × 1,000,000 / hours worked
 *   - LTIFR = Lost-Time Injuries     × 1,000,000 / hours worked
 *   - Fatality rate = fatalities     × 1,000,000 / hours worked
 *
 * "Recordable" = medical-treatment + restricted-work + lost-time +
 * fatality (NOT first-aid, NOT near-miss). The workforce-hours
 * denominator ties safety to the workforce pillar (CAPABILITY_SPEC_WAVE3
 * "tie workforce hours to the TRIFR denominator").
 *
 * SAFETY NOTE: these functions only MEASURE and FLAG. They never issue
 * PPE, sign a blast permit, or clear a critical control — the safety-agent
 * is monitoring + alerting only; field verification and sign-off route to
 * a named human accountable executive (GISTM Principle 10).
 *
 * Currency-agnostic + locale-agnostic: no money, no user-facing strings
 * that must be translated — callers render EN/SW.
 */

// ─────────────────────────────────────────────────────────────────────
// Per-million-hours convention
// ─────────────────────────────────────────────────────────────────────

/** Industry standard exposure base: rates are "per million hours worked". */
export const FREQUENCY_BASE_HOURS = 1_000_000;

/**
 * Incident kinds that count as RECORDABLE for TRIFR (ICMM/OSHA-aligned).
 * first_aid, near_miss, environmental_release and property_damage are
 * tracked but are NOT recordable injuries.
 */
export const RECORDABLE_KINDS: ReadonlyArray<string> = [
  'medical_treatment',
  'restricted_work',
  'lost_time_injury',
  'fatality',
];

/** Incident kinds that count as LOST-TIME for LTIFR. */
export const LOST_TIME_KINDS: ReadonlyArray<string> = ['lost_time_injury', 'fatality'];

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

export interface InjuryCounts {
  readonly first_aid: number;
  readonly medical_treatment: number;
  readonly restricted_work: number;
  readonly lost_time_injury: number;
  readonly fatality: number;
  readonly near_miss: number;
}

export interface FrequencyInputs {
  readonly injuries: InjuryCounts;
  /** Actual hours worked over the reporting window (the TRIFR denominator). */
  readonly hours_worked: number;
  /** Optional prior-period rates to compute trend direction. */
  readonly prior_trifr?: number;
  readonly prior_ltifr?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Outputs
// ─────────────────────────────────────────────────────────────────────

export type RateTrend = 'improving' | 'worsening' | 'flat' | 'no_baseline';

export interface FrequencyRates {
  readonly hours_worked: number;
  readonly recordable_count: number;
  readonly lost_time_count: number;
  readonly fatality_count: number;
  readonly trifr: number;
  readonly ltifr: number;
  readonly fatality_rate: number;
  readonly trifr_trend: RateTrend;
  readonly ltifr_trend: RateTrend;
  /** Zero fatalities is the ICMM Principle-5 hard line; any fatality trips this. */
  readonly fatality_free: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nonNeg(n: number): number {
  return n < 0 || !Number.isFinite(n) ? 0 : n;
}

function ratePerMillion(count: number, hoursWorked: number): number {
  if (hoursWorked <= 0) return 0;
  return round2((count * FREQUENCY_BASE_HOURS) / hoursWorked);
}

function trendOf(current: number, prior: number | undefined): RateTrend {
  if (prior === undefined) return 'no_baseline';
  const delta = current - prior;
  if (Math.abs(delta) < 0.01) return 'flat';
  // Lower frequency is better, so a fall is "improving".
  return delta < 0 ? 'improving' : 'worsening';
}

// ─────────────────────────────────────────────────────────────────────
// Engine 1 — DETERMINISTIC injury-frequency rates
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute TRIFR / LTIFR / fatality-rate per the per-million-hours
 * convention. Counts are clamped non-negative; division by zero hours
 * yields a 0 rate (no exposure recorded) rather than NaN.
 */
export function computeFrequencyRates(input: FrequencyInputs): FrequencyRates {
  const inj = input.injuries;
  const recordable =
    nonNeg(inj.medical_treatment) +
    nonNeg(inj.restricted_work) +
    nonNeg(inj.lost_time_injury) +
    nonNeg(inj.fatality);
  const lostTime = nonNeg(inj.lost_time_injury) + nonNeg(inj.fatality);
  const fatalities = nonNeg(inj.fatality);
  const hours = nonNeg(input.hours_worked);

  const trifr = ratePerMillion(recordable, hours);
  const ltifr = ratePerMillion(lostTime, hours);
  const fatalityRate = ratePerMillion(fatalities, hours);

  return {
    hours_worked: hours,
    recordable_count: recordable,
    lost_time_count: lostTime,
    fatality_count: fatalities,
    trifr,
    ltifr,
    fatality_rate: fatalityRate,
    trifr_trend: trendOf(trifr, input.prior_trifr),
    ltifr_trend: trendOf(ltifr, input.prior_ltifr),
    fatality_free: fatalities === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Engine 2 — ICMM Critical Control verification (CCM bowtie)
// ─────────────────────────────────────────────────────────────────────

/**
 * A single critical control on the register. Each control protects
 * against one or more Material Unwanted Events (MUEs) and must be
 * field-verified at a defined frequency by a named owner.
 */
export interface CriticalControlRecord {
  readonly control_id: string;
  readonly control: string;
  /** The Material Unwanted Event this control guards against. */
  readonly mue: string;
  /** Named accountable owner (ICMM CCM requires named ownership). */
  readonly owner?: string;
  /** Days between required field verifications (the performance standard). */
  readonly verification_interval_days: number;
  /** Days since the control was last field-verified (undefined = never). */
  readonly days_since_last_verification?: number;
  /** Whether the last field verification found the control effective. */
  readonly last_verification_passed?: boolean;
}

export type ControlStatus = 'effective' | 'degraded' | 'failed' | 'unverified';

export interface ControlVerification {
  readonly control_id: string;
  readonly control: string;
  readonly mue: string;
  readonly status: ControlStatus;
  readonly overdue: boolean;
  readonly owner_assigned: boolean;
  readonly reason: string;
}

export interface CriticalControlAssessment {
  readonly controls: ReadonlyArray<ControlVerification>;
  readonly total: number;
  readonly effective: number;
  readonly failed_control_ids: ReadonlyArray<string>;
  readonly overdue_control_ids: ReadonlyArray<string>;
  readonly unowned_control_ids: ReadonlyArray<string>;
  /** MUEs whose every guarding control is failed/unverified — top risk. */
  readonly exposed_mues: ReadonlyArray<string>;
  readonly any_failed: boolean;
}

/**
 * Grade a single critical control. Precedence (worst wins):
 *   1. last verification FAILED            -> 'failed'
 *   2. never verified, or verification overdue -> 'unverified'/'degraded'
 *   3. passed and in-date                   -> 'effective'
 *
 * "overdue" = days_since_last_verification > verification_interval_days.
 * A never-verified control is 'unverified' (cannot claim effectiveness
 * with no field evidence — CCM requires verification, not assertion).
 */
export function verifyCriticalControl(c: CriticalControlRecord): ControlVerification {
  const ownerAssigned = Boolean(c.owner && c.owner.trim().length > 0);
  const interval = nonNeg(c.verification_interval_days);
  const since = c.days_since_last_verification;
  const neverVerified = since === undefined;
  const overdue = !neverVerified && interval > 0 && (since as number) > interval;

  let status: ControlStatus;
  let reason: string;
  if (c.last_verification_passed === false) {
    status = 'failed';
    reason = 'last field verification found the control NOT effective';
  } else if (neverVerified) {
    status = 'unverified';
    reason = 'control has never been field-verified — effectiveness cannot be asserted';
  } else if (overdue) {
    // In-date pass would be effective; an overdue pass decays to degraded.
    status = 'degraded';
    reason = `verification overdue by ${(since as number) - interval} day(s) past the ${interval}-day standard`;
  } else {
    status = 'effective';
    reason = `field-verified ${since} day(s) ago within the ${interval}-day standard`;
  }

  return {
    control_id: c.control_id,
    control: c.control,
    mue: c.mue,
    status,
    overdue,
    owner_assigned: ownerAssigned,
    reason: ownerAssigned ? reason : `${reason}; NO named owner assigned (ICMM CCM violation)`,
  };
}

/**
 * Assess the whole critical-control register. Surfaces failed controls,
 * overdue verifications, unowned controls, and "exposed MUEs" — Material
 * Unwanted Events for which NO guarding control is currently effective
 * (the highest-priority field-verification target).
 */
export function assessCriticalControls(
  records: ReadonlyArray<CriticalControlRecord>,
): CriticalControlAssessment {
  const controls = records.map(verifyCriticalControl);

  const failed = controls.filter((c) => c.status === 'failed').map((c) => c.control_id);
  const overdue = controls.filter((c) => c.overdue).map((c) => c.control_id);
  const unowned = controls.filter((c) => !c.owner_assigned).map((c) => c.control_id);
  const effective = controls.filter((c) => c.status === 'effective').length;

  // Group by MUE; an MUE is "exposed" when none of its controls is effective.
  const byMue = new Map<string, ControlVerification[]>();
  for (const c of controls) {
    const list = byMue.get(c.mue) ?? [];
    list.push(c);
    byMue.set(c.mue, list);
  }
  const exposedMues: string[] = [];
  for (const [mue, list] of byMue) {
    if (list.length > 0 && list.every((c) => c.status !== 'effective')) {
      exposedMues.push(mue);
    }
  }

  return {
    controls,
    total: controls.length,
    effective,
    failed_control_ids: failed,
    overdue_control_ids: overdue,
    unowned_control_ids: unowned,
    exposed_mues: exposedMues,
    any_failed: failed.length > 0,
  };
}

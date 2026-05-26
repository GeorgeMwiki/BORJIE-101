/**
 * Scorer — pure given a clock + measurement port + template.
 *
 * Determinism is load-bearing: the same (date, employee,
 * measurements) tuple MUST produce the same scorecard. Spec §4.
 *
 * The scorer:
 *   1. Reads each KPI's raw value via the measurement port.
 *   2. Maps to a band via `bandFor` (canonical 5-band scale).
 *   3. Sums weighted contributions clamped to [0, 1].
 *   4. Captures anomalies / streaks into the signals jsonb.
 */

import type {
  EmployeeScorecard,
  Kpi,
  KpiDirection,
  KpiMeasurementPort,
  KpiResult,
  RoleKpiTemplate,
} from '../types.js';

export interface ScoreInput {
  readonly tenant_id: string;
  readonly employee_user_id: string;
  readonly role: string;
  readonly date: string;
  readonly template: RoleKpiTemplate;
  /** Optional previous scorecard for streak detection + prev_hash. */
  readonly prior?: EmployeeScorecard | null | undefined;
}

export interface ScoreDeps {
  readonly measurementPort: KpiMeasurementPort;
  readonly now: () => Date;
  /** Hash function — production wires SHA-256; tests use a stable stub. */
  readonly hash: (payload: Readonly<Record<string, unknown>>) => string;
  /** UUID generator — production wires `crypto.randomUUID`. */
  readonly newId: () => string;
}

/**
 * Map a raw measurement onto the canonical 5-band scale per
 * direction. The thresholds are:
 *
 *   higher_is_better : raw / target ratio → band
 *     ≥1.10 → 1.0     (best in class)
 *     ≥1.00 → 0.9     (exceeded)
 *     ≥0.95 → 0.7     (on target)
 *     ≥0.80 → 0.4     (below)
 *     <0.80 → 0.0     (missed)
 *
 *   lower_is_better  : raw / target ratio → band
 *     ≤0.50 → 1.0     (best in class)
 *     ≤1.00 → 0.9     (exceeded)
 *     ≤1.05 → 0.7     (on target)
 *     ≤1.20 → 0.4     (below)
 *     >1.20 → 0.0     (missed)
 *
 *   binary_target    : raw ≥ target → 1.0 ; else 0.0
 */
export function bandFor(
  raw: number,
  target: number,
  direction: KpiDirection,
): number {
  if (direction === 'binary_target') {
    return raw >= target ? 1.0 : 0.0;
  }
  if (target === 0) {
    // Avoid divide-by-zero. For lower_is_better with target=0 (e.g.
    // safety incidents), treat raw>0 as the missed band.
    if (direction === 'lower_is_better') {
      if (raw === 0) return 1.0;
      if (raw === 1) return 0.4;
      return 0.0;
    }
    return raw > 0 ? 1.0 : 0.0;
  }
  const ratio = raw / target;
  if (direction === 'higher_is_better') {
    if (ratio >= 1.1) return 1.0;
    if (ratio >= 1.0) return 0.9;
    if (ratio >= 0.95) return 0.7;
    if (ratio >= 0.8) return 0.4;
    return 0.0;
  }
  // lower_is_better
  if (ratio <= 0.5) return 1.0;
  if (ratio <= 1.0) return 0.9;
  if (ratio <= 1.05) return 0.7;
  if (ratio <= 1.2) return 0.4;
  return 0.0;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Compute a single KPI result. Pure. */
export async function scoreKpi(
  kpi: Kpi,
  measurementPort: KpiMeasurementPort,
  input: { tenant_id: string; employee_user_id: string; date: string },
): Promise<KpiResult> {
  const raw = await measurementPort.measure({
    tenant_id: input.tenant_id,
    employee_user_id: input.employee_user_id,
    date: input.date,
    measure_fn_name: kpi.measure_fn_name,
  });
  const band = bandFor(raw, kpi.target, kpi.direction);
  const contribution = kpi.weight * band;
  return {
    kpi_id: kpi.id,
    raw,
    band,
    contribution,
  };
}

interface SignalsBag {
  readonly anomalies: string[];
  readonly streak_days: number;
  readonly day_over_day_delta: number | null;
}

function buildSignals(
  kpiResults: ReadonlyArray<KpiResult>,
  prior: EmployeeScorecard | null | undefined,
  overall: number,
): SignalsBag {
  const anomalies: string[] = [];
  // A missed (band=0) KPI is always an anomaly.
  for (const r of kpiResults) {
    if (r.band === 0) {
      anomalies.push(`kpi_missed:${r.kpi_id}`);
    }
    if (r.band === 1.0) {
      anomalies.push(`kpi_best_in_class:${r.kpi_id}`);
    }
  }
  let streak = 0;
  let delta: number | null = null;
  if (prior) {
    delta = overall - prior.overall_score;
    if (Math.abs(delta) >= 0.2) {
      anomalies.push(
        delta > 0 ? 'jump_up_20pct' : 'jump_down_20pct',
      );
    }
    // Streak counter — increment if both are at/above on-target.
    const ON_TARGET_FLOOR = 0.7;
    if (overall >= ON_TARGET_FLOOR && prior.overall_score >= ON_TARGET_FLOOR) {
      const priorSignals = prior.signals as { streak_days?: number };
      const priorStreak =
        typeof priorSignals.streak_days === 'number'
          ? priorSignals.streak_days
          : 0;
      streak = priorStreak + 1;
    } else if (overall >= ON_TARGET_FLOOR) {
      streak = 1;
    }
  } else if (overall >= 0.7) {
    streak = 1;
  }
  return { anomalies, streak_days: streak, day_over_day_delta: delta };
}

/**
 * Compute a complete `EmployeeScorecard`. Validates template weights
 * sum to 1.0 by construction (callers should pre-validate via
 * `validateRoleTemplate`).
 */
export async function computeScorecard(
  input: ScoreInput,
  deps: ScoreDeps,
): Promise<EmployeeScorecard> {
  const kpiResults: KpiResult[] = [];
  for (const kpi of input.template.kpi_definitions) {
    const r = await scoreKpi(kpi, deps.measurementPort, {
      tenant_id: input.tenant_id,
      employee_user_id: input.employee_user_id,
      date: input.date,
    });
    kpiResults.push(r);
  }
  const overall = clamp01(
    kpiResults.reduce((sum, r) => sum + r.contribution, 0),
  );
  const signals = buildSignals(kpiResults, input.prior ?? null, overall);
  const id = deps.newId();
  const prev_hash = input.prior?.audit_hash ?? '';
  const auditPayload = {
    kind: 'employee_scorecard',
    tenant_id: input.tenant_id,
    employee_user_id: input.employee_user_id,
    date: input.date,
    role: input.role,
    overall_score: overall,
    kpis: kpiResults,
    signals,
    prev_hash,
  };
  const audit_hash = deps.hash(auditPayload);
  const created_at = deps.now().toISOString();
  const card: EmployeeScorecard = {
    id,
    tenant_id: input.tenant_id,
    employee_user_id: input.employee_user_id,
    date: input.date,
    role: input.role,
    kpis: kpiResults,
    overall_score: overall,
    signals: {
      anomalies: signals.anomalies,
      streak_days: signals.streak_days,
      day_over_day_delta: signals.day_over_day_delta,
    },
    prev_hash,
    audit_hash,
    created_at,
  };
  return card;
}

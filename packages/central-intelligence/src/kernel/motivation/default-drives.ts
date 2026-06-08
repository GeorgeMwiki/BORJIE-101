/**
 * The six standing estate DRIVES + their pure satisfaction evaluators.
 *
 * Each evaluator reads the activated situational snapshot, inspects the
 * relevant entity kind's domain attributes (e.g. a `cash` entity's
 * `runwayDays`, a `licence` entity's `renewalInDays`), and returns a
 * {@link DriveAssessment}. When a standing concern is breached the assessment
 * is `satisfied:false` and carries the breaching entities as evidence.
 *
 * Domain attribute contract (written by the loop's PERCEIVE step / sensors):
 *   cash      → { runwayDays: number }
 *   licence   → { renewalInDays: number }            (days until renewal due)
 *   safety    → site/equipment entity { openIncidents: number }
 *   offtake   → counterparty/site { offtakeCoverageRatio: number }  (0..1+)
 *   arrears   → { overdueDays: number }               (royalty/receivable age)
 *   equipment → { healthScore: number }               (0..1, 1 = healthy)
 *
 * Missing attributes mean "no signal" → the drive is SATISFIED for that
 * entity (we never raise a concern from absent data — that would spam the
 * owner). Pure + total: no throws, deterministic.
 */

import type { ActivatedEntity, SituationalSnapshot } from '../situational-model/types.js';
import type {
  Drive,
  DriveAssessment,
  DriveThresholds,
  DriveUrgency,
} from './types.js';

/** Built-in default thresholds (tenant config overrides each). */
export const DEFAULT_DRIVE_THRESHOLDS: Required<DriveThresholds> = Object.freeze({
  cashRunwayDaysFloor: 30,
  licenceRenewalDaysFloor: 30,
  safetyOpenIncidentsCeiling: 0,
  offtakeCoverageRatioFloor: 0.8,
  royaltyOverdueDaysCeiling: 0,
  equipmentHealthScoreFloor: 0.5,
});

function num(entity: ActivatedEntity, key: string): number | null {
  const v = entity.entity.attributes[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function ofKind(
  snapshot: SituationalSnapshot,
  kind: ActivatedEntity['entity']['kind'],
): ReadonlyArray<ActivatedEntity> {
  return snapshot.entities.filter((e) => e.entity.kind === kind);
}

/** Map a [0,1] breach severity to a coarse urgency band. */
function urgencyFor(severity: number): DriveUrgency {
  if (severity >= 0.75) return 'critical';
  if (severity >= 0.5) return 'high';
  if (severity >= 0.25) return 'medium';
  return 'low';
}

function satisfied(driveId: DriveAssessment['driveId']): DriveAssessment {
  return {
    driveId,
    satisfied: true,
    breachSeverity: 0,
    urgency: 'low',
    summary: 'within tolerance',
    evidence: [],
  };
}

// ── cash-runway ──────────────────────────────────────────────────────────
// Concern: cash never breaks. Breached when any cash entity's runwayDays is
// below the floor. Severity scales with how deep below the floor we are.
export const CASH_RUNWAY_DRIVE: Drive = {
  id: 'cash-runway',
  description: 'Cash runway must stay above the configured floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.cashRunwayDaysFloor ?? DEFAULT_DRIVE_THRESHOLDS.cashRunwayDaysFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'cash')) {
      const runway = num(e, 'runwayDays');
      if (runway === null || runway >= floor) continue;
      breaching.push(e);
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - runway) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('cash-runway');
    return {
      driveId: 'cash-runway',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `cash runway below ${floor}-day floor`,
      evidence: breaching,
    };
  },
};

// ── licence-currency ─────────────────────────────────────────────────────
// Concern: the licence never lapses. Breached when a licence's renewalInDays
// is below the lead-time floor (act before the breach, Endsley L3).
export const LICENCE_CURRENCY_DRIVE: Drive = {
  id: 'licence-currency',
  description: 'Every licence must be renewed before its lead-time floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.licenceRenewalDaysFloor ?? DEFAULT_DRIVE_THRESHOLDS.licenceRenewalDaysFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'licence')) {
      const days = num(e, 'renewalInDays');
      if (days === null || days > floor) continue;
      breaching.push(e);
      // Below floor → severity grows as the renewal date approaches/passes.
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - days) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('licence-currency');
    return {
      driveId: 'licence-currency',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `licence renewal within ${floor}-day lead time`,
      evidence: breaching,
    };
  },
};

// ── safety ───────────────────────────────────────────────────────────────
// Concern: the workforce is safe. Breached when open safety incidents on any
// site/equipment exceed the ceiling (default 0 → any open incident breaches).
export const SAFETY_DRIVE: Drive = {
  id: 'safety',
  description: 'Open safety incidents must not exceed the ceiling.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const ceiling = thresholds.safetyOpenIncidentsCeiling ?? DEFAULT_DRIVE_THRESHOLDS.safetyOpenIncidentsCeiling;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of [...ofKind(snapshot, 'site'), ...ofKind(snapshot, 'equipment')]) {
      const open = num(e, 'openIncidents');
      if (open === null || open <= ceiling) continue;
      breaching.push(e);
      // Severity saturates: 1 incident over → 0.5, 3+ over → 1.
      const over = open - ceiling;
      worst = Math.max(worst, Math.min(1, 0.5 + (over - 1) * 0.25));
    }
    if (breaching.length === 0) return satisfied('safety');
    return {
      driveId: 'safety',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `open safety incidents above ${ceiling}`,
      evidence: breaching,
    };
  },
};

// ── offtake-coverage ─────────────────────────────────────────────────────
// Concern: production is sold. Breached when a counterparty/site's offtake
// coverage ratio falls below the floor (uncovered tonnes pile up).
export const OFFTAKE_COVERAGE_DRIVE: Drive = {
  id: 'offtake-coverage',
  description: 'Off-take coverage ratio must stay above the floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.offtakeCoverageRatioFloor ?? DEFAULT_DRIVE_THRESHOLDS.offtakeCoverageRatioFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of [...ofKind(snapshot, 'counterparty'), ...ofKind(snapshot, 'site')]) {
      const ratio = num(e, 'offtakeCoverageRatio');
      if (ratio === null || ratio >= floor) continue;
      breaching.push(e);
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - ratio) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('offtake-coverage');
    return {
      driveId: 'offtake-coverage',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `off-take coverage below ${floor}`,
      evidence: breaching,
    };
  },
};

// ── royalty-currency ─────────────────────────────────────────────────────
// Concern: royalty/receivables stay current. Breached when an arrears
// position's overdueDays exceeds the ceiling.
export const ROYALTY_CURRENCY_DRIVE: Drive = {
  id: 'royalty-currency',
  description: 'Royalty / receivables must not exceed the overdue ceiling.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const ceiling = thresholds.royaltyOverdueDaysCeiling ?? DEFAULT_DRIVE_THRESHOLDS.royaltyOverdueDaysCeiling;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'arrears')) {
      const overdue = num(e, 'overdueDays');
      if (overdue === null || overdue <= ceiling) continue;
      breaching.push(e);
      // 30d over ceiling → ~0.5; 90d+ → 1.
      const over = overdue - ceiling;
      worst = Math.max(worst, Math.min(1, over / 90));
    }
    if (breaching.length === 0) return satisfied('royalty-currency');
    return {
      driveId: 'royalty-currency',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `overdue royalty/receivables above ${ceiling}-day ceiling`,
      evidence: breaching,
    };
  },
};

// ── equipment-health ─────────────────────────────────────────────────────
// Concern: equipment doesn't silently rot. Breached when an asset's health
// score falls below the floor.
export const EQUIPMENT_HEALTH_DRIVE: Drive = {
  id: 'equipment-health',
  description: 'Equipment health score must stay above the floor.',
  evaluate(snapshot, thresholds): DriveAssessment {
    const floor = thresholds.equipmentHealthScoreFloor ?? DEFAULT_DRIVE_THRESHOLDS.equipmentHealthScoreFloor;
    const breaching: ActivatedEntity[] = [];
    let worst = 0;
    for (const e of ofKind(snapshot, 'equipment')) {
      const health = num(e, 'healthScore');
      if (health === null || health >= floor) continue;
      breaching.push(e);
      const severity = floor <= 0 ? 1 : Math.min(1, (floor - health) / floor);
      worst = Math.max(worst, severity);
    }
    if (breaching.length === 0) return satisfied('equipment-health');
    return {
      driveId: 'equipment-health',
      satisfied: false,
      breachSeverity: worst,
      urgency: urgencyFor(worst),
      summary: `equipment health below ${floor}`,
      evidence: breaching,
    };
  },
};

/** The full default drive set, in evaluation order. */
export const DEFAULT_DRIVES: ReadonlyArray<Drive> = Object.freeze([
  CASH_RUNWAY_DRIVE,
  LICENCE_CURRENCY_DRIVE,
  SAFETY_DRIVE,
  OFFTAKE_COVERAGE_DRIVE,
  ROYALTY_CURRENCY_DRIVE,
  EQUIPMENT_HEALTH_DRIVE,
]);

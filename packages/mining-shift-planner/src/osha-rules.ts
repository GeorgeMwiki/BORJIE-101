/**
 * OSHA-TZ rule set for mining shifts.
 *
 * The actual jurisdictional rulebook lives in
 * `@borjie/regulatory-tz-mining`, which currently ships NEMC,
 * TUMEMADINI, BOT, TRA, and GEPG. OSHA-TZ ruleset will land there in a
 * later wave; until then we encode the safety floor here. Override
 * values can be supplied via `OshaRulebookPort.fetchOverrides`.
 *
 * Rules encoded:
 *   R1. Max 12-hour shift, min 10h rest between shifts.
 *   R2. Max 6 consecutive working days, then 24h rest.
 *   R3. Underground workers: max 48h/week, hazard rotation every 4h.
 *   R4. Mandatory pre-shift safety briefing logged within last 24h.
 *   R5. Heat-stress rotation when surface ambient > 35°C.
 */

import type {
  ComplianceReport,
  OshaRuleResult,
  Severity,
  ShiftPlan,
  ShiftRequest,
  Worker,
  WorkShiftRecord,
} from './types.js';

export interface OshaThresholds {
  readonly maxShiftHours: number;
  readonly minRestHours: number;
  readonly maxConsecutiveDays: number;
  readonly undergroundMaxWeeklyHours: number;
  readonly hazardRotationHours: number;
  readonly heatStressTempC: number;
  readonly safetyBriefingMaxAgeHours: number;
}

export const DEFAULT_OSHA_THRESHOLDS: OshaThresholds = {
  maxShiftHours: 12,
  minRestHours: 10,
  maxConsecutiveDays: 6,
  undergroundMaxWeeklyHours: 48,
  hazardRotationHours: 4,
  heatStressTempC: 35,
  safetyBriefingMaxAgeHours: 24,
};

const HOUR_MS = 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────

function hoursBetween(startISO: string, endISO: string): number {
  return Math.max(
    0,
    (new Date(endISO).getTime() - new Date(startISO).getTime()) / HOUR_MS,
  );
}

function hoursOfShift(shift: WorkShiftRecord): number {
  return hoursBetween(shift.startISO, shift.endISO);
}

function consecutiveWorkDays(shifts: ReadonlyArray<WorkShiftRecord>): number {
  if (shifts.length === 0) return 0;
  const dayKeys = new Set(
    shifts.map((s) => new Date(s.startISO).toISOString().slice(0, 10)),
  );
  const sorted = [...dayKeys].sort();
  let max = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    const dayDiff =
      (new Date(curr).getTime() - new Date(prev).getTime()) / (24 * HOUR_MS);
    if (Math.round(dayDiff) === 1) {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 1;
    }
  }
  return max;
}

function hoursInWindow(
  shifts: ReadonlyArray<WorkShiftRecord>,
  windowEndISO: string,
  windowHours: number,
): number {
  const end = new Date(windowEndISO).getTime();
  const start = end - windowHours * HOUR_MS;
  return shifts.reduce((sum, s) => {
    const sStart = new Date(s.startISO).getTime();
    const sEnd = new Date(s.endISO).getTime();
    if (sEnd <= start || sStart >= end) return sum;
    const clampedStart = Math.max(sStart, start);
    const clampedEnd = Math.min(sEnd, end);
    return sum + Math.max(0, (clampedEnd - clampedStart) / HOUR_MS);
  }, 0);
}

// ─── Individual rule checks ─────────────────────────────────────────

function checkShiftLengthAndRest(
  request: ShiftRequest,
  thresholds: OshaThresholds,
): OshaRuleResult {
  const violatingWorkerIds: string[] = [];
  if (request.durationHours > thresholds.maxShiftHours) {
    // Whole-plan violation — every worker is affected.
    for (const w of request.workers) violatingWorkerIds.push(w.id);
  }
  // Rest-between-shifts: check each worker's last recorded shift end.
  for (const worker of request.workers) {
    const lastEnd = worker.last72hShifts
      .map((s) => s.endISO)
      .sort()
      .pop();
    if (!lastEnd) continue;
    const restHours = hoursBetween(lastEnd, request.shiftStartISO);
    if (restHours < thresholds.minRestHours) {
      violatingWorkerIds.push(worker.id);
    }
  }
  const pass = violatingWorkerIds.length === 0;
  return {
    ruleId: 'osha-tz-r1',
    ruleLabel: `Max ${thresholds.maxShiftHours}h shift + min ${thresholds.minRestHours}h rest`,
    pass,
    severity: pass ? 'info' : 'high',
    affectedWorkerIds: Array.from(new Set(violatingWorkerIds)),
    detail: pass
      ? 'All workers cleared shift-length + rest rule.'
      : `${violatingWorkerIds.length} worker(s) failed shift-length or rest minimum.`,
  };
}

function checkConsecutiveDays(
  request: ShiftRequest,
  thresholds: OshaThresholds,
): OshaRuleResult {
  const violators: string[] = [];
  for (const worker of request.workers) {
    if (consecutiveWorkDays(worker.last72hShifts) >= thresholds.maxConsecutiveDays) {
      violators.push(worker.id);
    }
  }
  const pass = violators.length === 0;
  return {
    ruleId: 'osha-tz-r2',
    ruleLabel: `Max ${thresholds.maxConsecutiveDays} consecutive working days`,
    pass,
    severity: pass ? 'info' : 'high',
    affectedWorkerIds: violators,
    detail: pass
      ? 'No workers exceed consecutive-day cap.'
      : `${violators.length} worker(s) require a 24h rest day.`,
  };
}

function checkUndergroundWeeklyHours(
  request: ShiftRequest,
  thresholds: OshaThresholds,
): OshaRuleResult {
  // Underground if any task this shift is underground or if past
  // shifts include underground zone.
  const violators: string[] = [];
  for (const worker of request.workers) {
    const undergroundHours = worker.last72hShifts
      .filter((s) => s.zone === 'underground')
      .reduce((sum, s) => sum + hoursOfShift(s), 0);
    // Approximate weekly hours = last72h * (168/72).
    const weeklyEstimate = (undergroundHours / 72) * 168;
    if (weeklyEstimate > thresholds.undergroundMaxWeeklyHours) {
      violators.push(worker.id);
    }
  }
  const pass = violators.length === 0;
  return {
    ruleId: 'osha-tz-r3a',
    ruleLabel: `Underground max ${thresholds.undergroundMaxWeeklyHours}h/week`,
    pass,
    severity: pass ? 'info' : 'high',
    affectedWorkerIds: violators,
    detail: pass
      ? 'No underground worker exceeds the weekly cap.'
      : `${violators.length} underground worker(s) over weekly cap.`,
  };
}

function checkSafetyBriefing(
  request: ShiftRequest,
  thresholds: OshaThresholds,
): OshaRuleResult {
  const violators: string[] = [];
  for (const worker of request.workers) {
    if (!worker.lastSafetyBriefingISO) {
      violators.push(worker.id);
      continue;
    }
    const ageHours = hoursBetween(
      worker.lastSafetyBriefingISO,
      request.shiftStartISO,
    );
    if (ageHours > thresholds.safetyBriefingMaxAgeHours) {
      violators.push(worker.id);
    }
  }
  const pass = violators.length === 0;
  return {
    ruleId: 'osha-tz-r4',
    ruleLabel: 'Mandatory pre-shift safety briefing logged',
    pass,
    severity: pass ? 'info' : 'critical',
    affectedWorkerIds: violators,
    detail: pass
      ? 'All workers have a current safety briefing on record.'
      : `${violators.length} worker(s) lack a current safety briefing.`,
  };
}

function checkHeatStress(
  request: ShiftRequest,
  thresholds: OshaThresholds,
): OshaRuleResult {
  // Heat-stress applies when ambient > threshold AND at least one
  // surface-pit task is present.
  const hasSurface = request.tasks.some((t) => t.zone === 'surface-pit');
  const overTemp = request.ambientTemperatureC > thresholds.heatStressTempC;
  const requiresRotation = hasSurface && overTemp;
  return {
    ruleId: 'osha-tz-r5',
    ruleLabel: `Heat-stress rotation when ambient > ${thresholds.heatStressTempC}°C`,
    pass: !requiresRotation
      ? true
      : request.workers.length >= 2, // need at least two workers to rotate.
    severity: requiresRotation && request.workers.length < 2 ? 'high' : 'info',
    affectedWorkerIds: requiresRotation
      ? request.workers.map((w) => w.id)
      : [],
    detail: requiresRotation
      ? `Ambient ${request.ambientTemperatureC}°C — surface-pit teams must rotate.`
      : 'Heat-stress rotation not required.',
  };
}

// ─── Aggregator ─────────────────────────────────────────────────────

export function evaluateOshaRules(
  request: ShiftRequest,
  thresholds: OshaThresholds = DEFAULT_OSHA_THRESHOLDS,
): ReadonlyArray<OshaRuleResult> {
  return [
    checkShiftLengthAndRest(request, thresholds),
    checkConsecutiveDays(request, thresholds),
    checkUndergroundWeeklyHours(request, thresholds),
    checkSafetyBriefing(request, thresholds),
    checkHeatStress(request, thresholds),
  ];
}

/**
 * Evaluate compliance of a finalized plan (combines request + plan
 * outputs). Used by `validateOshaCompliance`.
 */
export function buildComplianceReport(
  request: ShiftRequest,
  _plan: ShiftPlan | null,
  thresholds: OshaThresholds = DEFAULT_OSHA_THRESHOLDS,
): ComplianceReport {
  const results = evaluateOshaRules(request, thresholds);
  const blockers: string[] = [];
  for (const r of results) {
    if (!r.pass && (r.severity === 'critical' || r.severity === 'high')) {
      blockers.push(`${r.ruleId}: ${r.detail}`);
    }
  }
  return {
    tenantId: request.tenantId,
    siteId: request.siteId,
    shiftStartISO: request.shiftStartISO,
    pass: blockers.length === 0,
    results: results.map((r) => ({ ...r })),
    blockingFailures: blockers,
  };
}

// Re-export severity type for convenience.
export type { Severity };

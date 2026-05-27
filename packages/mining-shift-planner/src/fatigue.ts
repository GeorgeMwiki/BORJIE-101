/**
 * Fatigue scoring.
 *
 * Combines four signals into a 0..1 risk score:
 *   - hours worked last 24h (weight 40%)
 *   - hours worked last 72h (weight 25%)
 *   - consecutive working days (weight 20%)
 *   - elapsed rest since last shift (weight 15%)
 *
 * `recommendedMaxHours` is a soft cap that ramps from 12h at score 0
 * down to 4h at score 1.
 */

import type { FatigueScore, Worker, WorkShiftRecord } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const WEIGHTS = {
  last24h: 0.4,
  last72h: 0.25,
  consecutive: 0.2,
  rest: 0.15,
} as const;

const SOFT_CAPS = {
  /** 24h-hours triggering full-weight contribution. */
  last24h: 14,
  /** 72h-hours triggering full-weight contribution. */
  last72h: 36,
  /** Consecutive days triggering full-weight. */
  consecutiveDays: 7,
  /** Hours of rest considered "fresh" (cap from contribution). */
  freshRestHours: 12,
};

function hoursOfShift(s: WorkShiftRecord): number {
  return Math.max(
    0,
    (new Date(s.endISO).getTime() - new Date(s.startISO).getTime()) / HOUR_MS,
  );
}

function hoursInWindow(
  shifts: ReadonlyArray<WorkShiftRecord>,
  asOf: Date,
  windowHours: number,
): number {
  const end = asOf.getTime();
  const start = end - windowHours * HOUR_MS;
  return shifts.reduce((sum, s) => {
    const sStart = new Date(s.startISO).getTime();
    const sEnd = new Date(s.endISO).getTime();
    if (sEnd <= start || sStart >= end) return sum;
    return sum + Math.max(0, (Math.min(sEnd, end) - Math.max(sStart, start)) / HOUR_MS);
  }, 0);
}

function consecutiveDays(shifts: ReadonlyArray<WorkShiftRecord>): number {
  if (shifts.length === 0) return 0;
  const dayKeys = new Set(
    shifts.map((s) => new Date(s.startISO).toISOString().slice(0, 10)),
  );
  const sorted = [...dayKeys].sort();
  let run = 1;
  let max = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    const diff = (new Date(curr).getTime() - new Date(prev).getTime()) / DAY_MS;
    if (Math.round(diff) === 1) {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 1;
    }
  }
  return max;
}

function lastShiftEnd(shifts: ReadonlyArray<WorkShiftRecord>): Date | null {
  if (shifts.length === 0) return null;
  const sorted = [...shifts].sort((a, b) => a.endISO.localeCompare(b.endISO));
  const last = sorted[sorted.length - 1];
  return last ? new Date(last.endISO) : null;
}

export interface ScoreFatigueArgs {
  readonly worker: Worker;
  /** When the new shift is starting — anchors all window calcs. */
  readonly asOfISO: string;
}

export function scoreFatigue({ worker, asOfISO }: ScoreFatigueArgs): FatigueScore {
  const asOf = new Date(asOfISO);
  const last24h = hoursInWindow(worker.last72hShifts, asOf, 24);
  const last72h = hoursInWindow(worker.last72hShifts, asOf, 72);
  const days = consecutiveDays(worker.last72hShifts);
  const lastEnd = lastShiftEnd(worker.last72hShifts);
  const restHours = lastEnd
    ? Math.max(0, (asOf.getTime() - lastEnd.getTime()) / HOUR_MS)
    : SOFT_CAPS.freshRestHours;

  const last24hContribution =
    Math.min(1, last24h / SOFT_CAPS.last24h) * WEIGHTS.last24h;
  const last72hContribution =
    Math.min(1, last72h / SOFT_CAPS.last72h) * WEIGHTS.last72h;
  const consecutiveContribution =
    Math.min(1, days / SOFT_CAPS.consecutiveDays) * WEIGHTS.consecutive;
  const restRatio = 1 - Math.min(1, restHours / SOFT_CAPS.freshRestHours);
  const restContribution = restRatio * WEIGHTS.rest;

  const score = Math.min(
    1,
    Math.round(
      (last24hContribution +
        last72hContribution +
        consecutiveContribution +
        restContribution) *
        100,
    ) / 100,
  );

  // Recommended max hours: 12 - 8 * score, floored at 4.
  const recommendedMaxHours = Math.max(4, 12 - 8 * score);

  return {
    workerId: worker.id,
    score,
    hoursWorkedLast24h: Math.round(last24h * 100) / 100,
    hoursWorkedLast72h: Math.round(last72h * 100) / 100,
    consecutiveDays: days,
    recommendedMaxHours: Math.round(recommendedMaxHours * 100) / 100,
    factors: [
      { label: 'last-24h', contribution: round(last24hContribution) },
      { label: 'last-72h', contribution: round(last72hContribution) },
      { label: 'consecutive-days', contribution: round(consecutiveContribution) },
      { label: 'rest-elapsed', contribution: round(restContribution) },
    ],
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

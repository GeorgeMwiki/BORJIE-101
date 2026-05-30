/**
 * Employees — 1-on-1 Tracker
 *
 * Pure functions that decide whether an employee is "overdue for a 1-on-1"
 * based on the time since their `last1on1At`. Surfaces an NBA suggestion
 * when overdue.
 *
 * Default cadence: 30 days. Onboarding hires (< 90 days at company) use
 * a tighter 14-day cadence.
 *
 * @module features/central-command/md/employees/one-on-one-tracker
 */

import type { Employee } from "./types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const STANDARD_CADENCE_DAYS = 30;
const ONBOARDING_CADENCE_DAYS = 14;
const ONBOARDING_WINDOW_DAYS = 90;

export interface OneOnOneSuggestion {
  readonly employeeId: string;
  readonly employeeName: string;
  /** Days since the last 1-on-1 (or hire date if never had one). */
  readonly daysSince: number;
  /** Cadence chosen for this employee (depends on onboarding status). */
  readonly cadenceDays: number;
  readonly priority: "low" | "normal" | "high" | "urgent";
  readonly reason: string;
}

export interface OneOnOneAnalysisInput {
  readonly employees: ReadonlyArray<Employee>;
  readonly now: Date;
}

/**
 * Identify employees who are overdue for a 1-on-1. Pure function.
 * Returns suggestions sorted by priority desc, then days-since desc.
 */
export function suggestOneOnOnes(
  input: OneOnOneAnalysisInput,
): ReadonlyArray<OneOnOneSuggestion> {
  const nowMs = input.now.getTime();
  const out: OneOnOneSuggestion[] = [];
  for (const e of input.employees) {
    const cadence = cadenceFor(e, nowMs);
    const lastMs = lastTouchpointMs(e);
    if (!Number.isFinite(lastMs)) continue;
    const daysSince = Math.floor((nowMs - lastMs) / MS_PER_DAY);
    if (daysSince < cadence) continue;
    out.push(
      Object.freeze({
        employeeId: e.id,
        employeeName: e.name,
        daysSince,
        cadenceDays: cadence,
        priority: priorityFor(daysSince, cadence),
        reason: e.last1on1At
          ? `Last 1-on-1 was ${daysSince} days ago (cadence ${cadence}d)`
          : `Never had a 1-on-1; hired ${daysSince} days ago`,
      }),
    );
  }
  return Object.freeze(
    out.slice().sort((a, b) => {
      const p = rankPriority(b.priority) - rankPriority(a.priority);
      if (p !== 0) return p;
      return b.daysSince - a.daysSince;
    }),
  );
}

/**
 * Update an employee's `last1on1At` timestamp. Pure — returns a new
 * employee object.
 */
export function recordOneOnOne(employee: Employee, at: Date): Employee {
  return Object.freeze({
    ...employee,
    last1on1At: at.toISOString(),
  });
}

function cadenceFor(e: Employee, nowMs: number): number {
  const hireMs = new Date(e.hireDate).getTime();
  if (!Number.isFinite(hireMs)) return STANDARD_CADENCE_DAYS;
  const tenureDays = (nowMs - hireMs) / MS_PER_DAY;
  return tenureDays < ONBOARDING_WINDOW_DAYS
    ? ONBOARDING_CADENCE_DAYS
    : STANDARD_CADENCE_DAYS;
}

function lastTouchpointMs(e: Employee): number {
  if (e.last1on1At) {
    const t = new Date(e.last1on1At).getTime();
    if (Number.isFinite(t)) return t;
  }
  const hire = new Date(e.hireDate).getTime();
  return Number.isFinite(hire) ? hire : NaN;
}

function priorityFor(
  daysSince: number,
  cadence: number,
): OneOnOneSuggestion["priority"] {
  const ratio = daysSince / cadence;
  if (ratio >= 3) return "urgent";
  if (ratio >= 2) return "high";
  if (ratio >= 1.25) return "normal";
  return "low";
}

function rankPriority(p: OneOnOneSuggestion["priority"]): number {
  return p === "urgent" ? 4 : p === "high" ? 3 : p === "normal" ? 2 : 1;
}

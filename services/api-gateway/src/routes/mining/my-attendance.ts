/**
 * Per-caller attendance projections for the employee HOME (workforce-mobile).
 *
 * Two mobile surfaces read these:
 *   GET /api/v1/mining/attendance/mine            → AttendanceShift (hero card)
 *   GET /api/v1/mining/attendance/me/performance  → PerformanceSnapshot
 *
 * Both previously cast nonexistent routes, so ShiftStatusHero and
 * PerformanceSnapshot rendered a permanent env-missing/no-data state. These
 * pure adapters build the render contract from the caller's OWN real
 * `attendance` rows only. Anything with no source is honest-omitted, never
 * fabricated.
 *
 * Field provenance — AttendanceShift:
 *   id              — attendance.id of the latest row (or '' when none)
 *   state           — derived: no row today → not-started; open (no
 *                     hoursWorked) → in-progress; closed → ended.
 *   status          — attendance.status mapped to present|absent|late|unknown
 *   clockedInAtIso  — attendance.signed_off_at of the open/last row
 *   siteName        — null (the row carries only siteId; no name join here —
 *                     the hero falls back to its localized default site label)
 *   elapsedSeconds  — (now − clockedInAt) for an OPEN shift, else 0. Never a
 *                     fabricated duration.
 *
 * Field provenance — PerformanceSnapshot:
 *   metricValue     — COUNT of the caller's attendance rows in the window
 *                     (shifts worked) — a REAL attendance-derived figure.
 *   metricUnit      — localized "shifts" / "zamu".
 *   deltaPct        — 0 with no prior-window baseline wired (honest: we do NOT
 *                     invent a trend; a real prior-window count drives it when
 *                     both windows are passed).
 *   rangeDays       — echo of the requested window.
 */

export type ShiftState = 'not-started' | 'in-progress' | 'on-break' | 'ended';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'unknown';

export interface AttendanceShiftWire {
  readonly id: string;
  readonly state: ShiftState;
  readonly status: AttendanceStatus;
  readonly clockedInAtIso: string | null;
  readonly siteName: string | null;
  readonly elapsedSeconds: number;
}

/** Raw attendance row slice the shift adapter needs. */
export interface MyAttendanceRow {
  readonly id: string | null;
  readonly status: string | null;
  readonly hoursWorked: string | number | null;
  readonly signedOffAt: string | Date | null;
  readonly workDate: string | null;
}

function mapAttendanceStatus(status: string | null): AttendanceStatus {
  if (status === 'present') return 'present';
  if (status === 'late') return 'late';
  if (status === 'absent' || status === 'sick' || status === 'leave') return 'absent';
  return 'unknown';
}

function toIso(v: string | Date | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Build the hero AttendanceShift from the caller's latest attendance row and
 * today's date key. `null` row → an honest not-started shift (no fabricated
 * timer / site). `now` is injected so the elapsed math is deterministic in
 * tests.
 */
export function adaptMyShift(
  row: MyAttendanceRow | null,
  todayKey: string,
  now: Date,
): AttendanceShiftWire {
  if (!row) {
    return {
      id: '',
      state: 'not-started',
      status: 'unknown',
      clockedInAtIso: null,
      siteName: null,
      elapsedSeconds: 0,
    };
  }
  const isOpen = row.hoursWorked == null;
  const isToday = row.workDate === todayKey;
  const clockedInAtIso = toIso(row.signedOffAt);
  // Only an OPEN shift STARTED TODAY is "in-progress"; a closed row or a stale
  // open row from a prior day reads as ended (the worker never checked out but
  // the shift is over). No fabricated running timer.
  const state: ShiftState = isOpen && isToday ? 'in-progress' : 'ended';
  let elapsedSeconds = 0;
  if (state === 'in-progress' && clockedInAtIso) {
    const started = new Date(clockedInAtIso).getTime();
    if (Number.isFinite(started)) {
      elapsedSeconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
    }
  }
  return {
    id: String(row.id ?? ''),
    state,
    status: mapAttendanceStatus(row.status),
    clockedInAtIso,
    // siteName has no name-join in this projection — the hero uses its own
    // localized default site label rather than us shipping a raw id.
    siteName: null,
    elapsedSeconds,
  };
}

export interface PerformanceSnapshotWire {
  readonly metricLabelSw: string;
  readonly metricLabelEn: string;
  readonly metricValue: number;
  readonly metricUnitSw: string;
  readonly metricUnitEn: string;
  readonly deltaPct: number;
  readonly rangeDays: number;
}

/**
 * Build the performance snapshot from a REAL count of the caller's shifts in
 * the window. `priorCount` (shifts in the immediately preceding window) drives
 * `deltaPct` — when it is null we emit `deltaPct: 0` rather than fabricating a
 * trend from a single window. The metric copy is locale-parallel (both sw+en
 * present) so the render layer never cross-falls-back.
 */
export function adaptMyPerformance(
  shiftsInWindow: number,
  rangeDays: number,
  priorCount: number | null,
): PerformanceSnapshotWire {
  const deltaPct =
    priorCount != null && priorCount > 0
      ? Math.round(((shiftsInWindow - priorCount) / priorCount) * 100)
      : 0;
  return {
    metricLabelSw: 'Zamu zilizofanyika',
    metricLabelEn: 'Shifts worked',
    metricValue: shiftsInWindow,
    metricUnitSw: 'zamu',
    metricUnitEn: 'shifts',
    deltaPct,
    rangeDays,
  };
}

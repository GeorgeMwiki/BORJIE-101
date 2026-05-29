/**
 * Pure payroll calculator — payroll chain L-B (issue #193).
 *
 * Takes a worker's clock-in events for a period and returns the
 * computed payroll line item shape.
 *
 * Conventions
 * -----------
 * - All money in TZS (CLAUDE.md: multi-currency, TZS-primary).
 * - Hours are rounded to 2 decimals at the per-event boundary.
 * - Overtime = hours over 8 per calendar day. Standard TZ labour law
 *   weekly overtime threshold is 40 (mirrors SAP S/4HANA + Workday
 *   default), but for daily granularity 8 is the SOTA per-shift cap.
 * - Overtime multiplier is 1.5x (statutory; same as SAP default).
 *
 * Pure module — no DB I/O, no Date.now() (caller supplies period).
 */

export interface ClockEventForPayroll {
  readonly employeeId: string;
  readonly clockedInAt: string;
  readonly clockedOutAt: string | null;
  readonly biometricPassed: boolean;
}

export interface ComputeLineItemInput {
  readonly workerUserId: string;
  /** ISO date-time inclusive lower bound. */
  readonly periodStartIso: string;
  /** ISO date-time exclusive upper bound. */
  readonly periodEndIso: string;
  /** Hourly rate in TZS. */
  readonly hourlyRateTzs: number;
  /** Manager-approved bonus delta in TZS. */
  readonly bonusTzs: number;
  /** Aggregate deductions in TZS (PPE, advance, etc.). */
  readonly deductionTzs: number;
  /** Worker's clock events within the period. */
  readonly events: ReadonlyArray<ClockEventForPayroll>;
}

export interface ComputeLineItemResult {
  readonly workerUserId: string;
  readonly hoursWorked: number;
  readonly overtimeHours: number;
  readonly hourlyRateTzs: number;
  readonly baseTzs: number;
  readonly overtimeTzs: number;
  readonly bonusTzs: number;
  readonly deductionTzs: number;
  readonly netTzs: number;
}

const OVERTIME_THRESHOLD_PER_DAY = 8;
const OVERTIME_MULTIPLIER = 1.5;
const MS_PER_HOUR = 1000 * 60 * 60;

function clamp(hours: number, lo: number, hi: number): number {
  if (hours < lo) return lo;
  if (hours > hi) return hi;
  return hours;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function ymdKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Compute one payroll line item for a worker across a period.
 *
 * - Events without a `clockedOutAt` are skipped (open shift).
 * - Events where biometric did not pass are still counted (clock-in
 *   record is the source of truth; biometric guard is a separate audit
 *   signal not a payroll deduction).
 * - Overtime is computed per calendar day: hours over 8 attract the
 *   overtime multiplier; the base hours stay at 1x.
 * - net = base + overtime + bonus - deduction. The DB CHECK constraint
 *   matches exactly.
 */
export function computeLineItem(
  input: ComputeLineItemInput,
): ComputeLineItemResult {
  const lo = new Date(input.periodStartIso).getTime();
  const hi = new Date(input.periodEndIso).getTime();

  // Group hours by calendar day so we can apply per-day overtime.
  const hoursPerDay = new Map<string, number>();
  for (const e of input.events) {
    if (!e.clockedOutAt) continue;
    const startMs = clamp(new Date(e.clockedInAt).getTime(), lo, hi);
    const endMs = clamp(new Date(e.clockedOutAt).getTime(), lo, hi);
    if (endMs <= startMs) continue;
    const hours = (endMs - startMs) / MS_PER_HOUR;
    const dayKey = ymdKey(e.clockedInAt);
    hoursPerDay.set(dayKey, (hoursPerDay.get(dayKey) ?? 0) + hours);
  }

  let baseHours = 0;
  let overtimeHours = 0;
  for (const hours of hoursPerDay.values()) {
    if (hours <= OVERTIME_THRESHOLD_PER_DAY) {
      baseHours += hours;
    } else {
      baseHours += OVERTIME_THRESHOLD_PER_DAY;
      overtimeHours += hours - OVERTIME_THRESHOLD_PER_DAY;
    }
  }

  const hourlyRateTzs = round2(input.hourlyRateTzs);
  const baseTzs = round2(baseHours * hourlyRateTzs);
  const overtimeTzs = round2(
    overtimeHours * hourlyRateTzs * OVERTIME_MULTIPLIER,
  );
  const bonusTzs = round2(input.bonusTzs);
  const deductionTzs = round2(input.deductionTzs);
  const netTzs = round2(baseTzs + overtimeTzs + bonusTzs - deductionTzs);

  return {
    workerUserId: input.workerUserId,
    hoursWorked: round2(baseHours + overtimeHours),
    overtimeHours: round2(overtimeHours),
    hourlyRateTzs,
    baseTzs,
    overtimeTzs,
    bonusTzs,
    deductionTzs,
    // The DB CHECK clamps non-negative. A net <= 0 is a manager problem
    // (over-deducted) — surface it but do not zero it out.
    netTzs,
  };
}

/**
 * Compute the run-level totals from a set of line items.
 */
export function rollupRun(
  lineItems: ReadonlyArray<ComputeLineItemResult>,
): {
  readonly totalTzs: number;
  readonly workerCount: number;
} {
  let total = 0;
  for (const li of lineItems) total += li.netTzs;
  return {
    totalTzs: round2(total),
    workerCount: lineItems.length,
  };
}

/**
 * Bilingual payslip-ready label for the worker's mobile view.
 */
export function payslipLabel(
  netTzs: number,
): { readonly sw: string; readonly en: string } {
  // We do NOT hardcode 'TZS' on the worker label — the formatCurrency
  // helper handles the symbol. Caller renders via formatCurrency(netTzs, currencyCode).
  return {
    sw: `Mshahara wako: ${netTzs.toFixed(2)}`,
    en: `Your payslip: ${netTzs.toFixed(2)}`,
  };
}

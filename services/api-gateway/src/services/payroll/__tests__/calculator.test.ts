/**
 * Pure payroll calculator — payroll chain L-B (issue #193).
 */

import { describe, it, expect } from 'vitest';
import {
  computeLineItem,
  rollupRun,
  payslipLabel,
  type ClockEventForPayroll,
} from '../calculator';

const WORKER = '11111111-1111-4111-8111-111111111111';
const RATE = 1000; // TZS / hour

function event(
  inAt: string,
  outAt: string | null,
  pass = true,
): ClockEventForPayroll {
  return {
    employeeId: WORKER,
    clockedInAt: inAt,
    clockedOutAt: outAt,
    biometricPassed: pass,
  };
}

describe('computeLineItem', () => {
  it('returns zeros when there are no clock events', () => {
    const result = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 0,
      deductionTzs: 0,
      events: [],
    });
    expect(result.hoursWorked).toBe(0);
    expect(result.overtimeHours).toBe(0);
    expect(result.baseTzs).toBe(0);
    expect(result.overtimeTzs).toBe(0);
    expect(result.netTzs).toBe(0);
  });

  it('skips open shifts (no clockedOutAt)', () => {
    const result = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 0,
      deductionTzs: 0,
      events: [event('2026-05-02T08:00:00.000Z', null)],
    });
    expect(result.hoursWorked).toBe(0);
  });

  it('computes 8-hour base shift at base rate', () => {
    const result = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 0,
      deductionTzs: 0,
      events: [event('2026-05-02T08:00:00.000Z', '2026-05-02T16:00:00.000Z')],
    });
    expect(result.hoursWorked).toBe(8);
    expect(result.overtimeHours).toBe(0);
    expect(result.baseTzs).toBe(8 * RATE);
    expect(result.overtimeTzs).toBe(0);
    expect(result.netTzs).toBe(8 * RATE);
  });

  it('applies 1.5x multiplier on overtime past 8h/day', () => {
    const result = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 0,
      deductionTzs: 0,
      // 12h shift on one day -> 8h base + 4h overtime.
      events: [event('2026-05-02T08:00:00.000Z', '2026-05-02T20:00:00.000Z')],
    });
    expect(result.hoursWorked).toBe(12);
    expect(result.overtimeHours).toBe(4);
    expect(result.baseTzs).toBe(8 * RATE);
    expect(result.overtimeTzs).toBe(4 * RATE * 1.5);
    expect(result.netTzs).toBe(8 * RATE + 4 * RATE * 1.5);
  });

  it('clips events at the period boundary', () => {
    const result = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-02T10:00:00.000Z',
      periodEndIso: '2026-05-02T14:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 0,
      deductionTzs: 0,
      // Shift starts before period, ends inside.
      events: [event('2026-05-02T08:00:00.000Z', '2026-05-02T16:00:00.000Z')],
    });
    expect(result.hoursWorked).toBe(4);
    expect(result.baseTzs).toBe(4 * RATE);
  });

  it('adds bonus and subtracts deduction in net', () => {
    const result = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 5_000,
      deductionTzs: 2_000,
      events: [event('2026-05-02T08:00:00.000Z', '2026-05-02T16:00:00.000Z')],
    });
    expect(result.netTzs).toBe(8 * RATE + 5_000 - 2_000);
  });
});

describe('rollupRun', () => {
  it('sums net + counts workers', () => {
    const a = computeLineItem({
      workerUserId: WORKER,
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE,
      bonusTzs: 0,
      deductionTzs: 0,
      events: [event('2026-05-02T08:00:00.000Z', '2026-05-02T16:00:00.000Z')],
    });
    const b = computeLineItem({
      workerUserId: '22222222-2222-4222-8222-222222222222',
      periodStartIso: '2026-05-01T00:00:00.000Z',
      periodEndIso: '2026-05-08T00:00:00.000Z',
      hourlyRateTzs: RATE * 2,
      bonusTzs: 0,
      deductionTzs: 0,
      events: [event('2026-05-03T08:00:00.000Z', '2026-05-03T16:00:00.000Z')],
    });
    const rollup = rollupRun([a, b]);
    expect(rollup.workerCount).toBe(2);
    expect(rollup.totalTzs).toBe(a.netTzs + b.netTzs);
  });
});

describe('payslipLabel', () => {
  it('is bilingual sw + en', () => {
    const label = payslipLabel(123.45);
    expect(label.sw).toContain('Mshahara');
    expect(label.en).toContain('payslip');
  });
});

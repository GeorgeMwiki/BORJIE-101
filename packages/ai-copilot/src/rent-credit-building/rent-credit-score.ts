/**
 * Rent-Credit-Score — computes a tenant's rent-payment creditworthiness
 * from their on-time payment history.
 *
 * Feeds into @borjie/ai-copilot/skills/estate/tenant-health-check.
 */

import type { PaymentRecord, RentCreditScore } from './types.js';

function daysLate(record: PaymentRecord): number {
  if (!record.paidAt) return 999;
  const due = Date.parse(record.dueDate);
  const paid = Date.parse(record.paidAt);
  if (Number.isNaN(due) || Number.isNaN(paid)) return 0;
  const diff = (paid - due) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(diff));
}

function gradeFromScore(score: number): RentCreditScore['grade'] {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function uniqueMonthsCount(records: readonly PaymentRecord[]): number {
  const set = new Set<string>();
  for (const r of records) {
    const date = new Date(r.dueDate);
    if (!Number.isNaN(date.getTime())) {
      set.add(`${date.getFullYear()}-${date.getMonth()}`);
    }
  }
  return set.size;
}

function consecutiveOnTimeStreak(records: readonly PaymentRecord[]): number {
  const sorted = [...records].sort(
    (a, b) => Date.parse(b.dueDate) - Date.parse(a.dueDate),
  );
  let streak = 0;
  for (const r of sorted) {
    if (daysLate(r) <= 2) streak += 1;
    else break;
  }
  return streak;
}

function buildRecommendations(
  onTimeRatePct: number,
  averageDaysLate: number,
  monthsObserved: number,
): readonly string[] {
  const recs: string[] = [];
  if (onTimeRatePct >= 95) {
    recs.push('Excellent track record — eligible for deposit financing partners.');
  } else if (onTimeRatePct >= 80) {
    recs.push('Strong history — keep streaks above 6 months to unlock top grade.');
  } else if (onTimeRatePct >= 60) {
    recs.push('Room to improve — set up autopay via M-Pesa or GePG standing order.');
  } else {
    recs.push('Build consistency — pay on or before due date for the next 3 months.');
  }
  if (averageDaysLate > 7) {
    recs.push(`Average late by ${Math.round(averageDaysLate)} days — move due date to align with payday.`);
  }
  if (monthsObserved < 6) {
    recs.push('Insufficient history — score will sharpen as more months are recorded.');
  }
  return recs;
}

export interface CalculateScoreInput {
  readonly userId: string;
  readonly tenantId: string;
  readonly records: readonly PaymentRecord[];
  readonly now: string;
}

export function calculateRentCreditScore(
  input: CalculateScoreInput,
): RentCreditScore {
  const paidOnlyRecords = input.records.filter(
    (r) => r.amountPaid >= r.amountExpected * 0.95,
  );
  const totalEvaluated = input.records.length;

  const lateDays = paidOnlyRecords.map(daysLate);
  const onTimeCount = lateDays.filter((d) => d <= 2).length;
  const onTimeRatePct =
    totalEvaluated === 0 ? 0 : (onTimeCount / totalEvaluated) * 100;
  const averageDaysLate =
    paidOnlyRecords.length === 0
      ? 0
      : lateDays.reduce((a, b) => a + b, 0) / paidOnlyRecords.length;
  const monthsObserved = uniqueMonthsCount(input.records);

  const paidRatio = totalEvaluated === 0 ? 0 : paidOnlyRecords.length / totalEvaluated;
  const base = onTimeRatePct * 0.7 + paidRatio * 100 * 0.2;
  const latenessPenalty = Math.min(20, averageDaysLate);
  const historyBonus = Math.min(10, monthsObserved / 2);
  const score = Math.max(0, Math.min(100, base - latenessPenalty + historyBonus));
  const grade = gradeFromScore(score);

  return {
    userId: input.userId,
    tenantId: input.tenantId,
    score: Math.round(score * 10) / 10,
    grade,
    onTimeRatePct: Math.round(onTimeRatePct * 10) / 10,
    averageDaysLate: Math.round(averageDaysLate * 10) / 10,
    totalPaymentsEvaluated: totalEvaluated,
    consecutiveOnTimeStreak: consecutiveOnTimeStreak(input.records),
    monthsObserved,
    calculatedAt: input.now,
    recommendations: buildRecommendations(onTimeRatePct, averageDaysLate, monthsObserved),
  };
}

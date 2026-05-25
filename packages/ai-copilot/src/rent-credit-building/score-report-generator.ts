/**
 * Score Report Generator — Mr. Mwikila writes a human-readable report a
 * tenant can download and show to a bank as proof of rent-paying reliability.
 *
 * Pure template-driven. No LLM call is required because the underlying score
 * object already carries structured fields and recommendations; the narrative
 * synthesises them into an English + Swahili paragraph.
 */

import type { RentCreditScore, ScoreReport } from './types.js';

function narrativeEn(score: RentCreditScore): string {
  const streakPhrase =
    score.consecutiveOnTimeStreak >= 6
      ? ` The current streak of ${score.consecutiveOnTimeStreak} consecutive on-time payments is a strong signal for lenders.`
      : score.consecutiveOnTimeStreak >= 3
        ? ` A short streak of ${score.consecutiveOnTimeStreak} on-time payments is present.`
        : '';
  const lateness =
    score.averageDaysLate <= 2
      ? 'typically paid on or near the due date'
      : `averaging ${score.averageDaysLate.toFixed(1)} days after the due date`;
  return (
    `Rent credit score: ${score.score} (grade ${score.grade}). ` +
    `${score.userId} has settled ${score.totalPaymentsEvaluated} rent instalments over ${score.monthsObserved} months ` +
    `with an on-time rate of ${score.onTimeRatePct.toFixed(1)}%, ` +
    `${lateness}.${streakPhrase} ` +
    `Recommendations: ${score.recommendations.join(' ')}`
  );
}

function narrativeSw(score: RentCreditScore): string {
  const streakPhrase =
    score.consecutiveOnTimeStreak >= 6
      ? ` Mfululizo wa malipo ${score.consecutiveOnTimeStreak} kwa wakati ni alama nzuri kwa wakopeshaji.`
      : '';
  return (
    `Alama ya kodi: ${score.score} (daraja ${score.grade}). ` +
    `Amelipia malipo ${score.totalPaymentsEvaluated} kwa miezi ${score.monthsObserved} ` +
    `kwa kiwango cha ${score.onTimeRatePct.toFixed(1)}% cha wakati uliostahili.${streakPhrase} ` +
    `Ushauri: ${score.recommendations.join(' ')}`
  );
}

function reportId(userId: string, tenantId: string, now: string): string {
  const ts = now.replace(/[:.TZ-]/g, '');
  return `rcr-${tenantId}-${userId}-${ts}`;
}

export function generateScoreReport(
  score: RentCreditScore,
  now: string,
): ScoreReport {
  return {
    userId: score.userId,
    tenantId: score.tenantId,
    score,
    narrativeEn: narrativeEn(score),
    narrativeSw: narrativeSw(score),
    generatedAt: now,
    reportId: reportId(score.userId, score.tenantId, now),
  };
}

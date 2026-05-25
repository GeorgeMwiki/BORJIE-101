/**
 * Rent Savings Advisor — nudges on-time tenants toward savings products.
 *
 * Pure: takes a score + tenant monthly rent, returns a nudge.
 */

import type { RentCreditScore } from './types.js';

export interface SavingsNudge {
  readonly shouldNudge: boolean;
  readonly suggestedMonthlySavingsPct: number;
  readonly suggestedMonthlySavingsAmount: number;
  readonly currency: 'KES' | 'TZS' | 'UGX' | 'RWF';
  readonly messageEn: string;
  readonly messageSw: string;
}

export interface NudgeRequest {
  readonly score: RentCreditScore;
  readonly monthlyRent: number;
  readonly currency: SavingsNudge['currency'];
}

export function computeSavingsNudge(request: NudgeRequest): SavingsNudge {
  const { score } = request;
  const shouldNudge = score.score >= 70 && score.consecutiveOnTimeStreak >= 3;
  if (!shouldNudge) {
    return {
      shouldNudge: false,
      suggestedMonthlySavingsPct: 0,
      suggestedMonthlySavingsAmount: 0,
      currency: request.currency,
      messageEn: 'Keep building your on-time streak before we unlock savings suggestions.',
      messageSw: 'Endelea kulipa kwa wakati kabla ya kufungua mapendekezo ya akiba.',
    };
  }
  const pct = score.score >= 90 ? 10 : score.score >= 80 ? 7 : 5;
  const amount = Math.round((request.monthlyRent * pct) / 100);
  return {
    shouldNudge: true,
    suggestedMonthlySavingsPct: pct,
    suggestedMonthlySavingsAmount: amount,
    currency: request.currency,
    messageEn:
      `Great streak. Consider saving ${pct}% of rent (${amount} ${request.currency}) ` +
      `each month. BORJIE can route it to a partner savings product automatically.`,
    messageSw:
      `Mfululizo mzuri. Hifadhi ${pct}% ya kodi (${amount} ${request.currency}) kila mwezi. ` +
      `BORJIE inaweza kuelekeza kwa akiba ya mshirika.`,
  };
}

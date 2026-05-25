/**
 * TZ — Landlord & Tenant Act, 2022 (Tanzania).
 *
 * Curated subset relevant to the kernel's policy-gate decisions. The
 * Act caps deposits at two months' rent, sets notice-period minimums
 * by tenancy type, and ties eviction to a court order EXCEPT for
 * abandonment / illegal-occupation cases.
 *
 * Not a substitute for legal counsel — the kernel surfaces the
 * citation so a human can verify.
 */

import type { RegulatoryRuleSet } from './rules-types.js';

const DEPOSIT_CAP_MONTHS = 2;
const RENT_INCREASE_NOTICE_DAYS = 90;
const EVICTION_NOTICE_DAYS_MIN = 30;
const RENT_INCREASE_CEILING_PCT = 15; // Lease + statutory guidance.

export const TZ_LANDLORD_TENANT_ACT: RegulatoryRuleSet = {
  jurisdiction: 'TZ',
  displayName: 'Tanzania Landlord & Tenant Act, 2022',
  statuteVersion: '2022',
  rules: [
    {
      id: 'tz-deposit-cap-2x',
      jurisdiction: 'TZ',
      action: 'collect_deposit',
      citation: 'TZ Landlord & Tenant Act 2022, s.27(1)',
      rationale:
        'Security deposits may not exceed two months\' rent. Excess is recoverable.',
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.amountMinor !== 'number') return false;
        if (typeof p.monthlyRentMinor !== 'number') return false;
        if (p.monthlyRentMinor <= 0) return false;
        return p.amountMinor > p.monthlyRentMinor * DEPOSIT_CAP_MONTHS;
      },
    },
    {
      id: 'tz-eviction-notice-min-30',
      jurisdiction: 'TZ',
      action: 'issue_eviction_notice',
      citation: 'TZ Landlord & Tenant Act 2022, s.41(2)',
      rationale: `Eviction notice must give at least ${EVICTION_NOTICE_DAYS_MIN} days unless the tenancy was abandoned or the entry is unlawful.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.noticeDays !== 'number') return false;
        return p.noticeDays < EVICTION_NOTICE_DAYS_MIN;
      },
    },
    {
      id: 'tz-eviction-without-court-order',
      jurisdiction: 'TZ',
      action: 'evict',
      citation: 'TZ Landlord & Tenant Act 2022, s.42',
      rationale:
        'Physical eviction without a court order is unlawful self-help.',
      verdict: 'refuse',
      predicate: (p) => p.hasCourtOrder === false,
    },
    {
      id: 'tz-rent-increase-notice',
      jurisdiction: 'TZ',
      action: 'raise_rent',
      citation: 'TZ Landlord & Tenant Act 2022, s.31(1)',
      rationale: `Rent increase requires at least ${RENT_INCREASE_NOTICE_DAYS} days' written notice.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.noticeDays !== 'number') return false;
        return p.noticeDays < RENT_INCREASE_NOTICE_DAYS;
      },
    },
    {
      id: 'tz-rent-increase-ceiling',
      jurisdiction: 'TZ',
      action: 'raise_rent',
      citation: 'TZ Landlord & Tenant Act 2022, s.31(3); Rent Tribunal guidance',
      rationale: `Rent increase above ${RENT_INCREASE_CEILING_PCT}% per cycle requires Rent Tribunal review.`,
      verdict: 'flag',
      predicate: (p) => {
        if (typeof p.increasePercentage !== 'number') return false;
        return p.increasePercentage > RENT_INCREASE_CEILING_PCT;
      },
    },
    {
      id: 'tz-distress-prohibited',
      jurisdiction: 'TZ',
      action: 'distrain_goods',
      citation: 'TZ Landlord & Tenant Act 2022, s.45',
      rationale:
        'Self-help distress on tenant goods is prohibited; pursue arrears through the Rent Tribunal.',
      verdict: 'refuse',
      predicate: () => true,
    },
    {
      id: 'tz-entry-without-notice',
      jurisdiction: 'TZ',
      action: 'enter_premises',
      citation: 'TZ Landlord & Tenant Act 2022, s.36',
      rationale:
        'Routine entry requires 48 hours\' notice except for genuine emergency.',
      verdict: 'flag',
      predicate: (p) => {
        if (typeof p.noticeDays !== 'number') return false;
        // 48h ~ 2 days
        return p.noticeDays < 2;
      },
    },
  ],
};

export const TZ_LIMITS = {
  depositCapMonths: DEPOSIT_CAP_MONTHS,
  rentIncreaseNoticeDays: RENT_INCREASE_NOTICE_DAYS,
  evictionNoticeMinDays: EVICTION_NOTICE_DAYS_MIN,
  rentIncreaseCeilingPct: RENT_INCREASE_CEILING_PCT,
} as const;

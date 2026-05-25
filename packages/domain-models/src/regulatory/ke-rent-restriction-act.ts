/**
 * KE — Rent Restriction Act (Cap. 296) + Distress for Rent Act (Cap. 293).
 *
 * Applies to controlled tenancies in Kenya (essentially residential
 * tenancies under the prescribed rent ceiling). The Distress for Rent
 * Act governs landlord seizure of goods for arrears — strictly
 * regulated and never to be self-help.
 *
 * Curated subset relevant to the kernel's policy gate.
 */

import type { RegulatoryRuleSet } from './rules-types.js';

const DEPOSIT_CAP_MONTHS = 2;
const RENT_INCREASE_NOTICE_DAYS = 60;
const RENT_INCREASE_CEILING_PCT = 10;
const EVICTION_NOTICE_DAYS_MIN = 60;

export const KE_RENT_RESTRICTION_ACT: RegulatoryRuleSet = {
  jurisdiction: 'KE',
  displayName: 'Kenya Rent Restriction Act (Cap. 296)',
  statuteVersion: '2012 revision',
  rules: [
    {
      id: 'ke-deposit-cap-2x',
      jurisdiction: 'KE',
      action: 'collect_deposit',
      citation: 'Rent Restriction Act (Cap. 296) s.5(2)(b)',
      rationale:
        'Security deposits on controlled tenancies are capped at two months\' rent.',
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.amountMinor !== 'number') return false;
        if (typeof p.monthlyRentMinor !== 'number') return false;
        if (p.monthlyRentMinor <= 0) return false;
        return p.amountMinor > p.monthlyRentMinor * DEPOSIT_CAP_MONTHS;
      },
    },
    {
      id: 'ke-rent-increase-notice',
      jurisdiction: 'KE',
      action: 'raise_rent',
      citation: 'Rent Restriction Act (Cap. 296) s.6(2)',
      rationale: `Rent increase requires at least ${RENT_INCREASE_NOTICE_DAYS} days' written notice for controlled tenancies.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.noticeDays !== 'number') return false;
        return p.noticeDays < RENT_INCREASE_NOTICE_DAYS;
      },
    },
    {
      id: 'ke-rent-increase-ceiling',
      jurisdiction: 'KE',
      action: 'raise_rent',
      citation: 'Rent Restriction Act (Cap. 296) s.6(3); Rent Tribunal guidance',
      rationale: `Rent increase above ${RENT_INCREASE_CEILING_PCT}% per cycle requires Rent Tribunal sanction.`,
      verdict: 'flag',
      predicate: (p) => {
        if (typeof p.increasePercentage !== 'number') return false;
        return p.increasePercentage > RENT_INCREASE_CEILING_PCT;
      },
    },
    {
      id: 'ke-eviction-notice-min-60',
      jurisdiction: 'KE',
      action: 'issue_eviction_notice',
      citation: 'Rent Restriction Act (Cap. 296) s.7',
      rationale: `Eviction notice must give at least ${EVICTION_NOTICE_DAYS_MIN} days for controlled tenancies.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.noticeDays !== 'number') return false;
        return p.noticeDays < EVICTION_NOTICE_DAYS_MIN;
      },
    },
    {
      id: 'ke-eviction-without-court-order',
      jurisdiction: 'KE',
      action: 'evict',
      citation: 'Land Act 2012 s.152G; Rent Restriction Act s.10',
      rationale: 'Eviction requires a court / tribunal order; self-help is unlawful.',
      verdict: 'refuse',
      predicate: (p) => p.hasCourtOrder === false,
    },
    {
      id: 'ke-distress-requires-warrant',
      jurisdiction: 'KE',
      action: 'distrain_goods',
      citation: 'Distress for Rent Act (Cap. 293) s.4',
      rationale:
        'Distress for rent must be levied under a warrant issued by a court bailiff; informal seizure is a tort.',
      verdict: 'refuse',
      predicate: (p) => p.hasCourtOrder !== true,
    },
    {
      id: 'ke-entry-without-notice',
      jurisdiction: 'KE',
      action: 'enter_premises',
      citation: 'Quiet-enjoyment common-law right',
      rationale: 'Routine entry without notice breaches quiet enjoyment.',
      verdict: 'flag',
      predicate: (p) => {
        if (typeof p.noticeDays !== 'number') return false;
        return p.noticeDays < 1;
      },
    },
  ],
};

export const KE_LIMITS = {
  depositCapMonths: DEPOSIT_CAP_MONTHS,
  rentIncreaseNoticeDays: RENT_INCREASE_NOTICE_DAYS,
  rentIncreaseCeilingPct: RENT_INCREASE_CEILING_PCT,
  evictionNoticeMinDays: EVICTION_NOTICE_DAYS_MIN,
} as const;

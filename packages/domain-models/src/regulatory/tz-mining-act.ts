/**
 * TZ — Mining Act, 2010 (as amended 2017) + Mineral Royalty regime.
 *
 * Curated subset relevant to the kernel's policy-gate decisions for a
 * Tanzanian mining estate. The Act vests all minerals in the United
 * Republic, ties extraction/processing to a valid licence under the
 * Mining Commission, levies a 6 % royalty on most minerals plus a 1 %
 * clearing-house inspection fee, requires refined gold to clear the
 * Bank of Tanzania window, and bans mercury in artisanal gold
 * processing under the Minamata-aligned mercury phase-down.
 *
 * Not a substitute for legal counsel — the kernel surfaces the
 * citation so a human can verify.
 */

import type { RegulatoryRuleSet } from './rules-types.js';

// Statutory mineral royalty on gold/most metallic minerals (Mining Act
// 2010 s.87 + Mineral Royalty Regulations). Gemstones differ — bespoke
// payloads override via `royaltyRatePct`.
const ROYALTY_RATE_PCT = 6;
// Clearing-house inspection fee on the gross value of minerals (Finance
// Act 2017 amendment to the Mining Act).
const CLEARING_FEE_PCT = 1;
// Grace beyond a royalty-return / payment deadline before it is a breach.
const ROYALTY_RETURN_GRACE_DAYS = 0;

export const TZ_MINING_ACT: RegulatoryRuleSet = {
  jurisdiction: 'TZ',
  displayName: 'Tanzania Mining Act, 2010 (as amended 2017)',
  statuteVersion: '2010 (am. 2017)',
  rules: [
    {
      id: 'tz-royalty-rate-min-6pct',
      jurisdiction: 'TZ',
      action: 'pay_royalty',
      citation: 'TZ Mining Act 2010, s.87; Mineral Royalty Regulations',
      rationale: `Royalty on gold and most metallic minerals is ${ROYALTY_RATE_PCT}% of gross value; under-assessment is recoverable by the Mining Commission.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.royaltyRatePct !== 'number') return false;
        return p.royaltyRatePct < ROYALTY_RATE_PCT;
      },
    },
    {
      id: 'tz-clearing-fee-min-1pct',
      jurisdiction: 'TZ',
      action: 'pay_royalty',
      citation: 'TZ Mining Act 2010 (Finance Act 2017 am.), s.87A',
      rationale: `A ${CLEARING_FEE_PCT}% clearing-house inspection fee on gross mineral value is payable in addition to royalty.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.clearingFeePct !== 'number') return false;
        return p.clearingFeePct < CLEARING_FEE_PCT;
      },
    },
    {
      id: 'tz-royalty-return-late',
      jurisdiction: 'TZ',
      action: 'file_royalty_return',
      citation: 'TZ Mining Act 2010, s.90; Tax Administration Act 2015',
      rationale: 'Royalty returns must be lodged on or before the statutory deadline; late returns attract penalties and interest.',
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.daysLate !== 'number') return false;
        return p.daysLate > ROYALTY_RETURN_GRACE_DAYS;
      },
    },
    {
      id: 'tz-operate-without-licence',
      jurisdiction: 'TZ',
      action: 'operate_without_licence',
      citation: 'TZ Mining Act 2010, s.7 & s.8',
      rationale:
        'Prospecting, mining or mineral processing without a valid licence from the Mining Commission is an offence.',
      verdict: 'refuse',
      predicate: (p) => p.hasValidLicence === false,
    },
    {
      id: 'tz-export-without-environmental-approval',
      jurisdiction: 'TZ',
      action: 'export_mineral',
      citation: 'Environmental Management Act 2004 (Cap. 191) s.81; NEMC',
      rationale:
        'Mineral export requires an approved EIA / environmental certificate for the originating operation.',
      verdict: 'refuse',
      predicate: (p) => p.hasEnvironmentalApproval === false,
    },
    {
      id: 'tz-gold-sold-outside-bot-window',
      jurisdiction: 'TZ',
      action: 'sell_gold',
      citation: 'Bank of Tanzania Act; BoT gold-purchase window directive 2024',
      rationale:
        'Refined gold must be offered to the Bank of Tanzania purchase window before any export sale; bypassing the window is non-compliant.',
      verdict: 'flag',
      predicate: (p) => p.routedThroughGoldWindow === false,
    },
    {
      id: 'tz-licence-transfer-without-consent',
      jurisdiction: 'TZ',
      action: 'transfer_licence',
      citation: 'TZ Mining Act 2010, s.8 & s.10',
      rationale:
        'A mining licence may not be transferred or assigned without prior written consent of the Mining Commission.',
      verdict: 'refuse',
      predicate: (p) => p.hasCommissionConsent === false,
    },
    {
      id: 'tz-mercury-in-asm-gold',
      jurisdiction: 'TZ',
      action: 'use_mercury',
      citation: 'Minamata Convention (TZ party); Mining (Mineral Processing) controls',
      rationale:
        'Mercury amalgamation in artisanal gold processing is being phased out; mercury-free recovery is mandated for formalised ASM.',
      verdict: 'refuse',
      predicate: () => true,
    },
  ],
};

export const TZ_LIMITS = {
  royaltyRatePct: ROYALTY_RATE_PCT,
  clearingFeePct: CLEARING_FEE_PCT,
  royaltyReturnGraceDays: ROYALTY_RETURN_GRACE_DAYS,
} as const;

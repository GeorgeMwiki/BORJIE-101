/**
 * KE — Mining Act, 2016 + Mining (Mineral Royalty) Regulations.
 *
 * Applies to mineral rights in Kenya (a planned expansion market). The
 * Act vests minerals in the State, ties extraction to a mineral right
 * granted by the Cabinet Secretary / Mining Rights Board, and levies
 * royalty at mineral-specific rates collected by the State. Gold
 * royalty is set at 5 % of gross market value under the Mining
 * (Royalties) Regulations.
 *
 * Curated subset relevant to the kernel's policy gate.
 */

import type { RegulatoryRuleSet } from './rules-types.js';

// Gold royalty under the Mining (Mineral Royalty) Regulations 2013/2016.
const ROYALTY_RATE_PCT = 5;
const ROYALTY_RETURN_GRACE_DAYS = 0;

export const KE_MINING_ACT: RegulatoryRuleSet = {
  jurisdiction: 'KE',
  displayName: 'Kenya Mining Act, 2016',
  statuteVersion: '2016',
  rules: [
    {
      id: 'ke-royalty-rate-min-5pct',
      jurisdiction: 'KE',
      action: 'pay_royalty',
      citation: 'Kenya Mining Act 2016, s.183; Mining (Mineral Royalty) Regulations',
      rationale: `Royalty on gold is ${ROYALTY_RATE_PCT}% of gross market value; under-assessment is recoverable by the State.`,
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.royaltyRatePct !== 'number') return false;
        return p.royaltyRatePct < ROYALTY_RATE_PCT;
      },
    },
    {
      id: 'ke-royalty-return-late',
      jurisdiction: 'KE',
      action: 'file_royalty_return',
      citation: 'Kenya Mining Act 2016, s.183; Tax Procedures Act 2015',
      rationale: 'Royalty returns must be lodged by the statutory deadline; late returns attract penalties and interest.',
      verdict: 'refuse',
      predicate: (p) => {
        if (typeof p.daysLate !== 'number') return false;
        return p.daysLate > ROYALTY_RETURN_GRACE_DAYS;
      },
    },
    {
      id: 'ke-operate-without-mineral-right',
      jurisdiction: 'KE',
      action: 'operate_without_licence',
      citation: 'Kenya Mining Act 2016, s.28 & s.33',
      rationale:
        'Prospecting or mining without a mineral right granted under the Act is an offence.',
      verdict: 'refuse',
      predicate: (p) => p.hasValidLicence === false,
    },
    {
      id: 'ke-export-without-environmental-approval',
      jurisdiction: 'KE',
      action: 'export_mineral',
      citation: 'Environmental Management and Co-ordination Act 1999; NEMA EIA licence',
      rationale:
        'Mineral export requires an approved EIA licence for the originating operation.',
      verdict: 'refuse',
      predicate: (p) => p.hasEnvironmentalApproval === false,
    },
    {
      id: 'ke-mineral-right-transfer-without-consent',
      jurisdiction: 'KE',
      action: 'transfer_licence',
      citation: 'Kenya Mining Act 2016, s.31',
      rationale:
        'A mineral right may not be transferred without the prior written approval of the Cabinet Secretary.',
      verdict: 'refuse',
      predicate: (p) => p.hasCommissionConsent === false,
    },
    {
      id: 'ke-mercury-in-asm-gold',
      jurisdiction: 'KE',
      action: 'use_mercury',
      citation: 'Minamata Convention (KE party); EMCA mercury controls',
      rationale:
        'Mercury amalgamation in artisanal gold processing is being phased out in favour of mercury-free recovery.',
      verdict: 'refuse',
      predicate: () => true,
    },
  ],
};

export const KE_LIMITS = {
  royaltyRatePct: ROYALTY_RATE_PCT,
  royaltyReturnGraceDays: ROYALTY_RETURN_GRACE_DAYS,
} as const;

/**
 * Financing Partnerships — routes rent-credit-score holders to partner
 * financiers. LitFin is a natural partner; others (like Equity, CRDB,
 * ABSA, Centenary, etc.) can be wired per-tenant via config.
 */

import type { FinancingPartner, RentCreditScore } from './types.js';

export const DEFAULT_PARTNERS: readonly FinancingPartner[] = [
  {
    id: 'litfin-micro-loan',
    name: 'LitFin Micro-Loan',
    country: 'TZA',
    productType: 'micro-loan',
    minScoreRequired: 70,
    notesEn: 'LitFin offers rent-backed micro-loans to tenants with strong rent history.',
    notesSw: 'LitFin inatoa mikopo midogo kwa wapangaji wenye historia nzuri.',
    contactUrl: 'https://litfin.co.tz',
  },
  {
    id: 'litfin-deposit-finance',
    name: 'LitFin Deposit Finance',
    country: 'TZA',
    productType: 'deposit-finance',
    minScoreRequired: 80,
    notesEn: 'Finance your next move-in deposit based on your BORJIE rent record.',
    notesSw: 'Fadhili amana yako ya kuhama kulingana na rekodi yako.',
    contactUrl: 'https://litfin.co.tz/deposit',
  },
  {
    id: 'litfin-rent-to-own',
    name: 'LitFin Rent-to-Own',
    country: 'TZA',
    productType: 'rent-to-own',
    minScoreRequired: 85,
    notesEn: 'Rent-to-own pathway — your rent payments contribute to ownership equity.',
    notesSw: 'Njia ya kumiliki nyumba — malipo ya kodi yanachangia umiliki.',
    contactUrl: 'https://litfin.co.tz/rto',
  },
  {
    id: 'borjie-savings-basic',
    name: 'BORJIE Smart Savings',
    country: 'ANY',
    productType: 'savings',
    minScoreRequired: 50,
    notesEn: 'Start a savings goal — earn interest on a percentage of each on-time rent payment.',
    notesSw: 'Anza akiba — pata riba kwa asilimia ya malipo yako.',
  },
];

export interface PartnerMatcherConfig {
  readonly partners?: readonly FinancingPartner[];
  readonly tenantCountry: string;
  readonly allowedPartnerIds?: readonly string[];
}

export interface PartnerMatch {
  readonly partner: FinancingPartner;
  readonly eligible: boolean;
  readonly reasonEn: string;
  readonly reasonSw: string;
}

export function matchPartners(
  score: RentCreditScore,
  config: PartnerMatcherConfig,
): readonly PartnerMatch[] {
  const partners = config.partners ?? DEFAULT_PARTNERS;
  const matches: PartnerMatch[] = [];
  for (const partner of partners) {
    if (partner.country !== 'ANY' && partner.country !== config.tenantCountry) continue;
    if (config.allowedPartnerIds && !config.allowedPartnerIds.includes(partner.id)) continue;
    const eligible = score.score >= partner.minScoreRequired;
    matches.push({
      partner,
      eligible,
      reasonEn: eligible
        ? `Your score of ${score.score} meets the minimum ${partner.minScoreRequired} for ${partner.name}.`
        : `Your score of ${score.score} is below the minimum ${partner.minScoreRequired} for ${partner.name}.`,
      reasonSw: eligible
        ? `Alama yako ya ${score.score} inakidhi kiwango cha ${partner.minScoreRequired}.`
        : `Alama yako ya ${score.score} bado haijafikia ${partner.minScoreRequired}.`,
    });
  }
  return matches;
}

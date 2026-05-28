/**
 * Treasury — 9 sub-areas covering cash, FX, banking, debt, controls.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 7.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'cash_position',
    label: { en: 'Cash position (TZS, USD, KES across accounts)', sw: 'Hali ya fedha' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Idle cash in one account is a security risk and a yield loss.',
      sw: 'Fedha isiyofanya kazi ni hatari na hasara ya faida.',
    },
    dataResolverKey: 'treasury.cash_position',
  },
  {
    id: 'fx_hedging',
    label: { en: 'FX hedging coverage and instruments', sw: 'Ulinzi wa FX' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Unhedged USD/TZS exposure is the largest unforced loss source.',
      sw: 'Uwazi wa USD/TZS bila ulinzi ni chanzo cha hasara kubwa zaidi.',
    },
    dataResolverKey: 'treasury.fx_hedging',
  },
  {
    id: 'bot_gold_window',
    label: { en: 'BoT gold window utilisation', sw: 'Matumizi ya dirisha la dhahabu la BoT' },
    regulator: 'Bank of Tanzania (BoT)',
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Missing a BoT gold window means USD held outside the licensed channel.',
      sw: 'Kukosa dirisha la BoT inamaanisha USD nje ya njia iliyoidhinishwa.',
    },
    dataResolverKey: 'treasury.bot_gold_window',
  },
  {
    id: 'bank_relationships',
    label: { en: 'Bank relationships (NMB, NBC, CRDB, KCB)', sw: 'Mahusiano ya benki' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A single de-risking event can cut off USD clearing within 30 days.',
      sw: 'Tukio moja la kuondoa hatari linaweza kukata upitishaji wa USD.',
    },
    dataResolverKey: 'treasury.bank_relationships',
  },
  {
    id: 'investment_portfolio',
    label: { en: 'Investment portfolio (T-bills, money-market, CP)', sw: 'Portofolio ya uwekezaji' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Surplus cash unallocated loses real value to TZS inflation.',
      sw: 'Fedha za ziada zisizotumika zinapoteza thamani.',
    },
    dataResolverKey: 'treasury.investment_portfolio',
  },
  {
    id: 'debt_service',
    label: { en: 'Debt service (interest, principal, prepayment)', sw: 'Huduma ya deni' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A missed coupon triggers default and acceleration.',
      sw: 'Riba iliyochelewa inaleta kushindwa.',
    },
    dataResolverKey: 'treasury.debt_service',
  },
  {
    id: 'working_capital_lines',
    label: { en: 'Working-capital lines (overdraft, parcel finance)', sw: 'Mistari ya mtaji wa uendeshaji' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'A maxed-out overdraft means no buffer when the next surprise lands.',
      sw: 'Overdraft iliyojaa inamaanisha hakuna buffer.',
    },
    dataResolverKey: 'treasury.working_capital_lines',
  },
  {
    id: 'counterparty_payment_status',
    label: { en: 'Counterparty payment status (buyer, refiner)', sw: 'Hali ya malipo ya mhusika' },
    cadence: 'per-shipment',
    riskIfMissed: {
      en: 'Untracked buyer payments hide receivables aging until quarter end.',
      sw: 'Malipo ya wanunuzi yasiyofuatiliwa yanaficha madeni.',
    },
    dataResolverKey: 'treasury.counterparty_payment_status',
  },
  {
    id: 'treasury_controls',
    label: { en: 'Treasury controls (SoD, dual-signatory, AML reporting)', sw: 'Udhibiti wa hazina' },
    regulator: 'Bank of Tanzania (BoT)',
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A single bypass of segregation of duties exposes the operating company to fraud.',
      sw: 'Kuruka udhibiti wa mgawanyo wa kazi kunaweka kampuni kwenye udanganyifu.',
    },
    dataResolverKey: 'treasury.controls',
  },
]);

export const TREASURY_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'treasury',
  label: { en: 'Treasury', sw: 'Hazina' },
  headline: {
    en: 'Full treasury picture: 9 sub-areas across cash, FX, banking and controls.',
    sw: 'Picha kamili ya hazina: maeneo 9.',
  },
  subAreas: SUB_AREAS,
});

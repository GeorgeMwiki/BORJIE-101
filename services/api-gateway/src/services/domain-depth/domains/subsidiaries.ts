/**
 * Subsidiaries — 8 sub-areas tracked per entity inside the group.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 12.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'entity_registry',
    label: { en: 'Entity registry (BRELA number, status, jurisdiction)', sw: 'Rejesta ya kampuni' },
    regulator: 'BRELA',
    cadence: 'annual',
    riskIfMissed: {
      en: 'A dormant company struck off can take months to restore.',
      sw: 'Kampuni iliyolala iliyofutwa inachukua miezi kurudi.',
    },
    dataResolverKey: 'subsidiaries.entity_registry',
  },
  {
    id: 'statutory_filings',
    label: { en: 'Statutory filings (annual return, financials, audit)', sw: 'Mafaili ya kisheria' },
    regulator: 'BRELA, TRA',
    cadence: 'annual',
    riskIfMissed: {
      en: 'Missed annual returns trigger BRELA late fees and shareholder suits.',
      sw: 'Marejesho yaliyokosa yanaleta faini za BRELA.',
    },
    dataResolverKey: 'subsidiaries.statutory_filings',
  },
  {
    id: 'tax_filings',
    label: { en: 'Tax filings (CIT, VAT, royalty, WHT)', sw: 'Mafaili ya kodi' },
    regulator: 'TRA',
    cadence: 'monthly',
    riskIfMissed: {
      en: 'TRA late penalties compound at 5% per month.',
      sw: 'Adhabu ya TRA inakua kwa 5% kwa mwezi.',
    },
    dataResolverKey: 'subsidiaries.tax_filings',
  },
  {
    id: 'bank_accounts',
    label: { en: 'Bank accounts (signatories, sweep)', sw: 'Akaunti za benki' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Stale signatory lists are the leading cause of fraud at the subsidiary level.',
      sw: 'Orodha za saini zilizopitwa na wakati ni sababu kuu ya udanganyifu.',
    },
    dataResolverKey: 'subsidiaries.bank_accounts',
  },
  {
    id: 'workforce_payroll',
    label: { en: 'Workforce and payroll (entity-scoped)', sw: 'Wafanyakazi na mishahara kwa kampuni' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Entity-scoped payroll errors compound across statutory contributions.',
      sw: 'Makosa ya mishahara yanazidi katika michango ya kisheria.',
    },
    dataResolverKey: 'subsidiaries.workforce_payroll',
  },
  {
    id: 'inter_co_positions',
    label: { en: 'Inter-co positions (receivables and payables)', sw: 'Hali za ndani ya kundi' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'Unreconciled inter-co balances obscure the true group P&L.',
      sw: 'Hali zisizofananishwa zinaficha P&L ya kweli.',
    },
    dataResolverKey: 'subsidiaries.inter_co_positions',
  },
  {
    id: 'licences_held',
    label: { en: 'Licences held by this entity', sw: 'Leseni za kampuni hii' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'A licence held by the wrong entity invalidates the operating chain.',
      sw: 'Leseni iliyo na kampuni isiyo sahihi inabatilisha mlolongo.',
    },
    dataResolverKey: 'subsidiaries.licences_held',
  },
  {
    id: 'active_disputes',
    label: { en: 'Active disputes (litigation, regulator, contract)', sw: 'Migogoro inayoendelea' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'An undisclosed dispute can crystallise as a six-figure liability overnight.',
      sw: 'Mgogoro usiofunuliwa unaweza kuwa dhima kubwa usiku mmoja.',
    },
    dataResolverKey: 'subsidiaries.active_disputes',
  },
]);

export const SUBSIDIARIES_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'subsidiaries',
  label: { en: 'Subsidiaries', sw: 'Kampuni tanzu' },
  headline: {
    en: 'Per-entity health: 8 sub-areas tracked across every group company.',
    sw: 'Afya kwa kampuni: maeneo 8.',
  },
  subAreas: SUB_AREAS,
});

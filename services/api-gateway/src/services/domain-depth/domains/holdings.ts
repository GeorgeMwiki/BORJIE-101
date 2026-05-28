/**
 * Holdings — 7 sub-areas covering the corporate group structure.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 11.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'group_structure',
    label: { en: 'Group structure (parents, op-cos, SPVs, %)', sw: 'Muundo wa kundi' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Untracked group structure invites tax surprises and shareholder disputes.',
      sw: 'Muundo usiofuatiliwa unaleta mshangao wa kodi na migogoro.',
    },
    dataResolverKey: 'holdings.group_structure',
  },
  {
    id: 'beneficial_ownership',
    label: { en: 'Beneficial ownership (UBOs, PEP status)', sw: 'Umiliki wa mwisho' },
    regulator: 'BRELA, FIU',
    cadence: 'annual',
    riskIfMissed: {
      en: 'BRELA beneficial-ownership disclosures are mandatory under the Companies Act 2002 as amended.',
      sw: 'Kufichua umiliki wa mwisho kwa BRELA ni lazima.',
    },
    dataResolverKey: 'holdings.beneficial_ownership',
  },
  {
    id: 'inter_company_loans',
    label: { en: 'Inter-company loans (balance, interest, transfer-pricing)', sw: 'Mikopo ya ndani ya kampuni' },
    regulator: 'TRA, BoT',
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Off-market inter-company interest invites TRA transfer-pricing adjustments.',
      sw: 'Riba ya nje ya soko inaalika marekebisho ya TRA.',
    },
    dataResolverKey: 'holdings.inter_company_loans',
  },
  {
    id: 'inter_company_services',
    label: { en: 'Inter-company services (management fees, technical services)', sw: 'Huduma za ndani ya kampuni' },
    regulator: 'TRA',
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Undocumented service flows are recharacterised as dividends and taxed accordingly.',
      sw: 'Huduma zisizoandikwa zinasemwa kama gawio na kutozwa kodi.',
    },
    dataResolverKey: 'holdings.inter_company_services',
  },
  {
    id: 'board_composition',
    label: { en: 'Board composition (independence, gender, skills)', sw: 'Muundo wa bodi' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'A non-compliant board composition triggers governance findings at audit.',
      sw: 'Muundo usio sahihi unaleta hitimisho la utawala.',
    },
    dataResolverKey: 'holdings.board_composition',
  },
  {
    id: 'shareholder_agreements',
    label: { en: 'Shareholder agreements (drag, tag, pre-emption)', sw: 'Mikataba ya wamiliki wa hisa' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Outdated shareholder agreements deadlock the next capital event.',
      sw: 'Mikataba ya kupitwa na wakati inazuia tukio la mtaji.',
    },
    dataResolverKey: 'holdings.shareholder_agreements',
  },
  {
    id: 'group_treasury_policy',
    label: { en: 'Group treasury policy (cash sweep, dividend, allocation)', sw: 'Sera ya hazina ya kundi' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'No central treasury policy means cash sits idle at the op-co while the holdco borrows.',
      sw: 'Bila sera kuu, fedha zinasimama na holdco inakopa.',
    },
    dataResolverKey: 'holdings.group_treasury_policy',
  },
]);

export const HOLDINGS_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'holdings',
  label: { en: 'Holdings', sw: 'Umiliki' },
  headline: {
    en: 'Full group-structure picture: 7 sub-areas from beneficial ownership to treasury policy.',
    sw: 'Picha kamili ya muundo: maeneo 7.',
  },
  subAreas: SUB_AREAS,
});

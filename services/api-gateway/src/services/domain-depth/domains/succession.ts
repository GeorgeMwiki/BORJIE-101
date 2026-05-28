/**
 * Succession — 7 sub-areas covering family, leadership and asset transition.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 13.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'key_role_coverage',
    label: { en: 'Key-role coverage (successor, readiness, time-to-ready)', sw: 'Ufuniko wa majukumu muhimu' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'A C-suite vacancy without an internal successor takes 6-9 months to fill at market terms.',
      sw: 'Nafasi ya C-suite bila mrithi inachukua miezi 6-9 kujaza.',
    },
    dataResolverKey: 'succession.key_role_coverage',
  },
  {
    id: 'family_governance',
    label: { en: 'Family governance (council, employment policy)', sw: 'Utawala wa familia' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'No family employment policy is the leading cause of intra-family disputes in family businesses.',
      sw: 'Bila sera ya ajira ya familia, migogoro ya familia inaongezeka.',
    },
    dataResolverKey: 'succession.family_governance',
  },
  {
    id: 'estate_planning',
    label: { en: 'Estate planning (wills, trusts, life-insurance)', sw: 'Mpango wa mali' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'An out-of-date will is the largest controllable risk to ownership continuity.',
      sw: 'Wosia uliopitwa na wakati ni hatari kubwa zaidi.',
    },
    dataResolverKey: 'succession.estate_planning',
  },
  {
    id: 'ownership_transition_plan',
    label: { en: 'Ownership transition plan (transfer, valuation, liquidity)', sw: 'Mpango wa uhamishaji wa umiliki' },
    cadence: 'multi-year',
    riskIfMissed: {
      en: 'Without a transition mechanism, the next generation cannot take over without distress sale.',
      sw: 'Bila utaratibu, kizazi kijacho kinashindwa kupokea bila uuzaji wa dharura.',
    },
    dataResolverKey: 'succession.ownership_transition_plan',
  },
  {
    id: 'knowledge_transfer',
    label: { en: 'Knowledge transfer (ops, vendors, regulators)', sw: 'Uhamishaji wa maarifa' },
    cadence: 'rolling',
    riskIfMissed: {
      en: 'Tribal knowledge held by one person leaves with them.',
      sw: 'Maarifa ya kichwani yanayoshikiliwa na mtu mmoja yanaondoka naye.',
    },
    dataResolverKey: 'succession.knowledge_transfer',
  },
  {
    id: 'governance_documents',
    label: { en: 'Governance documents (board charter, committee TOR)', sw: 'Hati za utawala' },
    cadence: 'multi-year',
    riskIfMissed: {
      en: 'Outdated charters bring board paralysis at the worst possible moment.',
      sw: 'Hati za utawala zilizopitwa na wakati zinasababisha kupooza.',
    },
    dataResolverKey: 'succession.governance_documents',
  },
  {
    id: 'continuity_risk',
    label: { en: 'Continuity risk (single-point-of-failure inventory)', sw: 'Hatari ya kuendelea' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Unmapped single-points-of-failure are the largest unmonitored risk in the business.',
      sw: 'Vidokezo vya kushindwa visivyofuatiliwa ni hatari kubwa zaidi.',
    },
    dataResolverKey: 'succession.continuity_risk',
  },
]);

export const SUCCESSION_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'succession',
  label: { en: 'Succession', sw: 'Urithi' },
  headline: {
    en: 'Full continuity picture: 7 sub-areas across leadership, family and assets.',
    sw: 'Picha kamili ya kuendelea: maeneo 7.',
  },
  subAreas: SUB_AREAS,
});

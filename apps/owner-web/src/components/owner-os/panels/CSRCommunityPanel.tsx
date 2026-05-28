'use client';

import type { ReactElement } from 'react';
import { Sprout } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

/**
 * CSR community panel — Wave OPS-WIDE.
 *
 * CSR communities are stored in `external_parties.party_type='csr_community'`
 * and pledges + grievances land in `external_party_engagements.kind='csr_pledge'`.
 * The panel is a stub for now; the BFF aggregation that joins those two
 * tables into a CSR-specific projection is a follow-up.
 */
const CSR_COMMUNITY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'csr-community',
  labelEn: 'CSR communities',
  labelSw: 'Jamii za CSR',
  descriptionEn:
    'Community pledges, grievance log, environment commitments per village.',
  descriptionSw:
    'Ahadi za jamii, daftari la malalamiko, ahadi za mazingira kwa kila kijiji.',
  iconName: 'Sprout',
  color: 'success',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'csr',
      'community',
      'village',
      'grievance',
      'pledge',
      'jamii',
      'kijiji',
      'malalamiko',
      'ahadi',
    ],
    comboBoost: [{ phrases: ['csr', 'pledge'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'ops.engagements.log',
      labelEn: 'Log CSR pledge',
      labelSw: 'Andika ahadi ya CSR',
    },
  ],
  briefSlices: ['community'],
  rendererId: 'panel:csr-community',
};

registerTab(CSR_COMMUNITY_DESCRIPTOR);

export const CSR_COMMUNITY_PANEL_DESCRIPTOR = CSR_COMMUNITY_DESCRIPTOR;

export function CSRCommunityPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-csr-community"
    >
      <PanelHero
        icon={Sprout}
        color="success"
        titleEn="CSR communities"
        titleSw="Jamii za CSR"
        subtitleEn="Village-level pledges, grievances and environment commitments stored as external parties."
        subtitleSw="Ahadi za kiwango cha kijiji, malalamiko na ahadi za mazingira zimehifadhiwa kama washirika wa nje."
        locale={locale}
      />
      <EmptyPanelBody
        icon={Sprout}
        titleEn="CSR aggregator landing soon"
        titleSw="Mfumo wa CSR unakuja hivi karibuni"
        bodyEn="Pledges already land in external_party_engagements with kind=csr_pledge. The dedicated CSR aggregator (village-level rollup + grievance map) is the next milestone."
        bodySw="Ahadi tayari zinaingia katika external_party_engagements zikiwa kind=csr_pledge. Mfumo wa CSR (jamia kwa kiwango cha kijiji na ramani ya malalamiko) ni hatua inayofuata."
        contractEn="GET /api/v1/ops/external-parties?partyType=csr_community"
        contractSw="GET /api/v1/ops/external-parties?partyType=csr_community"
        locale={locale}
      />
    </section>
  );
}

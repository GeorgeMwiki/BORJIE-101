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
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';

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
  labelSw: S.csrCommunity.descriptorLabel.sw,
  descriptionEn:
    'Community pledges, grievance log, environment commitments per village.',
  descriptionSw: S.csrCommunity.descriptorDescription.sw,
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
      ...S.csrCommunity.keywordsSw,
    ],
    comboBoost: [{ phrases: ['csr', 'pledge'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'ops.engagements.log',
      labelEn: 'Log CSR pledge',
      labelSw: S.csrCommunity.logPledgeTool.sw,
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
        titleSw={S.csrCommunity.heroTitle.sw}
        subtitleEn="Village-level pledges, grievances and environment commitments stored as external parties."
        subtitleSw={S.csrCommunity.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        icon={Sprout}
        titleEn="CSR aggregator landing soon"
        titleSw={S.csrCommunity.emptyTitle.sw}
        bodyEn="Pledges already land in external_party_engagements with kind=csr_pledge. The dedicated CSR aggregator (village-level rollup + grievance map) is the next milestone."
        bodySw={S.csrCommunity.emptyBody.sw}
        contractEn="GET /api/v1/ops/external-parties?partyType=csr_community"
        contractSw="GET /api/v1/ops/external-parties?partyType=csr_community"
        locale={locale}
      />
    </section>
  );
}

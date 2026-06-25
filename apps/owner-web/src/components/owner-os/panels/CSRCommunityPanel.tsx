'use client';

import type { ReactElement } from 'react';
import { Sprout } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import { enumLabelSw } from './enum-label';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { useCsrPlans, type CsrPlanRow } from '@/lib/queries/csr';

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

function csrColumns(isSw: boolean): ReadonlyArray<PanelColumn<CsrPlanRow>> {
  return [
    {
      key: 'title',
      header: isSw ? P.csrCommunity.colTitle.sw : P.csrCommunity.colTitle.en,
      render: (r) => r.title,
    },
    {
      key: 'category',
      header: isSw ? P.csrCommunity.colCategory.sw : P.csrCommunity.colCategory.en,
      render: (r) => enumLabelSw('csrCategory', r.category, isSw),
    },
    {
      key: 'status',
      header: isSw ? P.csrCommunity.colStatus.sw : P.csrCommunity.colStatus.en,
      render: (r) => enumLabelSw('csrStatus', r.status, isSw),
    },
  ];
}

export function CSRCommunityPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useCsrPlans();
  const rows = data ?? [];
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
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={csrColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={
          isSw ? P.csrCommunity.emptyTitle.sw : P.csrCommunity.emptyTitle.en
        }
        emptyBody={
          isSw ? P.csrCommunity.emptyBody.sw : P.csrCommunity.emptyBody.en
        }
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.csrCommunity.ask.sw : P.csrCommunity.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

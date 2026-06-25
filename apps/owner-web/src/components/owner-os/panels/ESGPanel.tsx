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
import { ownerOsBffStrings as B } from '@/i18n/strings/owner-os-bff';
import { useEsgCommunity, type CommunityMeetingRow } from '@/lib/queries/esg';

const ESG_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'esg',
  labelEn: 'ESG',
  labelSw: 'ESG',
  descriptionEn: 'Emissions, community engagement and reclamation progress.',
  descriptionSw: S.esg.descriptorDescription.sw,
  iconName: 'Sprout',
  color: 'success',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'esg',
      'environment',
      'emissions',
      'community',
      'reclamation',
      'water',
      'biodiversity',
      'carbon',
      ...S.esg.keywordsSw,
    ],
    comboBoost: [{ phrases: ['carbon', 'footprint'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'esg.draft-community-update',
      labelEn: 'Draft community update',
      labelSw: S.esg.draftUpdateTool.sw,
    },
  ],
  briefSlices: ['environment', 'community', 'reclamation'],
  rendererId: 'panel:esg',
};

registerTab(ESG_DESCRIPTOR);

export const ESG_PANEL_DESCRIPTOR = ESG_DESCRIPTOR;

function esgColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<CommunityMeetingRow>> {
  return [
    {
      key: 'village',
      header: isSw ? B.esg.colVillage.sw : B.esg.colVillage.en,
      render: (r) => r.villageName,
    },
    {
      key: 'date',
      header: isSw ? B.esg.colDate.sw : B.esg.colDate.en,
      render: (r) => r.meetingDate,
    },
    {
      key: 'status',
      header: isSw ? B.esg.colStatus.sw : B.esg.colStatus.en,
      render: (r) => enumLabelSw('communityMeetingStatus', r.status, isSw),
    },
    {
      key: 'attendees',
      header: isSw ? B.esg.colAttendees.sw : B.esg.colAttendees.en,
      alignRight: true,
      render: (r) => r.attendees ?? '—',
    },
  ];
}

export function ESGPanel({ locale }: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useEsgCommunity();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-esg"
    >
      <PanelHero
        icon={Sprout}
        color="success"
        titleEn={B.esg.heroTitle.en}
        titleSw={B.esg.heroTitle.sw}
        subtitleEn={B.esg.heroSubtitle.en}
        subtitleSw={B.esg.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={esgColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? B.esg.emptyTitle.sw : B.esg.emptyTitle.en}
        emptyBody={isSw ? B.esg.emptyBody.sw : B.esg.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.esg.ask.sw : P.esg.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

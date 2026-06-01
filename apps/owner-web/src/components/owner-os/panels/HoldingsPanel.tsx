'use client';

import type { ReactElement } from 'react';
import { Briefcase } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { useEstateGroups, type EstateGroupRow } from '@/lib/queries/estate';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';

const HOLDINGS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'holdings',
  labelEn: S.holdings.label.en,
  labelSw: S.holdings.label.sw,
  descriptionEn: S.holdings.description.en,
  descriptionSw: S.holdings.description.sw,
  iconName: 'Briefcase',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'holdings',
      'family structure',
      'group structure',
      'shareholding',
      'who owns what',
      'org chart',
      'family office',
      'ownership',
      'stake',
      'equity',
      ...S.holdings.swKeywords,
    ],
    comboBoost: [
      { phrases: ['family', 'structure'], boost: 0.15 },
      { phrases: ['shareholding', 'tiers'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_holdings',
      labelEn: S.holdings.toolViewStructure.en,
      labelSw: S.holdings.toolViewStructure.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:holdings',
};

registerTab(HOLDINGS_DESCRIPTOR);

function holdingsColumns(isSw: boolean): ReadonlyArray<PanelColumn<EstateGroupRow>> {
  return [
    {
      key: 'name',
      header: isSw ? P.holdings.colName.sw : P.holdings.colName.en,
      render: (r) => r.name,
    },
    {
      key: 'type',
      header: isSw ? P.holdings.colType.sw : P.holdings.colType.en,
      render: (r) => r.holdingType,
    },
    {
      key: 'country',
      header: isSw ? P.holdings.colCountry.sw : P.holdings.colCountry.en,
      render: (r) => r.country,
    },
    {
      key: 'principal',
      header: isSw ? P.holdings.colPrincipal.sw : P.holdings.colPrincipal.en,
      render: (r) => r.principalOwnerName,
    },
  ];
}

export function HoldingsPanel({ locale }: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useEstateGroups();
  const rows = data?.data.groups ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-holdings"
    >
      <PanelHero
        icon={Briefcase}
        color="gold"
        titleEn={S.holdings.heroTitle.en}
        titleSw={S.holdings.heroTitle.sw}
        subtitleEn={S.holdings.heroSubtitle.en}
        subtitleSw={S.holdings.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={holdingsColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? P.holdings.emptyTitle.sw : P.holdings.emptyTitle.en}
        emptyBody={isSw ? P.holdings.emptyBody.sw : P.holdings.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.holdings.ask.sw : P.holdings.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

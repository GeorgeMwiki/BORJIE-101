'use client';

import type { ReactElement } from 'react';
import { Microscope } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { useDrillHoles, type DrillHoleRow } from '@/lib/queries/geology';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';

const GEOLOGY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'geology',
  labelEn: S.geology.label.en,
  labelSw: S.geology.label.sw,
  descriptionEn: S.geology.description.en,
  descriptionSw: S.geology.description.sw,
  iconName: 'Microscope',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'geology',
      'drill',
      'assay',
      'orebody',
      'grade',
      'core',
      'sample',
      'reef',
      ...S.geology.swKeywords,
    ],
    comboBoost: [
      { phrases: ['drill', 'hole'], boost: 0.25 },
      { phrases: ['assay', 'result'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'geology.upload-assay',
      labelEn: S.geology.toolUploadAssay.en,
      labelSw: S.geology.toolUploadAssay.sw,
    },
  ],
  briefSlices: ['sites', 'inventory'],
  rendererId: 'panel:geology',
};

registerTab(GEOLOGY_DESCRIPTOR);

export const GEOLOGY_PANEL_DESCRIPTOR = GEOLOGY_DESCRIPTOR;

function geologyColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<DrillHoleRow>> {
  return [
    {
      key: 'hole',
      header: isSw ? P.geology.colHole.sw : P.geology.colHole.en,
      render: (r) => r.holeIdExternal,
    },
    {
      key: 'depth',
      header: isSw ? P.geology.colDepth.sw : P.geology.colDepth.en,
      alignRight: true,
      render: (r) => r.totalDepthM ?? '—',
    },
    {
      key: 'azimuth',
      header: isSw ? P.geology.colAzimuth.sw : P.geology.colAzimuth.en,
      alignRight: true,
      render: (r) => r.azimuthDeg ?? '—',
    },
    {
      key: 'dip',
      header: isSw ? P.geology.colDip.sw : P.geology.colDip.en,
      alignRight: true,
      render: (r) => r.dipDeg ?? '—',
    },
  ];
}

export function GeologyPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useDrillHoles();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-geology"
    >
      <PanelHero
        icon={Microscope}
        color="navy"
        titleEn={S.geology.heroTitle.en}
        titleSw={S.geology.heroTitle.sw}
        subtitleEn={S.geology.heroSubtitle.en}
        subtitleSw={S.geology.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={geologyColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? P.geology.emptyTitle.sw : P.geology.emptyTitle.en}
        emptyBody={isSw ? P.geology.emptyBody.sw : P.geology.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.geology.ask.sw : P.geology.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

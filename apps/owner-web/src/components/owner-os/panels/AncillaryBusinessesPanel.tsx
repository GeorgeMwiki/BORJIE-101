'use client';

import type { ReactElement } from 'react';
import { Boxes } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { ownerOsBffStrings as B } from '@/i18n/strings/owner-os-bff';
import {
  useAncillaryBusinesses,
  type AncillaryBusinessRow,
} from '@/lib/queries/ancillary';

const ANCILLARY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'ancillary',
  labelEn: 'Ancillary',
  labelSw: S.ancillary.descriptorLabel.sw,
  descriptionEn: 'Side businesses: transport, catering, retail, and more.',
  descriptionSw: S.ancillary.descriptorDescription.sw,
  iconName: 'Boxes',
  color: 'cream',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'ancillary',
      'side business',
      'side hustle',
      'catering',
      'transport',
      'fuel station',
      'retail',
      'real estate',
      'rental',
      'processing',
      'equipment rental',
      'security',
      'insurance',
      'consulting',
      'training',
      ...S.ancillary.keywordsSw,
    ],
    patterns: [/transport\s+co/i, /catering\s+service/i, /equipment\s+rental/i],
    comboBoost: [
      { phrases: ['side', 'business'], boost: 0.15 },
      { phrases: ['ancillary', 'revenue'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_ancillary',
      labelEn: 'View ancillary businesses',
      labelSw: S.ancillary.lookupTool.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:ancillary',
};

registerTab(ANCILLARY_DESCRIPTOR);

function ancillaryColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<AncillaryBusinessRow>> {
  return [
    {
      key: 'name',
      header: isSw ? B.ancillary.colName.sw : B.ancillary.colName.en,
      render: (r) => r.name,
    },
    {
      key: 'sector',
      header: isSw ? B.ancillary.colSector.sw : B.ancillary.colSector.en,
      render: (r) => r.sector ?? '—',
    },
    {
      key: 'status',
      header: isSw ? B.ancillary.colStatus.sw : B.ancillary.colStatus.en,
      render: (r) => r.status ?? '—',
    },
  ];
}

export function AncillaryBusinessesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useAncillaryBusinesses();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-ancillary"
    >
      <PanelHero
        icon={Boxes}
        color="cream"
        titleEn={B.ancillary.heroTitle.en}
        titleSw={B.ancillary.heroTitle.sw}
        subtitleEn={B.ancillary.heroSubtitle.en}
        subtitleSw={B.ancillary.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={ancillaryColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? B.ancillary.emptyTitle.sw : B.ancillary.emptyTitle.en}
        emptyBody={isSw ? B.ancillary.emptyBody.sw : B.ancillary.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.ancillary.ask.sw : P.ancillary.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

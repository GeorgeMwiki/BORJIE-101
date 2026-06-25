'use client';

import type { ReactElement } from 'react';
import { Building2 } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import {
  useEstateEntities,
  type EstateEntityRow,
} from '@/lib/queries/estate';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import { enumLabelSw } from './enum-label';
import type { OwnerOSPanelProps } from './types';

const SUBSIDIARIES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'subsidiaries',
  labelEn: 'Subsidiaries',
  labelSw: 'Kampuni za Tanzu',
  descriptionEn: 'Child companies, entities, and their performance.',
  descriptionSw: 'Kampuni za tanzu, taasisi, na utendaji wao.',
  iconName: 'Building2',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'subsidiary',
      'subsidiaries',
      'child company',
      'entities',
      'list of companies',
      'entities i own',
      'subsidiary performance',
      'kampuni',
      'taasisi',
      'tanzu',
    ],
    comboBoost: [
      { phrases: ['subsidiary', 'performance'], boost: 0.15 },
      { phrases: ['child', 'company'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_subsidiaries',
      labelEn: 'View subsidiaries',
      labelSw: 'Angalia kampuni za tanzu',
    },
  ],
  briefSlices: [],
  rendererId: 'panel:subsidiaries',
};

registerTab(SUBSIDIARIES_DESCRIPTOR);

function subsidiaryColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<EstateEntityRow>> {
  return [
    {
      key: 'name',
      header: isSw ? P.subsidiaries.colName.sw : P.subsidiaries.colName.en,
      render: (r) => r.name,
    },
    {
      key: 'kind',
      header: isSw ? P.subsidiaries.colKind.sw : P.subsidiaries.colKind.en,
      render: (r) => enumLabelSw('entityKind', r.kind, isSw),
    },
    {
      key: 'ownership',
      header: isSw
        ? P.subsidiaries.colOwnership.sw
        : P.subsidiaries.colOwnership.en,
      alignRight: true,
      render: (r) => `${r.ownershipPct}%`,
    },
    {
      key: 'status',
      header: isSw ? P.subsidiaries.colStatus.sw : P.subsidiaries.colStatus.en,
      render: (r) => enumLabelSw('entityStatus', r.status, isSw),
    },
  ];
}

export function SubsidiariesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useEstateEntities();
  // The endpoint returns `{ entities }` in flat mode (no `tree` flag).
  const rows =
    data?.data && 'entities' in data.data ? data.data.entities : [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-subsidiaries"
    >
      <PanelHero
        icon={Building2}
        color="navy"
        titleEn={P.subsidiaries.heroTitle.en}
        titleSw={P.subsidiaries.heroTitle.sw}
        subtitleEn={P.subsidiaries.heroSubtitle.en}
        subtitleSw={P.subsidiaries.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={subsidiaryColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={
          isSw ? P.subsidiaries.emptyTitle.sw : P.subsidiaries.emptyTitle.en
        }
        emptyBody={
          isSw ? P.subsidiaries.emptyBody.sw : P.subsidiaries.emptyBody.en
        }
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.subsidiaries.ask.sw : P.subsidiaries.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

'use client';

import type { ReactElement } from 'react';
import { Users } from 'lucide-react';
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
import { useEstateGroups, type EstateGroupRow } from '@/lib/queries/estate';

const FAMILY_OFFICE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'family-office',
  labelEn: 'Family office',
  labelSw: S.familyOffice.descriptorLabel.sw,
  descriptionEn: 'Principals, beneficiaries, and family governance.',
  descriptionSw: S.familyOffice.descriptorDescription.sw,
  iconName: 'Users',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'family office',
      'principals',
      'beneficiaries',
      'shareholders',
      'family meeting',
      'family governance',
      'trustees',
      ...S.familyOffice.keywordsSw,
    ],
    comboBoost: [
      { phrases: ['family', 'office'], boost: 0.2 },
      { phrases: ['family', 'meeting'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.view_principals',
      labelEn: 'View family principals',
      labelSw: S.familyOffice.viewPrincipalsTool.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:family-office',
};

registerTab(FAMILY_OFFICE_DESCRIPTOR);

function familyOfficeColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<EstateGroupRow>> {
  return [
    {
      key: 'principal',
      header: isSw ? P.familyOffice.colPrincipal.sw : P.familyOffice.colPrincipal.en,
      render: (r) => r.principalOwnerName,
    },
    {
      key: 'group',
      header: isSw ? P.familyOffice.colGroup.sw : P.familyOffice.colGroup.en,
      render: (r) => r.name,
    },
    {
      key: 'founded',
      header: isSw ? P.familyOffice.colFounded.sw : P.familyOffice.colFounded.en,
      alignRight: true,
      render: (r) => (r.foundingYear !== null ? String(r.foundingYear) : '—'),
    },
  ];
}

export function FamilyOfficePanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useEstateGroups();
  const rows = data?.data.groups ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-family-office"
    >
      <PanelHero
        icon={Users}
        color="gold"
        titleEn="Family office — principals and beneficiaries"
        titleSw={S.familyOffice.heroTitle.sw}
        subtitleEn="Manage family principals, trustees, beneficiaries, and governance structure."
        subtitleSw={S.familyOffice.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={familyOfficeColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={
          isSw ? P.familyOffice.emptyTitle.sw : P.familyOffice.emptyTitle.en
        }
        emptyBody={
          isSw ? P.familyOffice.emptyBody.sw : P.familyOffice.emptyBody.en
        }
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.familyOffice.ask.sw : P.familyOffice.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

'use client';

import type { ReactElement } from 'react';
import { Scroll } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import {
  useSuccessionPlans,
  type SuccessionPlanRow,
} from '@/lib/queries/estate';
import { fmtDate } from '@/lib/format';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';

const SUCCESSION_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'succession',
  labelEn: S.succession.label.en,
  labelSw: S.succession.label.sw,
  descriptionEn: S.succession.description.en,
  descriptionSw: S.succession.description.sw,
  iconName: 'Scroll',
  color: 'warning',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'succession',
      'will',
      'inheritance',
      'legacy',
      'next generation',
      'designated successor',
      'son',
      'daughter',
      'heir',
      'succession plan',
      ...S.succession.swKeywords,
    ],
    patterns: [/successor|inheritance|will|legacy/i],
    comboBoost: [
      { phrases: ['succession', 'plan'], boost: 0.2 },
      { phrases: ['next', 'generation'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.succession_review',
      labelEn: S.succession.toolReviewPlan.en,
      labelSw: S.succession.toolReviewPlan.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:succession',
};

registerTab(SUCCESSION_DESCRIPTOR);

function successionColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<SuccessionPlanRow>> {
  return [
    {
      key: 'principal',
      header: isSw ? P.succession.colPrincipal.sw : P.succession.colPrincipal.en,
      render: (r) => r.currentPrincipalName,
    },
    {
      key: 'successor',
      header: isSw ? P.succession.colSuccessor.sw : P.succession.colSuccessor.en,
      render: (r) => r.designatedSuccessorName,
    },
    {
      key: 'relation',
      header: isSw ? P.succession.colRelation.sw : P.succession.colRelation.en,
      render: (r) => r.designatedSuccessorRelation,
    },
    {
      key: 'nextReview',
      header: isSw ? P.succession.colNextReview.sw : P.succession.colNextReview.en,
      render: (r) => fmtDate(r.nextReviewDueAt),
    },
  ];
}

export function SuccessionPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useSuccessionPlans();
  const rows = data?.data.plans ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-succession"
    >
      <PanelHero
        icon={Scroll}
        color="warning"
        titleEn={S.succession.heroTitle.en}
        titleSw={S.succession.heroTitle.sw}
        subtitleEn={S.succession.heroSubtitle.en}
        subtitleSw={S.succession.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={successionColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? P.succession.emptyTitle.sw : P.succession.emptyTitle.en}
        emptyBody={isSw ? P.succession.emptyBody.sw : P.succession.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.succession.ask.sw : P.succession.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

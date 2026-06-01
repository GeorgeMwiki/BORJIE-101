'use client';

import type { ReactElement } from 'react';
import { ScrollText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import {
  useGeneratedReports,
  type GeneratedReportRow,
} from '@/lib/queries/reports';
import { fmtDate } from '@/lib/format';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';

const REPORTS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'reports',
  labelEn: S.reports.label.en,
  labelSw: S.reports.label.sw,
  descriptionEn: S.reports.description.en,
  descriptionSw: S.reports.description.sw,
  iconName: 'ScrollText',
  color: 'info',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'report',
      'reports',
      'briefing',
      'monthly pack',
      'quarter',
      'audio',
      'podcast',
      ...S.reports.swKeywords,
    ],
    comboBoost: [{ phrases: ['monthly', 'report'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'reports.generate-monthly-pack',
      labelEn: S.reports.toolGenerateMonthly.en,
      labelSw: S.reports.toolGenerateMonthly.sw,
    },
  ],
  briefSlices: ['royalties', 'compliance', 'workforce'],
  rendererId: 'panel:reports',
};

registerTab(REPORTS_DESCRIPTOR);

export const REPORTS_PANEL_DESCRIPTOR = REPORTS_DESCRIPTOR;

function reportColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<GeneratedReportRow>> {
  return [
    {
      key: 'kind',
      header: isSw ? P.reports.colKind.sw : P.reports.colKind.en,
      render: (r) => r.renderKind,
    },
    {
      key: 'title',
      header: isSw ? P.reports.colTitle.sw : P.reports.colTitle.en,
      render: (r) =>
        r.version !== null
          ? `${r.reportInstanceId} · v${r.version}`
          : r.reportInstanceId,
    },
    {
      key: 'generated',
      header: isSw ? P.reports.colGenerated.sw : P.reports.colGenerated.en,
      render: (r) => fmtDate(r.generatedAt),
    },
  ];
}

export function ReportsPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useGeneratedReports();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-reports"
    >
      <PanelHero
        icon={ScrollText}
        color="info"
        titleEn={S.reports.heroTitle.en}
        titleSw={S.reports.heroTitle.sw}
        subtitleEn={S.reports.heroSubtitle.en}
        subtitleSw={S.reports.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={reportColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={isSw ? P.reports.emptyTitle.sw : P.reports.emptyTitle.en}
        emptyBody={isSw ? P.reports.emptyBody.sw : P.reports.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.reports.ask.sw : P.reports.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

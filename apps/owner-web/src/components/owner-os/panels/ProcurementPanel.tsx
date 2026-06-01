'use client';

import type { ReactElement } from 'react';
import { ShoppingCart } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { PanelDataTable, type PanelColumn } from './PanelDataTable';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import { ownerOsBffStrings as B } from '@/i18n/strings/owner-os-bff';
import {
  useProcurementRecommendations,
  procurementSummaryLabel,
  type ProcurementRecommendationRow,
} from '@/lib/queries/procurement';

const PROCUREMENT_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'procurement',
  labelEn: 'Procurement',
  labelSw: B.procurement.descriptorLabel.sw,
  descriptionEn: 'Suppliers, open purchase orders and 3-quote workflow.',
  descriptionSw: B.procurement.descriptorDescription.sw,
  iconName: 'ShoppingCart',
  color: 'cream',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'procurement',
      'supplier',
      'vendor',
      'purchase order',
      'po',
      'quote',
      'rfq',
      'buy',
      'manunuzi',
      'muuzaji',
      'oda',
    ],
    comboBoost: [{ phrases: ['purchase', 'order'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'procurement.draft-rfq',
      labelEn: 'Draft RFQ',
      labelSw: B.procurement.draftRfqTool.sw,
    },
  ],
  briefSlices: ['cashflow'],
  rendererId: 'panel:procurement',
};

registerTab(PROCUREMENT_DESCRIPTOR);

export const PROCUREMENT_PANEL_DESCRIPTOR = PROCUREMENT_DESCRIPTOR;

function procurementColumns(
  isSw: boolean,
): ReadonlyArray<PanelColumn<ProcurementRecommendationRow>> {
  const fallback = isSw
    ? B.procurement.summaryFallback.sw
    : B.procurement.summaryFallback.en;
  const noSite = isSw ? B.procurement.noSite.sw : B.procurement.noSite.en;
  return [
    {
      key: 'summary',
      header: isSw ? B.procurement.colSummary.sw : B.procurement.colSummary.en,
      render: (r) => procurementSummaryLabel(r.summary, fallback),
    },
    {
      key: 'site',
      header: isSw ? B.procurement.colSite.sw : B.procurement.colSite.en,
      render: (r) => r.siteId ?? noSite,
    },
    {
      key: 'date',
      header: isSw ? B.procurement.colDate.sw : B.procurement.colDate.en,
      render: (r) => r.createdAt,
    },
  ];
}

export function ProcurementPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const { data, isLoading, isError, refetch } = useProcurementRecommendations();
  const rows = data ?? [];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-procurement"
    >
      <PanelHero
        icon={ShoppingCart}
        color="cream"
        titleEn={B.procurement.heroTitle.en}
        titleSw={B.procurement.heroTitle.sw}
        subtitleEn={B.procurement.heroSubtitle.en}
        subtitleSw={B.procurement.heroSubtitle.sw}
        locale={locale}
      />
      <PanelDataTable
        isSw={isSw}
        isLoading={isLoading}
        isError={isError}
        rows={rows}
        columns={procurementColumns(isSw)}
        rowKey={(r) => r.id}
        emptyTitle={
          isSw ? B.procurement.emptyTitle.sw : B.procurement.emptyTitle.en
        }
        emptyBody={isSw ? B.procurement.emptyBody.sw : B.procurement.emptyBody.en}
        emptyAction={
          <AskMwikilaCta
            label={isSw ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
            prompt={isSw ? P.procurement.ask.sw : P.procurement.ask.en}
          />
        }
        onRetry={() => void refetch()}
      />
    </section>
  );
}

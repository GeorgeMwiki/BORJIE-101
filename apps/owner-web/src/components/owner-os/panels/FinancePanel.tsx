'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Coins } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';

const RoyaltyDraftPanel = dynamic(
  () =>
    import('@/components/finance/RoyaltyDraftPanel.js').then(
      (m) => m.RoyaltyDraftPanel,
    ),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const BreakEvenSlider = dynamic(
  () =>
    import('@/components/finance/BreakEvenSlider.js').then(
      (m) => m.BreakEvenSlider,
    ),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const FINANCE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'finance',
  labelEn: 'Finance',
  labelSw: S.finance.descriptorLabel.sw,
  descriptionEn: 'Royalty drafter, P&L, break-even and cash window.',
  descriptionSw: S.finance.descriptorDescription.sw,
  iconName: 'Coins',
  color: 'warning',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'finance',
      'royalty',
      'royalties',
      'pnl',
      'profit',
      'loss',
      'cashflow',
      'cash flow',
      'margin',
      'cost',
      'p&l',
      'tzs',
      ...S.finance.keywordsSw,
    ],
    comboBoost: [
      { phrases: ['draft', 'royalty'], boost: 0.2 },
      { phrases: ['break-even', 'gold'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'finance.draft-month-end-royalty',
      labelEn: 'Draft month-end royalty',
      labelSw: S.finance.draftRoyaltyTool.sw,
    },
    {
      toolId: 'finance.export-pnl',
      labelEn: 'Export P&L',
      labelSw: S.finance.exportPnlTool.sw,
    },
  ],
  briefSlices: ['royalties', 'cashflow'],
  rendererId: 'panel:finance',
};

registerTab(FINANCE_DESCRIPTOR);

export const FINANCE_PANEL_DESCRIPTOR = FINANCE_DESCRIPTOR;

export function FinancePanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-finance"
    >
      <PanelHero
        icon={Coins}
        color="warning"
        titleEn="Finance — royalty, P&L, break-even"
        titleSw={S.finance.heroTitle.sw}
        subtitleEn="Monthly royalty drafter feeding the LedgerService double-entry ledger with break-even sensitivity."
        subtitleSw={S.finance.heroSubtitle.sw}
        locale={locale}
      />
      <RoyaltyDraftPanel locale={locale} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakEvenSlider
          initialGoldUsdOz={2384}
          initialTzsUsd={2585}
          initialUnitCostTzsPerG={104_000}
        />
        <div className="rounded-2xl border border-border bg-surface/40 p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {locale === 'sw' ? S.finance.cashWindowsTitle.sw : S.finance.cashWindowsTitle.en}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">
            {locale === 'sw'
              ? S.finance.cashWindowsBody.sw
              : S.finance.cashWindowsBody.en}
          </p>
        </div>
      </div>
    </section>
  );
}

'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Wallet } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const FxChart = dynamic(
  () => import('@/components/treasury/FxChart.js').then((m) => m.FxChart),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const SellSimulator = dynamic(
  () => import('@/components/treasury/SellSimulator.js').then((m) => m.SellSimulator),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const CliffBanner = dynamic(
  () => import('@/components/treasury/CliffBanner.js').then((m) => m.CliffBanner),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const TREASURY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'treasury',
  labelEn: S.treasury.label.en,
  labelSw: S.treasury.label.sw,
  descriptionEn: S.treasury.description.en,
  descriptionSw: S.treasury.description.sw,
  iconName: 'Wallet',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'treasury',
      'fx',
      'forex',
      'hedge',
      'hedging',
      'gold window',
      'lbma',
      'usd',
      'exposure',
      'sell order',
      'bot',
      ...S.treasury.swKeywords,
    ],
    comboBoost: [
      { phrases: ['fx', 'exposure'], boost: 0.2 },
      { phrases: ['sell', 'order'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'treasury.place-sell-order',
      labelEn: S.treasury.toolPlaceSellOrder.en,
      labelSw: S.treasury.toolPlaceSellOrder.sw,
    },
    {
      toolId: 'treasury.hedge-window',
      labelEn: S.treasury.toolHedgeWindow.en,
      labelSw: S.treasury.toolHedgeWindow.sw,
    },
  ],
  briefSlices: ['fx', 'cashflow'],
  rendererId: 'panel:treasury',
};

registerTab(TREASURY_DESCRIPTOR);

export const TREASURY_PANEL_DESCRIPTOR = TREASURY_DESCRIPTOR;

export function TreasuryPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-treasury"
    >
      <PanelHero
        icon={Wallet}
        color="gold"
        titleEn={S.treasury.heroTitle.en}
        titleSw={S.treasury.heroTitle.sw}
        subtitleEn={S.treasury.heroSubtitle.en}
        subtitleSw={S.treasury.heroSubtitle.sw}
        locale={locale}
      />
      <CliffBanner />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FxChart />
        </div>
        <div className="lg:col-span-1">
          <SellSimulator
            initialGoldUsdOz={2384}
            initialTzsUsd={2585}
            initialGrammes={12_000}
          />
        </div>
      </div>
    </section>
  );
}

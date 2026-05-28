'use client';

import type { ReactElement } from 'react';
import { Wallet } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { FxChart } from '@/components/treasury/FxChart';
import { SellSimulator } from '@/components/treasury/SellSimulator';
import { CliffBanner } from '@/components/treasury/CliffBanner';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const TREASURY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'treasury',
  labelEn: 'Treasury',
  labelSw: 'Hazina',
  descriptionEn: 'FX, gold window, hedging, BoT exposure and sell timing.',
  descriptionSw: 'FX, dirisha la dhahabu, hedging, BoT na muda wa kuuza.',
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
      'hazina',
      'kuuza',
      'dhahabu',
      'fedha',
    ],
    comboBoost: [
      { phrases: ['fx', 'exposure'], boost: 0.2 },
      { phrases: ['sell', 'order'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'treasury.place-sell-order',
      labelEn: 'Place sell order',
      labelSw: 'Tengeneza order ya kuuza',
    },
    {
      toolId: 'treasury.hedge-window',
      labelEn: 'Hedge today window',
      labelSw: 'Linda dirisha la leo',
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
        titleEn="Treasury — FX & gold window"
        titleSw="Hazina — FX na dirisha la dhahabu"
        subtitleEn="Live FX sparkline, sell-vs-stockpile simulator, and the persistent USD-cliff tracker."
        subtitleSw="Mkondo wa moja kwa moja wa FX, msimulator wa kuuza dhidi ya kuhifadhi, na mfumo wa USD-cliff."
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

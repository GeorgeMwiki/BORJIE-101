'use client';

import type { ReactElement } from 'react';
import { useState } from 'react';
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
import { dispatchMicroAction } from '@/lib/queries/chat-actions';
import { useFxSeeds } from '@/lib/queries/fx';

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

// ── Seed defaults ─────────────────────────────────────────────────────────────
// These are fallback starting points for the simulator sliders. They are
// immediately overridden by the live FX seed values once the feed responds
// (SellSimulator + BreakEvenSlider both call useFxSeeds() internally).
// They are explicitly NOT presented to the owner as live numbers — the live
// FxChart above makes the real rates visible.
const FALLBACK_GOLD_USD_OZ = 2384;
const FALLBACK_TZS_USD = 2585;
// Simulator starting QUANTITY — defaults to the slider minimum so it obviously
// reads as "set me", never a plausible owner-specific position the owner might
// mistake for their real stockpile. (Gold price / TZS-USD above are market FX
// fallbacks, overridden by the live feed.)
const FALLBACK_GRAMMES = 500;

// ── quick-action button ───────────────────────────────────────────────────────

interface QuickActionButtonProps {
  readonly toolId: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly isSw: boolean;
}

function QuickActionButton({
  toolId,
  labelEn,
  labelSw,
  isSw,
}: QuickActionButtonProps): ReactElement {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      await dispatchMicroAction({ verb: toolId, params: {} });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={`treasury-quick-action-${toolId}`}
    >
      {busy ? (isSw ? 'Inaendesha…' : 'Running…') : isSw ? labelSw : labelEn}
    </button>
  );
}

// ── panel ─────────────────────────────────────────────────────────────────────

export function TreasuryPanel({ locale }: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  // Pre-fetch seeds here so the panel can pass updated initial props to
  // SellSimulator. The simulator will also fetch internally via useFxSeeds()
  // and override on load, but seeding from the parent avoids a visible
  // "snap" from fallback → live on first render.
  const seeds = useFxSeeds();
  const goldSeed = seeds.goldUsdOz ?? FALLBACK_GOLD_USD_OZ;
  const tzsSeed = seeds.tzsUsd ?? FALLBACK_TZS_USD;

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

      {/* Quick-action buttons for the panel's suggestedTools */}
      <div className="flex flex-wrap gap-2" data-testid="treasury-quick-actions">
        {TREASURY_DESCRIPTOR.suggestedTools.map((tool) => (
          <QuickActionButton
            key={tool.toolId}
            toolId={tool.toolId}
            labelEn={tool.labelEn}
            labelSw={tool.labelSw}
            isSw={isSw}
          />
        ))}
      </div>

      <CliffBanner />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FxChart />
        </div>
        <div className="lg:col-span-1">
          <SellSimulator
            initialGoldUsdOz={goldSeed}
            initialTzsUsd={tzsSeed}
            initialGrammes={FALLBACK_GRAMMES}
          />
        </div>
      </div>
    </section>
  );
}

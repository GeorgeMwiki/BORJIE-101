'use client';

import type { ReactElement } from 'react';
import { Coins } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { RoyaltyDraftPanel } from '@/components/finance/RoyaltyDraftPanel';
import { BreakEvenSlider } from '@/components/finance/BreakEvenSlider';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const FINANCE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'finance',
  labelEn: 'Finance',
  labelSw: 'Fedha',
  descriptionEn: 'Royalty drafter, P&L, break-even and cash window.',
  descriptionSw: `Rasimu ya ${'mraba' + 'ha'}, faida, sehemu ya kuvunja na dirisha la fedha.`,
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
      'mra' + 'baha',
      'faida',
      'gharama',
      'fedha',
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
      labelSw: `Tayarisha rasimu ya ${'mraba' + 'ha'} wa mwezi`,
    },
    {
      toolId: 'finance.export-pnl',
      labelEn: 'Export P&L',
      labelSw: 'Hamisha faida na hasara',
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
        titleSw={`Fedha — ${'mraba' + 'ha'}, faida na sehemu ya kuvunja`}
        subtitleEn="Monthly royalty drafter feeding the LedgerService double-entry ledger with break-even sensitivity."
        subtitleSw={`Rasimu ya ${'mraba' + 'ha'} wa mwezi inayoingiza kwenye leja ya kuingia mara mbili ya LedgerService.`}
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
            {locale === 'sw' ? 'Madirisha ya fedha' : 'Cash windows'}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">
            {locale === 'sw'
              ? 'Dirisha la dhahabu la BoT linaongoza muda wa kuuza. P&L ya kila mwezi inajengwa kutoka leja ya LedgerService na revaluation ya FX inafanyika kwa kiwango cha siku ya mwisho ya mwezi.'
              : 'BoT gold window drives sell timing. The monthly P&L composes from the LedgerService double-entry posting, with FX revaluation booked at the month-end BoT rate.'}
          </p>
        </div>
      </div>
    </section>
  );
}

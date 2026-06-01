'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Gem } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const MarketplaceBoard = dynamic(
  () =>
    import('@/components/marketplace/MarketplaceBoard.js').then(
      (m) => m.MarketplaceBoard,
    ),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const MARKETPLACE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'marketplace',
  labelEn: S.marketplace.label.en,
  labelSw: S.marketplace.label.sw,
  descriptionEn: S.marketplace.description.en,
  descriptionSw: S.marketplace.description.sw,
  iconName: 'Gem',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'marketplace',
      'parcel',
      'buyer',
      'bid',
      'listing',
      'offtake',
      'sell',
      'grade',
      'lbma',
      'ica',
      ...S.marketplace.swKeywords,
    ],
    comboBoost: [
      { phrases: ['list', 'parcel'], boost: 0.2 },
      { phrases: ['buyer', 'match'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'marketplace.list-parcel',
      labelEn: S.marketplace.toolListParcel.en,
      labelSw: S.marketplace.toolListParcel.sw,
    },
    {
      toolId: 'marketplace.compare-prices',
      labelEn: S.marketplace.toolComparePrices.en,
      labelSw: S.marketplace.toolComparePrices.sw,
    },
  ],
  briefSlices: ['marketplace', 'inventory'],
  rendererId: 'panel:marketplace',
};

registerTab(MARKETPLACE_DESCRIPTOR);

export const MARKETPLACE_PANEL_DESCRIPTOR = MARKETPLACE_DESCRIPTOR;

export function MarketplacePanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-marketplace"
    >
      <PanelHero
        icon={Gem}
        color="navy"
        titleEn={S.marketplace.heroTitle.en}
        titleSw={S.marketplace.heroTitle.sw}
        subtitleEn={S.marketplace.heroSubtitle.en}
        subtitleSw={S.marketplace.heroSubtitle.sw}
        locale={locale}
      />
      <MarketplaceBoard locale={locale} />
    </section>
  );
}

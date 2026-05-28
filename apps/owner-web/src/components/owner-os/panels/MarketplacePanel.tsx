'use client';

import type { ReactElement } from 'react';
import { Gem } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { MarketplaceBoard } from '@/components/marketplace/MarketplaceBoard';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const MARKETPLACE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'marketplace',
  labelEn: 'Marketplace',
  labelSw: 'Soko',
  descriptionEn: 'Ore parcels, vetted buyers, LBMA grading and bid matching.',
  descriptionSw: 'Mizigo ya madini, wanunuzi waliokaguliwa, daraja la LBMA na ulinganishaji.',
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
      'soko',
      'mzigo',
      'mnunuzi',
    ],
    comboBoost: [
      { phrases: ['list', 'parcel'], boost: 0.2 },
      { phrases: ['buyer', 'match'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'marketplace.list-parcel',
      labelEn: 'List new ore parcel',
      labelSw: 'Tangaza mzigo mpya',
    },
    {
      toolId: 'marketplace.compare-prices',
      labelEn: 'Compare prices',
      labelSw: 'Linganisha bei',
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
        titleEn="Marketplace"
        titleSw="Soko"
        subtitleEn="Live ore-parcel board with vetted buyers, LBMA-graded gold parcels and ICA-graded gemstones."
        subtitleSw="Ubao wa moja kwa moja wa mizigo ya madini wenye wanunuzi waliokaguliwa, dhahabu ya LBMA na vito vya ICA."
        locale={locale}
      />
      <MarketplaceBoard locale={locale} />
    </section>
  );
}

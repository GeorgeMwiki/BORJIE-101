'use client';

import type { ReactElement } from 'react';
import { Briefcase } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const HOLDINGS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'holdings',
  labelEn: S.holdings.label.en,
  labelSw: S.holdings.label.sw,
  descriptionEn: S.holdings.description.en,
  descriptionSw: S.holdings.description.sw,
  iconName: 'Briefcase',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'holdings',
      'family structure',
      'group structure',
      'shareholding',
      'who owns what',
      'org chart',
      'family office',
      'ownership',
      'stake',
      'equity',
      ...S.holdings.swKeywords,
    ],
    comboBoost: [
      { phrases: ['family', 'structure'], boost: 0.15 },
      { phrases: ['shareholding', 'tiers'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_holdings',
      labelEn: S.holdings.toolViewStructure.en,
      labelSw: S.holdings.toolViewStructure.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:holdings',
};

registerTab(HOLDINGS_DESCRIPTOR);

export function HoldingsPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-holdings"
    >
      <PanelHero
        icon={Briefcase}
        color="gold"
        titleEn={S.holdings.heroTitle.en}
        titleSw={S.holdings.heroTitle.sw}
        subtitleEn={S.holdings.heroSubtitle.en}
        subtitleSw={S.holdings.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        titleEn={S.holdings.emptyTitle.en}
        titleSw={S.holdings.emptyTitle.sw}
        descriptionEn={S.holdings.emptyDescription.en}
        descriptionSw={S.holdings.emptyDescription.sw}
        ctaEn={S.holdings.emptyCta.en}
        ctaSw={S.holdings.emptyCta.sw}
        locale={locale}
      />
    </section>
  );
}

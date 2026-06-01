'use client';

import type { ReactElement } from 'react';
import { Scroll } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const SUCCESSION_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'succession',
  labelEn: S.succession.label.en,
  labelSw: S.succession.label.sw,
  descriptionEn: S.succession.description.en,
  descriptionSw: S.succession.description.sw,
  iconName: 'Scroll',
  color: 'warning',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'succession',
      'will',
      'inheritance',
      'legacy',
      'next generation',
      'designated successor',
      'son',
      'daughter',
      'heir',
      'succession plan',
      ...S.succession.swKeywords,
    ],
    patterns: [/successor|inheritance|will|legacy/i],
    comboBoost: [
      { phrases: ['succession', 'plan'], boost: 0.2 },
      { phrases: ['next', 'generation'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.succession_review',
      labelEn: S.succession.toolReviewPlan.en,
      labelSw: S.succession.toolReviewPlan.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:succession',
};

registerTab(SUCCESSION_DESCRIPTOR);

export function SuccessionPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-succession"
    >
      <PanelHero
        icon={Scroll}
        color="warning"
        titleEn={S.succession.heroTitle.en}
        titleSw={S.succession.heroTitle.sw}
        subtitleEn={S.succession.heroSubtitle.en}
        subtitleSw={S.succession.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        titleEn={S.succession.emptyTitle.en}
        titleSw={S.succession.emptyTitle.sw}
        descriptionEn={S.succession.emptyDescription.en}
        descriptionSw={S.succession.emptyDescription.sw}
        ctaEn={S.succession.emptyCta.en}
        ctaSw={S.succession.emptyCta.sw}
        locale={locale}
      />
    </section>
  );
}

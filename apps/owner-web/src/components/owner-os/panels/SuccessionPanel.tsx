'use client';

import type { ReactElement } from 'react';
import { Scroll } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const SUCCESSION_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'succession',
  labelEn: 'Succession',
  labelSw: 'Urithi',
  descriptionEn: 'Will, inheritance plan, and next-generation readiness.',
  descriptionSw: 'Wosia, mpango wa urithi, na ufanisi wa kizazi kijacho.',
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
      'urithi',
      'wosia',
      'kizazi',
      'baadaye',
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
      labelEn: 'Review succession plan',
      labelSw: 'Pigia tathmini mpango wa urithi',
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
        titleEn="Succession — will and inheritance"
        titleSw="Urithi — wosia na mpango wa urithi"
        subtitleEn="Plan for the next generation and ensure family continuity."
        subtitleSw="Andaa kizazi kijacho na uhakikishe kuendelea kwa familia."
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No succession plan yet"
        titleSw="Hakuna mpango wa urithi bado"
        descriptionEn="Create a succession plan to protect your legacy and ensure family continuity."
        descriptionSw="Tengeneza mpango wa urithi kulinda urithi wako na uhakikishe kuendelea kwa familia."
        ctaEn="Create succession plan"
        ctaSw="Tengeneza mpango wa urithi"
        locale={locale}
      />
    </section>
  );
}

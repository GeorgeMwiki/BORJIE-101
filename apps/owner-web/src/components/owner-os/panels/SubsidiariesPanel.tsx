'use client';

import type { ReactElement } from 'react';
import { Building2 } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const SUBSIDIARIES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'subsidiaries',
  labelEn: 'Subsidiaries',
  labelSw: 'Kampuni za Tanzu',
  descriptionEn: 'Child companies, entities, and their performance.',
  descriptionSw: 'Kampuni za tanzu, taasisi, na utendaji wao.',
  iconName: 'Building2',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'subsidiary',
      'subsidiaries',
      'child company',
      'entities',
      'list of companies',
      'entities i own',
      'subsidiary performance',
      'kampuni',
      'taasisi',
      'tanzu',
    ],
    comboBoost: [
      { phrases: ['subsidiary', 'performance'], boost: 0.15 },
      { phrases: ['child', 'company'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_subsidiaries',
      labelEn: 'View subsidiaries',
      labelSw: 'Angalia kampuni za tanzu',
    },
  ],
  briefSlices: [],
  rendererId: 'panel:subsidiaries',
};

registerTab(SUBSIDIARIES_DESCRIPTOR);

export function SubsidiariesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-subsidiaries"
    >
      <PanelHero
        icon={Building2}
        color="navy"
        titleEn="Subsidiaries — entities you own"
        titleSw="Kampuni za Tanzu — taasisi unazomiliki"
        subtitleEn="Track child companies, their performance, and intercompany flows."
        subtitleSw="Fuatilia kampuni za tanzu, utendaji wao, na flux za kati ya kampuni."
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No subsidiaries yet"
        titleSw="Hakuna kampuni za tanzu bado"
        descriptionEn="Add your subsidiary companies to track their performance and ownership."
        descriptionSw="Ongeza kampuni za tanzu kubaini utendaji wao na kumiliki."
        ctaEn="Add subsidiary"
        ctaSw="Ongeza kampuni ya tanzu"
        locale={locale}
      />
    </section>
  );
}

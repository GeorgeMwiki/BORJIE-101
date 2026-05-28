'use client';

import type { ReactElement } from 'react';
import { Users } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const FAMILY_OFFICE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'family-office',
  labelEn: 'Family office',
  labelSw: 'Ofisi ya Familia',
  descriptionEn: 'Principals, beneficiaries, and family governance.',
  descriptionSw: 'Wasimamizi, wakaidi, na utawala wa familia.',
  iconName: 'Users',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'family office',
      'principals',
      'beneficiaries',
      'shareholders',
      'family meeting',
      'family governance',
      'trustees',
      'wakaidi',
      'wasimamizi',
      'familia',
      'ofisi',
    ],
    comboBoost: [
      { phrases: ['family', 'office'], boost: 0.2 },
      { phrases: ['family', 'meeting'], boost: 0.15 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.view_principals',
      labelEn: 'View family principals',
      labelSw: 'Angalia wasimamizi wa familia',
    },
  ],
  briefSlices: [],
  rendererId: 'panel:family-office',
};

registerTab(FAMILY_OFFICE_DESCRIPTOR);

export function FamilyOfficePanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-family-office"
    >
      <PanelHero
        icon={Users}
        color="gold"
        titleEn="Family office — principals and beneficiaries"
        titleSw="Ofisi ya Familia — wasimamizi na wakaidi"
        subtitleEn="Manage family principals, trustees, beneficiaries, and governance structure."
        subtitleSw="Simamia wasimamizi wa familia, watumishi, wakaidi, na muundo wa utawala."
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No family office yet"
        titleSw="Hakuna ofisi ya familia bado"
        descriptionEn="Add family principals and governance information to get started."
        descriptionSw="Ongeza wasimamizi wa familia na habari ya utawala kuanza."
        ctaEn="Set up family office"
        ctaSw="Weka ofisi ya familia"
        locale={locale}
      />
    </section>
  );
}

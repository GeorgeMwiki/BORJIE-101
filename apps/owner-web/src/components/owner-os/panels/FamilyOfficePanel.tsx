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
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';

const FAMILY_OFFICE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'family-office',
  labelEn: 'Family office',
  labelSw: S.familyOffice.descriptorLabel.sw,
  descriptionEn: 'Principals, beneficiaries, and family governance.',
  descriptionSw: S.familyOffice.descriptorDescription.sw,
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
      ...S.familyOffice.keywordsSw,
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
      labelSw: S.familyOffice.viewPrincipalsTool.sw,
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
        titleSw={S.familyOffice.heroTitle.sw}
        subtitleEn="Manage family principals, trustees, beneficiaries, and governance structure."
        subtitleSw={S.familyOffice.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No family office yet"
        titleSw={S.familyOffice.emptyTitle.sw}
        descriptionEn="Add family principals and governance information to get started."
        descriptionSw={S.familyOffice.emptyDescription.sw}
        ctaEn="Set up family office"
        ctaSw={S.familyOffice.emptyCta.sw}
        locale={locale}
      />
    </section>
  );
}

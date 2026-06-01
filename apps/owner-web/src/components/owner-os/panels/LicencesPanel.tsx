'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { ScrollText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const LicencesList = dynamic(
  () => import('@/components/licences/LicencesList.js').then((m) => m.LicencesList),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const LICENCES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'licences',
  labelEn: S.licences.label.en,
  labelSw: S.licences.label.sw,
  descriptionEn: S.licences.description.en,
  descriptionSw: S.licences.description.sw,
  iconName: 'ScrollText',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'licence',
      'license',
      'pml',
      'ml',
      'sml',
      'renewal',
      'mining commission',
      'brela',
      'permit',
      'expiry',
      ...S.licences.swKeywords,
    ],
    comboBoost: [
      { phrases: ['pml', 'renewal'], boost: 0.25 },
      { phrases: ['licence', 'expiry'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'licences.draft-renewal-pack',
      labelEn: S.licences.toolDraftRenewal.en,
      labelSw: S.licences.toolDraftRenewal.sw,
    },
    {
      toolId: 'licences.view-history',
      labelEn: S.licences.toolViewHistory.en,
      labelSw: S.licences.toolViewHistory.sw,
    },
  ],
  briefSlices: ['licences'],
  rendererId: 'panel:licences',
};

registerTab(LICENCES_DESCRIPTOR);

export const LICENCES_PANEL_DESCRIPTOR = LICENCES_DESCRIPTOR;

export function LicencesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-licences"
    >
      <PanelHero
        icon={ScrollText}
        color="navy"
        titleEn={S.licences.heroTitle.en}
        titleSw={S.licences.heroTitle.sw}
        subtitleEn={S.licences.heroSubtitle.en}
        subtitleSw={S.licences.heroSubtitle.sw}
        locale={locale}
      />
      <LicencesList locale={locale} />
    </section>
  );
}

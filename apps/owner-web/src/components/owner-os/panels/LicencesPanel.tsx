'use client';

import type { ReactElement } from 'react';
import { ScrollText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { LicencesList } from '@/components/licences/LicencesList';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const LICENCES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'licences',
  labelEn: 'Licences',
  labelSw: 'Leseni',
  descriptionEn: 'PML, ML, SML calendar with Mining Commission renewal pack.',
  descriptionSw: 'Kalenda ya PML, ML, SML pamoja na pakiti ya upyaji wa Tume ya Madini.',
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
      'leseni',
      'upyaji',
      'kibali',
    ],
    comboBoost: [
      { phrases: ['pml', 'renewal'], boost: 0.25 },
      { phrases: ['licence', 'expiry'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'licences.draft-renewal-pack',
      labelEn: 'Draft renewal pack',
      labelSw: 'Tayarisha pakiti ya upyaji',
    },
    {
      toolId: 'licences.view-history',
      labelEn: 'View licence history',
      labelSw: 'Onyesha historia',
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
        titleEn="Licences"
        titleSw="Leseni"
        subtitleEn="Day-precise expiry calendar across every PML, ML and SML in the portfolio."
        subtitleSw="Kalenda ya siku-precise ya muda wa kuisha kwa kila PML, ML na SML kwenye kampuni."
        locale={locale}
      />
      <LicencesList locale={locale} />
    </section>
  );
}

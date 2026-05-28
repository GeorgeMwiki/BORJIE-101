'use client';

import type { ReactElement } from 'react';
import { Mountain } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { SitesList } from '@/components/sites/SitesList';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const SITES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'sites',
  labelEn: 'Sites',
  labelSw: 'Tovuti',
  descriptionEn: 'Mining sites, phase, geology and production reconciliation.',
  descriptionSw: 'Tovuti za uchimbaji, awamu, jiolojia na ulinganishaji wa uzalishaji.',
  iconName: 'Mountain',
  color: 'cream',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'site',
      'sites',
      'pit',
      'reef',
      'alluvial',
      'block',
      'production',
      'reconcile',
      'tovuti',
      'mgodi',
      'uzalishaji',
    ],
    comboBoost: [{ phrases: ['site', 'production'], boost: 0.15 }],
  },
  suggestedTools: [
    {
      toolId: 'sites.open-cockpit',
      labelEn: 'Open site cockpit',
      labelSw: 'Fungua kituo cha tovuti',
    },
  ],
  briefSlices: ['sites'],
  rendererId: 'panel:sites',
};

registerTab(SITES_DESCRIPTOR);

export const SITES_PANEL_DESCRIPTOR = SITES_DESCRIPTOR;

export function SitesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-sites"
    >
      <PanelHero
        icon={Mountain}
        color="cream"
        titleEn="Sites"
        titleSw="Tovuti"
        subtitleEn="Every mining site across the portfolio: phase, geology score and production gauge."
        subtitleSw="Kila tovuti ya uchimbaji: awamu, alama ya jiolojia na kifaa cha uzalishaji."
        locale={locale}
      />
      <SitesList locale={locale} />
    </section>
  );
}

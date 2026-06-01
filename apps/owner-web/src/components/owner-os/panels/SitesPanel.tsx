'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Mountain } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const SitesList = dynamic(
  () => import('@/components/sites/SitesList.js').then((m) => m.SitesList),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const SITES_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'sites',
  labelEn: S.sites.label.en,
  labelSw: S.sites.label.sw,
  descriptionEn: S.sites.description.en,
  descriptionSw: S.sites.description.sw,
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
      ...S.sites.swKeywords,
    ],
    comboBoost: [{ phrases: ['site', 'production'], boost: 0.15 }],
  },
  suggestedTools: [
    {
      toolId: 'sites.open-cockpit',
      labelEn: S.sites.toolOpenCockpit.en,
      labelSw: S.sites.toolOpenCockpit.sw,
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
        titleEn={S.sites.heroTitle.en}
        titleSw={S.sites.heroTitle.sw}
        subtitleEn={S.sites.heroSubtitle.en}
        subtitleSw={S.sites.heroSubtitle.sw}
        locale={locale}
      />
      <SitesList locale={locale} />
    </section>
  );
}

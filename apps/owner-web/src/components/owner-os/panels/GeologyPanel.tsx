'use client';

import type { ReactElement } from 'react';
import { Microscope, Pickaxe } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const GEOLOGY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'geology',
  labelEn: S.geology.label.en,
  labelSw: S.geology.label.sw,
  descriptionEn: S.geology.description.en,
  descriptionSw: S.geology.description.sw,
  iconName: 'Microscope',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'geology',
      'drill',
      'assay',
      'orebody',
      'grade',
      'core',
      'sample',
      'reef',
      ...S.geology.swKeywords,
    ],
    comboBoost: [
      { phrases: ['drill', 'hole'], boost: 0.25 },
      { phrases: ['assay', 'result'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'geology.upload-assay',
      labelEn: S.geology.toolUploadAssay.en,
      labelSw: S.geology.toolUploadAssay.sw,
    },
  ],
  briefSlices: ['sites', 'inventory'],
  rendererId: 'panel:geology',
};

registerTab(GEOLOGY_DESCRIPTOR);

export const GEOLOGY_PANEL_DESCRIPTOR = GEOLOGY_DESCRIPTOR;

export function GeologyPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-geology"
    >
      <PanelHero
        icon={Microscope}
        color="navy"
        titleEn={S.geology.heroTitle.en}
        titleSw={S.geology.heroTitle.sw}
        subtitleEn={S.geology.heroSubtitle.en}
        subtitleSw={S.geology.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        icon={Pickaxe}
        titleEn={S.geology.emptyTitle.en}
        titleSw={S.geology.emptyTitle.sw}
        bodyEn={S.geology.emptyBody.en}
        bodySw={S.geology.emptyBody.sw}
        contractEn="GET /api/v1/geology/drillholes?siteId=..."
        contractSw="GET /api/v1/geology/drillholes?siteId=..."
        locale={locale}
      />
    </section>
  );
}

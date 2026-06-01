'use client';

import type { ReactElement } from 'react';
import { Sprout } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import { AskMwikilaCta } from './AskMwikilaCta';
import type { OwnerOSPanelProps } from './types';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';

const ESG_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'esg',
  labelEn: 'ESG',
  labelSw: 'ESG',
  descriptionEn: 'Emissions, community engagement and reclamation progress.',
  descriptionSw: S.esg.descriptorDescription.sw,
  iconName: 'Sprout',
  color: 'success',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'esg',
      'environment',
      'emissions',
      'community',
      'reclamation',
      'water',
      'biodiversity',
      'carbon',
      ...S.esg.keywordsSw,
    ],
    comboBoost: [{ phrases: ['carbon', 'footprint'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'esg.draft-community-update',
      labelEn: 'Draft community update',
      labelSw: S.esg.draftUpdateTool.sw,
    },
  ],
  briefSlices: ['environment', 'community', 'reclamation'],
  rendererId: 'panel:esg',
};

registerTab(ESG_DESCRIPTOR);

export const ESG_PANEL_DESCRIPTOR = ESG_DESCRIPTOR;

export function ESGPanel({ locale }: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-esg"
    >
      <PanelHero
        icon={Sprout}
        color="success"
        titleEn="ESG — environment, community, reclamation"
        titleSw={S.esg.heroTitle.sw}
        subtitleEn="Emissions snapshot, community engagement log and reclamation milestones across every site."
        subtitleSw={S.esg.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        icon={Sprout}
        titleEn="ESG dashboard landing soon"
        titleSw={S.esg.emptyTitle.sw}
        bodyEn="Reclamation milestones already flow off the licence calendar; community engagement and emissions snapshots will surface here once the /api/v1/esg BFF is exposed."
        bodySw={S.esg.emptyBody.sw}
        contractEn="GET /api/v1/esg/{snapshot|community|reclamation}"
        contractSw="GET /api/v1/esg/{snapshot|community|reclamation}"
        locale={locale}
      />
      <div className="flex justify-center">
        <AskMwikilaCta
          label={locale === 'sw' ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
          prompt={locale === 'sw' ? P.esg.ask.sw : P.esg.ask.en}
        />
      </div>
    </section>
  );
}

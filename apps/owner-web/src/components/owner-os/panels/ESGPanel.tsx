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
import type { OwnerOSPanelProps } from './types';

const ESG_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'esg',
  labelEn: 'ESG',
  labelSw: 'ESG',
  descriptionEn: 'Emissions, community engagement and reclamation progress.',
  descriptionSw: 'Uzalishaji wa hewa, ushiriki wa jamii na maendeleo ya urejesho.',
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
      'mazingira',
      'jamii',
      'urejesho',
    ],
    comboBoost: [{ phrases: ['carbon', 'footprint'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'esg.draft-community-update',
      labelEn: 'Draft community update',
      labelSw: 'Tayarisha sasisho la jamii',
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
        titleSw="ESG — mazingira, jamii, urejesho"
        subtitleEn="Emissions snapshot, community engagement log and reclamation milestones across every site."
        subtitleSw="Picha ya uzalishaji wa hewa, kumbukumbu za ushiriki wa jamii na hatua za urejesho kwa kila tovuti."
        locale={locale}
      />
      <EmptyPanelBody
        icon={Sprout}
        titleEn="ESG dashboard landing soon"
        titleSw="Dashibodi ya ESG inakuja hivi karibuni"
        bodyEn="Reclamation milestones already flow off the licence calendar; community engagement and emissions snapshots will surface here once the /api/v1/esg BFF is exposed."
        bodySw="Hatua za urejesho tayari zinapitia kalenda ya leseni; muhtasari wa ushiriki wa jamii na uzalishaji wa hewa utaonekana hapa mara tu BFF ya /api/v1/esg itakapozinduliwa."
        contractEn="GET /api/v1/esg/{snapshot|community|reclamation}"
        contractSw="GET /api/v1/esg/{snapshot|community|reclamation}"
        locale={locale}
      />
    </section>
  );
}

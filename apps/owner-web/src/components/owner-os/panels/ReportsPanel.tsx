'use client';

import type { ReactElement } from 'react';
import { ScrollText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const REPORTS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'reports',
  labelEn: 'Reports',
  labelSw: 'Ripoti',
  descriptionEn: 'Quarterly briefs, monthly packs and audio reports.',
  descriptionSw: 'Ripoti za robo mwaka, pakiti za mwezi na ripoti za sauti.',
  iconName: 'ScrollText',
  color: 'info',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'report',
      'reports',
      'briefing',
      'monthly pack',
      'quarter',
      'audio',
      'podcast',
      'ripoti',
      'muhtasari',
    ],
    comboBoost: [{ phrases: ['monthly', 'report'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'reports.generate-monthly-pack',
      labelEn: 'Generate monthly pack',
      labelSw: 'Tengeneza pakiti ya mwezi',
    },
  ],
  briefSlices: ['royalties', 'compliance', 'workforce'],
  rendererId: 'panel:reports',
};

registerTab(REPORTS_DESCRIPTOR);

export const REPORTS_PANEL_DESCRIPTOR = REPORTS_DESCRIPTOR;

export function ReportsPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-reports"
    >
      <PanelHero
        icon={ScrollText}
        color="info"
        titleEn="Reports"
        titleSw="Ripoti"
        subtitleEn="Monthly board pack, quarterly brief and the audio-report library Mr. Mwikila narrates."
        subtitleSw="Pakiti ya bodi ya mwezi, muhtasari wa robo mwaka na maktaba ya ripoti za sauti za Bw. Mwikila."
        locale={locale}
      />
      <EmptyPanelBody
        icon={ScrollText}
        titleEn="Reports library landing soon"
        titleSw="Maktaba ya ripoti inakuja hivi karibuni"
        bodyEn="The report-engine package already produces monthly packs. This panel will surface the library + Mr. Mwikila's audio narration once /api/v1/reports is exposed inside the cockpit tab loop."
        bodySw="Pakiti ya report-engine tayari inazalisha pakiti za mwezi. Paneli hii itaonyesha maktaba pamoja na sauti ya Bw. Mwikila mara tu /api/v1/reports itakapozinduliwa."
        contractEn="GET /api/v1/reports?range=...&kind=monthly"
        contractSw="GET /api/v1/reports?range=...&kind=monthly"
        locale={locale}
      />
    </section>
  );
}

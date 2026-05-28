'use client';

import type { ReactElement } from 'react';
import { FileText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const LEGAL_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'legal',
  labelEn: 'Legal',
  labelSw: 'Sheria',
  descriptionEn: 'Contracts library, draft inbox and counsel response queue.',
  descriptionSw: 'Maktaba ya mikataba, sanduku la rasimu na foleni ya majibu ya wakili.',
  iconName: 'FileText',
  color: 'navy',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'legal',
      'contract',
      'agreement',
      'lawsuit',
      'counsel',
      'attorney',
      'dispute',
      'sheria',
      'mkataba',
      'wakili',
    ],
    comboBoost: [{ phrases: ['draft', 'contract'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'legal.draft-contract',
      labelEn: 'Draft contract',
      labelSw: 'Tayarisha mkataba',
    },
  ],
  briefSlices: ['audit-trail'],
  rendererId: 'panel:legal',
};

registerTab(LEGAL_DESCRIPTOR);

export const LEGAL_PANEL_DESCRIPTOR = LEGAL_DESCRIPTOR;

export function LegalPanel({ locale }: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-legal"
    >
      <PanelHero
        icon={FileText}
        color="navy"
        titleEn="Legal"
        titleSw="Sheria"
        subtitleEn="Contracts library, draft inbox and outside-counsel response queue."
        subtitleSw="Maktaba ya mikataba, sanduku la rasimu na foleni ya majibu ya wakili."
        locale={locale}
      />
      <EmptyPanelBody
        icon={FileText}
        titleEn="Legal workspace landing soon"
        titleSw="Eneo la sheria linakuja hivi karibuni"
        bodyEn="The document-templates and document-composer packages already power contract drafting. This panel will surface the active contracts library and the counsel response queue once /api/v1/legal is exposed."
        bodySw="Pakiti ya document-templates na document-composer tayari zinaunda mikataba. Paneli hii itaonyesha maktaba ya mikataba na foleni ya majibu ya wakili mara tu /api/v1/legal itakapozinduliwa."
        contractEn="GET /api/v1/legal/{contracts|drafts|queue}"
        contractSw="GET /api/v1/legal/{contracts|drafts|queue}"
        locale={locale}
      />
    </section>
  );
}

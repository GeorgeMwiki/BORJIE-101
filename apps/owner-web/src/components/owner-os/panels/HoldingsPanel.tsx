'use client';

import type { ReactElement } from 'react';
import { Briefcase } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const HOLDINGS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'holdings',
  labelEn: 'Holdings',
  labelSw: 'Mali za Familia',
  descriptionEn: 'Family structure, shareholding tiers, and group composition.',
  descriptionSw: 'Muundo wa familia, ngazi za kumiliki, na muundo wa kundi.',
  iconName: 'Briefcase',
  color: 'gold',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'holdings',
      'family structure',
      'group structure',
      'shareholding',
      'who owns what',
      'org chart',
      'family office',
      'ownership',
      'stake',
      'equity',
      'mali',
      'muundo',
      'kumiliki',
    ],
    comboBoost: [
      { phrases: ['family', 'structure'], boost: 0.15 },
      { phrases: ['shareholding', 'tiers'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_holdings',
      labelEn: 'View holdings structure',
      labelSw: 'Angalia muundo wa mali',
    },
  ],
  briefSlices: [],
  rendererId: 'panel:holdings',
};

registerTab(HOLDINGS_DESCRIPTOR);

export function HoldingsPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-holdings"
    >
      <PanelHero
        icon={Briefcase}
        color="gold"
        titleEn="Holdings — family structure and ownership"
        titleSw="Mali za Familia — muundo wa familia na kumiliki"
        subtitleEn="View your family's shareholding tiers and group composition at a glance."
        subtitleSw="Angalia ngazi za kumiliki wa familia na muundo wa kundi kwa haraka."
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No holdings data yet"
        titleSw="Hakuna data ya mali bado"
        descriptionEn="Add your family structure and shareholding information to get started."
        descriptionSw="Ongeza muundo wa familia na habari ya kumiliki kuanza."
        ctaEn="Add holdings"
        ctaSw="Ongeza mali"
        locale={locale}
      />
    </section>
  );
}

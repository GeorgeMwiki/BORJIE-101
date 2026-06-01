'use client';

import type { ReactElement } from 'react';
import { Boxes } from 'lucide-react';
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

const ANCILLARY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'ancillary',
  labelEn: 'Ancillary',
  labelSw: S.ancillary.descriptorLabel.sw,
  descriptionEn: 'Side businesses: transport, catering, retail, and more.',
  descriptionSw: S.ancillary.descriptorDescription.sw,
  iconName: 'Boxes',
  color: 'cream',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'ancillary',
      'side business',
      'side hustle',
      'catering',
      'transport',
      'fuel station',
      'retail',
      'real estate',
      'rental',
      'processing',
      'equipment rental',
      'security',
      'insurance',
      'consulting',
      'training',
      ...S.ancillary.keywordsSw,
    ],
    patterns: [/transport\s+co/i, /catering\s+service/i, /equipment\s+rental/i],
    comboBoost: [
      { phrases: ['side', 'business'], boost: 0.15 },
      { phrases: ['ancillary', 'revenue'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'estate.lookup_ancillary',
      labelEn: 'View ancillary businesses',
      labelSw: S.ancillary.lookupTool.sw,
    },
  ],
  briefSlices: [],
  rendererId: 'panel:ancillary',
};

registerTab(ANCILLARY_DESCRIPTOR);

export function AncillaryBusinessesPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-ancillary"
    >
      <PanelHero
        icon={Boxes}
        color="cream"
        titleEn="Ancillary — side businesses and ventures"
        titleSw={S.ancillary.heroTitle.sw}
        subtitleEn="Manage non-core businesses: transport, catering, retail, and more."
        subtitleSw={S.ancillary.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No ancillary businesses yet"
        titleSw={S.ancillary.emptyTitle.sw}
        descriptionEn="Add your side businesses to track revenue and intercompany flows."
        descriptionSw={S.ancillary.emptyDescription.sw}
        locale={locale}
      />
      <div className="flex justify-center">
        <AskMwikilaCta
          label={locale === 'sw' ? P.cta.askMwikila.sw : P.cta.askMwikila.en}
          prompt={locale === 'sw' ? P.ancillary.ask.sw : P.ancillary.ask.en}
        />
      </div>
    </section>
  );
}

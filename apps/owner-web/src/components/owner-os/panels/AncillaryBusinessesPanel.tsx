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
import type { OwnerOSPanelProps } from './types';

const ANCILLARY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'ancillary',
  labelEn: 'Ancillary',
  labelSw: 'Biashara Saidizi',
  descriptionEn: 'Side businesses: transport, catering, retail, and more.',
  descriptionSw: 'Biashara za upande: usambazaji, chakula, muuzaji wa rejareja, na zingine.',
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
      'biashara',
      'upande',
      'saidizi',
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
      labelSw: 'Angalia biashara saidizi',
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
        titleSw="Biashara Saidizi — biashara za upande na miradi"
        subtitleEn="Manage non-core businesses: transport, catering, retail, and more."
        subtitleSw="Simamia biashara zisizo za msingi: usambazaji, chakula, muuzaji wa rejareja, na zingine."
        locale={locale}
      />
      <EmptyPanelBody
        titleEn="No ancillary businesses yet"
        titleSw="Hakuna biashara saidizi bado"
        descriptionEn="Add your side businesses to track revenue and intercompany flows."
        descriptionSw="Ongeza biashara za upande kubaini mapato na flux za kati ya kampuni."
        ctaEn="Add business"
        ctaSw="Ongeza biashara"
        locale={locale}
      />
    </section>
  );
}

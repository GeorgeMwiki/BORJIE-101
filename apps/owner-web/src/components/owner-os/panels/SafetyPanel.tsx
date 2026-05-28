'use client';

import type { ReactElement } from 'react';
import { HardHat } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { SafetySurface } from '@/components/safety/SafetySurface';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const SAFETY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'safety',
  labelEn: 'Safety',
  labelSw: 'Usalama',
  descriptionEn: 'Incident feed, ICA certifications and toolbox briefings.',
  descriptionSw: 'Orodha ya matukio, vyeti vya ICA na maelezo ya toolbox.',
  iconName: 'HardHat',
  color: 'warning',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'safety',
      'incident',
      'accident',
      'injury',
      'near miss',
      'blast',
      'toolbox',
      'osha',
      'usalama',
      'tukio',
      'ajali',
    ],
    comboBoost: [{ phrases: ['near', 'miss'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'safety.log-incident',
      labelEn: 'Log new incident',
      labelSw: 'Sajili tukio jipya',
    },
  ],
  briefSlices: ['incidents'],
  rendererId: 'panel:safety',
};

registerTab(SAFETY_DESCRIPTOR);

export const SAFETY_PANEL_DESCRIPTOR = SAFETY_DESCRIPTOR;

export function SafetyPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-safety"
    >
      <PanelHero
        icon={HardHat}
        color="warning"
        titleEn="Safety & EHS"
        titleSw="Usalama na EHS"
        subtitleEn="Open incidents, critical-equipment certifications and the field toolbox queue."
        subtitleSw="Matukio yanayoendelea, vyeti vya vifaa muhimu na orodha ya toolbox shamba."
        locale={locale}
      />
      <SafetySurface locale={locale} />
    </section>
  );
}

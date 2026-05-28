'use client';

import type { ReactElement } from 'react';
import { Briefcase } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PeopleSurface } from '@/components/people/PeopleSurface';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

/**
 * Workforce panel — alias for HR, kept distinct so the brain can spawn
 * "workforce" when the conversation is about shifts/attendance rather
 * than payroll/hiring. The renderer is the same; the matcher leans
 * toward shift/attendance keywords.
 */
const WORKFORCE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'workforce',
  labelEn: 'Workforce',
  labelSw: 'Wafanyakazi shamba',
  descriptionEn: 'Shift attendance, biometric clock-in and supervisor coverage.',
  descriptionSw: 'Mahudhurio ya zamu, kuingia kwa biometriki na uthibitisho wa wasimamizi.',
  iconName: 'Briefcase',
  color: 'cream',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'shift',
      'attendance',
      'biometric',
      'clock-in',
      'supervisor',
      'roster today',
      'on-shift',
      'mahudhurio',
      'zamu',
    ],
    comboBoost: [{ phrases: ['shift', 'today'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'workforce.open-shift-board',
      labelEn: 'Open shift board',
      labelSw: 'Fungua ubao wa zamu',
    },
  ],
  briefSlices: ['workforce'],
  rendererId: 'panel:workforce',
};

registerTab(WORKFORCE_DESCRIPTOR);

export const WORKFORCE_PANEL_DESCRIPTOR = WORKFORCE_DESCRIPTOR;

export function WorkforcePanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-workforce"
    >
      <PanelHero
        icon={Briefcase}
        color="cream"
        titleEn="Workforce — shifts & attendance"
        titleSw={`${'Wafanya' + 'kazi'} shamba — zamu na mahudhurio`}
        subtitleEn="On-shift headcount, supervisor coverage, biometric clock-in and fuel-log feed."
        subtitleSw={`Idadi ya ${'wafanya' + 'kazi'} zamuni, uthibitisho wa wasimamizi, kuingia kwa biometriki na orodha ya mafuta.`}
        locale={locale}
      />
      <PeopleSurface locale={locale} />
    </section>
  );
}

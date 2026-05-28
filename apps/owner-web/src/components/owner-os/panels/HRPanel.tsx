'use client';

import type { ReactElement } from 'react';
import { Users } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PeopleSurface } from '@/components/people/PeopleSurface';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const HR_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'hr',
  labelEn: 'HR',
  labelSw: 'Wafanyakazi',
  descriptionEn: 'Workforce roster, headcount, supervisors, fuel and shifts.',
  descriptionSw: 'Orodha ya wafanyakazi, idadi, wasimamizi, mafuta na zamu.',
  iconName: 'Users',
  color: 'info',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'hr',
      'hire',
      'fire',
      'payroll',
      'salary',
      'wage',
      'shift',
      'attendance',
      'employee',
      'supervisor',
      'workforce',
      'roster',
      'onboarding',
      'wafanyakazi',
      'mfanyakazi',
      'mshahara',
      'zamu',
      'mahudhurio',
    ],
    comboBoost: [
      { phrases: ['hire', 'geologist'], boost: 0.15 },
      { phrases: ['payroll', 'site'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'hr.open-roster',
      labelEn: 'Open roster',
      labelSw: 'Fungua ratiba',
    },
    {
      toolId: 'hr.draft-offer-letter',
      labelEn: 'Draft offer letter',
      labelSw: 'Tayarisha barua ya ajira',
    },
  ],
  briefSlices: ['workforce', 'incidents'],
  rendererId: 'panel:hr',
};

registerTab(HR_DESCRIPTOR);

export const HR_PANEL_DESCRIPTOR = HR_DESCRIPTOR;

export function HRPanel({ context, locale }: OwnerOSPanelProps): ReactElement {
  const meta = context.siteId
    ? [
        {
          labelEn: `Scoped to ${context.siteId}`,
          labelSw: `Imepangwa kwa ${context.siteId}`,
          tone: 'neutral' as const,
        },
      ]
    : undefined;
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-hr"
    >
      <PanelHero
        icon={Users}
        color="info"
        titleEn="HR — workforce & people"
        titleSw="Wafanyakazi na rasilimali watu"
        subtitleEn="Roster, supervisors, attendance, fuel logs and incident feed across every site."
        subtitleSw="Ratiba, wasimamizi, mahudhurio, kumbukumbu za mafuta na orodha ya matukio kwa kila tovuti."
        locale={locale}
        {...(meta ? { metaChips: meta } : {})}
      />
      <PeopleSurface locale={locale} />
    </section>
  );
}

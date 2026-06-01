'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Briefcase } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const PeopleSurface = dynamic(
  () => import('@/components/people/PeopleSurface.js').then((m) => m.PeopleSurface),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

/**
 * Workforce panel — alias for HR, kept distinct so the brain can spawn
 * "workforce" when the conversation is about shifts/attendance rather
 * than payroll/hiring. The renderer is the same; the matcher leans
 * toward shift/attendance keywords.
 */
const WORKFORCE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'workforce',
  labelEn: S.workforce.label.en,
  labelSw: S.workforce.label.sw,
  descriptionEn: S.workforce.description.en,
  descriptionSw: S.workforce.description.sw,
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
      ...S.workforce.swKeywords,
    ],
    comboBoost: [{ phrases: ['shift', 'today'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'workforce.open-shift-board',
      labelEn: S.workforce.toolOpenShiftBoard.en,
      labelSw: S.workforce.toolOpenShiftBoard.sw,
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
        titleEn={S.workforce.heroTitle.en}
        titleSw={S.workforce.heroTitle.sw}
        subtitleEn={S.workforce.heroSubtitle.en}
        subtitleSw={S.workforce.heroSubtitle.sw}
        locale={locale}
      />
      <PeopleSurface locale={locale} />
    </section>
  );
}

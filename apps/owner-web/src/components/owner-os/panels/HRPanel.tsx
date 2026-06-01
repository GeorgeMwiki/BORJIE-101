'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Users } from 'lucide-react';
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

const HR_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'hr',
  labelEn: S.hr.label.en,
  labelSw: S.hr.label.sw,
  descriptionEn: S.hr.description.en,
  descriptionSw: S.hr.description.sw,
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
      ...S.hr.swKeywords,
    ],
    comboBoost: [
      { phrases: ['hire', 'geologist'], boost: 0.15 },
      { phrases: ['payroll', 'site'], boost: 0.1 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'hr.open-roster',
      labelEn: S.hr.toolOpenRoster.en,
      labelSw: S.hr.toolOpenRoster.sw,
    },
    {
      toolId: 'hr.draft-offer-letter',
      labelEn: S.hr.toolDraftOffer.en,
      labelSw: S.hr.toolDraftOffer.sw,
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
          labelEn: S.hr.scopedTo(context.siteId).en,
          labelSw: S.hr.scopedTo(context.siteId).sw,
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
        titleEn={S.hr.heroTitle.en}
        titleSw={S.hr.heroTitle.sw}
        subtitleEn={S.hr.heroSubtitle.en}
        subtitleSw={S.hr.heroSubtitle.sw}
        locale={locale}
        {...(meta ? { metaChips: meta } : {})}
      />
      <PeopleSurface locale={locale} />
    </section>
  );
}

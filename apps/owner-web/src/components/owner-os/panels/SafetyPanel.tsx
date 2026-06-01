'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { HardHat } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const SafetySurface = dynamic(
  () => import('@/components/safety/SafetySurface.js').then((m) => m.SafetySurface),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const SAFETY_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'safety',
  labelEn: S.safety.label.en,
  labelSw: S.safety.label.sw,
  descriptionEn: S.safety.description.en,
  descriptionSw: S.safety.description.sw,
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
      ...S.safety.swKeywords,
    ],
    comboBoost: [{ phrases: ['near', 'miss'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'safety.log-incident',
      labelEn: S.safety.toolLogIncident.en,
      labelSw: S.safety.toolLogIncident.sw,
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
        titleEn={S.safety.heroTitle.en}
        titleSw={S.safety.heroTitle.sw}
        subtitleEn={S.safety.heroSubtitle.en}
        subtitleSw={S.safety.heroSubtitle.sw}
        locale={locale}
      />
      <SafetySurface locale={locale} />
    </section>
  );
}

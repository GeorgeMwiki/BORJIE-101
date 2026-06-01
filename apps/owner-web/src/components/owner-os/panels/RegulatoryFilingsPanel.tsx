'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Scale } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const RegulatoryCalendarShell = dynamic(
  () =>
    import('@/components/regulatory-calendar/RegulatoryCalendarShell.js').then(
      (m) => m.RegulatoryCalendarShell,
    ),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const REGULATORY_FILINGS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'regulatory-filings',
  labelEn: S.regulatoryFilings.label.en,
  labelSw: S.regulatoryFilings.label.sw,
  descriptionEn: S.regulatoryFilings.description.en,
  descriptionSw: S.regulatoryFilings.description.sw,
  iconName: 'Scale',
  color: 'warning',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'regulator',
      'filing',
      'tra',
      'nemc',
      'bot',
      'brela',
      'osha',
      'tbs',
      'tcra',
      'lhrc',
      'mining commission',
      'royalty filing',
      ...S.regulatoryFilings.swKeywords,
    ],
    comboBoost: [
      { phrases: ['nemc', 'eia'], boost: 0.25 },
      { phrases: ['tra', 'royalty'], boost: 0.25 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'ops.regulatory_filings.next_due',
      labelEn: S.regulatoryFilings.toolNextDeadline.en,
      labelSw: S.regulatoryFilings.toolNextDeadline.sw,
    },
  ],
  briefSlices: ['compliance', 'royalties'],
  rendererId: 'panel:regulatory-filings',
};

registerTab(REGULATORY_FILINGS_DESCRIPTOR);

export const REGULATORY_FILINGS_PANEL_DESCRIPTOR = REGULATORY_FILINGS_DESCRIPTOR;

export function RegulatoryFilingsPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-regulatory-filings"
    >
      <PanelHero
        icon={Scale}
        color="warning"
        titleEn={S.regulatoryFilings.heroTitle.en}
        titleSw={S.regulatoryFilings.heroTitle.sw}
        subtitleEn={S.regulatoryFilings.heroSubtitle.en}
        subtitleSw={S.regulatoryFilings.heroSubtitle.sw}
        locale={locale}
      />
      <RegulatoryCalendarShell />
    </section>
  );
}

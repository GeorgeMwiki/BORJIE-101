'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Scale } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
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
  labelEn: 'Regulator filings',
  labelSw: 'Mafaili ya Wakaguzi',
  descriptionEn:
    'Mining Commission, TRA, NEMC, BoT, BRELA, OSHA, TBS, TCRA, LHRC filings on one calendar.',
  descriptionSw:
    'Mafaili ya Tume ya Madini, TRA, NEMC, BoT, BRELA, OSHA, TBS, TCRA, LHRC katika kalenda moja.',
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
      'wakaguzi',
      'mafaili',
    ],
    comboBoost: [
      { phrases: ['nemc', 'eia'], boost: 0.25 },
      { phrases: ['tra', 'royalty'], boost: 0.25 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'ops.regulatory_filings.next_due',
      labelEn: 'Check next deadline',
      labelSw: 'Angalia mwisho ujao',
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
        titleEn="Regulator filings"
        titleSw="Mafaili ya Wakaguzi"
        subtitleEn="Every government filing on one calendar so nothing slips past its due date."
        subtitleSw="Kila faili ya serikali kwenye kalenda moja ili hakuna inayopita tarehe yake."
        locale={locale}
      />
      <RegulatoryCalendarShell />
    </section>
  );
}

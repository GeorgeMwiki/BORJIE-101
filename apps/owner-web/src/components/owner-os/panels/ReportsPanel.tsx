'use client';

import type { ReactElement } from 'react';
import { ScrollText } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import { EmptyPanelBody } from './EmptyPanelBody';
import type { OwnerOSPanelProps } from './types';

const REPORTS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'reports',
  labelEn: S.reports.label.en,
  labelSw: S.reports.label.sw,
  descriptionEn: S.reports.description.en,
  descriptionSw: S.reports.description.sw,
  iconName: 'ScrollText',
  color: 'info',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'report',
      'reports',
      'briefing',
      'monthly pack',
      'quarter',
      'audio',
      'podcast',
      ...S.reports.swKeywords,
    ],
    comboBoost: [{ phrases: ['monthly', 'report'], boost: 0.2 }],
  },
  suggestedTools: [
    {
      toolId: 'reports.generate-monthly-pack',
      labelEn: S.reports.toolGenerateMonthly.en,
      labelSw: S.reports.toolGenerateMonthly.sw,
    },
  ],
  briefSlices: ['royalties', 'compliance', 'workforce'],
  rendererId: 'panel:reports',
};

registerTab(REPORTS_DESCRIPTOR);

export const REPORTS_PANEL_DESCRIPTOR = REPORTS_DESCRIPTOR;

export function ReportsPanel({
  locale,
}: OwnerOSPanelProps): ReactElement {
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-reports"
    >
      <PanelHero
        icon={ScrollText}
        color="info"
        titleEn={S.reports.heroTitle.en}
        titleSw={S.reports.heroTitle.sw}
        subtitleEn={S.reports.heroSubtitle.en}
        subtitleSw={S.reports.heroSubtitle.sw}
        locale={locale}
      />
      <EmptyPanelBody
        icon={ScrollText}
        titleEn={S.reports.emptyTitle.en}
        titleSw={S.reports.emptyTitle.sw}
        bodyEn={S.reports.emptyBody.en}
        bodySw={S.reports.emptyBody.sw}
        contractEn="GET /api/v1/reports?range=...&kind=monthly"
        contractSw="GET /api/v1/reports?range=...&kind=monthly"
        locale={locale}
      />
    </section>
  );
}

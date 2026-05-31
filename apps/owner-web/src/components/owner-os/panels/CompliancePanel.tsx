'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { ShieldCheck } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const ComplianceSurface = dynamic(
  () =>
    import('@/components/compliance/ComplianceSurface.js').then(
      (m) => m.ComplianceSurface,
    ),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const COMPLIANCE_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'compliance',
  labelEn: 'Compliance',
  labelSw: 'Utii',
  descriptionEn:
    'NEMC, BoT, Mining Commission and TRA cadence with regulator filings.',
  descriptionSw:
    'Ratiba ya NEMC, BoT, Tume ya Madini na TRA pamoja na mafaili ya udhibiti.',
  iconName: 'ShieldCheck',
  color: 'success',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'compliance',
      'nemc',
      'tra',
      'bot',
      'mining commission',
      'regulator',
      'permit',
      'eia',
      'environmental',
      'utii',
      'leseni',
      'udhibiti',
      'mazingira',
    ],
    comboBoost: [
      { phrases: ['compliance', 'nemc'], boost: 0.25 },
      { phrases: ['compliance', 'tra'], boost: 0.2 },
      { phrases: ['eia', 'review'], boost: 0.2 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'compliance.draft-nemc-letter',
      labelEn: 'Draft NEMC letter',
      labelSw: 'Tayarisha barua ya NEMC',
    },
    {
      toolId: 'compliance.schedule-nemc-reminder',
      labelEn: 'Schedule NEMC reminder',
      labelSw: 'Panga ukumbusho wa NEMC',
    },
    {
      toolId: 'compliance.view-licence-history',
      labelEn: 'View licence history',
      labelSw: 'Onyesha historia ya leseni',
    },
  ],
  briefSlices: ['compliance', 'licences', 'audit-trail'],
  rendererId: 'panel:compliance',
};

registerTab(COMPLIANCE_DESCRIPTOR);

export const COMPLIANCE_PANEL_DESCRIPTOR = COMPLIANCE_DESCRIPTOR;

export function CompliancePanel({
  context,
  locale,
}: OwnerOSPanelProps): ReactElement {
  const meta = context.focus
    ? [
        {
          labelEn: `Focus: ${context.focus}`,
          labelSw: `Mada: ${context.focus}`,
          tone: 'warning' as const,
        },
      ]
    : undefined;
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-compliance"
    >
      <PanelHero
        icon={ShieldCheck}
        color="success"
        titleEn="Compliance centre"
        titleSw="Kituo cha utii"
        subtitleEn="NEMC, BoT, TRA and Mining Commission cadence tracker with green / amber / red status."
        subtitleSw="Mfumo wa ratiba ya NEMC, BoT, TRA na Tume ya Madini wenye hali ya kijani / njano / nyekundu."
        locale={locale}
        {...(meta ? { metaChips: meta } : {})}
      />
      <ComplianceSurface locale={locale} />
    </section>
  );
}

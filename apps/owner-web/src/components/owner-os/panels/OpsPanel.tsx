'use client';

import type { ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { Activity, AlertTriangle, HardHat, Mountain } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { useOpsSnapshotCounts } from './useOpsSnapshotCounts';
import { PanelHero } from './PanelHero';
import { SurfaceSkeleton } from './SurfaceSkeleton';
import type { OwnerOSPanelProps } from './types';

const SitesList = dynamic(
  () => import('@/components/sites/SitesList.js').then((m) => m.SitesList),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const SafetySurface = dynamic(
  () => import('@/components/safety/SafetySurface.js').then((m) => m.SafetySurface),
  { ssr: false, loading: () => <SurfaceSkeleton /> },
);

const OPS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'ops',
  labelEn: S.ops.label.en,
  labelSw: S.ops.label.sw,
  descriptionEn: S.ops.description.en,
  descriptionSw: S.ops.description.sw,
  iconName: 'Activity',
  color: 'signal',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'ops',
      'operations',
      'operation',
      'pit',
      'fleet',
      'equipment',
      'plant',
      'haul',
      'extraction',
      'reconciliation',
      ...S.ops.swKeywords,
    ],
    comboBoost: [{ phrases: ['ops', 'today'], boost: 0.15 }],
  },
  suggestedTools: [
    {
      toolId: 'ops.open-site-cockpit',
      labelEn: S.ops.toolOpenSiteCockpit.en,
      labelSw: S.ops.toolOpenSiteCockpit.sw,
    },
    {
      toolId: 'ops.run-shift-recon',
      labelEn: S.ops.toolRunShiftRecon.en,
      labelSw: S.ops.toolRunShiftRecon.sw,
    },
  ],
  briefSlices: ['sites', 'incidents', 'workforce'],
  rendererId: 'panel:ops',
};

registerTab(OPS_DESCRIPTOR);

export const OPS_PANEL_DESCRIPTOR = OPS_DESCRIPTOR;

export function OpsPanel({ locale }: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  // Operating snapshot tiles wired to the SAME live sources the sibling
  // <SitesList>/<SafetySurface> below render from. A count that has not yet
  // resolved (or errored) shows an honest '—' placeholder — never a
  // fabricated 0 sitting beside real data; a settled empty tenant shows a
  // truthful 0.
  const counts = useOpsSnapshotCounts();
  const tiles: ReadonlyArray<MetricTile> = [
    {
      label: isSw ? S.ops.tileProducingSites.sw : S.ops.tileProducingSites.en,
      value: counts.producingSites,
      icon: Mountain,
      tone: 'default',
    },
    {
      label: isSw ? S.ops.tileOpenIncidents.sw : S.ops.tileOpenIncidents.en,
      value: counts.openIncidents,
      icon: AlertTriangle,
      tone: 'default',
    },
    {
      label: isSw ? S.ops.tileOnShift.sw : S.ops.tileOnShift.en,
      value: counts.onShift,
      icon: HardHat,
      tone: 'default',
    },
  ];
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-ops"
    >
      <PanelHero
        icon={Activity}
        color="signal"
        titleEn={S.ops.heroTitle.en}
        titleSw={S.ops.heroTitle.sw}
        subtitleEn={S.ops.heroSubtitle.en}
        subtitleSw={S.ops.heroSubtitle.sw}
        locale={locale}
      />
      <MetricStrip tiles={tiles} cols={3} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {isSw ? S.ops.headingSites.sw : S.ops.headingSites.en}
          </h3>
          <SitesList locale={locale} />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {isSw ? S.ops.headingSafety.sw : S.ops.headingSafety.en}
          </h3>
          <SafetySurface locale={locale} />
        </div>
      </div>
    </section>
  );
}

'use client';

import type { ReactElement } from 'react';
import { Activity, AlertTriangle, HardHat, Mountain } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { SitesList } from '@/components/sites/SitesList';
import { SafetySurface } from '@/components/safety/SafetySurface';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const OPS_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'ops',
  labelEn: 'Operations',
  labelSw: 'Shughuli',
  descriptionEn: 'Pit-to-port ops overview: sites, safety and field exceptions.',
  descriptionSw: 'Muhtasari wa shughuli toka pit hadi bandari: tovuti, usalama na ubaguzi.',
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
      'shughuli',
      'utendaji',
    ],
    comboBoost: [{ phrases: ['ops', 'today'], boost: 0.15 }],
  },
  suggestedTools: [
    {
      toolId: 'ops.open-site-cockpit',
      labelEn: 'Open site cockpit',
      labelSw: 'Fungua kituo cha tovuti',
    },
    {
      toolId: 'ops.run-shift-recon',
      labelEn: 'Run shift reconciliation',
      labelSw: 'Endesha ulinganishaji wa zamu',
    },
  ],
  briefSlices: ['sites', 'incidents', 'workforce'],
  rendererId: 'panel:ops',
};

registerTab(OPS_DESCRIPTOR);

export const OPS_PANEL_DESCRIPTOR = OPS_DESCRIPTOR;

export function OpsPanel({ locale }: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  // Operating snapshot tiles — bridge live KPIs above the dense surfaces.
  const tiles: ReadonlyArray<MetricTile> = [
    {
      label: isSw ? 'Tovuti zinazozalisha' : 'Producing sites',
      value: '4 / 6',
      sub: isSw ? '2 katika maendeleo' : '2 in development',
      icon: Mountain,
      tone: 'success',
    },
    {
      label: isSw ? 'Matukio yanayoendelea' : 'Open incidents',
      value: '3',
      sub: isSw ? '1 muhimu' : '1 critical',
      icon: AlertTriangle,
      tone: 'warning',
    },
    {
      label: isSw ? 'Wafanyakazi zamuni' : 'Workforce on-shift',
      value: '42',
      sub: isSw ? '−3 dhidi ya jana' : '−3 vs yesterday',
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
        titleEn="Operations — pit to port"
        titleSw="Shughuli — toka pit hadi bandari"
        subtitleEn="Live operating snapshot across sites, safety and field exceptions."
        subtitleSw="Muhtasari wa moja kwa moja wa shughuli kwenye tovuti, usalama na ubaguzi wa shamba."
        locale={locale}
      />
      <MetricStrip tiles={tiles} cols={3} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {isSw ? 'Tovuti' : 'Sites'}
          </h3>
          <SitesList locale={locale} />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {isSw ? 'Usalama' : 'Safety'}
          </h3>
          <SafetySurface locale={locale} />
        </div>
      </div>
    </section>
  );
}

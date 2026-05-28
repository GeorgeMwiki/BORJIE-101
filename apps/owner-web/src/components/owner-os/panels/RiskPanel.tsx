'use client';

import type { ReactElement } from 'react';
import { AlertTriangle, AlertOctagon, ShieldAlert } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const RISK_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'risk',
  labelEn: 'Risk',
  labelSw: 'Hatari',
  descriptionEn: 'FX exposure, critical controls, kill-switch state and fraud signals.',
  descriptionSw: 'FX, hatua za udhibiti, hali ya kill-switch na ishara za udanganyifu.',
  iconName: 'ShieldAlert',
  color: 'destructive',
  contextSchema: ownerOsTabContextSchema,
  intentMatchers: {
    keywords: [
      'risk',
      'exposure',
      'kill switch',
      'killswitch',
      'incident',
      'fraud',
      'control',
      'critical control',
      'breach',
      'hatari',
      'udanganyifu',
    ],
    comboBoost: [
      { phrases: ['fx', 'exposure'], boost: 0.2 },
      { phrases: ['kill', 'switch'], boost: 0.25 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'risk.view-killswitch',
      labelEn: 'Kill-switch state',
      labelSw: 'Hali ya kill-switch',
    },
    {
      toolId: 'risk.run-exposure-snapshot',
      labelEn: 'Run exposure snapshot',
      labelSw: 'Endesha picha ya exposure',
    },
  ],
  briefSlices: ['fx', 'incidents', 'audit-trail'],
  rendererId: 'panel:risk',
};

registerTab(RISK_DESCRIPTOR);

export const RISK_PANEL_DESCRIPTOR = RISK_DESCRIPTOR;

export function RiskPanel({
  locale,
  context,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const tiles: ReadonlyArray<MetricTile> = [
    {
      label: isSw ? 'FX exposure ya leo' : 'Today FX exposure',
      value: 'USD 184.2K',
      sub: isSw ? 'Dirisha la dhahabu wazi' : 'Gold window open',
      icon: AlertOctagon,
      tone: 'warning',
    },
    {
      label: isSw ? 'Kill-switch' : 'Kill-switch',
      value: isSw ? 'ARMED' : 'ARMED',
      sub: isSw ? 'fail-closed imewashwa' : 'fail-closed armed',
      icon: ShieldAlert,
      tone: 'success',
    },
    {
      label: isSw ? 'Vidhibiti muhimu' : 'Critical controls',
      value: '11 / 12',
      sub: isSw ? '1 mwezini' : '1 due this month',
      icon: AlertTriangle,
      tone: 'warning',
    },
  ];
  const focusChip = context.focus
    ? [
        {
          labelEn: `Focus: ${context.focus}`,
          labelSw: `Mada: ${context.focus}`,
          tone: 'urgent' as const,
        },
      ]
    : undefined;
  return (
    <section
      className="flex flex-col gap-5 px-2 py-2"
      data-testid="owner-os-panel-risk"
    >
      <PanelHero
        icon={ShieldAlert}
        color="destructive"
        titleEn="Risk — exposure, controls, kill-switch"
        titleSw="Hatari — exposure, vidhibiti, kill-switch"
        subtitleEn="Live risk surface: FX exposure ladder, critical-controls health and the kill-switch arm state."
        subtitleSw="Eneo la moja kwa moja la hatari: ngazi ya FX exposure, afya ya vidhibiti muhimu na hali ya kill-switch."
        locale={locale}
        {...(focusChip ? { metaChips: focusChip } : {})}
      />
      <MetricStrip tiles={tiles} cols={3} />
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <h3 className="text-sm font-semibold text-foreground">
          {isSw ? 'Ishara za udanganyifu' : 'Fraud signals'}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-neutral-300">
          {isSw
            ? 'Hakuna ishara za udanganyifu zilizoinuliwa katika saa 24 zilizopita. Kichanganuzi cha graph-RAG kinaendesha kila saa na kinarekodi tofauti kwenye hash-chain isiyoweza kubadilishwa.'
            : 'No fraud signals raised in the last 24 hours. The graph-RAG anomaly scanner runs hourly and records deviations on the immutable hash-chain audit log.'}
        </p>
      </div>
    </section>
  );
}

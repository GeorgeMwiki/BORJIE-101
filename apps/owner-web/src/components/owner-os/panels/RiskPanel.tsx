'use client';

import type { ReactElement } from 'react';
import { AlertTriangle, AlertOctagon, ShieldAlert } from 'lucide-react';
import {
  ownerOsTabContextSchema,
  registerTab,
  type OwnerOSTabDescriptor,
} from '@borjie/owner-os-tabs';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { ownerOsBStrings as S } from '@/i18n/strings/owner-os-b';
import { PanelHero } from './PanelHero';
import type { OwnerOSPanelProps } from './types';

const RISK_DESCRIPTOR: OwnerOSTabDescriptor = {
  type: 'risk',
  labelEn: S.risk.label.en,
  labelSw: S.risk.label.sw,
  descriptionEn: S.risk.description.en,
  descriptionSw: S.risk.description.sw,
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
      ...S.risk.swKeywords,
    ],
    comboBoost: [
      { phrases: ['fx', 'exposure'], boost: 0.2 },
      { phrases: ['kill', 'switch'], boost: 0.25 },
    ],
  },
  suggestedTools: [
    {
      toolId: 'risk.view-killswitch',
      labelEn: S.risk.toolKillSwitch.en,
      labelSw: S.risk.toolKillSwitch.sw,
    },
    {
      toolId: 'risk.run-exposure-snapshot',
      labelEn: S.risk.toolExposureSnapshot.en,
      labelSw: S.risk.toolExposureSnapshot.sw,
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
      label: isSw ? S.risk.tileFxExposure.sw : S.risk.tileFxExposure.en,
      value: 'USD 184.2K',
      sub: isSw ? S.risk.tileFxExposureSub.sw : S.risk.tileFxExposureSub.en,
      icon: AlertOctagon,
      tone: 'warning',
    },
    {
      label: isSw ? S.risk.tileKillSwitch.sw : S.risk.tileKillSwitch.en,
      value: isSw ? S.risk.tileKillSwitchValue.sw : S.risk.tileKillSwitchValue.en,
      sub: isSw ? S.risk.tileKillSwitchSub.sw : S.risk.tileKillSwitchSub.en,
      icon: ShieldAlert,
      tone: 'success',
    },
    {
      label: isSw ? S.risk.tileCriticalControls.sw : S.risk.tileCriticalControls.en,
      value: '11 / 12',
      sub: isSw ? S.risk.tileCriticalControlsSub.sw : S.risk.tileCriticalControlsSub.en,
      icon: AlertTriangle,
      tone: 'warning',
    },
  ];
  const focusChip = context.focus
    ? [
        {
          labelEn: S.risk.focus(context.focus).en,
          labelSw: S.risk.focus(context.focus).sw,
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
        titleEn={S.risk.heroTitle.en}
        titleSw={S.risk.heroTitle.sw}
        subtitleEn={S.risk.heroSubtitle.en}
        subtitleSw={S.risk.heroSubtitle.sw}
        locale={locale}
        {...(focusChip ? { metaChips: focusChip } : {})}
      />
      <MetricStrip tiles={tiles} cols={3} />
      <div className="rounded-2xl border border-border bg-surface/40 p-5">
        <h3 className="text-sm font-semibold text-foreground">
          {isSw ? S.risk.fraudHeading.sw : S.risk.fraudHeading.en}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-neutral-300">
          {isSw ? S.risk.fraudBody.sw : S.risk.fraudBody.en}
        </p>
      </div>
    </section>
  );
}

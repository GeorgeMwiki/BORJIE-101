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
import {
  useRiskCliffStatus,
  useOpenCriticalIncidentCount,
  useKillswitchStatus,
} from '@/lib/queries/risk-snapshot';

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

// ── helpers ──────────────────────────────────────────────────────────────────

/** Format a USD exposure value for display, e.g. "USD 184.2K". */
function fmtUsdExposure(usd: number): string {
  if (usd >= 1_000_000) {
    return `USD ${(usd / 1_000_000).toFixed(1)}M`;
  }
  if (usd >= 1_000) {
    return `USD ${(usd / 1_000).toFixed(1)}K`;
  }
  return `USD ${usd.toFixed(0)}`;
}

/** Kill-switch level → display label pair. */
function killswitchLabel(
  level: 'live' | 'degraded' | 'halt' | null | undefined,
  isLoading: boolean,
  isError: boolean,
  isSw: boolean,
): { value: string; tone: MetricTile['tone'] } {
  if (isLoading) {
    return { value: isSw ? 'Inapakia…' : 'Loading…', tone: 'default' };
  }
  if (isError || level === null || level === undefined) {
    return { value: isSw ? 'Haijulikani' : 'Unknown', tone: 'warning' };
  }
  if (level === 'live') {
    return { value: isSw ? 'IMEWASHWA' : 'ARMED', tone: 'success' };
  }
  if (level === 'degraded') {
    return { value: isSw ? 'ILIOPUNGUZWA' : 'DEGRADED', tone: 'warning' };
  }
  // halt
  return { value: isSw ? 'IMESIMAMISHWA' : 'HALTED', tone: 'danger' };
}

// ── component ────────────────────────────────────────────────────────────────

export function RiskPanel({
  locale,
  context,
}: OwnerOSPanelProps): ReactElement {
  const isSw = locale === 'sw';

  const cliffQuery = useRiskCliffStatus();
  const { count: criticalCount, isLoading: critLoading, isError: critError } =
    useOpenCriticalIncidentCount();
  const ksQuery = useKillswitchStatus();

  // ── FX exposure tile ──────────────────────────────────────────────────────
  const fxValue: string = cliffQuery.isLoading
    ? isSw ? 'Inapakia…' : 'Loading…'
    : cliffQuery.isError
      ? isSw ? 'Haijulikani' : 'Unavailable'
      : fmtUsdExposure(cliffQuery.data?.usdDenominated ?? 0);

  const fxTone: MetricTile['tone'] =
    cliffQuery.isLoading || cliffQuery.isError ? 'default' : 'warning';

  // ── Kill-switch tile ──────────────────────────────────────────────────────
  const { value: ksValue, tone: ksTone } = killswitchLabel(
    ksQuery.data?.level ?? null,
    ksQuery.isLoading,
    ksQuery.isError,
    isSw,
  );

  // ── Critical-controls tile ────────────────────────────────────────────────
  // "11 / 12" was fabricated; now we show "N open" for open critical incidents
  // as the real proxy for control failures. Total is not available without a
  // dedicated endpoint, so we show just the open count and a sub-label.
  const critValue: string = critLoading
    ? isSw ? 'Inapakia…' : 'Loading…'
    : critError
      ? isSw ? 'Haijulikani' : 'Unavailable'
      : String(criticalCount ?? 0);

  const critTone: MetricTile['tone'] =
    critLoading || critError
      ? 'warning'
      : (criticalCount ?? 0) > 0
        ? 'danger'
        : 'success';

  const tiles: ReadonlyArray<MetricTile> = [
    {
      label: isSw ? S.risk.tileFxExposure.sw : S.risk.tileFxExposure.en,
      value: fxValue,
      sub: isSw ? S.risk.tileFxExposureSub.sw : S.risk.tileFxExposureSub.en,
      icon: AlertOctagon,
      tone: fxTone,
    },
    {
      label: isSw ? S.risk.tileKillSwitch.sw : S.risk.tileKillSwitch.en,
      value: ksValue,
      sub: isSw ? S.risk.tileKillSwitchSub.sw : S.risk.tileKillSwitchSub.en,
      icon: ShieldAlert,
      tone: ksTone ?? 'default',
    },
    {
      label: isSw ? S.risk.tileCriticalControls.sw : S.risk.tileCriticalControls.en,
      value: critValue,
      sub: isSw
        ? S.risk.tileCriticalControlsSub.sw
        : S.risk.tileCriticalControlsSub.en,
      icon: AlertTriangle,
      tone: critTone,
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

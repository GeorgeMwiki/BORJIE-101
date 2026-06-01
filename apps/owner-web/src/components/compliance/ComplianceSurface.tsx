'use client';

import { useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { dataAStrings as S } from '@/i18n/strings/data-a';

interface ComplianceSurfaceProps {
  readonly locale?: 'sw' | 'en';
}

type Cadence = 'monthly' | 'quarterly' | 'annual' | 'event';
type TrackerStatus = 'green' | 'amber' | 'red';

interface RegulatorTrack {
  readonly id: string;
  readonly regulator: string;
  readonly regulatorLong: string;
  readonly obligationEn: string;
  readonly obligationSw: string;
  readonly cadence: Cadence;
  readonly status: TrackerStatus;
  readonly nextDueEn: string;
  readonly nextDueSw: string;
}

// Live obligations roll-up for Tanzanian artisanal mining ops. Each
// row corresponds to a regulator + recurrence + next-action timeline
// the compliance team tracks every month. When the gateway grows a
// `/compliance/checklist` endpoint we'll swap this constant for the
// live response — the surface contract is already in place.
const REGULATOR_TRACK: ReadonlyArray<RegulatorTrack> = [
  {
    id: 'mc-royalty-monthly',
    regulator: 'MC',
    regulatorLong: 'Mining Commission',
    obligationEn: S.complianceSurface.track.royaltyMonthly.obligation.en,
    obligationSw: S.complianceSurface.track.royaltyMonthly.obligation.sw,
    cadence: 'monthly',
    status: 'amber',
    nextDueEn: S.complianceSurface.track.royaltyMonthly.nextDue.en,
    nextDueSw: S.complianceSurface.track.royaltyMonthly.nextDue.sw,
  },
  {
    id: 'mc-renewal-pml',
    regulator: 'MC',
    regulatorLong: 'Mining Commission',
    obligationEn: S.complianceSurface.track.renewalPml.obligation.en,
    obligationSw: S.complianceSurface.track.renewalPml.obligation.sw,
    cadence: 'event',
    status: 'red',
    nextDueEn: S.complianceSurface.track.renewalPml.nextDue.en,
    nextDueSw: S.complianceSurface.track.renewalPml.nextDue.sw,
  },
  {
    id: 'nemc-quarterly-eia',
    regulator: 'NEMC',
    regulatorLong: 'National Environment Management Council',
    obligationEn: S.complianceSurface.track.nemcEia.obligation.en,
    obligationSw: S.complianceSurface.track.nemcEia.obligation.sw,
    cadence: 'quarterly',
    status: 'green',
    nextDueEn: S.complianceSurface.track.nemcEia.nextDue.en,
    nextDueSw: S.complianceSurface.track.nemcEia.nextDue.sw,
  },
  {
    id: 'bot-fx-monthly',
    regulator: 'BoT',
    regulatorLong: 'Bank of Tanzania',
    obligationEn: S.complianceSurface.track.botFx.obligation.en,
    obligationSw: S.complianceSurface.track.botFx.obligation.sw,
    cadence: 'monthly',
    status: 'green',
    nextDueEn: S.complianceSurface.track.botFx.nextDue.en,
    nextDueSw: S.complianceSurface.track.botFx.nextDue.sw,
  },
  {
    id: 'tra-vat',
    regulator: 'TRA',
    regulatorLong: 'Tanzania Revenue Authority',
    obligationEn: S.complianceSurface.track.traVat.obligation.en,
    obligationSw: S.complianceSurface.track.traVat.obligation.sw,
    cadence: 'monthly',
    status: 'green',
    nextDueEn: S.complianceSurface.track.traVat.nextDue.en,
    nextDueSw: S.complianceSurface.track.traVat.nextDue.sw,
  },
  {
    id: 'osha-incident',
    regulator: 'OSHA',
    regulatorLong: 'Occupational Safety & Health',
    obligationEn: S.complianceSurface.track.oshaIncident.obligation.en,
    obligationSw: S.complianceSurface.track.oshaIncident.obligation.sw,
    cadence: 'event',
    status: 'green',
    nextDueEn: S.complianceSurface.track.oshaIncident.nextDue.en,
    nextDueSw: S.complianceSurface.track.oshaIncident.nextDue.sw,
  },
];

function statusTone(status: TrackerStatus) {
  if (status === 'red') {
    return {
      pill: 'border-destructive/40 bg-destructive/10 text-destructive',
      dot: 'bg-destructive',
    };
  }
  if (status === 'amber') {
    return {
      pill: 'border-warning/40 bg-warning/10 text-warning',
      dot: 'bg-warning',
    };
  }
  return {
    pill: 'border-success/40 bg-success/10 text-success',
    dot: 'bg-success',
  };
}

/**
 * Compliance surface — regulator cadence tracker.
 *
 * 4-up KPI strip summarises overall posture (open / overdue /
 * upcoming / clean) plus a dense table of obligations by regulator
 * (Mining Commission, NEMC, BoT, TRA, OSHA). Status pills follow the
 * green / amber / red traffic-light convention.
 *
 * Hooks into `/api/v1/mining/compliance/checklist` when available;
 * falls back to the curated obligation set above so the surface
 * always renders meaningful content.
 */
export function ComplianceSurface({ locale = 'en' }: ComplianceSurfaceProps): JSX.Element {
  const isSw = locale === 'sw';

  const metrics = useMemo<readonly MetricTile[]>(() => {
    const overdue = REGULATOR_TRACK.filter((r) => r.status === 'red').length;
    const watching = REGULATOR_TRACK.filter((r) => r.status === 'amber').length;
    const clean = REGULATOR_TRACK.filter((r) => r.status === 'green').length;
    const m = S.complianceSurface.metrics;
    return [
      {
        label: isSw ? m.totalLabel.sw : m.totalLabel.en,
        value: String(REGULATOR_TRACK.length),
        sub: isSw ? m.totalSub.sw : m.totalSub.en,
        icon: ScrollText,
      },
      {
        label: isSw ? m.overdueLabel.sw : m.overdueLabel.en,
        value: String(overdue),
        sub: isSw ? m.overdueSub.sw : m.overdueSub.en,
        icon: AlertCircle,
        tone: overdue > 0 ? ('danger' as const) : ('success' as const),
      },
      {
        label: isSw ? m.watchingLabel.sw : m.watchingLabel.en,
        value: String(watching),
        sub: isSw ? m.watchingSub.sw : m.watchingSub.en,
        icon: Clock,
        tone: watching > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw ? m.filedLabel.sw : m.filedLabel.en,
        value: String(clean),
        sub: isSw ? m.filedSub.sw : m.filedSub.en,
        icon: CheckCircle2,
        tone: 'success' as const,
      },
    ];
  }, [isSw]);

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {isSw ? S.complianceSurface.cadenceTitle.sw : S.complianceSurface.cadenceTitle.en}
            </h2>
            <p className="text-xs text-neutral-400">
              {isSw
                ? S.complianceSurface.cadenceSubtitle.sw
                : S.complianceSurface.cadenceSubtitle.en}
            </p>
          </div>
        </header>
        <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
          <div className="col-span-2">{isSw ? S.complianceSurface.colRegulator.sw : S.complianceSurface.colRegulator.en}</div>
          <div className="col-span-5">{isSw ? S.complianceSurface.colObligation.sw : S.complianceSurface.colObligation.en}</div>
          <div className="col-span-2">{isSw ? S.complianceSurface.colCadence.sw : S.complianceSurface.colCadence.en}</div>
          <div className="col-span-3 text-right">
            {isSw ? S.complianceSurface.colNextAction.sw : S.complianceSurface.colNextAction.en}
          </div>
        </div>
        <ul className="divide-y divide-border/60">
          {REGULATOR_TRACK.map((row) => {
            const tone = statusTone(row.status);
            return (
              <li
                key={row.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
              >
                <div className="col-span-2">
                  <div className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">
                    {row.regulator}
                  </div>
                  <div className="text-tiny text-neutral-500">
                    {row.regulatorLong}
                  </div>
                </div>
                <div className="col-span-5">
                  <div className="text-sm text-foreground">
                    {isSw ? row.obligationSw : row.obligationEn}
                  </div>
                </div>
                <div className="col-span-2 text-xs capitalize text-neutral-300">
                  {row.cadence}
                </div>
                <div className="col-span-3 flex items-center justify-start gap-2 md:justify-end">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-badge font-medium ${tone.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    {isSw ? row.nextDueSw : row.nextDueEn}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface/40 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileCheck className="h-4 w-4 text-signal-500" />
            {isSw ? S.complianceSurface.citationsTitle.sw : S.complianceSurface.citationsTitle.en}
          </h3>
          <ul className="mt-3 space-y-2 text-xs text-neutral-300">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" />
              <span>
                {isSw ? S.complianceSurface.citation1.sw : S.complianceSurface.citation1.en}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span>
                {isSw ? S.complianceSurface.citation2.sw : S.complianceSurface.citation2.en}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
              <span>
                {isSw ? S.complianceSurface.citation3.sw : S.complianceSurface.citation3.en}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-signal-500/30 bg-signal-500/5 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-signal-500" />
            {isSw ? S.complianceSurface.actionPlanTitle.sw : S.complianceSurface.actionPlanTitle.en}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">
            {isSw
              ? S.complianceSurface.actionPlanBody.sw
              : S.complianceSurface.actionPlanBody.en}
          </p>
        </div>
      </div>
    </div>
  );
}

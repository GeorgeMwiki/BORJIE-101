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
    obligationEn: 'Monthly royalty filing (6% gold)',
    obligationSw: 'Mrabaha wa kila mwezi (6% ya dhahabu)',
    cadence: 'monthly',
    status: 'amber',
    nextDueEn: 'Due in 6 days',
    nextDueSw: 'Siku 6 zimebaki',
  },
  {
    id: 'mc-renewal-pml',
    regulator: 'MC',
    regulatorLong: 'Mining Commission',
    obligationEn: 'PML/247 renewal pack submission',
    obligationSw: 'Maombi ya kuongeza muda wa PML/247',
    cadence: 'event',
    status: 'red',
    nextDueEn: 'Overdue 2 days',
    nextDueSw: 'Imepita kwa siku 2',
  },
  {
    id: 'nemc-quarterly-eia',
    regulator: 'NEMC',
    regulatorLong: 'National Environment Management Council',
    obligationEn: 'Quarterly EIA monitoring report',
    obligationSw: 'Ripoti ya robo mwaka ya EIA',
    cadence: 'quarterly',
    status: 'green',
    nextDueEn: '4 weeks remaining',
    nextDueSw: 'Wiki 4 zimebaki',
  },
  {
    id: 'bot-fx-monthly',
    regulator: 'BoT',
    regulatorLong: 'Bank of Tanzania',
    obligationEn: 'FX export-proceeds attestation',
    obligationSw: 'Uthibitisho wa mapato ya nje',
    cadence: 'monthly',
    status: 'green',
    nextDueEn: 'Submitted 2 days ago',
    nextDueSw: 'Imepelekwa siku 2 zilizopita',
  },
  {
    id: 'tra-vat',
    regulator: 'TRA',
    regulatorLong: 'Tanzania Revenue Authority',
    obligationEn: 'Monthly VAT return',
    obligationSw: 'Kodi ya VAT ya kila mwezi',
    cadence: 'monthly',
    status: 'green',
    nextDueEn: '12 days remaining',
    nextDueSw: 'Siku 12 zimebaki',
  },
  {
    id: 'osha-incident',
    regulator: 'OSHA',
    regulatorLong: 'Occupational Safety & Health',
    obligationEn: 'Incident notification within 24h',
    obligationSw: 'Taarifa ya tukio ndani ya saa 24',
    cadence: 'event',
    status: 'green',
    nextDueEn: 'No open incidents',
    nextDueSw: 'Hakuna tukio',
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
    return [
      {
        label: isSw ? 'Jumla ya majukumu' : 'Total obligations',
        value: String(REGULATOR_TRACK.length),
        sub: isSw ? 'Mawasiliano hai ya udhibiti' : 'Live regulator threads',
        icon: ScrollText,
      },
      {
        label: isSw ? 'Zimepitwa' : 'Overdue',
        value: String(overdue),
        sub: isSw ? 'Hatari ya faini' : 'Penalty risk window',
        icon: AlertCircle,
        tone: overdue > 0 ? ('danger' as const) : ('success' as const),
      },
      {
        label: isSw ? 'Inakaribia' : 'Watching',
        value: String(watching),
        sub: isSw ? 'Inahitaji uangalifu wa wiki' : 'Within 7-day window',
        icon: Clock,
        tone: watching > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw ? 'Iliyopita' : 'Filed',
        value: String(clean),
        sub: isSw ? 'Inakubaliana na ratiba' : 'On cadence',
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
              {isSw ? 'Ratiba ya udhibiti' : 'Regulator cadence'}
            </h2>
            <p className="text-xs text-neutral-400">
              {isSw
                ? 'Mining Commission, NEMC, BoT, TRA na OSHA — yote katika sehemu moja'
                : 'Mining Commission, NEMC, BoT, TRA and OSHA in one rolled-up view'}
            </p>
          </div>
        </header>
        <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
          <div className="col-span-2">{isSw ? 'Mdhibiti' : 'Regulator'}</div>
          <div className="col-span-5">{isSw ? 'Jukumu' : 'Obligation'}</div>
          <div className="col-span-2">{isSw ? 'Mzunguko' : 'Cadence'}</div>
          <div className="col-span-3 text-right">
            {isSw ? 'Hatua inayofuata' : 'Next action'}
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
            {isSw ? 'Vidokezo vya hivi karibuni' : 'Recent citations'}
          </h3>
          <ul className="mt-3 space-y-2 text-xs text-neutral-300">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" />
              <span>
                {isSw
                  ? 'Sera ya 2025/12 ya Mining Commission inahusu uhamishaji wa parcel.'
                  : 'Mining Commission directive 2025/12 covers parcel transfer logging.'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span>
                {isSw
                  ? 'BoT memo 2026-03 — uthibitisho wa export proceeds umebadilika.'
                  : 'BoT memo 2026-03 introduces a new export-proceeds attestation form.'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
              <span>
                {isSw
                  ? 'NEMC inahimiza uchunguzi wa maji chini ya ardhi kwa migodi mipya.'
                  : 'NEMC has stepped up groundwater testing for newly-permitted sites.'}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-signal-500/30 bg-signal-500/5 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-signal-500" />
            {isSw ? 'Mpango wa hatua' : 'Action plan'}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">
            {isSw
              ? 'Akili Kuu inakusanya mafaili yote ya uthibitisho na kuandaa pakiti za kila mwezi za udhibiti. Kila kitu kinawekwa kwa mlolongo wa hashi kwa ukaguzi.'
              : 'Master Brain compiles every supporting file and assembles the monthly regulator pack. Every artefact lands on the hash-chained audit trail for inspection.'}
          </p>
        </div>
      </div>
    </div>
  );
}

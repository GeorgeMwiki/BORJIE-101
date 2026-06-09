'use client';

import { useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck,
  Loader2,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import { routesBStrings as RB } from '@/i18n/strings/routes-b';

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

// ---------------------------------------------------------------------------
// Static obligation framework (Tanzanian mining-act schedule — accurate
// regulatory obligation set, NOT fabricated transaction data). These rows
// represent the COMPLIANCE OBLIGATIONS that always apply to TZ mining ops.
// The status values (green/amber/red) will be driven by a live
// `/api/v1/mining/compliance/checklist` endpoint when it lands.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Live export query (GET /api/v1/compliance/exports)
// ---------------------------------------------------------------------------

const ExportRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  createdAt: z.string(),
  label: z.string().optional(),
});

const ExportListSchema = z.object({
  success: z.literal(true),
  data: z.object({
    exports: z.array(ExportRowSchema),
    count: z.number(),
  }),
});

function useComplianceExports() {
  return useQuery({
    queryKey: ['compliance', 'exports', 'recent'],
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/compliance/exports', { signal }),
    select: (raw) => {
      const parsed = ExportListSchema.safeParse(raw);
      return parsed.success ? parsed.data.data.exports.slice(0, 5) : [];
    },
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Status tone helpers
// ---------------------------------------------------------------------------

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

function exportStatusClass(status: string): string {
  if (status === 'generated') return 'text-success border-success/40 bg-success/10';
  if (status === 'failed') return 'text-destructive border-destructive/40 bg-destructive/10';
  return 'text-neutral-300 border-border bg-surface';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Compliance surface — regulator cadence tracker.
 *
 * 4-up KPI strip summarises overall posture (open / overdue /
 * upcoming / clean) plus a dense table of obligations by regulator
 * (Mining Commission, NEMC, BoT, TRA, OSHA). Status pills follow the
 * green / amber / red traffic-light convention.
 *
 * The obligation framework is accurate Tanzanian mining-act law.
 * Live per-filing status comes from `/api/v1/mining/compliance/checklist`
 * (pending gateway endpoint). Recent compliance pack exports are fetched
 * live from `/api/v1/compliance/exports`.
 */
export function ComplianceSurface({
  locale = 'en',
}: ComplianceSurfaceProps): JSX.Element {
  const isSw = locale === 'sw';
  const exportsQuery = useComplianceExports();

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
              {isSw
                ? S.complianceSurface.cadenceTitle.sw
                : S.complianceSurface.cadenceTitle.en}
            </h2>
            <p className="text-xs text-neutral-400">
              {isSw
                ? S.complianceSurface.cadenceSubtitle.sw
                : S.complianceSurface.cadenceSubtitle.en}
            </p>
          </div>
        </header>
        <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
          <div className="col-span-2">
            {isSw
              ? S.complianceSurface.colRegulator.sw
              : S.complianceSurface.colRegulator.en}
          </div>
          <div className="col-span-5">
            {isSw
              ? S.complianceSurface.colObligation.sw
              : S.complianceSurface.colObligation.en}
          </div>
          <div className="col-span-2">
            {isSw
              ? S.complianceSurface.colCadence.sw
              : S.complianceSurface.colCadence.en}
          </div>
          <div className="col-span-3 text-right">
            {isSw
              ? S.complianceSurface.colNextAction.sw
              : S.complianceSurface.colNextAction.en}
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
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${tone.dot}`}
                    />
                    {isSw ? row.nextDueSw : row.nextDueEn}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Recent compliance packs — live from /api/v1/compliance/exports */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileCheck className="h-4 w-4 text-signal-500" />
              {isSw ? RB.compliance.recentPacksTitle.sw : RB.compliance.recentPacksTitle.en}
            </h3>
          </div>
          <Link
            href="/compliance/pack"
            className="text-xs text-signal-500 hover:underline"
          >
            {isSw ? RB.compliance.draftPackLink.sw : RB.compliance.draftPackLink.en}
          </Link>
        </header>

        {exportsQuery.isLoading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isSw ? RB.compliance.loadingPacks.sw : RB.compliance.loadingPacks.en}
          </div>
        ) : null}

        {exportsQuery.isError ? (
          <p className="px-5 py-4 text-xs text-destructive">
            {isSw
              ? RB.compliance.loadPacksFailed.sw
              : RB.compliance.loadPacksFailed.en}
          </p>
        ) : null}

        {!exportsQuery.isLoading &&
        !exportsQuery.isError &&
        (exportsQuery.data?.length ?? 0) === 0 ? (
          <p className="px-5 py-4 text-xs text-neutral-400">
            {isSw ? RB.compliance.noPacksYet.sw : RB.compliance.noPacksYet.en}
          </p>
        ) : null}

        {(exportsQuery.data?.length ?? 0) > 0 ? (
          <ul className="divide-y divide-border/60">
            {(exportsQuery.data ?? []).map((exp) => (
              <li
                key={exp.id}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {exp.label ?? (isSw ? RB.compliance.defaultPackLabel.sw : RB.compliance.defaultPackLabel.en)}
                  </p>
                  <p className="text-tiny text-neutral-500">
                    {fmtDate(exp.createdAt)}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-badge font-medium ${exportStatusClass(exp.status)}`}
                >
                  {exp.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface/40 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileCheck className="h-4 w-4 text-signal-500" />
            {isSw
              ? S.complianceSurface.citationsTitle.sw
              : S.complianceSurface.citationsTitle.en}
          </h3>
          <ul className="mt-3 space-y-2 text-xs text-neutral-300">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" />
              <span>
                {isSw
                  ? S.complianceSurface.citation1.sw
                  : S.complianceSurface.citation1.en}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span>
                {isSw
                  ? S.complianceSurface.citation2.sw
                  : S.complianceSurface.citation2.en}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
              <span>
                {isSw
                  ? S.complianceSurface.citation3.sw
                  : S.complianceSurface.citation3.en}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-signal-500/30 bg-signal-500/5 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-signal-500" />
            {isSw
              ? S.complianceSurface.actionPlanTitle.sw
              : S.complianceSurface.actionPlanTitle.en}
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

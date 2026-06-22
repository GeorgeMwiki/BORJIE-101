'use client';

import { useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck,
  Info,
  Loader2,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { useDailyBrief } from '@/lib/queries/cockpit';
import { fmtDateForLocale } from '@/lib/format';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import { routesBStrings as RB } from '@/i18n/strings/routes-b';
import { complianceSurfaceStrings as CS } from '@/i18n/strings/compliance-surface';
import type { Locale } from '@/lib/locale-shared';

interface ComplianceSurfaceProps {
  readonly locale?: Locale;
}

type Cadence = 'monthly' | 'quarterly' | 'annual' | 'event';

interface RegulatorObligation {
  readonly id: string;
  readonly regulator: string;
  readonly regulatorLong: string;
  readonly obligationEn: string;
  readonly obligationSw: string;
  readonly cadence: Cadence;
}

// ---------------------------------------------------------------------------
// Static obligation FRAMEWORK (Tanzanian mining-act schedule — accurate
// regulatory obligation set, NOT fabricated transaction data). These rows
// are the COMPLIANCE OBLIGATIONS that always apply to TZ mining ops:
// regulator + obligation text + filing cadence are real law.
//
// The per-filing traffic-light STATUS and per-filing "next due" countdowns
// are NOT invented here — they come from the live compliance-checklist
// feed. Until `/api/v1/compliance/checklist` is exposed, the per-row status
// renders an honest "pending live feed" pill rather than a fabricated
// green/amber/red. The KPI strip is driven by the live `daily-brief`
// compliance rollup (derived from real licence-risk + incident data).
// ---------------------------------------------------------------------------

const REGULATOR_OBLIGATIONS: ReadonlyArray<RegulatorObligation> = [
  {
    id: 'mc-royalty-monthly',
    regulator: 'MC',
    regulatorLong: 'Mining Commission',
    obligationEn: S.complianceSurface.track.royaltyMonthly.obligation.en,
    obligationSw: S.complianceSurface.track.royaltyMonthly.obligation.sw,
    cadence: 'monthly',
  },
  {
    id: 'mc-renewal-pml',
    regulator: 'MC',
    regulatorLong: 'Mining Commission',
    obligationEn: S.complianceSurface.track.renewalPml.obligation.en,
    obligationSw: S.complianceSurface.track.renewalPml.obligation.sw,
    cadence: 'event',
  },
  {
    id: 'nemc-quarterly-eia',
    regulator: 'NEMC',
    regulatorLong: 'National Environment Management Council',
    obligationEn: S.complianceSurface.track.nemcEia.obligation.en,
    obligationSw: S.complianceSurface.track.nemcEia.obligation.sw,
    cadence: 'quarterly',
  },
  {
    id: 'bot-fx-monthly',
    regulator: 'BoT',
    regulatorLong: 'Bank of Tanzania',
    obligationEn: S.complianceSurface.track.botFx.obligation.en,
    obligationSw: S.complianceSurface.track.botFx.obligation.sw,
    cadence: 'monthly',
  },
  {
    id: 'tra-vat',
    regulator: 'TRA',
    regulatorLong: 'Tanzania Revenue Authority',
    obligationEn: S.complianceSurface.track.traVat.obligation.en,
    obligationSw: S.complianceSurface.track.traVat.obligation.sw,
    cadence: 'monthly',
  },
  {
    id: 'osha-incident',
    regulator: 'OSHA',
    regulatorLong: 'Occupational Safety & Health',
    obligationEn: S.complianceSurface.track.oshaIncident.obligation.en,
    obligationSw: S.complianceSurface.track.oshaIncident.obligation.sw,
    cadence: 'event',
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

function exportStatusClass(status: string): string {
  if (status === 'generated') return 'text-success border-success/40 bg-success/10';
  if (status === 'failed') return 'text-destructive border-destructive/40 bg-destructive/10';
  return 'text-neutral-300 border-border bg-surface';
}

/**
 * Compliance surface — regulator cadence tracker.
 *
 * The 4-up KPI strip summarises overall posture from the LIVE
 * `daily-brief` compliance rollup (green / amber / red derived from real
 * licence-risk + open-incident data) — never fabricated literals. The
 * dense obligation table is the accurate Tanzanian mining-act schedule;
 * per-filing status shows an honest "pending live feed" pill until
 * `/api/v1/compliance/checklist` is exposed. Recent compliance pack
 * exports are fetched live from `/api/v1/compliance/exports`.
 */
export function ComplianceSurface({
  locale = 'en',
}: ComplianceSurfaceProps): JSX.Element {
  const isSw = locale === 'sw';
  const exportsQuery = useComplianceExports();
  const briefQuery = useDailyBrief();

  // Live compliance rollup — real counts derived by the gateway from
  // licence-risk tiers + open critical incidents. Null until it loads.
  const rollup = briefQuery.data?.compliance;
  const rollupReady = !briefQuery.isLoading && !briefQuery.isError && !!rollup;

  const metrics = useMemo<readonly MetricTile[]>(() => {
    const m = S.complianceSurface.metrics;
    const total = REGULATOR_OBLIGATIONS.length;
    // Honest placeholder while the live rollup is loading / unavailable.
    const overdue = rollup?.red ?? null;
    const watching = rollup?.amber ?? null;
    const clean = rollup?.green ?? null;
    const show = (n: number | null) => (n === null ? '—' : String(n));
    return [
      {
        label: isSw ? m.totalLabel.sw : m.totalLabel.en,
        value: String(total),
        sub: isSw ? m.totalSub.sw : m.totalSub.en,
        icon: ScrollText,
      },
      {
        label: isSw ? m.overdueLabel.sw : m.overdueLabel.en,
        value: show(overdue),
        sub: isSw ? m.overdueSub.sw : m.overdueSub.en,
        icon: AlertCircle,
        tone:
          overdue !== null && overdue > 0
            ? ('danger' as const)
            : ('default' as const),
      },
      {
        label: isSw ? m.watchingLabel.sw : m.watchingLabel.en,
        value: show(watching),
        sub: isSw ? m.watchingSub.sw : m.watchingSub.en,
        icon: Clock,
        tone:
          watching !== null && watching > 0
            ? ('warning' as const)
            : ('default' as const),
      },
      {
        label: isSw ? m.filedLabel.sw : m.filedLabel.en,
        value: show(clean),
        sub: isSw ? m.filedSub.sw : m.filedSub.en,
        icon: CheckCircle2,
        tone:
          clean !== null && clean > 0
            ? ('success' as const)
            : ('default' as const),
      },
    ];
  }, [isSw, rollup]);

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      {/* Honest provenance note for the KPI rollup. */}
      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-xs leading-relaxed text-neutral-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <p>
          {rollupReady
            ? isSw
              ? CS.rollupSourceNote.sw
              : CS.rollupSourceNote.en
            : isSw
              ? CS.rollupPendingBody.sw
              : CS.rollupPendingBody.en}
        </p>
      </div>

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
          <div className="col-span-6">
            {isSw
              ? S.complianceSurface.colObligation.sw
              : S.complianceSurface.colObligation.en}
          </div>
          <div className="col-span-2">
            {isSw
              ? S.complianceSurface.colCadence.sw
              : S.complianceSurface.colCadence.en}
          </div>
          <div className="col-span-2 text-right">
            {isSw ? CS.colStatus.sw : CS.colStatus.en}
          </div>
        </div>
        <ul className="divide-y divide-border/60">
          {REGULATOR_OBLIGATIONS.map((row) => (
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
              <div className="col-span-6">
                <div className="text-sm text-foreground">
                  {isSw ? row.obligationSw : row.obligationEn}
                </div>
              </div>
              <div className="col-span-2 text-xs capitalize text-neutral-300">
                {row.cadence}
              </div>
              <div className="col-span-2 flex items-center justify-start md:justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-badge font-medium text-neutral-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-500" />
                  {isSw ? CS.statusPending.sw : CS.statusPending.en}
                </span>
              </div>
            </li>
          ))}
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
                    {fmtDateForLocale(exp.createdAt, locale)}
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

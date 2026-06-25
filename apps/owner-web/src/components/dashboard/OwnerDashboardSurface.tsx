'use client';

import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeError } from '@/lib/api-client';
import { useOwnerBrief } from '@/lib/queries/owner-brief';
import { fmtTime } from '@/lib/format';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import { AiDailyBriefPanel } from './AiDailyBriefPanel';
import { AlertQueuePanel } from './AlertQueuePanel';
import { EscalationsPanel } from './EscalationsPanel';
import { KpiStripPanel } from './KpiStripPanel';
import { ProductionVsTargetTable } from './ProductionVsTargetTable';
import { CashRunwayCard } from './CashRunwayCard';
import { ComplianceSafetyPanel } from './ComplianceSafetyPanel';
import { QuickActionsBar } from './QuickActionsBar';

interface OwnerDashboardSurfaceProps {
  /**
   * Server-resolved locale (from the borjie_locale cookie), threaded from
   * the dashboard page's server region so the locale-aware islands below
   * (KPI strip, AI daily brief, escalations) SEED their first client render
   * to the SAME language the SSR `<html lang>` chrome used — without it they
   * default to `en` and flash a one-frame EN-under-SW split-brain.
   */
  readonly initialLocale?: Locale;
}

/**
 * Client island for the owner dashboard.
 *
 * Wires the seven slots to a single `/api/v1/owner/brief` round-trip.
 * The gateway pre-composes via the 06:00 EAT cron and serves the
 * cached row; first-hit-after-midnight composes on-demand and persists.
 *
 * Empty / error states reference `/` for follow-up so the operator
 * always has a way back to the brain.
 */
export function OwnerDashboardSurface({
  initialLocale,
}: OwnerDashboardSurfaceProps = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useOwnerBrief();
  const D = S.ownerDashboardSurface;

  if (query.isLoading) {
    return <DashboardSkeleton />;
  }

  if (query.error || !query.data) {
    // Localize the gateway error by its stable CODE — never the raw English
    // `.message` (rendering that under `sw` is language MIXING).
    const message = query.error
      ? localizeError(query.error, locale)
      : pickByLocale(locale, D.offlineFallback);
    const status =
      query.error && 'status' in query.error
        ? (query.error as { status: number }).status
        : undefined;
    return (
      <DashboardErrorState
        locale={locale}
        message={message}
        {...(status !== undefined ? { status } : {})}
      />
    );
  }

  const { brief, source, generatedAt, cached } = query.data;

  return (
    <div className="flex flex-col gap-6" data-testid="owner-dashboard-surface">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {pickByLocale(locale, D.updatedAt(fmtTime(generatedAt)))} ·{' '}
          {pickByLocale(locale, D.source(source))}
          {cached ? ` ${pickByLocale(locale, D.cached)}` : ''}
          {query.isFetching ? ` · ${pickByLocale(locale, D.refreshing)}` : ''}
        </span>
        <QuickActionsBar />
      </div>

      <section
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-testid="dashboard-top-row"
      >
        <AiDailyBriefPanel
          dailyBrief={brief.dailyBrief}
          initialLocale={initialLocale}
        />
        <AlertQueuePanel
          decisions={brief.decisions}
          incidents={brief.openHighIncidents}
          initialLocale={initialLocale}
        />
      </section>

      {/* Escalations closing surface — reads the authoritative
          mining_escalations ladder and exposes Acknowledge / Resolve so
          the closing stage is reachable for a real owner. */}
      <EscalationsPanel languagePreference={initialLocale} />

      <KpiStripPanel brief={brief} initialLocale={initialLocale} />

      <section
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        data-testid="dashboard-middle-row"
      >
        <div className="lg:col-span-2">
          <ProductionVsTargetTable
            production={brief.productionVsTarget}
            initialLocale={initialLocale}
          />
        </div>
        <CashRunwayCard
          cashRunway={brief.cashRunway}
          cliffStatus={brief.cliffStatus}
          initialLocale={initialLocale}
        />
      </section>

      <ComplianceSafetyPanel
        licenceHealth={brief.licenceHealth}
        incidents={brief.openHighIncidents}
        initialLocale={initialLocale}
      />
    </div>
  );
}

function DashboardSkeleton(): JSX.Element {
  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      data-testid="owner-dashboard-skeleton"
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-lg border border-border bg-surface/40"
        />
      ))}
    </div>
  );
}

interface DashboardErrorStateProps {
  readonly locale: Locale;
  readonly message: string;
  readonly status?: number;
}

function DashboardErrorState({
  locale,
  message,
  status,
}: DashboardErrorStateProps): JSX.Element {
  const D = S.ownerDashboardSurface;
  return (
    <div
      className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-6"
      data-testid="owner-dashboard-error"
    >
      <h2 className="font-display text-xl text-foreground">
        {pickByLocale(locale, D.errorTitle)}
      </h2>
      <p className="mt-2 text-sm text-neutral-300">{message}</p>
      {status ? (
        <p className="mt-1 text-xs text-neutral-500">
          {pickByLocale(locale, D.httpStatus(status))}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-neutral-400">
        {pickByLocale(locale, D.errorHelpBefore)}{' '}
        <a className="text-signal-500 underline" href="/">
          {pickByLocale(locale, D.errorHelpLink)}
        </a>{' '}
        {pickByLocale(locale, D.errorHelpAfter)}
      </p>
    </div>
  );
}

'use client';

import { useOwnerBrief } from '@/lib/queries/owner-brief';
import { fmtTime } from '@/lib/format';
import { AiDailyBriefPanel } from './AiDailyBriefPanel';
import { AlertQueuePanel } from './AlertQueuePanel';
import { KpiStripPanel } from './KpiStripPanel';
import { ProductionVsTargetTable } from './ProductionVsTargetTable';
import { CashRunwayCard } from './CashRunwayCard';
import { ComplianceSafetyPanel } from './ComplianceSafetyPanel';
import { QuickActionsBar } from './QuickActionsBar';

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
export function OwnerDashboardSurface(): JSX.Element {
  const query = useOwnerBrief();

  if (query.isLoading) {
    return <DashboardSkeleton />;
  }

  if (query.error || !query.data) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : 'Dashboard composition is offline.';
    const status =
      query.error && 'status' in query.error
        ? (query.error as { status: number }).status
        : undefined;
    return (
      <DashboardErrorState
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
          Updated {fmtTime(generatedAt)} · source: {source}
          {cached ? ' (cached)' : ''}
          {query.isFetching ? ' · refreshing…' : ''}
        </span>
        <QuickActionsBar />
      </div>

      <section
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-testid="dashboard-top-row"
      >
        <AiDailyBriefPanel dailyBrief={brief.dailyBrief} />
        <AlertQueuePanel
          decisions={brief.decisions}
          incidents={brief.openHighIncidents}
        />
      </section>

      <KpiStripPanel brief={brief} />

      <section
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        data-testid="dashboard-middle-row"
      >
        <div className="lg:col-span-2">
          <ProductionVsTargetTable production={brief.productionVsTarget} />
        </div>
        <CashRunwayCard
          cashRunway={brief.cashRunway}
          cliffStatus={brief.cliffStatus}
        />
      </section>

      <ComplianceSafetyPanel
        licenceHealth={brief.licenceHealth}
        incidents={brief.openHighIncidents}
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
  readonly message: string;
  readonly status?: number;
}

function DashboardErrorState({
  message,
  status,
}: DashboardErrorStateProps): JSX.Element {
  return (
    <div
      className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-6"
      data-testid="owner-dashboard-error"
    >
      <h2 className="font-display text-xl text-foreground">
        Dashboard data is offline
      </h2>
      <p className="mt-2 text-sm text-neutral-300">{message}</p>
      {status ? (
        <p className="mt-1 text-xs text-neutral-500">HTTP {status}</p>
      ) : null}
      <p className="mt-3 text-sm text-neutral-400">
        Ask Borjie Brain directly on the{' '}
        <a className="text-signal-500 underline" href="/">
          home chat
        </a>{' '}
        — it can pull most of these signals on demand from the corpus.
      </p>
    </div>
  );
}

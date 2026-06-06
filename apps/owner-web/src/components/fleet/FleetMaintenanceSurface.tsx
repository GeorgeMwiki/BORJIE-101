'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { MaintenanceTable } from '@/components/fleet/MaintenanceTable';
import { useMaintenanceList } from '@/lib/queries/maintenance';

/**
 * Fleet & assets surface — wired to the LIVE maintenance feed
 * (GET /api/v1/mining/maintenance via useMaintenanceList), grouped by
 * asset over the last 30 days. This is the real asset-health data the
 * gateway exposes today.
 *
 * Honest scope note: a dedicated fleet-UNITS register and the
 * match-factor computation are separate, not-yet-built gateway endpoints
 * (/api/v1/mining/fleet/units, /api/v1/mining/fleet/match-factor) — we do
 * NOT fabricate them. Real loading / empty / error states throughout.
 */
export function FleetMaintenanceSurface() {
  const sinceIso = useMemo(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString(),
    [],
  );
  const events = useMaintenanceList(sinceIso);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Asset maintenance — last 30 days"
        subtitle="Live maintenance events grouped by asset, with predictive due-soon / overdue flags."
        actions={
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => void events.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw
              className={`h-4 w-4 ${events.isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {events.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : events.isError ? (
          <EmptyState
            title="Could not load maintenance"
            description={(events.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/maintenance"
          />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState
            title="No maintenance events yet"
            description="Recorded maintenance for your assets will appear here, grouped by unit with predictive service flags."
          />
        ) : (
          <MaintenanceTable events={events.data ?? []} />
        )}
      </SectionCard>
    </div>
  );
}

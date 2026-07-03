'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { Skeleton } from '@borjie/design-system';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { MaintenanceTable } from '@/components/fleet/MaintenanceTable';
import { useMaintenanceList } from '@/lib/queries/maintenance';
import { useLocale, pickByLocale } from '@/lib/locale';
import { localizeError } from '@/lib/api-client';
import type { Locale } from '@/lib/locale-shared';
import { fleetMaintenanceStrings as S } from '@/i18n/strings/fleet-maintenance-page';

interface FleetMaintenanceSurfaceProps {
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

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
export function FleetMaintenanceSurface({ locale: seeded }: FleetMaintenanceSurfaceProps) {
  const locale = useLocale(seeded);
  const sinceIso = useMemo(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString(),
    [],
  );
  const events = useMaintenanceList(sinceIso);

  return (
    <div className="space-y-4">
      <SectionCard
        title={pickByLocale(locale, S.surfaceTitle)}
        subtitle={pickByLocale(locale, S.surfaceSubtitle)}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
            onClick={() => void events.refetch()}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              className={`h-4 w-4 ${events.isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {events.isLoading ? (
          <Skeleton className="h-chart-sm rounded-lg border border-border" />
        ) : events.isError ? (
          <EmptyState
            title={pickByLocale(locale, S.loadErrorTitle)}
            description={events.error ? localizeError(events.error, locale) : pickByLocale(locale, S.unknownError)}
            hint="GET /api/v1/mining/maintenance"
          />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.emptyTitle)}
            description={pickByLocale(locale, S.emptyBody)}
          />
        ) : (
          <MaintenanceTable events={events.data ?? []} locale={locale} />
        )}
      </SectionCard>
    </div>
  );
}

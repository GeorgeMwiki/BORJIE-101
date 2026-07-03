'use client';

import { useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button, Skeleton } from '@borjie/design-system';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { MaintenanceTable } from '@/components/fleet/MaintenanceTable';
import { NewMaintenanceModal } from '@/components/fleet/NewMaintenanceModal';
import { useMaintenanceList } from '@/lib/queries/maintenance';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeError } from '@/lib/api-client';
import { fleetMaintenanceStrings as S } from '@/i18n/strings/fleet-maintenance-page';

/**
 * Fleet maintenance — last 30 days of maintenance events grouped by
 * asset with predictive flags. Powered by
 * GET /api/v1/mining/maintenance and the partner mutation in
 * lib/queries/maintenance.ts. Strict per-locale copy via pickByLocale.
 *
 * Locale is seeded from the server-resolved value so SSR and the first
 * client render agree (no EN-under-SW first-paint split-brain).
 */
export function MaintenancePageBody({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const sinceIso = useMemo(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString(),
    [],
  );
  const events = useMaintenanceList(sinceIso);
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const assetOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of events.data ?? []) set.add(row.assetId);
    return Array.from(set).sort();
  }, [events.data]);

  return (
    <>
      <header className="border-b border-border px-8 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="font-mono text-xs text-muted-foreground">
              {pickByLocale(locale, S.eyebrow)}
            </span>
            <h1 className="mt-1 font-display text-3xl text-foreground">
              {pickByLocale(locale, S.title)}
            </h1>
            <p className="mt-0.5 text-xs italic text-muted-foreground">
              {pickByLocale(locale, S.subhead)}
            </p>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              {pickByLocale(locale, S.intro)}
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setModalOpen(true)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            {pickByLocale(locale, S.newMaintenanceCta)}
          </Button>
        </div>
      </header>
      <div className="px-8 py-6">
        <SectionCard
          title={pickByLocale(locale, S.recentEventsTitle)}
          subtitle={pickByLocale(locale, S.recentEventsSubtitle)}
          actions={
            <button
              type="button"
              aria-label={pickByLocale(locale, S.refresh)}
              onClick={() => void events.refetch()}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-4 w-4 ${events.isFetching ? 'animate-spin' : ''}`} />
            </button>
          }
        >
          {events.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 rounded-md border border-border" />
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
            </div>
          ) : events.isError ? (
            <EmptyState
              title={pickByLocale(locale, S.loadErrorTitle)}
              description={events.error ? localizeError(events.error, locale) : pickByLocale(locale, S.unknownError)}
              hint="GET /api/v1/mining/maintenance"
            />
          ) : (
            <MaintenanceTable events={events.data ?? []} locale={locale} />
          )}
        </SectionCard>
      </div>
      <NewMaintenanceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void events.refetch()}
        assetOptions={assetOptions}
        locale={locale}
      />
    </>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { MaintenanceTable } from '@/components/fleet/MaintenanceTable';
import { NewMaintenanceModal } from '@/components/fleet/NewMaintenanceModal';
import { useMaintenanceList } from '@/lib/queries/maintenance';

/**
 * Fleet maintenance — last 30 days of maintenance events grouped by
 * asset with predictive flags. Powered by
 * GET /api/v1/mining/maintenance and the partner mutation in
 * lib/queries/maintenance.ts. Bilingual sw+en labels live inline so
 * the screen does not depend on the global locale toggle.
 */
export default function FleetMaintenancePage() {
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
            <span className="font-mono text-xs text-neutral-500">O-W-09 · maintenance</span>
            <h1 className="mt-1 font-display text-3xl text-foreground">
              Fleet maintenance
            </h1>
            <p className="mt-0.5 text-xs italic text-neutral-500">
              Matengenezo ya Magari
            </p>
            <p className="mt-3 max-w-3xl text-sm text-neutral-300">
              Last 30 days of maintenance events grouped by asset. Predictive
              flags surface due-soon and overdue services. /{' '}
              <span className="italic">
                Matengenezo ya siku 30 zilizopita kwa kila gari.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-3 py-2 text-xs text-warning hover:bg-warning-subtle/50"
          >
            <Plus className="h-4 w-4" />
            Open new maintenance / Anza matengenezo
          </button>
        </div>
      </header>
      <div className="px-8 py-6">
        <SectionCard
          title="Recent events"
          subtitle="Matukio ya hivi karibuni"
          actions={
            <button
              type="button"
              aria-label="Refresh"
              onClick={() => void events.refetch()}
              className="text-neutral-500 hover:text-foreground"
            >
              <RefreshCw className={`h-4 w-4 ${events.isFetching ? 'animate-spin' : ''}`} />
            </button>
          }
        >
          {events.isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-neutral-500">
              Loading… / Inapakia…
            </p>
          ) : events.isError ? (
            <EmptyState
              title="Could not load maintenance"
              description={(events.error as Error)?.message ?? 'unknown error'}
              hint="GET /api/v1/mining/maintenance"
            />
          ) : (
            <MaintenanceTable events={events.data ?? []} />
          )}
        </SectionCard>
      </div>
      <NewMaintenanceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void events.refetch()}
        assetOptions={assetOptions.length > 0 ? assetOptions : ['EXC-01', 'TRK-02', 'GEN-01']}
      />
    </>
  );
}

'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtNum, fmtDate } from '@/lib/format';
import { useFleetOpsTco, type VehicleTcoRow } from '@/lib/queries/fleet-ops';

/**
 * Fleet-ops surface — REAL cost-of-ownership computed by
 * `@borjie/fleet-management` (`computeVehicleTco`) over the tenant's live
 * `assets` + `fuel_logs` + `maintenance_events`.
 *
 * Live endpoint: GET /api/v1/mining/fleet-ops/tco. Complements the existing
 * maintenance-feed surface on the same screen — this one is the genuine
 * fuel + maintenance + depreciation roll-up per vehicle.
 *
 * MONEY: figures arrive as integer minor-units (cents) in the tenant's
 * reporting currency. We render the major-unit number (cents / 100) with a
 * neutral "reporting currency" column label — never a hard-coded currency
 * symbol (CLAUDE.md hard rule). Real loading / empty / error states.
 */

/** Minor-units → major-unit number, formatted with the shared grouping. */
function fmtMajor(cents: number): string {
  return fmtNum(Math.round(cents) / 100);
}

function VehicleTcoTable({ rows }: { readonly rows: ReadonlyArray<VehicleTcoRow> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">Vehicle</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 text-right font-medium">Fuel</th>
            <th className="px-3 py-2 text-right font-medium">Maintenance</th>
            <th className="px-3 py-2 text-right font-medium">Depreciation</th>
            <th className="px-3 py-2 text-right font-medium">Total (reporting ccy)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vehicleId} className="border-b border-border/60">
              <td className="px-3 py-2 font-medium text-foreground">{r.label}</td>
              <td className="px-3 py-2 text-neutral-500">{r.type}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtMajor(r.fuelCostCents)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtMajor(r.maintenanceCostCents)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtMajor(r.depreciationCents)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {fmtMajor(r.totalCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FleetOpsSurface() {
  const tco = useFleetOpsTco();

  const subtitle = useMemo(() => {
    if (!tco.data) return 'Fuel + maintenance + depreciation per vehicle.';
    return `Period ${fmtDate(tco.data.periodStart)} – ${fmtDate(
      tco.data.periodEnd,
    )} · ${tco.data.fleetTotals.vehicleCount} vehicle(s).`;
  }, [tco.data]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Fleet cost of ownership"
        subtitle={subtitle}
        actions={
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => void tco.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw
              className={`h-4 w-4 ${tco.isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {tco.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : tco.isError ? (
          <EmptyState
            title="Could not load fleet cost of ownership"
            description={(tco.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/fleet-ops/tco"
          />
        ) : (tco.data?.vehicles ?? []).length === 0 ? (
          <EmptyState
            title="No vehicle assets yet"
            description="Register trucks / vehicles and log fuel + maintenance to see real per-vehicle cost of ownership computed by the fleet engine."
            hint="assets.kind in [truck, vehicle, pickup, van]"
          />
        ) : (
          <div className="space-y-4">
            <VehicleTcoTable rows={tco.data?.vehicles ?? []} />
            {tco.data ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryTile
                  label="Fuel"
                  value={fmtMajor(tco.data.fleetTotals.fuelCostCents)}
                />
                <SummaryTile
                  label="Maintenance"
                  value={fmtMajor(tco.data.fleetTotals.maintenanceCostCents)}
                />
                <SummaryTile
                  label="Depreciation"
                  value={fmtMajor(tco.data.fleetTotals.depreciationCents)}
                />
                <SummaryTile
                  label="Total"
                  value={fmtMajor(tco.data.fleetTotals.totalCents)}
                  emphasis
                />
              </div>
            ) : null}
            {(tco.data?.flags ?? []).length > 0 ? (
              <ul className="space-y-1 rounded-lg border border-border bg-surface/40 p-3 text-xs text-neutral-500">
                {(tco.data?.flags ?? []).map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  emphasis,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </div>
      <div
        className={`mt-1 tabular-nums ${
          emphasis ? 'text-lg font-semibold text-foreground' : 'text-base'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

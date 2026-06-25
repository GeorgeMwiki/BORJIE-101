'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtNum, fmtDate } from '@/lib/format';
import { useLocale, pickByLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale-shared';
import { useFleetOpsTco, type FleetOpsTco, type VehicleTcoRow } from '@/lib/queries/fleet-ops';
import { fleetOpsStrings as S } from '@/i18n/strings/fleet-ops-surface';
import { advisorEnumLabel } from '@/components/treasury/advisor-enum-label';

interface FleetOpsSurfaceProps {
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

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

/**
 * Resolve the backend's stable honesty-flag KEYS into owner-facing notes in
 * the active locale. The wire stays locale-neutral (keys only); we localize
 * here. Per the trust contract, a note is shown ONLY when its underlying
 * figure is genuinely 0:
 *   - distance_source_missing → every vehicle has distanceKm 0 (no trip source)
 *   - depreciation_unmodelled → fleet depreciation total is 0
 *   - vehicle_kind_scope      → always relevant (scope disclosure)
 * Unknown keys are dropped rather than rendered raw.
 */
function resolveFleetFlagNotes(
  data: FleetOpsTco,
  locale: Locale,
): ReadonlyArray<{ readonly key: string; readonly note: string }> {
  const distanceMissing =
    data.vehicles.length === 0 || data.vehicles.every((v) => v.distanceKm === 0);
  const depreciationZero = data.fleetTotals.depreciationCents === 0;
  const table = S.flags;

  return data.flags.flatMap((key) => {
    if (key === 'distance_source_missing' && !distanceMissing) return [];
    if (key === 'depreciation_unmodelled' && !depreciationZero) return [];
    const entry = table[key as keyof typeof table];
    if (!entry) return [];
    return [{ key, note: pickByLocale(locale, entry) }];
  });
}

function VehicleTcoTable({
  rows,
  locale,
}: {
  readonly rows: ReadonlyArray<VehicleTcoRow>;
  readonly locale: Locale;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{pickByLocale(locale, S.colVehicle)}</TableHead>
          <TableHead>{pickByLocale(locale, S.colType)}</TableHead>
          <TableHead className="text-right">{pickByLocale(locale, S.colFuel)}</TableHead>
          <TableHead className="text-right">{pickByLocale(locale, S.colMaintenance)}</TableHead>
          <TableHead className="text-right">{pickByLocale(locale, S.colDepreciation)}</TableHead>
          <TableHead className="text-right">{pickByLocale(locale, S.colTotalReporting)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.vehicleId}>
            <TableCell className="font-medium text-foreground">{r.label}</TableCell>
            <TableCell className="text-muted-foreground">
              {advisorEnumLabel('fleetVehicleType', r.type, locale)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmtMajor(r.fuelCostCents)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtMajor(r.maintenanceCostCents)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {fmtMajor(r.depreciationCents)}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {fmtMajor(r.totalCents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FleetOpsSurface({ locale: seeded }: FleetOpsSurfaceProps) {
  const locale = useLocale(seeded);
  const tco = useFleetOpsTco();

  const subtitle = useMemo(() => {
    if (!tco.data) return pickByLocale(locale, S.subtitleDefault);
    return `${pickByLocale(locale, S.periodPrefix)} ${fmtDate(tco.data.periodStart)} – ${fmtDate(
      tco.data.periodEnd,
    )} · ${tco.data.fleetTotals.vehicleCount} ${pickByLocale(locale, S.vehicleCountSuffix)}`;
  }, [tco.data, locale]);

  return (
    <div className="space-y-4">
      <SectionCard
        title={pickByLocale(locale, S.title)}
        subtitle={subtitle}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
            onClick={() => void tco.refetch()}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${tco.isFetching ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {tco.isLoading ? (
          <Skeleton className="h-chart-sm rounded-lg border border-border" />
        ) : tco.isError ? (
          <EmptyState
            title={pickByLocale(locale, S.loadErrorTitle)}
            description={(tco.error as Error)?.message ?? pickByLocale(locale, S.unknownError)}
            hint="GET /api/v1/mining/fleet-ops/tco"
          />
        ) : (tco.data?.vehicles ?? []).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.emptyTitle)}
            description={pickByLocale(locale, S.emptyBody)}
            hint="assets.kind in [truck, vehicle, pickup, van]"
          />
        ) : (
          <div className="space-y-4">
            <VehicleTcoTable rows={tco.data?.vehicles ?? []} locale={locale} />
            {tco.data ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryTile
                  label={pickByLocale(locale, S.tileFuel)}
                  value={fmtMajor(tco.data.fleetTotals.fuelCostCents)}
                />
                <SummaryTile
                  label={pickByLocale(locale, S.tileMaintenance)}
                  value={fmtMajor(tco.data.fleetTotals.maintenanceCostCents)}
                />
                <SummaryTile
                  label={pickByLocale(locale, S.tileDepreciation)}
                  value={fmtMajor(tco.data.fleetTotals.depreciationCents)}
                />
                <SummaryTile
                  label={pickByLocale(locale, S.tileTotal)}
                  value={fmtMajor(tco.data.fleetTotals.totalCents)}
                  emphasis
                />
              </div>
            ) : null}
            {tco.data ? <FleetFlagNotes data={tco.data} locale={locale} /> : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function FleetFlagNotes({
  data,
  locale,
}: {
  readonly data: FleetOpsTco;
  readonly locale: Locale;
}) {
  const notes = resolveFleetFlagNotes(data, locale);
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-border bg-surface/40 p-3 text-xs text-muted-foreground">
      {notes.map((n) => (
        <li key={n.key}>{n.note}</li>
      ))}
    </ul>
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
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 tabular-nums ${
          emphasis ? 'text-lg font-semibold text-foreground' : 'text-base text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

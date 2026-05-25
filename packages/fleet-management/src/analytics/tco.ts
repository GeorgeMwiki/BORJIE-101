/**
 * Total cost of ownership (TCO) calculator.
 *
 * Sums fuel + maintenance + insurance + fines + straight-line
 * depreciation over a reporting period. Returns the absolute and
 * per-km figures so dashboards can compare across vehicle classes.
 */

import {
  type VehicleTco,
  type Cents,
  type IsoDate,
  type Vehicle,
  type FuelEntry,
  type MaintenanceTask,
  type Trip,
  type Kilometres,
} from '../types.js';

export interface TcoInputs {
  readonly vehicle: Vehicle;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly fuelEntries: ReadonlyArray<FuelEntry>;
  readonly maintenanceTasks: ReadonlyArray<MaintenanceTask>;
  readonly trips: ReadonlyArray<Trip>;
  readonly insuranceCents: Cents;
  readonly finesCents?: Cents;
  /** Annualised straight-line depreciation in cents (purchase / useful-life). */
  readonly annualDepreciationCents: Cents;
}

function daysBetween(startIso: IsoDate, endIso: IsoDate): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(1, Math.round((end - start) / (24 * 3_600_000)));
}

export function computeVehicleTco(inputs: TcoInputs): VehicleTco {
  const fuelCostCents = inputs.fuelEntries
    .filter((e) => e.vehicleId === inputs.vehicle.id
      && e.recordedAt >= inputs.periodStart
      && e.recordedAt <= inputs.periodEnd)
    .reduce((s, e) => s + e.costCents, 0);
  const maintenanceCostCents = inputs.maintenanceTasks
    .filter((t) => t.vehicleId === inputs.vehicle.id
      && t.status === 'completed'
      && t.lastCompletedAtDate
      && t.lastCompletedAtDate >= inputs.periodStart.slice(0, 10)
      && t.lastCompletedAtDate <= inputs.periodEnd.slice(0, 10))
    .reduce((s, t) => s + (t.costCents ?? 0), 0);
  const distanceKm: Kilometres = inputs.trips
    .filter((t) => t.vehicleId === inputs.vehicle.id
      && t.status === 'closed'
      && t.startedAt >= inputs.periodStart
      && t.startedAt <= inputs.periodEnd)
    .reduce((s, t) => s + (t.distanceKm ?? 0), 0);
  const days = daysBetween(inputs.periodStart, inputs.periodEnd);
  const depreciationCents = Math.round((inputs.annualDepreciationCents * days) / 365);
  const finesCostCents = inputs.finesCents ?? 0;
  const totalCents = fuelCostCents
    + maintenanceCostCents
    + inputs.insuranceCents
    + finesCostCents
    + depreciationCents;
  const costPerKmCents = distanceKm > 0 ? totalCents / distanceKm : 0;
  return {
    vehicleId: inputs.vehicle.id,
    periodStart: inputs.periodStart,
    periodEnd: inputs.periodEnd,
    fuelCostCents,
    maintenanceCostCents,
    insuranceCostCents: inputs.insuranceCents,
    finesCostCents,
    depreciationCents,
    totalCents,
    costPerKmCents,
    distanceKm,
  };
}

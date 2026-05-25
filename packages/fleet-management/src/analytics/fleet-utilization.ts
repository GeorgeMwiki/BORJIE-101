/**
 * Fleet utilization + idle-fleet detection.
 *
 *   utilizationPct = productive hours / available hours
 *
 * Productive hours = sum of trip durations across closed trips in the
 * window. Available hours = active fleet × period × 8 (default working
 * day). Adjust via `workingHoursPerDay`.
 *
 * Idle detection: any vehicle with no closed trip in the last
 * `idleThresholdDays` days (default 7) joins `idleVehicleIds`.
 */

import {
  type FleetUtilization,
  type Vehicle,
  type Trip,
  type IsoDate,
} from '../types.js';

export interface FleetUtilizationInputs {
  readonly vehicles: ReadonlyArray<Vehicle>;
  readonly trips: ReadonlyArray<Trip>;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly workingHoursPerDay?: number;
  readonly idleThresholdDays?: number;
}

function daysBetween(startIso: IsoDate, endIso: IsoDate): number {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.max(1, Math.round((e - s) / (24 * 3_600_000)));
}

function tripHours(t: Trip): number {
  if (!t.endedAt) return 0;
  const start = Date.parse(t.startedAt);
  const end = Date.parse(t.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 3_600_000);
}

export function computeFleetUtilization(inputs: FleetUtilizationInputs): FleetUtilization {
  const activeVehicles = inputs.vehicles.filter((v) => v.status === 'active');
  const periodDays = daysBetween(inputs.periodStart, inputs.periodEnd);
  const workingHours = inputs.workingHoursPerDay ?? 8;
  const availableHours = activeVehicles.length * periodDays * workingHours;
  const productiveHours = inputs.trips
    .filter((t) => t.status === 'closed'
      && t.startedAt >= inputs.periodStart
      && t.startedAt <= inputs.periodEnd)
    .reduce((s, t) => s + tripHours(t), 0);
  const utilizationPct = availableHours > 0
    ? Math.min(100, (productiveHours / availableHours) * 100)
    : 0;

  // Idle detection
  const threshold = inputs.idleThresholdDays ?? 7;
  const cutoffMs = Date.parse(inputs.periodEnd) - threshold * 24 * 3_600_000;
  const lastTripByVehicle = new Map<string, number>();
  for (const t of inputs.trips) {
    if (t.status !== 'closed') continue;
    const ms = Date.parse(t.startedAt);
    if (!Number.isFinite(ms)) continue;
    const prev = lastTripByVehicle.get(t.vehicleId) ?? -Infinity;
    if (ms > prev) lastTripByVehicle.set(t.vehicleId, ms);
  }
  const idleVehicleIds = activeVehicles
    .filter((v) => {
      const last = lastTripByVehicle.get(v.id) ?? -Infinity;
      return last < cutoffMs;
    })
    .map((v) => v.id);

  return {
    periodStart: inputs.periodStart,
    periodEnd: inputs.periodEnd,
    totalVehicles: inputs.vehicles.length,
    activeVehicles: activeVehicles.length,
    productiveHours,
    availableHours,
    utilizationPct,
    idleVehicleIds,
  };
}

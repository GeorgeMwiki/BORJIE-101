/**
 * Dispatcher — match a service request to the nearest suitable vehicle.
 *
 * Inputs:
 *   - requestedLocation — where the job lives
 *   - requiredCapacity (passengers or payloadKg)
 *   - requiredType — optional VehicleType filter
 *
 * Algorithm (greedy):
 *   1. Filter the vehicle pool by status='active', type match, and
 *      capacity meets-or-exceeds requirement.
 *   2. For each candidate, look up the most recent telemetry location
 *      (via `TelematicsProvider.getCurrentState`).
 *   3. Rank by haversine distance; return the closest one.
 *   4. If no telemetry, fall back to last known fuel-entry location.
 *
 * This is intentionally simple — the SOTA version would solve a
 * weighted bipartite matching across many simultaneous requests. We
 * leave that to a future BIG-O upgrade and document it in
 * `nextBestInputs` on the returned envelope.
 */

import {
  type Vehicle,
  type VehicleType,
  type GeoPoint,
  type DispatchAssignment,
  type TelematicsProvider,
} from '../types.js';
import { haversineKm } from '../trips/geo.js';

export interface AssignNearestVehicleInput {
  readonly requestedLocation: GeoPoint;
  readonly requiredCapacity: number;
  readonly capacityKind: 'passenger' | 'payload';
  readonly requiredType?: VehicleType;
}

export interface AssignNearestVehicleContext {
  readonly vehicles: ReadonlyArray<Vehicle>;
  readonly telematics?: TelematicsProvider | null;
  readonly fallbackLocations?: ReadonlyMap<string, GeoPoint>;
  /** average urban speed for ETA estimate */
  readonly avgSpeedKph?: number;
}

export async function assignNearestVehicle(
  input: AssignNearestVehicleInput,
  ctx: AssignNearestVehicleContext,
): Promise<DispatchAssignment | null> {
  const filtered = ctx.vehicles.filter((v) => {
    if (v.status !== 'active') return false;
    if (input.requiredType && v.type !== input.requiredType) return false;
    const cap = input.capacityKind === 'passenger' ? v.passengerCapacity : v.payloadKg;
    return cap >= input.requiredCapacity;
  });
  if (filtered.length === 0) return null;

  const ranked: Array<{ readonly v: Vehicle; readonly distanceKm: number; readonly source: 'telematics' | 'fuel_fallback' | 'none' }> = [];
  for (const v of filtered) {
    let location: GeoPoint | null = null;
    let source: 'telematics' | 'fuel_fallback' | 'none' = 'none';
    if (ctx.telematics) {
      try {
        const state = await ctx.telematics.getCurrentState(v.id);
        if (state?.location) {
          location = state.location;
          source = 'telematics';
        }
      } catch {
        /* fall through */
      }
    }
    if (!location && ctx.fallbackLocations) {
      const fallback = ctx.fallbackLocations.get(v.id);
      if (fallback) {
        location = fallback;
        source = 'fuel_fallback';
      }
    }
    if (!location) continue;
    const distanceKm = haversineKm(input.requestedLocation, location);
    ranked.push({ v, distanceKm, source });
  }
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => a.distanceKm - b.distanceKm);
  const winner = ranked[0]!;
  const speed = ctx.avgSpeedKph ?? 35;
  const etaMinutes = Math.max(1, Math.round((winner.distanceKm / speed) * 60));

  return {
    vehicleId: winner.v.id,
    driverId: winner.v.currentDriverId ?? '',
    etaMinutes,
    distanceKm: winner.distanceKm,
    rationale:
      `Nearest active ${winner.v.type} with capacity≥${input.requiredCapacity}; `
      + `location source=${winner.source}, distance=${winner.distanceKm.toFixed(2)} km`,
  };
}

export interface DispatchToMaintenanceJobInput {
  readonly jobId: string;
  readonly requiredSkills: ReadonlyArray<string>;
  readonly propertyId: string;
  readonly propertyLocation: GeoPoint;
}

export interface DispatchToMaintenanceJobContext extends AssignNearestVehicleContext {
  readonly driverSkills: ReadonlyMap<string, ReadonlyArray<string>>;
}

export async function dispatchToMaintenanceJob(
  input: DispatchToMaintenanceJobInput,
  ctx: DispatchToMaintenanceJobContext,
): Promise<{ readonly assignment: DispatchAssignment; readonly skillMatchCount: number } | null> {
  // Filter vehicles whose current driver has at least one required skill.
  const allowedVehicleIds = new Set<string>();
  for (const v of ctx.vehicles) {
    if (!v.currentDriverId) continue;
    const skills = ctx.driverSkills.get(v.currentDriverId) ?? [];
    const matchCount = input.requiredSkills.filter((s) => skills.includes(s)).length;
    if (matchCount > 0) allowedVehicleIds.add(v.id);
  }
  const restricted = ctx.vehicles.filter((v) => allowedVehicleIds.has(v.id));
  if (restricted.length === 0) return null;
  const assignment = await assignNearestVehicle(
    {
      requestedLocation: input.propertyLocation,
      requiredCapacity: 0,
      capacityKind: 'passenger',
    },
    { ...ctx, vehicles: restricted },
  );
  if (!assignment) return null;
  const winnerSkills = ctx.driverSkills.get(assignment.driverId) ?? [];
  const skillMatchCount = input.requiredSkills.filter((s) => winnerSkills.includes(s)).length;
  return { assignment, skillMatchCount };
}

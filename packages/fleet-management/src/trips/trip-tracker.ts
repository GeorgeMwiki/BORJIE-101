/**
 * Trip tracker — start, append breadcrumbs, end, query.
 *
 * Distance: prefer the polyline (breadcrumbs) sum if we have them,
 * otherwise fall back to (endOdometerKm - startOdometerKm). Fuel
 * consumption is computed from the difference + the vehicle's
 * fuel-economy model when not supplied directly.
 */

import { z } from 'zod';
import {
  type Trip,
  type TripPurpose,
  type GeoPoint,
  type Kilometres,
  type Litres,
  type Cents,
  TRIP_PURPOSES,
} from '../types.js';
import { CrossTenantError } from '../vehicles/vehicle-registry.js';
import { haversineKm, polylineLengthKm } from './geo.js';

export class TripNotFoundError extends Error {
  constructor(id: string) {
    super(`Trip not found: ${id}`);
    this.name = 'TripNotFoundError';
  }
}

export class TripAlreadyClosedError extends Error {
  constructor(id: string) {
    super(`Trip ${id} already closed`);
    this.name = 'TripAlreadyClosedError';
  }
}

export interface TripStore {
  get(id: string): Promise<Trip | null>;
  listByVehicle(tenantId: string, vehicleId: string, opts?: { readonly limit?: number }): Promise<ReadonlyArray<Trip>>;
  listByDriver(tenantId: string, driverId: string, opts?: { readonly limit?: number }): Promise<ReadonlyArray<Trip>>;
  listForPeriod(tenantId: string, periodStart: string, periodEnd: string): Promise<ReadonlyArray<Trip>>;
  save(trip: Trip): Promise<Trip>;
}

const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altitudeM: z.number().optional(),
  recordedAt: z.string().optional(),
});

export const StartTripSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  vehicleId: z.string().min(1),
  driverId: z.string().min(1),
  purpose: z.enum(TRIP_PURPOSES),
  startLocation: GeoPointSchema,
  startOdometerKm: z.number().min(0),
  notes: z.string().max(1000).optional(),
  evidenceRefs: z.array(z.string()).optional(),
});

export type StartTripInput = z.infer<typeof StartTripSchema>;

export const EndTripSchema = z.object({
  endLocation: GeoPointSchema,
  endOdometerKm: z.number().min(0),
  fuelConsumedL: z.number().min(0).optional(),
  fuelCostCents: z.number().int().min(0).optional(),
  notes: z.string().max(1000).optional(),
  extraEvidenceRefs: z.array(z.string()).optional(),
});

export type EndTripInput = z.infer<typeof EndTripSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

export async function startTrip(
  input: StartTripInput,
  store: TripStore,
): Promise<Trip> {
  const parsed = StartTripSchema.parse(input);
  const trip: Trip = {
    id: parsed.id,
    tenantId: parsed.tenantId,
    vehicleId: parsed.vehicleId,
    driverId: parsed.driverId,
    purpose: parsed.purpose as TripPurpose,
    startLocation: parsed.startLocation,
    startOdometerKm: parsed.startOdometerKm,
    startedAt: nowIso(),
    status: 'open',
    evidenceRefs: parsed.evidenceRefs ?? [],
    ...(parsed.notes ? { notes: parsed.notes } : {}),
  };
  return store.save(trip);
}

/** Append GPS breadcrumb. Throws if trip is closed. */
export async function appendBreadcrumb(
  tripId: string,
  tenantId: string,
  point: GeoPoint,
  store: TripStore,
): Promise<Trip> {
  const trip = await store.get(tripId);
  if (!trip) throw new TripNotFoundError(tripId);
  if (trip.tenantId !== tenantId) throw new CrossTenantError('trip', tripId);
  if (trip.status !== 'open') throw new TripAlreadyClosedError(tripId);
  const breadcrumbs = [...(trip.breadcrumbs ?? []), point];
  return store.save({ ...trip, breadcrumbs });
}

export interface FuelEconomyEstimate {
  /** Litres per 100 km for the vehicle (e.g. 8.5). */
  readonly litresPer100Km: number;
  /** Pence/cents per litre (for fuel-cost calc when caller did not supply). */
  readonly costPerLitreCents?: Cents;
}

/**
 * Close a trip. Computes distance + fuel from inputs + economy
 * estimate when the caller did not supply explicit fuel data.
 */
export async function endTrip(
  tripId: string,
  tenantId: string,
  input: EndTripInput,
  store: TripStore,
  economy?: FuelEconomyEstimate,
): Promise<Trip> {
  const parsed = EndTripSchema.parse(input);
  const trip = await store.get(tripId);
  if (!trip) throw new TripNotFoundError(tripId);
  if (trip.tenantId !== tenantId) throw new CrossTenantError('trip', tripId);
  if (trip.status !== 'open') throw new TripAlreadyClosedError(tripId);
  if (parsed.endOdometerKm < trip.startOdometerKm) {
    throw new Error(
      `endOdometerKm (${parsed.endOdometerKm}) < startOdometerKm (${trip.startOdometerKm})`,
    );
  }

  const odoDistance: Kilometres = parsed.endOdometerKm - trip.startOdometerKm;
  let polyDistance: Kilometres | null = null;
  if (trip.breadcrumbs && trip.breadcrumbs.length >= 2) {
    polyDistance = polylineLengthKm([
      trip.startLocation,
      ...trip.breadcrumbs,
      parsed.endLocation,
    ]);
  } else {
    polyDistance = haversineKm(trip.startLocation, parsed.endLocation);
  }
  // Trust the odometer when available; polyline is a sanity check.
  const distanceKm: Kilometres = odoDistance > 0 ? odoDistance : polyDistance;

  let fuelConsumedL: Litres | undefined = parsed.fuelConsumedL;
  if (fuelConsumedL === undefined && economy && economy.litresPer100Km > 0) {
    fuelConsumedL = (distanceKm * economy.litresPer100Km) / 100;
  }
  let fuelCostCents: Cents | undefined = parsed.fuelCostCents;
  if (fuelCostCents === undefined
    && fuelConsumedL !== undefined
    && economy?.costPerLitreCents !== undefined) {
    fuelCostCents = Math.round(fuelConsumedL * economy.costPerLitreCents);
  }

  const evidenceRefs = parsed.extraEvidenceRefs?.length
    ? [...trip.evidenceRefs, ...parsed.extraEvidenceRefs]
    : trip.evidenceRefs;

  const closed: Trip = {
    ...trip,
    endLocation: parsed.endLocation,
    endOdometerKm: parsed.endOdometerKm,
    distanceKm,
    endedAt: nowIso(),
    status: 'closed',
    evidenceRefs,
    ...(fuelConsumedL !== undefined ? { fuelConsumedL } : {}),
    ...(fuelCostCents !== undefined ? { fuelCostCents } : {}),
    ...(parsed.notes ? { notes: parsed.notes } : {}),
  };
  return store.save(closed);
}

export async function getTripsByVehicle(
  tenantId: string,
  vehicleId: string,
  store: TripStore,
  opts?: { readonly limit?: number },
): Promise<ReadonlyArray<Trip>> {
  return store.listByVehicle(tenantId, vehicleId, opts);
}

export async function getTripsByDriver(
  tenantId: string,
  driverId: string,
  store: TripStore,
  opts?: { readonly limit?: number },
): Promise<ReadonlyArray<Trip>> {
  return store.listByDriver(tenantId, driverId, opts);
}

export async function getTripsForPeriod(
  tenantId: string,
  periodStart: string,
  periodEnd: string,
  store: TripStore,
): Promise<ReadonlyArray<Trip>> {
  return store.listForPeriod(tenantId, periodStart, periodEnd);
}

export function createInMemoryTripStore(): TripStore {
  const byId = new Map<string, Trip>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async listByVehicle(tenantId, vehicleId, opts) {
      const all = [...byId.values()]
        .filter((t) => t.tenantId === tenantId && t.vehicleId === vehicleId)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      return opts?.limit ? all.slice(0, opts.limit) : all;
    },
    async listByDriver(tenantId, driverId, opts) {
      const all = [...byId.values()]
        .filter((t) => t.tenantId === tenantId && t.driverId === driverId)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      return opts?.limit ? all.slice(0, opts.limit) : all;
    },
    async listForPeriod(tenantId, periodStart, periodEnd) {
      return [...byId.values()].filter(
        (t) => t.tenantId === tenantId
          && t.startedAt >= periodStart
          && t.startedAt <= periodEnd,
      );
    },
    async save(trip) {
      byId.set(trip.id, trip);
      return trip;
    },
  };
}

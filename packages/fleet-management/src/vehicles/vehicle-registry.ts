/**
 * Vehicle registry — pure-function CRUD over the `Vehicle` aggregate.
 *
 * The registry is stateless: each function takes an immutable input and
 * returns a new copy. Persistence is delegated to a `VehicleStore` port
 * so the same registry is exercised by in-memory tests, Postgres, or
 * Redis-cached read replicas.
 *
 * Tenant boundary: every operation requires `tenantId`. Updates against
 * a vehicle that belongs to another tenant throw a `CrossTenantError`
 * instead of silently overwriting — fail-loud is the right default for
 * a multi-tenant SaaS.
 */

import { z } from 'zod';
import {
  type Vehicle,
  type VehicleStatus,
  type VehicleType,
  type FuelType,
  VEHICLE_TYPES,
  FUEL_TYPES,
} from '../types.js';

export class CrossTenantError extends Error {
  constructor(entity: string, id: string) {
    super(`Cross-tenant access denied for ${entity} ${id}`);
    this.name = 'CrossTenantError';
  }
}

export class VehicleNotFoundError extends Error {
  constructor(id: string) {
    super(`Vehicle not found: ${id}`);
    this.name = 'VehicleNotFoundError';
  }
}

/**
 * Storage port — implementations live outside the package (Postgres in
 * api-gateway, in-memory in tests). All operations are tenant-scoped at
 * the call site; the store does not enforce tenancy on its own.
 */
export interface VehicleStore {
  get(id: string): Promise<Vehicle | null>;
  list(filters: {
    readonly tenantId: string;
    readonly orgId?: string;
    readonly status?: VehicleStatus;
    readonly type?: VehicleType;
  }): Promise<ReadonlyArray<Vehicle>>;
  save(vehicle: Vehicle): Promise<Vehicle>;
  delete(id: string): Promise<void>;
}

export const RegisterVehicleSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  orgId: z.string().min(1),
  plate: z.string().min(1).max(20),
  vin: z.string().min(11).max(17),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  type: z.enum(VEHICLE_TYPES),
  fuelType: z.enum(FUEL_TYPES),
  passengerCapacity: z.number().int().min(0).max(200),
  payloadKg: z.number().min(0),
  currentOdometerKm: z.number().min(0),
  assignedToPropertyId: z.string().optional(),
});

export type RegisterVehicleInput = z.infer<typeof RegisterVehicleSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

export async function registerVehicle(
  input: RegisterVehicleInput,
  store: VehicleStore,
): Promise<Vehicle> {
  const parsed = RegisterVehicleSchema.parse(input);
  const ts = nowIso();
  const vehicle: Vehicle = {
    id: parsed.id,
    tenantId: parsed.tenantId,
    orgId: parsed.orgId,
    plate: parsed.plate.toUpperCase().replace(/\s+/g, ''),
    vin: parsed.vin.toUpperCase(),
    make: parsed.make,
    model: parsed.model,
    year: parsed.year,
    type: parsed.type,
    fuelType: parsed.fuelType,
    passengerCapacity: parsed.passengerCapacity,
    payloadKg: parsed.payloadKg,
    currentOdometerKm: parsed.currentOdometerKm,
    status: 'active',
    ...(parsed.assignedToPropertyId
      ? { assignedToPropertyId: parsed.assignedToPropertyId }
      : {}),
    createdAt: ts,
    updatedAt: ts,
  };
  return store.save(vehicle);
}

export interface UpdateVehiclePatch {
  readonly plate?: string;
  readonly make?: string;
  readonly model?: string;
  readonly type?: VehicleType;
  readonly fuelType?: FuelType;
  readonly passengerCapacity?: number;
  readonly payloadKg?: number;
  readonly currentOdometerKm?: number;
  readonly status?: VehicleStatus;
  readonly assignedToPropertyId?: string | null;
  readonly currentDriverId?: string | null;
}

export async function updateVehicle(
  id: string,
  tenantId: string,
  patch: UpdateVehiclePatch,
  store: VehicleStore,
): Promise<Vehicle> {
  const current = await store.get(id);
  if (!current) throw new VehicleNotFoundError(id);
  if (current.tenantId !== tenantId) {
    throw new CrossTenantError('vehicle', id);
  }
  if (patch.currentOdometerKm !== undefined
    && patch.currentOdometerKm < current.currentOdometerKm) {
    throw new Error(
      `Odometer must be monotonically non-decreasing (current=${current.currentOdometerKm}, new=${patch.currentOdometerKm})`,
    );
  }
  // Optional FK fields use null-to-clear semantics. `undefined` in the
  // patch = "leave current value alone"; `null` = "clear it".
  const nextAssignedProperty: string | undefined =
    patch.assignedToPropertyId === null
      ? undefined
      : patch.assignedToPropertyId === undefined
        ? current.assignedToPropertyId
        : patch.assignedToPropertyId;
  const nextDriver: string | undefined =
    patch.currentDriverId === null
      ? undefined
      : patch.currentDriverId === undefined
        ? current.currentDriverId
        : patch.currentDriverId;

  const next: Vehicle = {
    ...current,
    plate: patch.plate
      ? patch.plate.toUpperCase().replace(/\s+/g, '')
      : current.plate,
    make: patch.make ?? current.make,
    model: patch.model ?? current.model,
    type: patch.type ?? current.type,
    fuelType: patch.fuelType ?? current.fuelType,
    passengerCapacity: patch.passengerCapacity ?? current.passengerCapacity,
    payloadKg: patch.payloadKg ?? current.payloadKg,
    currentOdometerKm: patch.currentOdometerKm ?? current.currentOdometerKm,
    status: patch.status ?? current.status,
    assignedToPropertyId: nextAssignedProperty,
    currentDriverId: nextDriver,
    updatedAt: nowIso(),
  };
  return store.save(next);
}

export async function decommission(
  id: string,
  tenantId: string,
  store: VehicleStore,
): Promise<Vehicle> {
  return updateVehicle(id, tenantId, { status: 'decommissioned', currentDriverId: null }, store);
}

export async function transferToOrg(
  id: string,
  tenantId: string,
  newOrgId: string,
  store: VehicleStore,
): Promise<Vehicle> {
  if (!newOrgId) throw new Error('newOrgId required');
  const current = await store.get(id);
  if (!current) throw new VehicleNotFoundError(id);
  if (current.tenantId !== tenantId) {
    throw new CrossTenantError('vehicle', id);
  }
  if (current.orgId === newOrgId) return current;
  const next: Vehicle = { ...current, orgId: newOrgId, updatedAt: nowIso() };
  return store.save(next);
}

/** In-memory store for tests + local-dev. */
export function createInMemoryVehicleStore(): VehicleStore {
  const byId = new Map<string, Vehicle>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async list(filters) {
      return [...byId.values()].filter((v) => {
        if (v.tenantId !== filters.tenantId) return false;
        if (filters.orgId && v.orgId !== filters.orgId) return false;
        if (filters.status && v.status !== filters.status) return false;
        if (filters.type && v.type !== filters.type) return false;
        return true;
      });
    },
    async save(vehicle) {
      byId.set(vehicle.id, vehicle);
      return vehicle;
    },
    async delete(id) {
      byId.delete(id);
    },
  };
}

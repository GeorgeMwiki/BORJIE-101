/**
 * Driver registry — CRUD over the `Driver` aggregate + assignment
 * helpers that maintain the `Driver.currentVehicleId` ↔
 * `Vehicle.currentDriverId` invariant.
 *
 * The store port mirrors the vehicle store. The assignment helpers
 * accept BOTH stores (driver + vehicle) so we update both sides in a
 * single call — the consumer wraps this in a Postgres tx for atomicity.
 */

import { z } from 'zod';
import {
  type Driver,
  type SafetyScoreCard,
  type LicenseClass,
  LICENSE_CLASSES,
} from '../types.js';
import {
  CrossTenantError,
  type VehicleStore,
} from '../vehicles/vehicle-registry.js';

export class DriverNotFoundError extends Error {
  constructor(id: string) {
    super(`Driver not found: ${id}`);
    this.name = 'DriverNotFoundError';
  }
}

export class DriverAlreadyAssignedError extends Error {
  constructor(driverId: string, vehicleId: string) {
    super(`Driver ${driverId} already assigned to vehicle ${vehicleId}`);
    this.name = 'DriverAlreadyAssignedError';
  }
}

export interface DriverStore {
  get(id: string): Promise<Driver | null>;
  getByUserId(tenantId: string, userId: string): Promise<Driver | null>;
  list(filters: {
    readonly tenantId: string;
    readonly licenseClass?: LicenseClass;
    readonly hasVehicle?: boolean;
  }): Promise<ReadonlyArray<Driver>>;
  save(driver: Driver): Promise<Driver>;
  delete(id: string): Promise<void>;
}

const DEFAULT_SCORECARD: SafetyScoreCard = {
  score: 100,
  windowDays: 30,
  speedingEvents: 0,
  harshBrakingEvents: 0,
  collisionEvents: 0,
  idleHours: 0,
  distanceKm: 0,
};

export const RegisterDriverSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  licenseClass: z.enum(LICENSE_CLASSES),
  licenseNumber: z.string().min(1).max(50),
  licenseExpiresAt: z.string().min(8),
  hasMedicalCert: z.boolean(),
  certExpiresAt: z.string().optional(),
});

export type RegisterDriverInput = z.infer<typeof RegisterDriverSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

export async function registerDriver(
  input: RegisterDriverInput,
  store: DriverStore,
): Promise<Driver> {
  const parsed = RegisterDriverSchema.parse(input);
  const ts = nowIso();
  const driver: Driver = {
    id: parsed.id,
    userId: parsed.userId,
    tenantId: parsed.tenantId,
    licenseClass: parsed.licenseClass,
    licenseNumber: parsed.licenseNumber,
    licenseExpiresAt: parsed.licenseExpiresAt,
    hasMedicalCert: parsed.hasMedicalCert,
    ...(parsed.certExpiresAt ? { certExpiresAt: parsed.certExpiresAt } : {}),
    safetyScoreCard: DEFAULT_SCORECARD,
    createdAt: ts,
    updatedAt: ts,
  };
  return store.save(driver);
}

export interface UpdateDriverPatch {
  readonly licenseClass?: LicenseClass;
  readonly licenseNumber?: string;
  readonly licenseExpiresAt?: string;
  readonly hasMedicalCert?: boolean;
  readonly certExpiresAt?: string | null;
  readonly safetyScoreCard?: SafetyScoreCard;
  readonly currentVehicleId?: string | null;
}

export async function updateDriver(
  id: string,
  tenantId: string,
  patch: UpdateDriverPatch,
  store: DriverStore,
): Promise<Driver> {
  const current = await store.get(id);
  if (!current) throw new DriverNotFoundError(id);
  if (current.tenantId !== tenantId) {
    throw new CrossTenantError('driver', id);
  }
  const nextCert =
    patch.certExpiresAt === null
      ? undefined
      : patch.certExpiresAt ?? current.certExpiresAt;
  const nextVehicle =
    patch.currentVehicleId === null
      ? undefined
      : patch.currentVehicleId ?? current.currentVehicleId;
  const next: Driver = {
    ...current,
    licenseClass: patch.licenseClass ?? current.licenseClass,
    licenseNumber: patch.licenseNumber ?? current.licenseNumber,
    licenseExpiresAt: patch.licenseExpiresAt ?? current.licenseExpiresAt,
    hasMedicalCert: patch.hasMedicalCert ?? current.hasMedicalCert,
    ...(nextCert ? { certExpiresAt: nextCert } : {}),
    safetyScoreCard: patch.safetyScoreCard ?? current.safetyScoreCard,
    ...(nextVehicle ? { currentVehicleId: nextVehicle } : {}),
    updatedAt: nowIso(),
  };
  return store.save(next);
}

/**
 * Bidirectional assignment — sets `Driver.currentVehicleId` AND
 * `Vehicle.currentDriverId`. Rejects if the driver is already on
 * another vehicle (caller must unassign first).
 */
export async function assignDriver(
  driverId: string,
  vehicleId: string,
  tenantId: string,
  stores: { readonly drivers: DriverStore; readonly vehicles: VehicleStore },
): Promise<{ readonly driver: Driver }> {
  const driver = await stores.drivers.get(driverId);
  if (!driver) throw new DriverNotFoundError(driverId);
  if (driver.tenantId !== tenantId) {
    throw new CrossTenantError('driver', driverId);
  }
  if (driver.currentVehicleId && driver.currentVehicleId !== vehicleId) {
    throw new DriverAlreadyAssignedError(driverId, driver.currentVehicleId);
  }
  const vehicle = await stores.vehicles.get(vehicleId);
  if (!vehicle) throw new Error(`Vehicle not found: ${vehicleId}`);
  if (vehicle.tenantId !== tenantId) {
    throw new CrossTenantError('vehicle', vehicleId);
  }
  if (vehicle.status === 'decommissioned') {
    throw new Error(`Cannot assign driver to decommissioned vehicle ${vehicleId}`);
  }

  const ts = nowIso();
  const nextDriver: Driver = {
    ...driver,
    currentVehicleId: vehicleId,
    updatedAt: ts,
  };
  await stores.drivers.save(nextDriver);
  await stores.vehicles.save({ ...vehicle, currentDriverId: driverId, updatedAt: ts });
  return { driver: nextDriver };
}

export async function unassignDriver(
  driverId: string,
  tenantId: string,
  stores: { readonly drivers: DriverStore; readonly vehicles: VehicleStore },
): Promise<Driver> {
  const driver = await stores.drivers.get(driverId);
  if (!driver) throw new DriverNotFoundError(driverId);
  if (driver.tenantId !== tenantId) {
    throw new CrossTenantError('driver', driverId);
  }
  const previousVehicleId = driver.currentVehicleId;
  const ts = nowIso();
  // Drop currentVehicleId from the new entity (undefined is allowed).
  const { currentVehicleId: _stripped, ...driverRest } = driver;
  void _stripped;
  const nextDriver: Driver = {
    ...driverRest,
    updatedAt: ts,
  };
  await stores.drivers.save(nextDriver);
  if (previousVehicleId) {
    const vehicle = await stores.vehicles.get(previousVehicleId);
    if (vehicle && vehicle.tenantId === tenantId) {
      const { currentDriverId: _stripDriver, ...vehicleRest } = vehicle;
      void _stripDriver;
      await stores.vehicles.save({
        ...vehicleRest,
        updatedAt: ts,
      });
    }
  }
  return nextDriver;
}

export function createInMemoryDriverStore(): DriverStore {
  const byId = new Map<string, Driver>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async getByUserId(tenantId, userId) {
      for (const d of byId.values()) {
        if (d.tenantId === tenantId && d.userId === userId) return d;
      }
      return null;
    },
    async list(filters) {
      return [...byId.values()].filter((d) => {
        if (d.tenantId !== filters.tenantId) return false;
        if (filters.licenseClass && d.licenseClass !== filters.licenseClass) return false;
        if (filters.hasVehicle !== undefined) {
          const hasV = Boolean(d.currentVehicleId);
          if (hasV !== filters.hasVehicle) return false;
        }
        return true;
      });
    },
    async save(driver) {
      byId.set(driver.id, driver);
      return driver;
    },
    async delete(id) {
      byId.delete(id);
    },
  };
}

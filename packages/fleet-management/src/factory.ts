/**
 * `createFleetManagement` — composite façade.
 *
 * Wires together the registries + optional telematics + routing
 * provider. The api-gateway router constructs one instance per request
 * (or per worker) and calls the bound methods so individual endpoints
 * stay tiny.
 *
 * Stores default to the in-memory implementations so tests do not need
 * to plumb Postgres. In production the api-gateway injects the
 * Postgres-backed adapters.
 */

import {
  type VehicleStore,
  createInMemoryVehicleStore,
} from './vehicles/vehicle-registry.js';
import {
  type DriverStore,
  createInMemoryDriverStore,
} from './drivers/driver-registry.js';
import {
  type TripStore,
  createInMemoryTripStore,
} from './trips/trip-tracker.js';
import {
  type MaintenanceStore,
  createInMemoryMaintenanceStore,
} from './maintenance/maintenance-scheduler.js';
import {
  type FuelStore,
  createInMemoryFuelStore,
} from './fuel/fuel-tracker.js';
import {
  type TelematicsProvider,
  type RoutingProvider,
} from './types.js';
import { localRoutingProvider } from './dispatch/route-optimizer.js';

export interface FleetManagementOptions {
  readonly stores?: {
    readonly vehicles?: VehicleStore;
    readonly drivers?: DriverStore;
    readonly trips?: TripStore;
    readonly maintenance?: MaintenanceStore;
    readonly fuel?: FuelStore;
  };
  readonly telematics?: TelematicsProvider;
  readonly routing?: RoutingProvider;
  readonly alerts?: {
    readonly publish: (alert: { readonly kind: string; readonly subjectId: string; readonly severity: string; readonly message: string }) => void | Promise<void>;
  };
}

export interface FleetManagement {
  readonly stores: {
    readonly vehicles: VehicleStore;
    readonly drivers: DriverStore;
    readonly trips: TripStore;
    readonly maintenance: MaintenanceStore;
    readonly fuel: FuelStore;
  };
  readonly telematics: TelematicsProvider | null;
  readonly routing: RoutingProvider;
  readonly publishAlert: (alert: { readonly kind: string; readonly subjectId: string; readonly severity: string; readonly message: string }) => Promise<void>;
}

export function createFleetManagement(options: FleetManagementOptions = {}): FleetManagement {
  const stores = {
    vehicles: options.stores?.vehicles ?? createInMemoryVehicleStore(),
    drivers: options.stores?.drivers ?? createInMemoryDriverStore(),
    trips: options.stores?.trips ?? createInMemoryTripStore(),
    maintenance: options.stores?.maintenance ?? createInMemoryMaintenanceStore(),
    fuel: options.stores?.fuel ?? createInMemoryFuelStore(),
  };
  const publisher = options.alerts?.publish;
  return {
    stores,
    telematics: options.telematics ?? null,
    routing: options.routing ?? localRoutingProvider,
    async publishAlert(alert) {
      if (!publisher) return;
      await Promise.resolve(publisher(alert));
    },
  };
}

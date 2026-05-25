/**
 * `@borjie/fleet-management` — public surface.
 *
 * Fleet management module: vehicles, drivers, trips, maintenance,
 * fuel, telematics (Samsara / Geotab / mock), dispatch + route
 * optimisation (Google Routes / TSP fallback), TCO + driver
 * scorecards + utilization analytics, and compliance watchers
 * (licence + insurance + roadworthiness + TZ TRA road licence + TZ
 * NIT inspection).
 *
 * Multi-tenant from row one. Every aggregate carries `tenantId`; all
 * cross-tenant reads/writes throw `CrossTenantError`.
 */

// Types
export * from './types.js';

// Vehicles
export {
  registerVehicle,
  updateVehicle,
  decommission,
  transferToOrg,
  createInMemoryVehicleStore,
  CrossTenantError,
  VehicleNotFoundError,
  type VehicleStore,
  type RegisterVehicleInput,
  type UpdateVehiclePatch,
} from './vehicles/vehicle-registry.js';
export {
  decodeVin,
  VinDecodeError,
  type VinDecoderOptions,
} from './vehicles/vin-decoder.js';

// Drivers
export {
  registerDriver,
  updateDriver,
  assignDriver,
  unassignDriver,
  createInMemoryDriverStore,
  DriverNotFoundError,
  DriverAlreadyAssignedError,
  type DriverStore,
  type RegisterDriverInput,
  type UpdateDriverPatch,
} from './drivers/driver-registry.js';
export {
  scanLicenseExpiries,
  DEFAULT_REMINDERS_DAYS as LICENSE_REMINDER_DAYS,
  type ScanOptions as LicenseScanOptions,
} from './drivers/license-expiry-watcher.js';

// Trips
export {
  startTrip,
  endTrip,
  appendBreadcrumb,
  getTripsByVehicle,
  getTripsByDriver,
  getTripsForPeriod,
  createInMemoryTripStore,
  TripNotFoundError,
  TripAlreadyClosedError,
  type TripStore,
  type StartTripInput,
  type EndTripInput,
  type FuelEconomyEstimate,
} from './trips/trip-tracker.js';
export {
  haversineKm,
  polylineLengthKm,
  smoothBreadcrumbs,
} from './trips/geo.js';

// Maintenance
export {
  seedMaintenanceTasks,
  recordCompletion,
  nextDueTasks,
  predictNextDueDate,
  createInMemoryMaintenanceStore,
  MaintenanceTaskNotFoundError,
  type MaintenanceStore,
} from './maintenance/maintenance-scheduler.js';
export {
  defaultIntervalsFor,
  intervalFor,
  type ServiceInterval,
} from './maintenance/intervals.js';

// Fuel
export {
  addFuelEntry,
  computeFuelEconomy,
  detectFuelAnomaly,
  monthlyFuelCostReport,
  quarterlyFuelCostReport,
  createInMemoryFuelStore,
  type FuelStore,
  type AddFuelEntryInput,
} from './fuel/fuel-tracker.js';

// Telematics
export {
  createMockTelematics,
  KNOWN_EVENT_KINDS,
  type MockTelematicsSeed,
  type MockTelematicsOptions,
} from './telematics/mock-adapter.js';
export {
  createSamsaraAdapter,
  type SamsaraAdapterConfig,
} from './telematics/samsara-adapter.js';
export {
  createGeotabAdapter,
  type GeotabAdapterConfig,
  type GeotabCreds,
} from './telematics/geotab-adapter.js';

// Dispatch
export {
  solveTsp,
  buildDistanceMatrix,
  type TspResult,
} from './dispatch/tsp-solver.js';
export {
  optimizeRoute,
  createGoogleRoutesProvider,
  localRoutingProvider,
  defaultRoutingProvider,
  type GoogleRoutesConfig,
  type OptimizeRouteOptions,
} from './dispatch/route-optimizer.js';
export {
  assignNearestVehicle,
  dispatchToMaintenanceJob,
  type AssignNearestVehicleInput,
  type AssignNearestVehicleContext,
  type DispatchToMaintenanceJobInput,
  type DispatchToMaintenanceJobContext,
} from './dispatch/dispatcher.js';

// Analytics
export {
  computeVehicleTco,
  type TcoInputs,
} from './analytics/tco.js';
export {
  computeDriverScorecard,
  type DriverScorecardInputs,
} from './analytics/driver-scorecard.js';
export {
  computeFleetUtilization,
  type FleetUtilizationInputs,
} from './analytics/fleet-utilization.js';

// Compliance
export {
  scanInsuranceExpiries,
  scanRoadworthinessExpiries,
  scanRoadLicenceExpiries,
  scanNitInspectionExpiries,
  scanAllVehicleCompliance,
  DEFAULT_REMINDERS_DAYS as VEHICLE_COMPLIANCE_REMINDER_DAYS,
  type VehicleComplianceRecord,
} from './compliance/expiry-watchers.js';

// Composite factory
export { createFleetManagement, type FleetManagement, type FleetManagementOptions } from './factory.js';

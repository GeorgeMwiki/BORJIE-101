/**
 * Public types for `@borjie/fleet-management`.
 *
 * Pure type module — no runtime. Every entity type is `readonly`
 * end-to-end so the registries' immutable updates do not get mutated
 * downstream. Update operations always return a new copy.
 *
 * Multi-tenant from row one. Every entity carries `tenantId` (the
 * platform tenant that owns the record) plus `orgId` (the estate
 * organisation within that tenant — co-ownerships, vehicle pools, or
 * holding companies). The registries enforce that updates never cross
 * tenant boundaries.
 */

// ─────────────────────────────────────────────────────────────────────
// Geo + identifier primitives
// ─────────────────────────────────────────────────────────────────────

/**
 * Lat/lng + optional altitude. The full PostGIS geometry lives in
 * Postgres; the runtime carries the lightweight tuple form so we are
 * not coupled to the PostGIS client surface in pure-function callers.
 */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
  readonly altitudeM?: number | undefined;
  readonly recordedAt?: string | undefined;       // ISO timestamp
}

export type IsoDate = string;         // YYYY-MM-DD or full ISO
export type Cents = number;           // Integer minor-unit currency
export type Litres = number;          // Decimal litres
export type Kilometres = number;      // Decimal kilometres

// ─────────────────────────────────────────────────────────────────────
// Vehicle types
// ─────────────────────────────────────────────────────────────────────

export const VEHICLE_TYPES = [
  'sedan',
  'suv',
  'pickup',
  'van',
  'truck',
  'motorcycle',
  'scooter',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const FUEL_TYPES = [
  'petrol',
  'diesel',
  'electric',
  'hybrid',
  'cng',
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const VEHICLE_STATUSES = [
  'active',
  'maintenance',
  'decommissioned',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export interface Vehicle {
  readonly id: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly plate: string;
  readonly vin: string;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly type: VehicleType;
  readonly fuelType: FuelType;
  readonly passengerCapacity: number;
  readonly payloadKg: number;
  readonly currentOdometerKm: Kilometres;
  readonly status: VehicleStatus;
  readonly assignedToPropertyId?: string | undefined;
  readonly currentDriverId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Decoded VIN — what NHTSA returns, normalised to our domain. */
export interface VehicleSpec {
  readonly vin: string;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly type: VehicleType | 'unknown';
  readonly fuelType: FuelType | 'unknown';
  readonly engineCylinders?: number | undefined;
  readonly displacementL?: number | undefined;
  readonly bodyClass?: string | undefined;
  readonly plantCountry?: string | undefined;
  readonly source: 'nhtsa' | 'cache' | 'stub';
}

// ─────────────────────────────────────────────────────────────────────
// Driver types
// ─────────────────────────────────────────────────────────────────────

/**
 * License classes — superset of TZ + KE + UK + US categories. The
 * jurisdiction-specific compliance check (see `compliance/`) maps these
 * to local equivalences.
 */
export const LICENSE_CLASSES = [
  'A',        // Motorcycle
  'B',        // Light vehicles (sedan/SUV)
  'C',        // Light trucks / pickups
  'CE',       // Heavy goods + trailer
  'D',        // Passenger vehicles (mini-bus)
  'D1',       // Mini-bus < 16 pax
  'PSV',      // Public service (TZ/KE)
  'HAZMAT',   // Hazardous goods
] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];

export interface SafetyEvent {
  readonly kind: 'speeding' | 'harsh_braking' | 'idle' | 'collision' | 'geofence_exit';
  readonly occurredAt: string;
  readonly severity: 'info' | 'warn' | 'critical';
}

export interface SafetyScoreCard {
  /** 0-100 (100 = perfect). */
  readonly score: number;
  readonly windowDays: number;
  readonly speedingEvents: number;
  readonly harshBrakingEvents: number;
  readonly collisionEvents: number;
  readonly idleHours: number;
  readonly distanceKm: number;
}

export interface Driver {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly licenseClass: LicenseClass;
  readonly licenseNumber: string;
  readonly licenseExpiresAt: IsoDate;
  readonly hasMedicalCert: boolean;
  readonly certExpiresAt?: IsoDate | undefined;
  readonly safetyScoreCard: SafetyScoreCard;
  readonly currentVehicleId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Trip types
// ─────────────────────────────────────────────────────────────────────

export const TRIP_PURPOSES = [
  'maintenance',
  'security',
  'delivery',
  'admin',
  'personal',
] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

export const TRIP_STATUSES = ['open', 'closed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface Trip {
  readonly id: string;
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly driverId: string;
  readonly purpose: TripPurpose;
  readonly startLocation: GeoPoint;
  readonly endLocation?: GeoPoint | undefined;
  readonly startOdometerKm: Kilometres;
  readonly endOdometerKm?: Kilometres | undefined;
  readonly distanceKm?: Kilometres | undefined;
  readonly startedAt: string;
  readonly endedAt?: string | undefined;
  readonly status: TripStatus;
  readonly fuelConsumedL?: Litres | undefined;
  readonly fuelCostCents?: Cents | undefined;
  readonly notes?: string | undefined;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly breadcrumbs?: ReadonlyArray<GeoPoint> | undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Maintenance types
// ─────────────────────────────────────────────────────────────────────

export const MAINTENANCE_KINDS = [
  'oil_change',
  'tire_rotation',
  'tire_replacement',
  'brake_service',
  'inspection',
  'major_service',
  'battery',
  'transmission',
  'air_filter',
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_STATUSES = [
  'scheduled',
  'due',
  'overdue',
  'completed',
  'cancelled',
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export interface MaintenanceTask {
  readonly id: string;
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly kind: MaintenanceKind;
  readonly nextDueAtKm?: Kilometres | undefined;
  readonly nextDueAtDate?: IsoDate | undefined;
  readonly lastCompletedAtKm?: Kilometres | undefined;
  readonly lastCompletedAtDate?: IsoDate | undefined;
  readonly vendor?: string | undefined;
  readonly costCents?: Cents | undefined;
  readonly status: MaintenanceStatus;
  readonly notes?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MaintenanceCompletion {
  readonly completedAtKm: Kilometres;
  readonly completedAtDate: IsoDate;
  readonly vendor: string;
  readonly costCents: Cents;
  readonly notes?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Fuel types
// ─────────────────────────────────────────────────────────────────────

export interface FuelEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly driverId: string;
  readonly fuelType: FuelType;
  readonly litres: Litres;
  readonly costCents: Cents;
  readonly odometerKm: Kilometres;
  readonly location?: GeoPoint | undefined;
  readonly vendor: string;
  readonly receiptImageUrl?: string | undefined;
  readonly recordedAt: string;
}

export interface FuelEconomy {
  readonly vehicleId: string;
  readonly windowEntries: number;
  readonly windowKm: Kilometres;
  readonly windowLitres: Litres;
  /** Litres per 100 km — the standard metric world-wide. */
  readonly litresPer100Km: number;
  /** Inverse for legacy MPG (US gallons). */
  readonly mpgUs: number;
  /** Rolling-window confidence — `low` if < 3 entries / < 200 km. */
  readonly confidence: 'low' | 'medium' | 'high';
}

export interface FuelAnomaly {
  readonly vehicleId: string;
  readonly entryId: string;
  readonly observedLPer100Km: number;
  readonly expectedLPer100Km: number;
  /** Deviation as a positive ratio (e.g. 1.4 = 40% worse). */
  readonly deviationRatio: number;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly reason: string;
}

// ─────────────────────────────────────────────────────────────────────
// Telematics types
// ─────────────────────────────────────────────────────────────────────

export const TELEMATICS_EVENT_KINDS = [
  'ignition_on',
  'ignition_off',
  'speeding',
  'harsh_braking',
  'idle',
  'geofence_entry',
  'geofence_exit',
  'collision',
  'fault_code',
] as const;
export type TelematicsEventKind = (typeof TELEMATICS_EVENT_KINDS)[number];

export interface TelematicsEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly kind: TelematicsEventKind;
  readonly occurredAt: string;
  readonly location?: GeoPoint | undefined;
  readonly speedKph?: number | undefined;
  readonly headingDeg?: number | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface VehicleLiveState {
  readonly vehicleId: string;
  readonly location?: GeoPoint | undefined;
  readonly speedKph: number;
  readonly headingDeg: number;
  readonly ignitionOn: boolean;
  readonly fuelLevelPct?: number | undefined;
  readonly batteryPct?: number | undefined;
  readonly engineTempC?: number | undefined;
  readonly faultCodes: ReadonlyArray<string>;
  readonly asOf: string;
}

/** Port — implementations live in `telematics/`. */
export interface TelematicsProvider {
  readonly name: string;
  streamLocations(
    vehicleId: string,
    onLocation: (point: GeoPoint) => void,
  ): { stop(): void };
  getCurrentState(vehicleId: string): Promise<VehicleLiveState | null>;
  getEvents(vehicleId: string, since: string): Promise<ReadonlyArray<TelematicsEvent>>;
}

// ─────────────────────────────────────────────────────────────────────
// Dispatch types
// ─────────────────────────────────────────────────────────────────────

export interface RouteStop {
  readonly id: string;
  readonly location: GeoPoint;
  readonly serviceMinutes?: number | undefined;
  readonly priority?: number | undefined;
}

export interface OptimizedRoute {
  readonly orderedStopIds: ReadonlyArray<string>;
  readonly totalDistanceKm: Kilometres;
  readonly totalDurationMinutes: number;
  readonly polyline?: string | undefined;
  readonly provider: 'google' | 'haversine_fallback';
}

export interface DispatchAssignment {
  readonly vehicleId: string;
  readonly driverId: string;
  readonly etaMinutes: number;
  readonly distanceKm: Kilometres;
  readonly rationale: string;
}

/** Port — implementations live in `dispatch/`. */
export interface RoutingProvider {
  readonly name: string;
  optimize(input: {
    readonly start: GeoPoint;
    readonly stops: ReadonlyArray<RouteStop>;
    readonly returnToStart: boolean;
  }): Promise<OptimizedRoute>;
}

// ─────────────────────────────────────────────────────────────────────
// Analytics types
// ─────────────────────────────────────────────────────────────────────

export interface VehicleTco {
  readonly vehicleId: string;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly fuelCostCents: Cents;
  readonly maintenanceCostCents: Cents;
  readonly insuranceCostCents: Cents;
  readonly finesCostCents: Cents;
  readonly depreciationCents: Cents;
  readonly totalCents: Cents;
  readonly costPerKmCents: number;
  readonly distanceKm: Kilometres;
}

export interface DriverScorecard {
  readonly driverId: string;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly safetyScore: number;       // 0-100
  readonly fuelEconomyLPer100Km: number;
  readonly onTimeArrivalPct: number;
  readonly jobsCompleted: number;
  readonly distanceKm: Kilometres;
  readonly idleHours: number;
  readonly events: Readonly<{
    readonly speeding: number;
    readonly harshBraking: number;
    readonly collisions: number;
  }>;
}

export interface FleetUtilization {
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly totalVehicles: number;
  readonly activeVehicles: number;
  readonly productiveHours: number;
  readonly availableHours: number;
  readonly utilizationPct: number;
  readonly idleVehicleIds: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Compliance types
// ─────────────────────────────────────────────────────────────────────

export const COMPLIANCE_KINDS = [
  'driver_license_expiry',
  'driver_medical_cert_expiry',
  'vehicle_insurance_expiry',
  'vehicle_roadworthiness_expiry',
  'vehicle_road_licence_expiry',         // TZ/KE TRA
  'vehicle_nit_inspection_expiry',       // TZ NIT
] as const;
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];

export interface ComplianceAlert {
  readonly kind: ComplianceKind;
  readonly subjectId: string;            // vehicle or driver id
  readonly subjectKind: 'vehicle' | 'driver';
  readonly tenantId: string;
  readonly expiresOn: IsoDate;
  readonly daysUntilExpiry: number;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly message: string;
  readonly jurisdiction?: string | undefined;        // ISO country code
}

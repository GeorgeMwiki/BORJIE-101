/**
 * Dispatch — TSP solver, Google Routes adapter (mocked), nearest
 * vehicle assignment, skill-aware maintenance dispatch.
 */
import { describe, it, expect } from 'vitest';
import { solveTsp } from '../dispatch/tsp-solver.js';
import {
  optimizeRoute,
  localRoutingProvider,
  createGoogleRoutesProvider,
  defaultRoutingProvider,
} from '../dispatch/route-optimizer.js';
import { assignNearestVehicle, dispatchToMaintenanceJob } from '../dispatch/dispatcher.js';
import { type Vehicle, type RouteStop } from '../types.js';
import { createMockTelematics } from '../telematics/mock-adapter.js';

const TENANT = 'tnt-1';

const baseVehicle = (overrides: Partial<Vehicle>): Vehicle => ({
  id: 'veh',
  tenantId: TENANT,
  orgId: 'org-a',
  plate: 'PL',
  vin: '1HGCM82633A123456',
  make: 'M', model: 'X', year: 2022,
  type: 'van', fuelType: 'diesel',
  passengerCapacity: 5, payloadKg: 800,
  currentOdometerKm: 10000, status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('dispatch / TSP solver', () => {
  it('returns a tour visiting every stop', () => {
    const start = { lat: 0, lng: 0 };
    const stops: RouteStop[] = [
      { id: 'a', location: { lat: 1, lng: 0 } },
      { id: 'b', location: { lat: 2, lng: 0 } },
      { id: 'c', location: { lat: 3, lng: 0 } },
    ];
    const r = solveTsp(start, stops);
    expect(r.orderedIndexes).toHaveLength(stops.length + 1);
    expect(r.totalDistanceKm).toBeGreaterThan(0);
  });

  it('returns to start when asked', () => {
    const start = { lat: 0, lng: 0 };
    const stops: RouteStop[] = [
      { id: 'a', location: { lat: 1, lng: 0 } },
      { id: 'b', location: { lat: -1, lng: 0 } },
    ];
    const r = solveTsp(start, stops, true);
    // First index = depot start (0); last index = depot return (stops.length + 1).
    expect(r.orderedIndexes[0]).toBe(0);
    expect(r.orderedIndexes[r.orderedIndexes.length - 1]).toBe(stops.length + 1);
  });
});

describe('dispatch / route-optimizer', () => {
  it('local provider returns a haversine_fallback envelope', async () => {
    const r = await optimizeRoute({
      provider: localRoutingProvider,
      start: { lat: 0, lng: 0 },
      stops: [
        { id: 'a', location: { lat: 1, lng: 0 } },
        { id: 'b', location: { lat: 2, lng: 0 } },
      ],
    });
    expect(r.provider).toBe('haversine_fallback');
    expect(new Set(r.orderedStopIds)).toEqual(new Set(['a', 'b']));
  });

  it('google provider parses the API response', async () => {
    const fetchSpy = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          routes: [
            {
              distanceMeters: 12_500,
              duration: '1800s',
              polyline: { encodedPolyline: 'abc123' },
              optimizedIntermediateWaypointIndex: [1, 0],
            },
          ],
        };
      },
    });
    const provider = createGoogleRoutesProvider({ apiKey: 'k', fetch: fetchSpy });
    const r = await optimizeRoute({
      provider,
      start: { lat: 0, lng: 0 },
      stops: [
        { id: 'a', location: { lat: 1, lng: 0 } },
        { id: 'b', location: { lat: 2, lng: 0 } },
      ],
      returnToStart: true,
    });
    expect(r.provider).toBe('google');
    expect(r.totalDistanceKm).toBeCloseTo(12.5, 1);
    expect(r.totalDurationMinutes).toBe(30);
    expect(r.polyline).toBe('abc123');
  });

  it('defaultRoutingProvider picks Google when key present, local otherwise', () => {
    expect(defaultRoutingProvider({}).name).toBe('haversine_fallback');
    expect(defaultRoutingProvider({ GOOGLE_MAPS_API_KEY: 'k' }).name).toBe('google');
  });
});

describe('dispatch / assignNearestVehicle', () => {
  it('returns null when no vehicles match capacity', async () => {
    const r = await assignNearestVehicle(
      { requestedLocation: { lat: 0, lng: 0 }, requiredCapacity: 10, capacityKind: 'passenger' },
      { vehicles: [baseVehicle({ id: 'v1' })] },
    );
    expect(r).toBeNull();
  });

  it('picks the nearest active vehicle (telematics location)', async () => {
    const vehicles = [
      baseVehicle({ id: 'far', currentDriverId: 'drv-far' }),
      baseVehicle({ id: 'near', currentDriverId: 'drv-near' }),
    ];
    const telematics = createMockTelematics([
      { tenantId: TENANT, vehicleId: 'far',  initialState: { location: { lat: 10, lng: 10 }, speedKph: 0, headingDeg: 0, ignitionOn: false, faultCodes: [], asOf: '' } },
      { tenantId: TENANT, vehicleId: 'near', initialState: { location: { lat: 0.1, lng: 0.1 }, speedKph: 0, headingDeg: 0, ignitionOn: false, faultCodes: [], asOf: '' } },
    ]);
    const r = await assignNearestVehicle(
      { requestedLocation: { lat: 0, lng: 0 }, requiredCapacity: 0, capacityKind: 'passenger' },
      { vehicles, telematics },
    );
    expect(r?.vehicleId).toBe('near');
    expect(r?.driverId).toBe('drv-near');
    expect(r?.distanceKm).toBeGreaterThan(0);
  });

  it('falls back to fuel-fallback location when telematics has none', async () => {
    const vehicles = [baseVehicle({ id: 'v1', currentDriverId: 'drv-1' })];
    const fallback = new Map([['v1', { lat: 0.05, lng: 0.05 }]]);
    const r = await assignNearestVehicle(
      { requestedLocation: { lat: 0, lng: 0 }, requiredCapacity: 0, capacityKind: 'passenger' },
      { vehicles, fallbackLocations: fallback },
    );
    expect(r?.vehicleId).toBe('v1');
  });
});

describe('dispatch / dispatchToMaintenanceJob', () => {
  it('restricts to vehicles whose driver has at least one required skill', async () => {
    const vehicles = [
      baseVehicle({ id: 'v-plumb', currentDriverId: 'drv-plumb' }),
      baseVehicle({ id: 'v-elec', currentDriverId: 'drv-elec' }),
    ];
    const driverSkills = new Map([
      ['drv-plumb', ['plumbing']],
      ['drv-elec', ['electrical']],
    ]);
    const telematics = createMockTelematics([
      { tenantId: TENANT, vehicleId: 'v-plumb', initialState: { location: { lat: 0.1, lng: 0.1 }, speedKph: 0, headingDeg: 0, ignitionOn: false, faultCodes: [], asOf: '' } },
      { tenantId: TENANT, vehicleId: 'v-elec',  initialState: { location: { lat: 10, lng: 10 }, speedKph: 0, headingDeg: 0, ignitionOn: false, faultCodes: [], asOf: '' } },
    ]);
    const r = await dispatchToMaintenanceJob(
      { jobId: 'job-1', requiredSkills: ['plumbing'], propertyId: 'prop-1', propertyLocation: { lat: 0, lng: 0 } },
      { vehicles, telematics, driverSkills },
    );
    expect(r?.assignment.vehicleId).toBe('v-plumb');
    expect(r?.skillMatchCount).toBe(1);
  });
});

/**
 * Trip tracker — start, append breadcrumbs, end, distance + fuel calc,
 * tenant + state invariants.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  startTrip,
  endTrip,
  appendBreadcrumb,
  getTripsByVehicle,
  getTripsByDriver,
  getTripsForPeriod,
  createInMemoryTripStore,
  TripAlreadyClosedError,
  TripNotFoundError,
  type TripStore,
} from '../trips/trip-tracker.js';
import { CrossTenantError } from '../vehicles/vehicle-registry.js';
import { haversineKm } from '../trips/geo.js';

const TENANT = 'tnt-1';

const baseStart = {
  id: 'trip-1',
  tenantId: TENANT,
  vehicleId: 'veh-1',
  driverId: 'drv-1',
  purpose: 'maintenance' as const,
  startLocation: { lat: -6.7924, lng: 39.2083 }, // DSM
  startOdometerKm: 10000,
};

describe('trip tracker', () => {
  let store: TripStore;
  beforeEach(() => {
    store = createInMemoryTripStore();
  });

  it('start creates an open trip with empty breadcrumbs', async () => {
    const t = await startTrip(baseStart, store);
    expect(t.status).toBe('open');
    expect(t.breadcrumbs).toBeUndefined();
    expect(t.evidenceRefs).toEqual([]);
  });

  it('end computes distance from odometer and stores both sides', async () => {
    await startTrip(baseStart, store);
    const closed = await endTrip(
      'trip-1',
      TENANT,
      { endLocation: { lat: -6.8, lng: 39.3 }, endOdometerKm: 10025 },
      store,
    );
    expect(closed.status).toBe('closed');
    expect(closed.distanceKm).toBe(25);
    expect(closed.endedAt).toBeDefined();
  });

  it('end without explicit fuel uses economy estimate', async () => {
    await startTrip(baseStart, store);
    const closed = await endTrip(
      'trip-1',
      TENANT,
      { endLocation: { lat: -6.8, lng: 39.3 }, endOdometerKm: 10100 },
      store,
      { litresPer100Km: 8 },
    );
    expect(closed.fuelConsumedL).toBeCloseTo(8, 3);
  });

  it('end refuses to close an already-closed trip', async () => {
    await startTrip(baseStart, store);
    await endTrip('trip-1', TENANT, { endLocation: { lat: -6.8, lng: 39.3 }, endOdometerKm: 10020 }, store);
    await expect(endTrip('trip-1', TENANT, { endLocation: { lat: 0, lng: 0 }, endOdometerKm: 10025 }, store)).rejects.toThrow(TripAlreadyClosedError);
  });

  it('end refuses an end odometer less than start', async () => {
    await startTrip(baseStart, store);
    await expect(endTrip('trip-1', TENANT, { endLocation: { lat: 0, lng: 0 }, endOdometerKm: 9999 }, store)).rejects.toThrow(/endOdometerKm/);
  });

  it('cross-tenant end is rejected', async () => {
    await startTrip(baseStart, store);
    await expect(endTrip('trip-1', 'evil-tenant', { endLocation: { lat: 0, lng: 0 }, endOdometerKm: 10025 }, store)).rejects.toThrow(CrossTenantError);
  });

  it('end throws when trip missing', async () => {
    await expect(endTrip('trip-X', TENANT, { endLocation: { lat: 0, lng: 0 }, endOdometerKm: 1 }, store)).rejects.toThrow(TripNotFoundError);
  });

  it('appendBreadcrumb adds and is reflected in stored trip', async () => {
    await startTrip(baseStart, store);
    await appendBreadcrumb('trip-1', TENANT, { lat: -6.85, lng: 39.25 }, store);
    const t = await store.get('trip-1');
    expect(t?.breadcrumbs).toHaveLength(1);
  });

  it('appendBreadcrumb refuses to mutate a closed trip', async () => {
    await startTrip(baseStart, store);
    await endTrip('trip-1', TENANT, { endLocation: { lat: -6.8, lng: 39.3 }, endOdometerKm: 10020 }, store);
    await expect(appendBreadcrumb('trip-1', TENANT, { lat: 0, lng: 0 }, store)).rejects.toThrow(TripAlreadyClosedError);
  });

  it('haversine distance is sane for DSM → DAR-Mlimani', () => {
    const km = haversineKm({ lat: -6.7924, lng: 39.2083 }, { lat: -6.8000, lng: 39.3000 });
    expect(km).toBeGreaterThan(8);
    expect(km).toBeLessThan(12);
  });

  it('listing helpers filter by vehicle, driver, period', async () => {
    await startTrip(baseStart, store);
    await startTrip({ ...baseStart, id: 'trip-2', vehicleId: 'veh-2', driverId: 'drv-2' }, store);
    const byVehicle = await getTripsByVehicle(TENANT, 'veh-1', store);
    expect(byVehicle).toHaveLength(1);
    const byDriver = await getTripsByDriver(TENANT, 'drv-2', store);
    expect(byDriver).toHaveLength(1);
    const period = await getTripsForPeriod(TENANT, '2020-01-01', '2099-01-01', store);
    expect(period).toHaveLength(2);
  });
});

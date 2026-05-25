/**
 * Analytics — TCO, driver scorecard, fleet utilization.
 */
import { describe, it, expect } from 'vitest';
import { computeVehicleTco } from '../analytics/tco.js';
import { computeDriverScorecard } from '../analytics/driver-scorecard.js';
import { computeFleetUtilization } from '../analytics/fleet-utilization.js';
import { type Vehicle, type FuelEntry, type MaintenanceTask, type Trip, type TelematicsEvent } from '../types.js';

const TENANT = 'tnt-1';

const baseVehicle = (id: string): Vehicle => ({
  id, tenantId: TENANT, orgId: 'org', plate: id, vin: '1HGCM82633A123456',
  make: 'X', model: 'Y', year: 2022, type: 'van', fuelType: 'diesel',
  passengerCapacity: 5, payloadKg: 800, currentOdometerKm: 50_000, status: 'active',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

describe('analytics / TCO', () => {
  it('sums fuel + maintenance + insurance + fines + depreciation', () => {
    const fuelEntries: FuelEntry[] = [
      { id: 'f1', tenantId: TENANT, vehicleId: 'veh-1', driverId: 'drv-1', fuelType: 'diesel', litres: 40, costCents: 80_000, odometerKm: 1, vendor: 'V', recordedAt: '2026-02-15T00:00:00Z' },
      { id: 'f2', tenantId: TENANT, vehicleId: 'veh-1', driverId: 'drv-1', fuelType: 'diesel', litres: 50, costCents: 100_000, odometerKm: 1, vendor: 'V', recordedAt: '2026-03-15T00:00:00Z' },
    ];
    const maint: MaintenanceTask[] = [
      { id: 'm1', tenantId: TENANT, vehicleId: 'veh-1', kind: 'oil_change', status: 'completed', costCents: 50_000, lastCompletedAtDate: '2026-02-10', createdAt: '', updatedAt: '' },
    ];
    const trips: Trip[] = [
      { id: 't1', tenantId: TENANT, vehicleId: 'veh-1', driverId: 'drv-1', purpose: 'admin',
        startLocation: { lat: 0, lng: 0 }, startOdometerKm: 50_000, startedAt: '2026-02-01T08:00:00Z',
        endLocation: { lat: 0, lng: 1 }, endOdometerKm: 50_500, endedAt: '2026-02-01T18:00:00Z',
        distanceKm: 500, status: 'closed', evidenceRefs: [] },
    ];
    const tco = computeVehicleTco({
      vehicle: baseVehicle('veh-1'),
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      fuelEntries,
      maintenanceTasks: maint,
      trips,
      insuranceCents: 120_000,
      finesCents: 5_000,
      annualDepreciationCents: 365_000,
    });
    expect(tco.fuelCostCents).toBe(180_000);
    expect(tco.maintenanceCostCents).toBe(50_000);
    expect(tco.insuranceCostCents).toBe(120_000);
    expect(tco.finesCostCents).toBe(5_000);
    // ~ 89 days @ 1000/day = 89000
    expect(tco.depreciationCents).toBeGreaterThan(80_000);
    expect(tco.distanceKm).toBe(500);
    expect(tco.totalCents).toBe(tco.fuelCostCents + tco.maintenanceCostCents + tco.insuranceCostCents + tco.finesCostCents + tco.depreciationCents);
    expect(tco.costPerKmCents).toBeGreaterThan(0);
  });

  it('reports zero distance gracefully', () => {
    const tco = computeVehicleTco({
      vehicle: baseVehicle('veh-2'),
      periodStart: '2026-01-01', periodEnd: '2026-03-31',
      fuelEntries: [], maintenanceTasks: [], trips: [],
      insuranceCents: 0, annualDepreciationCents: 0,
    });
    expect(tco.distanceKm).toBe(0);
    expect(tco.costPerKmCents).toBe(0);
  });
});

describe('analytics / driver scorecard', () => {
  it('penalises critical events more than warns', () => {
    const events: TelematicsEvent[] = [
      { id: 'e1', tenantId: TENANT, vehicleId: 'veh-1', kind: 'speeding', occurredAt: '2026-02-15T08:00:00Z', metadata: {} },
    ];
    const sc = computeDriverScorecard({
      driverId: 'drv-1',
      periodStart: '2026-01-01', periodEnd: '2026-03-31',
      trips: [], fuelEntries: [],
      safetyEvents: events,
    });
    expect(sc.safetyScore).toBeLessThan(100);
    expect(sc.events.speeding).toBe(1);
  });

  it('zero distance + zero events ⇒ score=100', () => {
    const sc = computeDriverScorecard({
      driverId: 'drv-1', periodStart: '2026-01-01', periodEnd: '2026-03-31',
      trips: [], fuelEntries: [], safetyEvents: [],
    });
    expect(sc.safetyScore).toBe(100);
    expect(sc.jobsCompleted).toBe(0);
  });

  it('on-time arrival pct uses configured window', () => {
    const trips: Trip[] = [
      { id: 't1', tenantId: TENANT, vehicleId: 'v', driverId: 'drv-1', purpose: 'admin',
        startLocation: { lat: 0, lng: 0 }, startOdometerKm: 0, startedAt: '2026-02-15T08:00:00Z',
        endLocation: { lat: 0, lng: 0 }, endOdometerKm: 0, endedAt: '2026-02-15T10:05:00Z',
        distanceKm: 0, status: 'closed', evidenceRefs: [] },
    ];
    const sc = computeDriverScorecard({
      driverId: 'drv-1', periodStart: '2026-01-01', periodEnd: '2026-03-31',
      trips, fuelEntries: [], safetyEvents: [],
      scheduledArrivals: [{ tripId: 't1', scheduledAt: '2026-02-15T10:00:00Z' }],
      onTimeWindowMinutes: 10,
    });
    expect(sc.onTimeArrivalPct).toBe(100);
  });
});

describe('analytics / fleet utilization', () => {
  it('computes utilization as productive/available', () => {
    const vehicles = [baseVehicle('v1'), baseVehicle('v2')];
    const trips: Trip[] = [
      { id: 't1', tenantId: TENANT, vehicleId: 'v1', driverId: 'd', purpose: 'admin',
        startLocation: { lat: 0, lng: 0 }, startOdometerKm: 0, startedAt: '2026-02-01T08:00:00Z',
        endLocation: { lat: 0, lng: 0 }, endOdometerKm: 0, endedAt: '2026-02-01T12:00:00Z',
        distanceKm: 0, status: 'closed', evidenceRefs: [] },
    ];
    const u = computeFleetUtilization({
      vehicles, trips, periodStart: '2026-02-01', periodEnd: '2026-02-02',
      workingHoursPerDay: 8,
    });
    expect(u.productiveHours).toBeCloseTo(4, 2);
    expect(u.availableHours).toBeCloseTo(2 * 1 * 8, 2);
    expect(u.utilizationPct).toBeGreaterThan(0);
  });

  it('flags vehicles with no recent trip as idle', () => {
    const vehicles = [baseVehicle('v1'), baseVehicle('v2')];
    const trips: Trip[] = [
      // v1 has a fresh trip 1 day before period end → not idle
      { id: 't1', tenantId: TENANT, vehicleId: 'v1', driverId: 'd', purpose: 'admin',
        startLocation: { lat: 0, lng: 0 }, startOdometerKm: 0, startedAt: '2026-02-27T08:00:00Z',
        endLocation: { lat: 0, lng: 0 }, endOdometerKm: 0, endedAt: '2026-02-27T09:00:00Z',
        distanceKm: 0, status: 'closed', evidenceRefs: [] },
    ];
    const u = computeFleetUtilization({
      vehicles, trips, periodStart: '2026-02-01', periodEnd: '2026-02-28',
      idleThresholdDays: 5,
    });
    expect(u.idleVehicleIds).toEqual(['v2']);
  });
});

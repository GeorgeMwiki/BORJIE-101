/**
 * Maintenance scheduler tests — seed, completion roll-forward,
 * due/overdue classification, predictive due-date.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  seedMaintenanceTasks,
  recordCompletion,
  nextDueTasks,
  predictNextDueDate,
  createInMemoryMaintenanceStore,
  MaintenanceTaskNotFoundError,
  type MaintenanceStore,
} from '../maintenance/maintenance-scheduler.js';
import { defaultIntervalsFor, intervalFor } from '../maintenance/intervals.js';
import { CrossTenantError } from '../vehicles/vehicle-registry.js';
import { type Vehicle } from '../types.js';

const TENANT = 'tnt-1';

function fixtureVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'veh-1',
    tenantId: TENANT,
    orgId: 'org-a',
    plate: 'KAA123',
    vin: '1HGCM82633A123456',
    make: 'Toyota',
    model: 'Hilux',
    year: 2022,
    type: 'pickup',
    fuelType: 'diesel',
    passengerCapacity: 5,
    payloadKg: 1000,
    currentOdometerKm: 20000,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('maintenance / intervals', () => {
  it('returns more rows for hybrid than petrol', () => {
    expect(defaultIntervalsFor('hybrid').length).toBeGreaterThan(defaultIntervalsFor('petrol').length - 1);
  });
  it('intervalFor returns the latest matching entry per kind', () => {
    const i = intervalFor('hybrid', 'battery');
    expect(i?.intervalKm).toBe(80_000);
  });
});

describe('maintenance / seed', () => {
  it('creates rows for every interval in the fuel-type table', async () => {
    const store: MaintenanceStore = createInMemoryMaintenanceStore();
    const v = fixtureVehicle({ fuelType: 'petrol' });
    const created = await seedMaintenanceTasks(v, store);
    expect(created.length).toBe(defaultIntervalsFor('petrol').length);
    const sample = created.find((t) => t.kind === 'oil_change');
    expect(sample?.nextDueAtKm).toBe(v.currentOdometerKm + 15_000);
  });
  it('is idempotent — second seed adds nothing', async () => {
    const store = createInMemoryMaintenanceStore();
    const v = fixtureVehicle();
    await seedMaintenanceTasks(v, store);
    const second = await seedMaintenanceTasks(v, store);
    expect(second).toHaveLength(0);
  });
});

describe('maintenance / recordCompletion', () => {
  it('rolls the next-due window forward by the standard interval', async () => {
    const store = createInMemoryMaintenanceStore();
    const v = fixtureVehicle({ fuelType: 'diesel' });
    const tasks = await seedMaintenanceTasks(v, store);
    const oilTask = tasks.find((t) => t.kind === 'oil_change')!;
    const completed = await recordCompletion(
      oilTask.id,
      TENANT,
      {
        completedAtKm: 22_000,
        completedAtDate: '2026-05-24',
        vendor: 'AutoTech Ltd',
        costCents: 50_000,
      },
      store,
      'diesel',
    );
    expect(completed.status).toBe('completed');
    expect(completed.lastCompletedAtKm).toBe(22_000);
    expect(completed.nextDueAtKm).toBe(22_000 + 20_000);
  });
  it('rejects cross-tenant completion', async () => {
    const store = createInMemoryMaintenanceStore();
    const v = fixtureVehicle();
    const tasks = await seedMaintenanceTasks(v, store);
    await expect(
      recordCompletion(tasks[0]!.id, 'evil-tenant', { completedAtKm: 1, completedAtDate: '2026-05-24', vendor: 'X', costCents: 1 }, store),
    ).rejects.toThrow(CrossTenantError);
  });
  it('throws for unknown id', async () => {
    const store = createInMemoryMaintenanceStore();
    await expect(
      recordCompletion('nope', TENANT, { completedAtKm: 1, completedAtDate: '2026-05-24', vendor: 'X', costCents: 1 }, store),
    ).rejects.toThrow(MaintenanceTaskNotFoundError);
  });
});

describe('maintenance / nextDueTasks classification', () => {
  it('marks rows overdue when current odo > nextDue', async () => {
    const store = createInMemoryMaintenanceStore();
    const v = fixtureVehicle({ fuelType: 'petrol', currentOdometerKm: 100_000 });
    await seedMaintenanceTasks(v, store);
    const due = await nextDueTasks(TENANT, v.id, 200_000, '2026-05-24', store);
    expect(due[0]?.status).toBe('overdue');
  });
  it('orders overdue → due → scheduled', async () => {
    const store = createInMemoryMaintenanceStore();
    const v = fixtureVehicle({ fuelType: 'petrol', currentOdometerKm: 1000 });
    await seedMaintenanceTasks(v, store);
    const due = await nextDueTasks(TENANT, v.id, 1000, '2026-05-24', store);
    expect(due.every((t) => t.status === 'scheduled')).toBe(true);
  });
});

describe('maintenance / predictNextDueDate', () => {
  it('extrapolates from rolling daily km rate', () => {
    const d = predictNextDueDate({
      currentOdometerKm: 50_000,
      nextDueAtKm: 65_000,
      distanceLastNDaysKm: 1500,
      nDays: 30,
      asOfIso: '2026-05-24',
    });
    // 15000 km remaining at 50 km/day → 300 days ≈ 2027-03-21
    expect(d?.slice(0, 4)).toBe('2027');
  });
  it('returns null if daily rate is zero', () => {
    expect(predictNextDueDate({
      currentOdometerKm: 50_000, nextDueAtKm: 65_000,
      distanceLastNDaysKm: 0, nDays: 30, asOfIso: '2026-05-24',
    })).toBeNull();
  });
  it('returns today if already at threshold', () => {
    const d = predictNextDueDate({
      currentOdometerKm: 65_000, nextDueAtKm: 65_000,
      distanceLastNDaysKm: 100, nDays: 30, asOfIso: '2026-05-24',
    });
    expect(d).toBe('2026-05-24');
  });
});

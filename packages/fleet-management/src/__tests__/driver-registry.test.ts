/**
 * Driver registry — assignment invariant, cross-tenant rejection,
 * license expiry watcher.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerDriver,
  assignDriver,
  unassignDriver,
  DriverAlreadyAssignedError,
  createInMemoryDriverStore,
  type DriverStore,
} from '../drivers/driver-registry.js';
import {
  registerVehicle,
  createInMemoryVehicleStore,
  CrossTenantError,
  type VehicleStore,
} from '../vehicles/vehicle-registry.js';
import { scanLicenseExpiries } from '../drivers/license-expiry-watcher.js';

const TENANT = 'tnt-1';

const baseDriver = {
  id: 'drv-1',
  userId: 'usr-1',
  tenantId: TENANT,
  licenseClass: 'B' as const,
  licenseNumber: 'TZ-DL-1234',
  licenseExpiresAt: '2026-12-31',
  hasMedicalCert: true,
  certExpiresAt: '2026-08-15',
};

const baseVehicle = {
  id: 'veh-1',
  tenantId: TENANT,
  orgId: 'org-a',
  plate: 'KAA 123 X',
  vin: '1HGCM82633A123456',
  make: 'Toyota',
  model: 'Hilux',
  year: 2022,
  type: 'pickup' as const,
  fuelType: 'diesel' as const,
  passengerCapacity: 5,
  payloadKg: 1000,
  currentOdometerKm: 12345,
};

describe('driver registry / register', () => {
  it('registers with default scorecard score=100', async () => {
    const d = await registerDriver(baseDriver, createInMemoryDriverStore());
    expect(d.safetyScoreCard.score).toBe(100);
    expect(d.licenseClass).toBe('B');
  });
});

describe('driver registry / assignment', () => {
  let drivers: DriverStore;
  let vehicles: VehicleStore;
  beforeEach(async () => {
    drivers = createInMemoryDriverStore();
    vehicles = createInMemoryVehicleStore();
    await registerDriver(baseDriver, drivers);
    await registerVehicle(baseVehicle, vehicles);
  });

  it('assignDriver sets both sides of the invariant', async () => {
    await assignDriver('drv-1', 'veh-1', TENANT, { drivers, vehicles });
    const d = await drivers.get('drv-1');
    const v = await vehicles.get('veh-1');
    expect(d?.currentVehicleId).toBe('veh-1');
    expect(v?.currentDriverId).toBe('drv-1');
  });

  it('rejects assigning an already-assigned driver to a different vehicle', async () => {
    await assignDriver('drv-1', 'veh-1', TENANT, { drivers, vehicles });
    await registerVehicle({ ...baseVehicle, id: 'veh-2', plate: 'KBC 999', vin: '2HGCM82633A123456' }, vehicles);
    await expect(assignDriver('drv-1', 'veh-2', TENANT, { drivers, vehicles })).rejects.toThrow(DriverAlreadyAssignedError);
  });

  it('refuses to assign to a decommissioned vehicle', async () => {
    await vehicles.save({ ...(await vehicles.get('veh-1'))!, status: 'decommissioned' });
    await expect(assignDriver('drv-1', 'veh-1', TENANT, { drivers, vehicles })).rejects.toThrow(/decommissioned/);
  });

  it('rejects cross-tenant assignment', async () => {
    await expect(assignDriver('drv-1', 'veh-1', 'evil-tenant', { drivers, vehicles })).rejects.toThrow(CrossTenantError);
  });

  it('unassign clears both sides', async () => {
    await assignDriver('drv-1', 'veh-1', TENANT, { drivers, vehicles });
    const d = await unassignDriver('drv-1', TENANT, { drivers, vehicles });
    expect(d.currentVehicleId).toBeUndefined();
    const v = await vehicles.get('veh-1');
    expect(v?.currentDriverId).toBeUndefined();
  });
});

describe('license-expiry watcher', () => {
  it('fires a critical alert when already expired', async () => {
    const drivers = createInMemoryDriverStore();
    await registerDriver({ ...baseDriver, licenseExpiresAt: '2026-01-01' }, drivers);
    const alerts = scanLicenseExpiries(await drivers.list({ tenantId: TENANT }), '2026-05-24');
    expect(alerts).toHaveLength(2);   // license + medical cert may also be reminded
    const expiry = alerts.find((a) => a.kind === 'driver_license_expiry');
    expect(expiry?.severity).toBe('critical');
    expect(expiry?.daysUntilExpiry).toBeLessThan(0);
  });

  it('fires warn at the 30-day threshold', async () => {
    const drivers = createInMemoryDriverStore();
    await registerDriver({ ...baseDriver, licenseExpiresAt: '2026-06-20', hasMedicalCert: false }, drivers);
    const alerts = scanLicenseExpiries(await drivers.list({ tenantId: TENANT }), '2026-05-24');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('warn');
  });

  it('fires info at the 90-day threshold but not earlier', async () => {
    const drivers = createInMemoryDriverStore();
    await registerDriver({ ...baseDriver, licenseExpiresAt: '2026-08-20', hasMedicalCert: false }, drivers);
    const alerts = scanLicenseExpiries(await drivers.list({ tenantId: TENANT }), '2026-05-24');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('info');

    const drivers2 = createInMemoryDriverStore();
    await registerDriver({ ...baseDriver, licenseExpiresAt: '2027-01-01', hasMedicalCert: false }, drivers2);
    const alerts2 = scanLicenseExpiries(await drivers2.list({ tenantId: TENANT }), '2026-05-24');
    expect(alerts2).toHaveLength(0);
  });

  it('also reminds for medical cert expiry', async () => {
    const drivers = createInMemoryDriverStore();
    await registerDriver({ ...baseDriver, certExpiresAt: '2026-06-01' }, drivers);
    const alerts = scanLicenseExpiries(await drivers.list({ tenantId: TENANT }), '2026-05-24');
    const cert = alerts.find((a) => a.kind === 'driver_medical_cert_expiry');
    expect(cert?.severity).toBe('warn');
  });
});

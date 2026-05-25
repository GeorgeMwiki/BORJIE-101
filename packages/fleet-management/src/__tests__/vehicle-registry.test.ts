/**
 * Vehicle registry — registration, update, decommission, transfer,
 * cross-tenant fail-loud.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerVehicle,
  updateVehicle,
  decommission,
  transferToOrg,
  createInMemoryVehicleStore,
  CrossTenantError,
  VehicleNotFoundError,
  type VehicleStore,
} from '../vehicles/vehicle-registry.js';

const TENANT = 'tnt-1';
const baseInput = {
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

describe('vehicle registry / register', () => {
  let store: VehicleStore;
  beforeEach(() => {
    store = createInMemoryVehicleStore();
  });

  it('registers a vehicle with status=active and normalises plate', async () => {
    const v = await registerVehicle(baseInput, store);
    expect(v.id).toBe('veh-1');
    expect(v.status).toBe('active');
    expect(v.plate).toBe('KAA123X');
    expect(v.vin).toBe('1HGCM82633A123456');
    expect(v.createdAt).toBeDefined();
    expect(v.updatedAt).toBe(v.createdAt);
  });

  it('rejects invalid VIN length', async () => {
    await expect(registerVehicle({ ...baseInput, vin: 'TOOSHORT' }, store)).rejects.toThrow();
  });

  it('rejects invalid year', async () => {
    await expect(registerVehicle({ ...baseInput, year: 1800 }, store)).rejects.toThrow();
  });

  it('round-trips through the store', async () => {
    await registerVehicle(baseInput, store);
    const fetched = await store.get('veh-1');
    expect(fetched?.plate).toBe('KAA123X');
  });
});

describe('vehicle registry / update', () => {
  let store: VehicleStore;
  beforeEach(async () => {
    store = createInMemoryVehicleStore();
    await registerVehicle(baseInput, store);
  });

  it('updates make/model and bumps updatedAt', async () => {
    const before = await store.get('veh-1');
    await new Promise((r) => setTimeout(r, 5));
    const v = await updateVehicle('veh-1', TENANT, { model: 'Hilux 2.4' }, store);
    expect(v.model).toBe('Hilux 2.4');
    expect(v.updatedAt > before!.updatedAt).toBe(true);
  });

  it('rejects cross-tenant updates', async () => {
    await expect(updateVehicle('veh-1', 'other-tenant', { model: 'X' }, store)).rejects.toThrow(CrossTenantError);
  });

  it('rejects monotonically decreasing odometer', async () => {
    await expect(updateVehicle('veh-1', TENANT, { currentOdometerKm: 100 }, store)).rejects.toThrow(/monotonically/);
  });

  it('throws when vehicle missing', async () => {
    await expect(updateVehicle('does-not-exist', TENANT, { model: 'X' }, store)).rejects.toThrow(VehicleNotFoundError);
  });

  it('clears assignedToPropertyId via null sentinel', async () => {
    await updateVehicle('veh-1', TENANT, { assignedToPropertyId: 'prop-7' }, store);
    const after = await updateVehicle('veh-1', TENANT, { assignedToPropertyId: null }, store);
    expect(after.assignedToPropertyId).toBeUndefined();
  });
});

describe('vehicle registry / decommission + transferToOrg', () => {
  let store: VehicleStore;
  beforeEach(async () => {
    store = createInMemoryVehicleStore();
    await registerVehicle(baseInput, store);
  });

  it('decommission sets status to decommissioned and clears driver', async () => {
    await updateVehicle('veh-1', TENANT, { currentDriverId: 'drv-1' }, store);
    const d = await decommission('veh-1', TENANT, store);
    expect(d.status).toBe('decommissioned');
    expect(d.currentDriverId).toBeUndefined();
  });

  it('transferToOrg moves the vehicle and updates updatedAt', async () => {
    const t = await transferToOrg('veh-1', TENANT, 'org-b', store);
    expect(t.orgId).toBe('org-b');
  });

  it('transferToOrg is a no-op if newOrgId matches', async () => {
    const before = await store.get('veh-1');
    const t = await transferToOrg('veh-1', TENANT, 'org-a', store);
    expect(t.updatedAt).toBe(before!.updatedAt);
  });

  it('transferToOrg rejects empty newOrgId', async () => {
    await expect(transferToOrg('veh-1', TENANT, '', store)).rejects.toThrow();
  });

  it('list filters by tenant + status + type', async () => {
    await registerVehicle({ ...baseInput, id: 'veh-2', plate: 'KBC 456 Y', vin: '2HGCM82633A123456', type: 'sedan', fuelType: 'petrol' }, store);
    await decommission('veh-1', TENANT, store);
    const active = await store.list({ tenantId: TENANT, status: 'active' });
    expect(active.map((v) => v.id)).toEqual(['veh-2']);
    const sedans = await store.list({ tenantId: TENANT, type: 'sedan' });
    expect(sedans).toHaveLength(1);
  });
});

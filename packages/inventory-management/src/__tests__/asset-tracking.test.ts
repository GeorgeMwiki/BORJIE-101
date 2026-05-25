/**
 * Asset-tracking tests — register, install, maintain, decommission +
 * warranty alerts + appliance inventory per unit.
 */

import { describe, it, expect } from 'vitest';
import {
  applianceInventoryForUnit,
  assetHistory,
  assetMaintenanceLog,
  assetSummaryForSku,
  findAssetBySerial,
  installAsset,
  logAssetMaintenance,
  registerAsset,
  removeAsset,
  warrantyAlerts,
} from '../assets/asset-tracking.js';
import { currentStock, receiveStock } from '../movements/stock-movements.js';
import type { AssetEvent, AssetSerial, AssetSerialId, MovementId, SkuId, StockMovement } from '../types.js';

const tenantId = 't-1';
const wA = 'loc-warehouse-a';
const unitLoc = 'loc-unit-409';
const unitId = 'U-409';
const skuId = 'sku-fridge' as SkuId;

function gen(prefix: string) {
  let i = 0;
  return () => `${prefix}-${++i}`;
}

function seedAsset(): { serials: ReadonlyArray<AssetSerial>; events: ReadonlyArray<AssetEvent>; log: ReadonlyArray<StockMovement>; serial: AssetSerial } {
  const r = registerAsset(
    [],
    tenantId,
    { skuId, serialNumber: 'SN-FRIDGE-001', currentLocationId: wA, warrantyExpiresAt: '2027-12-31', purchaseCostCents: 500_00 },
    gen('as') as () => AssetSerialId,
  );
  if (!r.ok) throw new Error('seed');
  const stockSeed = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 1 }, gen('m') as () => MovementId, '2026-05-01T00:00:00Z');
  if (!stockSeed.ok) throw new Error('seed stock');
  return { serials: r.value.serials, events: [], log: stockSeed.value.log, serial: r.value.serial };
}

describe('registerAsset', () => {
  it('creates an in_stock serial', () => {
    const s = seedAsset();
    expect(s.serial.status).toBe('in_stock');
    expect(s.serial.currentLocationId).toBe(wA);
  });

  it('refuses duplicate serial for same SKU', () => {
    const s = seedAsset();
    const r = registerAsset(s.serials, tenantId, { skuId, serialNumber: 'SN-FRIDGE-001', currentLocationId: wA }, gen('as') as () => AssetSerialId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('DUPLICATE_SERIAL');
  });
});

describe('installAsset — full lifecycle entry point', () => {
  it('installs into a unit, updates serial, emits event, emits movement', () => {
    const s = seedAsset();
    const r = installAsset(
      s.serials,
      s.events,
      s.log,
      tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc, installedByUserId: 'tech-1' },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.serial.status).toBe('installed');
    expect(r.value.serial.installedInUnitId).toBe(unitId);
    expect(r.value.serial.currentLocationId).toBe(unitLoc);
    expect(r.value.event.eventType).toBe('installed');
    // Warehouse decremented, unit location incremented.
    expect(currentStock(r.value.log, tenantId, skuId, wA)).toBe(0);
    expect(currentStock(r.value.log, tenantId, skuId, unitLoc)).toBe(1);
  });

  it('refuses to install a serial already installed', () => {
    const s = seedAsset();
    const first = installAsset(
      s.serials,
      s.events,
      s.log,
      tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!first.ok) throw new Error('first install');
    const second = installAsset(
      first.value.serials,
      first.value.events,
      first.value.log,
      tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId: 'U-410', unitLocationId: 'loc-unit-410' },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-03T10:00:00Z',
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('INVALID_STATUS');
  });
});

describe('logAssetMaintenance', () => {
  it('records a maintenance event without flipping status', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const r = logAssetMaintenance(
      installed.value.serials, installed.value.events, tenantId,
      { serialNumber: 'SN-FRIDGE-001', reference: 'WO-77', notes: 'replaced compressor relay' },
      gen('e'),
      '2026-06-01T10:00:00Z',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.serial.status).toBe('installed'); // unchanged
    expect(r.value.event.eventType).toBe('maintenance');
  });

  it('movedToRepair flips status to in_repair', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const r = logAssetMaintenance(
      installed.value.serials, installed.value.events, tenantId,
      { serialNumber: 'SN-FRIDGE-001', movedToRepair: true },
      gen('e'),
      '2026-06-01T10:00:00Z',
    );
    if (!r.ok) throw new Error('repair');
    expect(r.value.serial.status).toBe('in_repair');
  });
});

describe('removeAsset', () => {
  it('decommission — sets decommissioned and emits uninstall movement', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const r = removeAsset(
      installed.value.serials, installed.value.events, installed.value.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', reason: 'decommission' },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2027-01-01T00:00:00Z',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.serial.status).toBe('decommissioned');
    expect(r.value.event.eventType).toBe('decommissioned');
    expect(r.value.movement?.reason).toBe('uninstall');
    expect(currentStock(r.value.log, tenantId, skuId, unitLoc)).toBe(0);
  });

  it('replacement — moves back to a warehouse and clears unit link', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const r = removeAsset(
      installed.value.serials, installed.value.events, installed.value.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', reason: 'replacement', destinationLocationId: wA },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-12-01T00:00:00Z',
    );
    if (!r.ok) throw new Error('remove');
    expect(r.value.serial.status).toBe('in_stock');
    expect(r.value.serial.installedInUnitId).toBeNull();
    expect(currentStock(r.value.log, tenantId, skuId, wA)).toBe(1);
    expect(currentStock(r.value.log, tenantId, skuId, unitLoc)).toBe(0);
  });

  it('theft — flags lost + emits loss movement', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const r = removeAsset(
      installed.value.serials, installed.value.events, installed.value.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', reason: 'theft' },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-09-01T00:00:00Z',
    );
    if (!r.ok) throw new Error('theft');
    expect(r.value.serial.status).toBe('lost');
    expect(r.value.movement?.reason).toBe('loss');
  });

  it('replacement without destination is rejected', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const r = removeAsset(
      installed.value.serials, installed.value.events, installed.value.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', reason: 'replacement' },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-12-01T00:00:00Z',
    );
    expect(r.ok).toBe(false);
  });
});

describe('history + queries', () => {
  it('assetHistory + assetMaintenanceLog are sorted oldest-first', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const m1 = logAssetMaintenance(installed.value.serials, installed.value.events, tenantId, { serialNumber: 'SN-FRIDGE-001', reference: 'WO-1' }, gen('e'), '2026-07-01T00:00:00Z');
    if (!m1.ok) throw new Error('m1');
    const m2 = logAssetMaintenance(m1.value.serials, m1.value.events, tenantId, { serialNumber: 'SN-FRIDGE-001', reference: 'WO-2' }, gen('e'), '2026-10-01T00:00:00Z');
    if (!m2.ok) throw new Error('m2');
    const history = assetHistory(m2.value.events, installed.value.serial.id);
    expect(history.map((e) => e.eventType)).toEqual(['installed', 'maintenance', 'maintenance']);
    const log = assetMaintenanceLog(m2.value.events, installed.value.serial.id);
    expect(log).toHaveLength(2);
  });

  it('applianceInventoryForUnit returns only installed serials for that unit', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const list = applianceInventoryForUnit(installed.value.serials, tenantId, unitId);
    expect(list).toHaveLength(1);
    expect(list[0]!.serialNumber).toBe('SN-FRIDGE-001');
  });

  it('findAssetBySerial respects tenant isolation', () => {
    const s = seedAsset();
    expect(findAssetBySerial(s.serials, tenantId, 'SN-FRIDGE-001')).toBeTruthy();
    expect(findAssetBySerial(s.serials, 'attacker', 'SN-FRIDGE-001')).toBeNull();
  });

  it('assetSummaryForSku aggregates by status', () => {
    const s = seedAsset();
    const summary = assetSummaryForSku(s.serials, tenantId, skuId);
    expect(summary.total).toBe(1);
    expect(summary.byStatus.in_stock).toBe(1);
  });
});

describe('warrantyAlerts', () => {
  it('returns serials whose warranty expires within the horizon', () => {
    const s = seedAsset();
    // Warranty expires 2027-12-31; 800 days from 2026-05-01 = 2028-07-10 → in horizon.
    const within = warrantyAlerts(s.serials, tenantId, '2026-05-01T00:00:00Z', 800);
    expect(within).toHaveLength(1);
    const beyond = warrantyAlerts(s.serials, tenantId, '2026-05-01T00:00:00Z', 30);
    expect(beyond).toHaveLength(0);
  });

  it('skips decommissioned serials', () => {
    const s = seedAsset();
    const installed = installAsset(
      s.serials, s.events, s.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', unitId, unitLocationId: unitLoc },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-05-02T10:00:00Z',
    );
    if (!installed.ok) throw new Error('seed');
    const removed = removeAsset(
      installed.value.serials, installed.value.events, installed.value.log, tenantId,
      { serialNumber: 'SN-FRIDGE-001', reason: 'decommission' },
      { event: gen('e'), movement: gen('m') as () => MovementId },
      '2026-06-01T00:00:00Z',
    );
    if (!removed.ok) throw new Error('decom');
    const alerts = warrantyAlerts(removed.value.serials, tenantId, '2026-06-01T00:00:00Z', 1000);
    expect(alerts).toHaveLength(0);
  });
});

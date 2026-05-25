/**
 * Fuel tracker — entries, economy calculation, anomaly detection,
 * monthly + quarterly cost rollups.
 */
import { describe, it, expect } from 'vitest';
import {
  addFuelEntry,
  computeFuelEconomy,
  detectFuelAnomaly,
  monthlyFuelCostReport,
  quarterlyFuelCostReport,
  createInMemoryFuelStore,
} from '../fuel/fuel-tracker.js';
import { type FuelEntry } from '../types.js';

const TENANT = 'tnt-1';

function makeEntry(overrides: Partial<FuelEntry> & { readonly id: string; readonly litres: number; readonly odometerKm: number; readonly recordedAt: string }): FuelEntry {
  return {
    tenantId: TENANT,
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    fuelType: 'diesel',
    costCents: 30_000,
    vendor: 'TotalEnergies',
    ...overrides,
  };
}

describe('fuel-tracker / addFuelEntry', () => {
  it('persists with normalised recordedAt + tenant', async () => {
    const store = createInMemoryFuelStore();
    const e = await addFuelEntry({
      id: 'fe-1',
      tenantId: TENANT,
      vehicleId: 'veh-1',
      driverId: 'drv-1',
      fuelType: 'diesel',
      litres: 40,
      costCents: 60_000,
      odometerKm: 12_345,
      vendor: 'PetroChina',
    }, store);
    expect(e.recordedAt).toBeDefined();
    expect(e.tenantId).toBe(TENANT);
  });

  it('rejects non-positive litres', async () => {
    const store = createInMemoryFuelStore();
    await expect(addFuelEntry({
      id: 'fe-bad', tenantId: TENANT, vehicleId: 'veh-1', driverId: 'drv-1', fuelType: 'diesel',
      litres: 0, costCents: 0, odometerKm: 1, vendor: 'X',
    }, store)).rejects.toThrow();
  });
});

describe('fuel-tracker / computeFuelEconomy', () => {
  const entries: FuelEntry[] = [
    makeEntry({ id: '1', litres: 40, odometerKm: 0, recordedAt: '2026-01-01T00:00:00Z' }),
    makeEntry({ id: '2', litres: 40, odometerKm: 500, recordedAt: '2026-01-08T00:00:00Z' }),
    makeEntry({ id: '3', litres: 40, odometerKm: 1000, recordedAt: '2026-01-15T00:00:00Z' }),
    makeEntry({ id: '4', litres: 40, odometerKm: 1500, recordedAt: '2026-01-22T00:00:00Z' }),
  ];

  it('computes L/100km from rolling window', () => {
    const eco = computeFuelEconomy(entries, 'veh-1');
    expect(eco.windowKm).toBe(1500);
    expect(eco.windowLitres).toBe(120);   // excludes first fill
    expect(eco.litresPer100Km).toBeCloseTo(8, 3);
    expect(eco.mpgUs).toBeCloseTo(235.215 / 8, 2);
    expect(eco.confidence).toBe('medium');
  });

  it('returns low confidence on a tiny dataset', () => {
    const eco = computeFuelEconomy([entries[0]!], 'veh-1');
    expect(eco.confidence).toBe('low');
    expect(eco.litresPer100Km).toBe(0);
  });

  it('returns high confidence for 9+ entries and ≥1000 km', () => {
    const long = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `e${i}`, litres: 50, odometerKm: i * 200, recordedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
    );
    const eco = computeFuelEconomy(long, 'veh-1');
    expect(eco.confidence).toBe('high');
  });
});

describe('fuel-tracker / detectFuelAnomaly', () => {
  it('returns null with no baseline', () => {
    expect(detectFuelAnomaly('veh-1', [])).toBeNull();
  });

  it('flags critical when latest L/100km is ≥ 1.40 × baseline', () => {
    const entries: FuelEntry[] = [
      makeEntry({ id: '1', litres: 40, odometerKm: 0,    recordedAt: '2026-01-01T00:00:00Z' }),
      makeEntry({ id: '2', litres: 40, odometerKm: 500,  recordedAt: '2026-01-08T00:00:00Z' }),
      makeEntry({ id: '3', litres: 40, odometerKm: 1000, recordedAt: '2026-01-15T00:00:00Z' }),
      makeEntry({ id: '4', litres: 40, odometerKm: 1500, recordedAt: '2026-01-22T00:00:00Z' }),
      makeEntry({ id: '5', litres: 70, odometerKm: 1750, recordedAt: '2026-01-29T00:00:00Z' }), // 28 L/100km vs 8 baseline
    ];
    const a = detectFuelAnomaly('veh-1', entries);
    expect(a?.severity).toBe('critical');
    expect(a?.deviationRatio).toBeGreaterThan(1.4);
  });

  it('returns null when km is non-positive', () => {
    const entries: FuelEntry[] = [
      makeEntry({ id: '1', litres: 40, odometerKm: 100, recordedAt: '2026-01-01T00:00:00Z' }),
      makeEntry({ id: '2', litres: 40, odometerKm: 100, recordedAt: '2026-01-08T00:00:00Z' }),
    ];
    expect(detectFuelAnomaly('veh-1', entries)).toBeNull();
  });
});

describe('fuel-tracker / cost reports', () => {
  const entries: FuelEntry[] = [
    makeEntry({ id: '1', litres: 40, odometerKm: 0,    recordedAt: '2026-01-15T00:00:00Z', costCents: 80_000 }),
    makeEntry({ id: '2', litres: 40, odometerKm: 500,  recordedAt: '2026-01-29T00:00:00Z', costCents: 80_000 }),
    makeEntry({ id: '3', litres: 40, odometerKm: 1000, recordedAt: '2026-02-15T00:00:00Z', costCents: 90_000 }),
    makeEntry({ id: '4', litres: 40, odometerKm: 1500, recordedAt: '2026-04-10T00:00:00Z', costCents: 95_000 }),
  ];

  it('monthly rollup picks only the requested month', () => {
    const r = monthlyFuelCostReport(entries, 'veh-1', '2026-01');
    expect(r.entryCount).toBe(2);
    expect(r.totalLitres).toBe(80);
    expect(r.totalCostCents).toBe(160_000);
  });

  it('quarterly rollup spans 3 months', () => {
    const r = quarterlyFuelCostReport(entries, 'veh-1', 2026, 1);
    expect(r.entryCount).toBe(3);
    expect(r.totalLitres).toBe(120);
    expect(r.totalCostCents).toBe(250_000);
  });
});

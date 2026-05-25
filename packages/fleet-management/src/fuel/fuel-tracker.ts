/**
 * Fuel tracking — entries, rolling fuel-economy, anomaly detection,
 * monthly + quarterly cost reports.
 *
 * The anomaly detector compares each new entry's litres-per-100 km
 * against a rolling baseline of the previous N entries. A sudden +40%
 * deviation triggers a `critical` alert — most commonly fuel theft, a
 * leak, or odometer fraud.
 */

import { z } from 'zod';
import {
  type FuelEntry,
  type FuelEconomy,
  type FuelAnomaly,
  type FuelType,
  type Kilometres,
  type Cents,
  FUEL_TYPES,
} from '../types.js';
import { CrossTenantError } from '../vehicles/vehicle-registry.js';

export interface FuelStore {
  list(tenantId: string, vehicleId: string, opts?: { readonly limit?: number }): Promise<ReadonlyArray<FuelEntry>>;
  save(entry: FuelEntry): Promise<FuelEntry>;
  delete(id: string): Promise<void>;
}

const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altitudeM: z.number().optional(),
  recordedAt: z.string().optional(),
});

export const AddFuelEntrySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  vehicleId: z.string().min(1),
  driverId: z.string().min(1),
  fuelType: z.enum(FUEL_TYPES),
  litres: z.number().positive(),
  costCents: z.number().int().min(0),
  odometerKm: z.number().min(0),
  vendor: z.string().min(1),
  location: GeoPointSchema.optional(),
  receiptImageUrl: z.string().url().optional(),
  recordedAt: z.string().optional(),
});

export type AddFuelEntryInput = z.infer<typeof AddFuelEntrySchema>;

function nowIso(): string {
  return new Date().toISOString();
}

export async function addFuelEntry(
  input: AddFuelEntryInput,
  store: FuelStore,
): Promise<FuelEntry> {
  const parsed = AddFuelEntrySchema.parse(input);
  const entry: FuelEntry = {
    id: parsed.id,
    tenantId: parsed.tenantId,
    vehicleId: parsed.vehicleId,
    driverId: parsed.driverId,
    fuelType: parsed.fuelType as FuelType,
    litres: parsed.litres,
    costCents: parsed.costCents,
    odometerKm: parsed.odometerKm,
    vendor: parsed.vendor,
    recordedAt: parsed.recordedAt ?? nowIso(),
    ...(parsed.location ? { location: parsed.location } : {}),
    ...(parsed.receiptImageUrl ? { receiptImageUrl: parsed.receiptImageUrl } : {}),
  };
  return store.save(entry);
}

/**
 * Compute rolling fuel economy from the most recent N entries.
 *
 *   L/100km = (sum of litres between fills) / (km between fills) × 100
 *
 * Confidence band:
 *   - < 3 entries OR < 200 km window  → low
 *   - 3-8 entries AND ≥ 200 km        → medium
 *   - > 8 entries AND ≥ 1000 km       → high
 */
export function computeFuelEconomy(
  entries: ReadonlyArray<FuelEntry>,
  vehicleId: string,
  window = 12,
): FuelEconomy {
  const sorted = [...entries]
    .filter((e) => e.vehicleId === vehicleId)
    .sort((a, b) => (a.odometerKm - b.odometerKm));
  const tail = sorted.slice(-window);

  if (tail.length < 2) {
    return {
      vehicleId,
      windowEntries: tail.length,
      windowKm: 0,
      windowLitres: tail.reduce((s, e) => s + e.litres, 0),
      litresPer100Km: 0,
      mpgUs: 0,
      confidence: 'low',
    };
  }

  const first = tail[0]!;
  const last = tail[tail.length - 1]!;
  const windowKm: Kilometres = last.odometerKm - first.odometerKm;
  // Sum of litres EXCLUDING the first fill (the first fill is a reset point).
  const windowLitres = tail.slice(1).reduce((s, e) => s + e.litres, 0);

  const litresPer100Km = windowKm > 0
    ? (windowLitres / windowKm) * 100
    : 0;
  // 1 US MPG = 235.215 / (L/100km). 0 protects against div-by-zero.
  const mpgUs = litresPer100Km > 0 ? 235.215 / litresPer100Km : 0;

  let confidence: FuelEconomy['confidence'] = 'low';
  if (tail.length > 8 && windowKm >= 1000) confidence = 'high';
  else if (tail.length >= 3 && windowKm >= 200) confidence = 'medium';

  return {
    vehicleId,
    windowEntries: tail.length,
    windowKm,
    windowLitres,
    litresPer100Km,
    mpgUs,
    confidence,
  };
}

/**
 * Detect anomalies in the latest entry against the prior baseline.
 *
 *   - deviationRatio > 1.40 → critical (likely theft / leak)
 *   - deviationRatio > 1.20 → warn
 *   - deviationRatio < 0.70 → info (suspicious — under-reporting?)
 */
export function detectFuelAnomaly(
  vehicleId: string,
  entries: ReadonlyArray<FuelEntry>,
): FuelAnomaly | null {
  const sorted = [...entries]
    .filter((e) => e.vehicleId === vehicleId)
    .sort((a, b) => a.odometerKm - b.odometerKm);
  if (sorted.length < 3) return null;

  const latest = sorted[sorted.length - 1]!;
  const previous = sorted[sorted.length - 2]!;
  const km = latest.odometerKm - previous.odometerKm;
  if (km <= 0) return null;
  const observedLPer100Km = (latest.litres / km) * 100;

  const baseline = computeFuelEconomy(sorted.slice(0, -1), vehicleId);
  if (baseline.confidence === 'low' || baseline.litresPer100Km <= 0) return null;
  const expectedLPer100Km = baseline.litresPer100Km;
  const deviationRatio = observedLPer100Km / expectedLPer100Km;

  let severity: FuelAnomaly['severity'] | null = null;
  let reason = '';
  if (deviationRatio >= 1.40) {
    severity = 'critical';
    reason = 'Fuel consumption ≥40% above baseline — possible leak, theft, or odometer fraud';
  } else if (deviationRatio >= 1.20) {
    severity = 'warn';
    reason = 'Fuel consumption 20-40% above baseline';
  } else if (deviationRatio <= 0.70) {
    severity = 'info';
    reason = 'Fuel consumption ≥30% below baseline — receipt may be under-reported';
  }
  if (!severity) return null;
  return {
    vehicleId,
    entryId: latest.id,
    observedLPer100Km,
    expectedLPer100Km,
    deviationRatio,
    severity,
    reason,
  };
}

/** Fuel cost rollup over a date range. */
export function monthlyFuelCostReport(
  entries: ReadonlyArray<FuelEntry>,
  vehicleId: string,
  yearMonth: string,
): { readonly vehicleId: string; readonly yearMonth: string; readonly totalLitres: number; readonly totalCostCents: Cents; readonly entryCount: number } {
  const filtered = entries.filter(
    (e) => e.vehicleId === vehicleId && e.recordedAt.slice(0, 7) === yearMonth,
  );
  return {
    vehicleId,
    yearMonth,
    totalLitres: filtered.reduce((s, e) => s + e.litres, 0),
    totalCostCents: filtered.reduce((s, e) => s + e.costCents, 0),
    entryCount: filtered.length,
  };
}

export function quarterlyFuelCostReport(
  entries: ReadonlyArray<FuelEntry>,
  vehicleId: string,
  year: number,
  quarter: 1 | 2 | 3 | 4,
): { readonly vehicleId: string; readonly year: number; readonly quarter: 1 | 2 | 3 | 4; readonly totalLitres: number; readonly totalCostCents: Cents; readonly entryCount: number } {
  const startMonth = (quarter - 1) * 3 + 1;
  const months = new Set([
    `${year}-${String(startMonth).padStart(2, '0')}`,
    `${year}-${String(startMonth + 1).padStart(2, '0')}`,
    `${year}-${String(startMonth + 2).padStart(2, '0')}`,
  ]);
  const filtered = entries.filter(
    (e) => e.vehicleId === vehicleId && months.has(e.recordedAt.slice(0, 7)),
  );
  return {
    vehicleId,
    year,
    quarter,
    totalLitres: filtered.reduce((s, e) => s + e.litres, 0),
    totalCostCents: filtered.reduce((s, e) => s + e.costCents, 0),
    entryCount: filtered.length,
  };
}

export function createInMemoryFuelStore(): FuelStore {
  const byId = new Map<string, FuelEntry>();
  return {
    async list(tenantId, vehicleId, opts) {
      const all = [...byId.values()]
        .filter((e) => e.tenantId === tenantId && e.vehicleId === vehicleId)
        .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
      return opts?.limit ? all.slice(0, opts.limit) : all;
    },
    async save(entry) {
      byId.set(entry.id, entry);
      return entry;
    },
    async delete(id) {
      byId.delete(id);
    },
  };
}

export { CrossTenantError };

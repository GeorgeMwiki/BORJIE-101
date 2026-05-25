/**
 * Standard service-interval table — published in the OEM service
 * manuals for the most common fleet vehicles. We index by fuel type
 * because most major intervals (oil, filters, plugs) are dictated by
 * powertrain, not bodywork. A future extension can layer manufacturer
 * overrides via a `(make, model) → interval` lookup.
 *
 * Source consensus (DEFRA / AA / Castrol / Bosch service guides):
 *   - Petrol synthetic-oil: 15,000 km / 12 mo
 *   - Diesel modern (DPF): 20,000 km / 24 mo
 *   - Electric: brake fluid every 40,000 km / 24 mo; coolant 100k; tyres = same
 *   - Hybrid: petrol intervals + battery health check at 80k
 *   - CNG: petrol + filter check at 30k
 */

import { type MaintenanceKind, type FuelType } from '../types.js';

export interface ServiceInterval {
  readonly kind: MaintenanceKind;
  readonly intervalKm: number;
  readonly intervalDays: number;
}

const PETROL: ReadonlyArray<ServiceInterval> = [
  { kind: 'oil_change', intervalKm: 15_000, intervalDays: 365 },
  { kind: 'tire_rotation', intervalKm: 10_000, intervalDays: 365 },
  { kind: 'tire_replacement', intervalKm: 60_000, intervalDays: 1825 },
  { kind: 'brake_service', intervalKm: 50_000, intervalDays: 730 },
  { kind: 'inspection', intervalKm: 20_000, intervalDays: 365 },
  { kind: 'air_filter', intervalKm: 30_000, intervalDays: 730 },
  { kind: 'battery', intervalKm: 100_000, intervalDays: 1460 },
  { kind: 'major_service', intervalKm: 100_000, intervalDays: 1825 },
];

const DIESEL: ReadonlyArray<ServiceInterval> = [
  { kind: 'oil_change', intervalKm: 20_000, intervalDays: 730 },
  { kind: 'tire_rotation', intervalKm: 10_000, intervalDays: 365 },
  { kind: 'tire_replacement', intervalKm: 60_000, intervalDays: 1825 },
  { kind: 'brake_service', intervalKm: 50_000, intervalDays: 730 },
  { kind: 'inspection', intervalKm: 25_000, intervalDays: 365 },
  { kind: 'air_filter', intervalKm: 40_000, intervalDays: 730 },
  { kind: 'battery', intervalKm: 100_000, intervalDays: 1460 },
  { kind: 'major_service', intervalKm: 120_000, intervalDays: 1825 },
];

const ELECTRIC: ReadonlyArray<ServiceInterval> = [
  { kind: 'tire_rotation', intervalKm: 10_000, intervalDays: 365 },
  { kind: 'tire_replacement', intervalKm: 50_000, intervalDays: 1825 },
  { kind: 'brake_service', intervalKm: 80_000, intervalDays: 730 },
  { kind: 'inspection', intervalKm: 25_000, intervalDays: 365 },
  { kind: 'battery', intervalKm: 200_000, intervalDays: 2920 },
  { kind: 'major_service', intervalKm: 150_000, intervalDays: 1825 },
];

const HYBRID: ReadonlyArray<ServiceInterval> = [
  ...PETROL,
  { kind: 'battery', intervalKm: 80_000, intervalDays: 1460 },
];

const CNG: ReadonlyArray<ServiceInterval> = [
  ...PETROL,
  { kind: 'inspection', intervalKm: 30_000, intervalDays: 365 },
];

const TABLE: Readonly<Record<FuelType, ReadonlyArray<ServiceInterval>>> = Object.freeze({
  petrol: PETROL,
  diesel: DIESEL,
  electric: ELECTRIC,
  hybrid: HYBRID,
  cng: CNG,
});

export function defaultIntervalsFor(fuel: FuelType): ReadonlyArray<ServiceInterval> {
  return TABLE[fuel];
}

export function intervalFor(
  fuel: FuelType,
  kind: MaintenanceKind,
): ServiceInterval | null {
  const list = TABLE[fuel];
  // Find the latest one that matches the kind (hybrid/cng append overrides).
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.kind === kind) return list[i]!;
  }
  return null;
}

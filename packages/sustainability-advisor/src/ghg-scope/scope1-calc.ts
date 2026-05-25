/**
 * Scope 1 — direct on-site combustion + fugitive emissions.
 *
 * Sources:
 *   - UK BEIS/DEFRA 2024 conversion factors (net CV) — natural gas,
 *     diesel, LPG, kerosene, fuel oil.
 *   - IPCC AR6 WG1 (2021) GWP100 values for HFC refrigerants.
 *
 * All factors are exposed as named exports so a downstream caller can
 * inject a fresher table without forking this file.
 */

import type { EmissionLine, KgCO2e, Scope1Report } from '../types.js';

/**
 * Default Scope 1 emission factors (kgCO2e per stated unit).
 * Versioned via FACTOR_VERSION so audits can replay any historical
 * calculation deterministically.
 */
export const FACTOR_VERSION = 'DEFRA-2024';

export const FUEL_FACTORS = Object.freeze({
  /** Natural gas (net CV), kgCO2e per kWh — DEFRA 2024. */
  natural_gas_kwh: 0.18316,
  /** Natural gas, kgCO2e per m³ at 38.7 MJ/m³ NCV. */
  natural_gas_m3: 2.04,
  /** Diesel (avg biofuel blend), kgCO2e per litre. */
  diesel_litre: 2.687,
  /** Petrol, kgCO2e per litre. */
  petrol_litre: 2.105,
  /** LPG, kgCO2e per kg. */
  lpg_kg: 1.557,
  /** Kerosene, kgCO2e per litre. */
  kerosene_litre: 2.540,
  /** Heating oil (fuel oil residential), kgCO2e per litre. */
  fuel_oil_litre: 2.518,
  /** Coal, kgCO2e per kg. */
  coal_kg: 2.405,
});

export type FuelKey = keyof typeof FUEL_FACTORS;

/**
 * AR6 GWP100 values (CO2 = 1). Use these for fugitive refrigerant
 * accounting: kgCO2e = leak_kg × GWP.
 */
export const REFRIGERANT_GWP100 = Object.freeze({
  CO2:        1,
  HFC_134a:   1430,
  HFC_404A:   3922,
  HFC_407C:   1774,
  HFC_410A:   2088,
  HFC_32:     675,
  HFC_125:    3500,
  HFO_1234yf: 4,
  HFO_1234ze: 7,
  R_290_propane: 3,
});

export type RefrigerantKey = keyof typeof REFRIGERANT_GWP100;

export interface FuelInput {
  readonly fuel: FuelKey;
  readonly quantity: number;     // in the unit implied by the key
  readonly note?: string;
}

export interface RefrigerantInput {
  readonly refrigerant: RefrigerantKey;
  /** Mass of refrigerant lost (kg) over the period. Typical
   *  annual leak rate for split AC ~5-10% of charge. */
  readonly leakKg: number;
  readonly equipmentLabel?: string;
}

export interface Scope1Inputs {
  readonly fuels: ReadonlyArray<FuelInput>;
  readonly refrigerants: ReadonlyArray<RefrigerantInput>;
  /** Optional override factor table (e.g. local jurisdiction factors). */
  readonly factorOverrides?: Partial<typeof FUEL_FACTORS>;
  readonly gwpOverrides?: Partial<typeof REFRIGERANT_GWP100>;
  readonly factorVersionLabel?: string;
}

function unitOf(fuel: FuelKey): string {
  // Suffix after last underscore is the unit (kwh, litre, kg, m3).
  const tail = fuel.split('_').slice(-1)[0] ?? '';
  switch (tail) {
    case 'kwh':   return 'kWh';
    case 'litre': return 'L';
    case 'kg':    return 'kg';
    case 'm3':    return 'm³';
    default:      return tail;
  }
}

/**
 * Pure: compute a Scope 1 report from fuels + fugitive refrigerants.
 *
 * Negative quantities are rejected — you can't subtract emissions
 * in Scope 1; offsets live in a separate ledger and are reported
 * downstream, not inside the gross inventory.
 */
export function computeScope1(inputs: Scope1Inputs): Scope1Report {
  const factorTable = { ...FUEL_FACTORS, ...(inputs.factorOverrides ?? {}) } as typeof FUEL_FACTORS;
  const gwpTable = { ...REFRIGERANT_GWP100, ...(inputs.gwpOverrides ?? {}) } as typeof REFRIGERANT_GWP100;
  const version = inputs.factorVersionLabel ?? FACTOR_VERSION;

  const lines: EmissionLine[] = [];

  for (const fuel of inputs.fuels) {
    if (!Number.isFinite(fuel.quantity)) {
      throw new TypeError(`scope1: non-finite quantity for ${fuel.fuel}`);
    }
    if (fuel.quantity < 0) {
      throw new RangeError(`scope1: negative quantity for ${fuel.fuel}`);
    }
    const factor = factorTable[fuel.fuel];
    if (factor === undefined) {
      throw new RangeError(`scope1: unknown fuel ${fuel.fuel}`);
    }
    const kg = round3(fuel.quantity * factor);
    lines.push({
      source: fuel.fuel,
      activity: fuel.quantity,
      activityUnit: unitOf(fuel.fuel),
      factor,
      factorSource: version,
      kgCO2e: kg,
    });
  }

  for (const r of inputs.refrigerants) {
    if (!Number.isFinite(r.leakKg)) {
      throw new TypeError(`scope1: non-finite leakKg for ${r.refrigerant}`);
    }
    if (r.leakKg < 0) {
      throw new RangeError(`scope1: negative leakKg for ${r.refrigerant}`);
    }
    const gwp = gwpTable[r.refrigerant];
    if (gwp === undefined) {
      throw new RangeError(`scope1: unknown refrigerant ${r.refrigerant}`);
    }
    const kg = round3(r.leakKg * gwp);
    lines.push({
      source: `refrigerant_${r.refrigerant}`,
      activity: r.leakKg,
      activityUnit: 'kg',
      factor: gwp,
      factorSource: `${version} / IPCC AR6 GWP100`,
      kgCO2e: kg,
    });
  }

  const totalKgCO2e = round3(lines.reduce((acc, l) => acc + l.kgCO2e, 0));

  return {
    scope: 1,
    lines,
    totalKgCO2e,
  };
}

function round3(n: number): KgCO2e {
  return Math.round(n * 1000) / 1000;
}

/**
 * Scope 3 — value-chain emissions, 15 GHGP categories.
 *
 * For property management the materiality concentrates in:
 *   - C5 waste in operations
 *   - C6 business travel
 *   - C7 employee commuting
 *   - C8 upstream leased assets (where the org is a tenant)
 *   - C13 downstream leased assets (PCAF Real Estate Part A method)
 *   - C14 franchises (rare for property)
 *
 * Sources: DEFRA 2024 conversion factors (waste, travel, hotel-night);
 * PCAF Standard Part A v2.0 (Dec 2024) for financed-emissions math.
 */

import type { EmissionLine, KgCO2e, Scope3Report } from '../types.js';

export const SCOPE3_VERSION = 'DEFRA-2024';

/** DEFRA 2024 — kgCO2e/tonne for waste streams (open-bin to gate). */
export const WASTE_FACTORS_PER_TONNE = Object.freeze({
  mixed_msw_landfill:        467.0,
  mixed_msw_incineration:    21.4,
  mixed_recycling:           21.0,
  food_waste_compost:        10.0,
  food_waste_anaerobic_dig:  8.0,
  paper_card_recycled:       21.0,
  plastic_recycled:          21.4,
  construction_landfill:     1.8,    // per tonne inert
  construction_recycled:     1.0,
});

export type WasteStream = keyof typeof WASTE_FACTORS_PER_TONNE;

/** kgCO2e per passenger-km (DEFRA 2024 avg). */
export const TRAVEL_FACTORS_PER_PAX_KM = Object.freeze({
  car_average:               0.171,
  taxi_regular:              0.149,
  bus_local:                 0.118,
  rail_national:             0.0354,
  rail_underground:          0.0275,
  flight_domestic:           0.246,
  flight_short_haul_economy: 0.151,
  flight_long_haul_economy:  0.149,
  flight_long_haul_business: 0.435,
  hotel_night_uk:            10.4,   // not pax-km; per night
});

export type TravelMode = keyof typeof TRAVEL_FACTORS_PER_PAX_KM;

export interface WasteInput {
  readonly stream: WasteStream;
  /** Mass in tonnes. */
  readonly tonnes: number;
}

export interface TravelInput {
  readonly mode: TravelMode;
  /** Activity: passenger-km, or for hotel_night_uk, number of nights. */
  readonly activity: number;
  readonly note?: string;
}

export interface DownstreamLeasedAssetInput {
  /** Total tenant energy (kWh) used in your leased assets. */
  readonly tenantElectricityKWh: number;
  /** Grid factor at the tenant's grid (kgCO2e/kWh). */
  readonly gridFactor: number;
  /** Tenant on-site combustion (kWh equivalent). */
  readonly tenantFuelKWh?: number;
  /** Combustion factor (kgCO2e/kWh). */
  readonly fuelFactor?: number;
  /** PCAF attribution factor 0..1 — proportion of total emissions
   *  the reporting entity claims. For 100% lease typically 1.0. */
  readonly attributionFactor: number;
}

export interface Scope3Inputs {
  /** C5 waste streams generated in operations. */
  readonly waste?: ReadonlyArray<WasteInput>;
  /** C6 business travel + C7 commuting. */
  readonly travel?: ReadonlyArray<TravelInput>;
  /** C13 downstream leased assets. */
  readonly downstreamLeased?: DownstreamLeasedAssetInput;
  /** Free-form supplemental categories already computed externally. */
  readonly extraCategories?: Readonly<Record<string, KgCO2e>>;
  readonly factorVersionLabel?: string;
}

export function computeScope3(inputs: Scope3Inputs): Scope3Report {
  const version = inputs.factorVersionLabel ?? SCOPE3_VERSION;
  const lines: EmissionLine[] = [];
  const breakdown: Record<string, KgCO2e> = {};

  // C5 waste
  let c5 = 0;
  for (const w of inputs.waste ?? []) {
    if (!Number.isFinite(w.tonnes)) {
      throw new TypeError(`scope3: non-finite tonnes for ${w.stream}`);
    }
    if (w.tonnes < 0) {
      throw new RangeError(`scope3: negative tonnes for ${w.stream}`);
    }
    const f = WASTE_FACTORS_PER_TONNE[w.stream];
    const kg = round3(w.tonnes * f);
    c5 += kg;
    lines.push({
      source: `c5_waste_${w.stream}`,
      activity: w.tonnes,
      activityUnit: 't',
      factor: f,
      factorSource: version,
      kgCO2e: kg,
    });
  }
  if (c5 > 0) breakdown['c5_waste'] = round3(c5);

  // C6+C7 travel/commute
  let c6 = 0;
  for (const t of inputs.travel ?? []) {
    if (!Number.isFinite(t.activity)) {
      throw new TypeError(`scope3: non-finite activity for ${t.mode}`);
    }
    if (t.activity < 0) {
      throw new RangeError(`scope3: negative activity for ${t.mode}`);
    }
    const f = TRAVEL_FACTORS_PER_PAX_KM[t.mode];
    const kg = round3(t.activity * f);
    c6 += kg;
    const unit = t.mode === 'hotel_night_uk' ? 'night' : 'pax-km';
    lines.push({
      source: `c6_travel_${t.mode}`,
      activity: t.activity,
      activityUnit: unit,
      factor: f,
      factorSource: version,
      kgCO2e: kg,
    });
  }
  if (c6 > 0) breakdown['c6_business_travel'] = round3(c6);

  // C13 downstream leased
  if (inputs.downstreamLeased) {
    const d = inputs.downstreamLeased;
    if (d.attributionFactor < 0 || d.attributionFactor > 1) {
      throw new RangeError('scope3: attributionFactor must be in [0,1]');
    }
    if (d.tenantElectricityKWh < 0 || d.gridFactor < 0) {
      throw new RangeError('scope3: negative tenant electricity or grid factor');
    }
    let kg = d.tenantElectricityKWh * d.gridFactor * d.attributionFactor;
    if (d.tenantFuelKWh !== undefined && d.fuelFactor !== undefined) {
      if (d.tenantFuelKWh < 0 || d.fuelFactor < 0) {
        throw new RangeError('scope3: negative tenant fuel or fuel factor');
      }
      kg += d.tenantFuelKWh * d.fuelFactor * d.attributionFactor;
    }
    const rounded = round3(kg);
    breakdown['c13_downstream_leased'] = rounded;
    lines.push({
      source: 'c13_downstream_leased_assets',
      activity: d.tenantElectricityKWh + (d.tenantFuelKWh ?? 0),
      activityUnit: 'kWh',
      factor: 0, // composite; see narrative
      factorSource: `${version} + PCAF Part A v2.0 attribution`,
      kgCO2e: rounded,
    });
  }

  // Extras
  for (const [k, v] of Object.entries(inputs.extraCategories ?? {})) {
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`scope3: bad extra category ${k}`);
    }
    breakdown[k] = round3(v);
    lines.push({
      source: k,
      activity: 0,
      activityUnit: 'composite',
      factor: 0,
      factorSource: 'caller-provided',
      kgCO2e: round3(v),
    });
  }

  const totalKgCO2e = round3(
    Object.values(breakdown).reduce((acc, v) => acc + v, 0),
  );

  return {
    scope: 3,
    categoryBreakdown: Object.freeze(breakdown),
    lines,
    totalKgCO2e,
  };
}

function round3(n: number): KgCO2e {
  return Math.round(n * 1000) / 1000;
}

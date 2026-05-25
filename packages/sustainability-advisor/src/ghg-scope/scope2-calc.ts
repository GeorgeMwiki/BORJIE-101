/**
 * Scope 2 — purchased electricity, dual-reporting (location vs market).
 *
 * Sources:
 *   - IEA Emission Factors (2025 edition) + EmberClimate Yearly
 *     Electricity Data (2025) for country grid intensities (AR6
 *     GWP100, kgCO2e/kWh, latest available year).
 *   - Scope 2 Guidance (GHGP, 2015) — market-based subtraction of
 *     supplier-specific factors / REGOs / GOs / RECs / I-REC.
 *
 * The country table is intentionally read-only and exported so callers
 * may override per-jurisdiction (e.g. tighter ESB Ireland 2026 factor).
 */

import type { CountryCode, EmissionLine, KgCO2e, Scope2Report } from '../types.js';

export const SCOPE2_VERSION = 'IEA-2025+EMBER-2025';

/**
 * Grid GHG intensity by ISO country code (kgCO2e/kWh, latest year).
 * Compiled May 2026 from IEA + EmberClimate; intentionally a small
 * curated set — countries not listed throw, forcing the caller to
 * inject a known-good factor rather than silently default.
 */
export const GRID_INTENSITY_KGCO2_PER_KWH: Readonly<Record<CountryCode, number>> = Object.freeze({
  // Europe
  GB: 0.207, IE: 0.279, FR: 0.058, DE: 0.380, IT: 0.272, ES: 0.155, NL: 0.354,
  PL: 0.692, SE: 0.012, NO: 0.029, DK: 0.146, BE: 0.158, CH: 0.026, AT: 0.108,
  PT: 0.137,
  // North America
  US: 0.367, CA: 0.130, MX: 0.412,
  // South America
  BR: 0.099, AR: 0.317, CL: 0.292, CO: 0.221,
  // Asia-Pacific
  AU: 0.620, NZ: 0.119, JP: 0.435, KR: 0.430, CN: 0.582, IN: 0.713, ID: 0.685,
  TH: 0.510, MY: 0.564, PH: 0.654, VN: 0.473, SG: 0.408,
  // Middle East
  AE: 0.471, SA: 0.620, IL: 0.467,
  // Africa — including East Africa
  ZA: 0.928, NG: 0.439, EG: 0.479, MA: 0.610, GH: 0.443,
  KE: 0.111, TZ: 0.347, UG: 0.149, RW: 0.255, ET: 0.025, BI: 0.180,
  SS: 0.690, SD: 0.480,
});

export interface Scope2Inputs {
  readonly country: CountryCode;
  /** Grid electricity drawn over the period, kWh. */
  readonly electricityKWh: number;
  /** Supplier-specific factor for market-based method (kgCO2e/kWh).
   *  If not provided, location and market are equal less REC offsets. */
  readonly supplierFactor?: number;
  /** Renewable certificates retired (kWh) — net out market-based intensity. */
  readonly renewablesCertificatesKWh?: number;
  /** Optional override of the country intensity table. */
  readonly countryFactorOverride?: number;
  readonly factorVersionLabel?: string;
}

/**
 * Pure: compute Scope 2 with both location-based and market-based
 * totals. REC retirements only affect the market-based number — that
 * is the GHGP-compliant treatment.
 */
export function computeScope2(inputs: Scope2Inputs): Scope2Report {
  if (!Number.isFinite(inputs.electricityKWh)) {
    throw new TypeError('scope2: non-finite electricityKWh');
  }
  if (inputs.electricityKWh < 0) {
    throw new RangeError('scope2: negative electricityKWh');
  }
  const recKWh = inputs.renewablesCertificatesKWh ?? 0;
  if (recKWh < 0) {
    throw new RangeError('scope2: negative renewablesCertificatesKWh');
  }
  if (recKWh > inputs.electricityKWh) {
    throw new RangeError('scope2: renewablesCertificatesKWh exceeds consumption');
  }

  const locFactor = inputs.countryFactorOverride
    ?? GRID_INTENSITY_KGCO2_PER_KWH[inputs.country];
  if (locFactor === undefined) {
    throw new RangeError(
      `scope2: no grid intensity for country ${inputs.country}; ` +
      'inject countryFactorOverride to proceed',
    );
  }

  const version = inputs.factorVersionLabel ?? SCOPE2_VERSION;
  const marketFactor = inputs.supplierFactor ?? locFactor;
  const billableMarketKWh = Math.max(0, inputs.electricityKWh - recKWh);

  const locationBased: EmissionLine = {
    source: 'grid_electricity_location_based',
    activity: inputs.electricityKWh,
    activityUnit: 'kWh',
    factor: locFactor,
    factorSource: version,
    kgCO2e: round3(inputs.electricityKWh * locFactor),
  };

  const marketBased: EmissionLine = {
    source: 'grid_electricity_market_based',
    activity: billableMarketKWh,
    activityUnit: 'kWh',
    factor: marketFactor,
    factorSource: inputs.supplierFactor !== undefined
      ? `${version} + supplier-specific factor`
      : `${version} (no supplier factor — fell back to location)`,
    kgCO2e: round3(billableMarketKWh * marketFactor),
  };

  return {
    scope: 2,
    locationBased,
    marketBased,
    renewablesCertificatesKWh: recKWh,
    totalKgCO2eMarketBased: marketBased.kgCO2e,
    totalKgCO2eLocationBased: locationBased.kgCO2e,
  };
}

function round3(n: number): KgCO2e {
  return Math.round(n * 1000) / 1000;
}

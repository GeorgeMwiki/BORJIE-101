/**
 * Embodied carbon — ICMS 3rd ed + EN 15978 aligned.
 *
 * Module mapping (EN 15978):
 *   A1-A3  product stage         — manufacturing + cradle-to-gate
 *   A4     transport to site     — vehicle km × tonne × factor
 *   A5     construction          — energy + waste at site
 *   B1-B7  use stage             — operational (out of scope here)
 *   C1-C4  end-of-life           — demolition, transport, processing, disposal
 *   D      benefits beyond       — module D, reuse + recovery (NOT netted)
 *
 * Defaults derive from RICS Whole Life Carbon Assessment 2nd ed (2023)
 * benchmarks + EC3 Tool (Building Transparency 2024 EPD digest).
 *
 * Output is intentionally an estimate band, not a certifiable LCA;
 * an accredited LCA practitioner runs One Click LCA or eToolLCD for
 * the audit-grade number.
 */

import type { EmbodiedCarbonReport, KgCO2e } from '../types.js';

/** EPD-aligned cradle-to-gate factors (kgCO2e per stated unit). */
export const MATERIAL_FACTORS = Object.freeze({
  /** Concrete CEM I, kgCO2e per m³. */
  concrete_cem_i_m3: 410.0,
  /** Concrete CEM III/A (high GGBS replacement), kgCO2e per m³. */
  concrete_cem_iii_a_m3: 210.0,
  /** Steel rebar, EU avg, kgCO2e per kg. */
  rebar_kg: 1.55,
  /** Structural steel section EU avg, kgCO2e per kg. */
  structural_steel_kg: 1.93,
  /** Cross-laminated timber (sustainably sourced), kgCO2e per m³. */
  clt_m3: -560.0,   // negative = sequestered (A1-A3 only)
  /** Glulam timber, kgCO2e per m³. */
  glulam_m3: -480.0,
  /** Brick, kgCO2e per 1000 bricks. */
  brick_per_1000: 248.0,
  /** Mineral wool insulation, kgCO2e per kg. */
  mineral_wool_kg: 1.28,
  /** Plasterboard, kgCO2e per m². */
  plasterboard_m2: 2.95,
  /** Aluminium window frame, kgCO2e per kg. */
  aluminium_window_kg: 8.40,
  /** Float glass (double-glazed), kgCO2e per m². */
  double_glazed_glass_m2: 35.0,
});

export type MaterialKey = keyof typeof MATERIAL_FACTORS;

/**
 * Quick-estimate intensities — kgCO2e/m² GIA, A1-A5 upfront.
 * From RICS WLCA 2023 + LETI Climate Emergency Design Guide 2024.
 * Used when no bill-of-quantities is available.
 */
export const QUICK_INTENSITY_PER_M2: Readonly<Record<
  'residential_timber' | 'residential_concrete' |
  'office_low' | 'office_medium' | 'office_high' |
  'hospital' | 'industrial_warehouse'
, number>> = Object.freeze({
  residential_timber:    420,
  residential_concrete:  750,
  office_low:            700,
  office_medium:         900,
  office_high:           1200,
  hospital:              1400,
  industrial_warehouse:  500,
});

export interface MaterialQuantity {
  readonly material: MaterialKey;
  /** Quantity in the unit implied by the key. */
  readonly quantity: number;
  /** Distance to site (km) — drives A4 transport calc. */
  readonly transportKm?: number;
  /** Vehicle category for A4 (default rigid HGV). */
  readonly vehicle?: 'rigid_hgv' | 'articulated_hgv' | 'van';
}

/** A4 transport — kgCO2e per tonne-km (DEFRA 2024 lifecycle WTW). */
export const TRANSPORT_FACTORS_TKM = Object.freeze({
  rigid_hgv:        0.181,
  articulated_hgv:  0.073,
  van:              0.541,
});

/** Material mass density (kg per quantity-unit) for A4 mass × distance. */
const MATERIAL_MASS_PER_UNIT: Readonly<Record<MaterialKey, number>> = Object.freeze({
  concrete_cem_i_m3:        2400,
  concrete_cem_iii_a_m3:    2400,
  rebar_kg:                 1,
  structural_steel_kg:      1,
  clt_m3:                   480,
  glulam_m3:                480,
  brick_per_1000:           3300,    // ~3.3 kg per brick × 1000
  mineral_wool_kg:          1,
  plasterboard_m2:          11,
  aluminium_window_kg:      1,
  double_glazed_glass_m2:   25,
});

export interface EmbodiedInputs {
  /** Either a bill-of-quantities or — if absent — fall back to
   *  the quick-estimate intensity by archetype. */
  readonly materials?: ReadonlyArray<MaterialQuantity>;
  readonly quickArchetype?: keyof typeof QUICK_INTENSITY_PER_M2;
  readonly grossInternalArea_m2: number;
  /** Whether to compute C1-C4 end-of-life (default true). */
  readonly includeEndOfLife?: boolean;
  /** End-of-life assumption: 5% of A1-A3 by default (RICS WLCA). */
  readonly endOfLifePctOfProduct?: number;
  /** Construction (A5) overhead — default 7% of A1-A3. */
  readonly constructionPctOfProduct?: number;
}

export function computeEmbodiedCarbon(inputs: EmbodiedInputs): EmbodiedCarbonReport {
  if (inputs.grossInternalArea_m2 <= 0) {
    throw new RangeError('embodied: grossInternalArea_m2 must be > 0');
  }

  const constructionPct = inputs.constructionPctOfProduct ?? 0.07;
  const eolPct = inputs.endOfLifePctOfProduct ?? 0.05;

  const breakdown: Record<string, KgCO2e> = {};
  let productKgCO2e = 0;
  let transportKgCO2e = 0;

  if (inputs.materials && inputs.materials.length > 0) {
    for (const m of inputs.materials) {
      if (!Number.isFinite(m.quantity) || m.quantity < 0) {
        throw new RangeError(`embodied: bad quantity for ${m.material}`);
      }
      const factor = MATERIAL_FACTORS[m.material];
      const productKg = m.quantity * factor;
      productKgCO2e += productKg;
      breakdown[m.material] = round3((breakdown[m.material] ?? 0) + productKg);

      // A4 transport contribution
      const distance = m.transportKm ?? 0;
      const massKg = m.quantity * MATERIAL_MASS_PER_UNIT[m.material];
      if (distance > 0 && massKg > 0) {
        const vehicle = m.vehicle ?? 'rigid_hgv';
        const tFactor = TRANSPORT_FACTORS_TKM[vehicle];
        const tCO2e = (massKg / 1000) * distance * tFactor;
        transportKgCO2e += tCO2e;
      }
    }
  } else {
    if (!inputs.quickArchetype) {
      throw new Error('embodied: either materials[] or quickArchetype must be supplied');
    }
    const intensity = QUICK_INTENSITY_PER_M2[inputs.quickArchetype];
    productKgCO2e = intensity * inputs.grossInternalArea_m2 / (1 + constructionPct);
    breakdown[`quick_${inputs.quickArchetype}`] = round3(productKgCO2e);
  }

  const constructionKgCO2e = productKgCO2e * constructionPct;
  const endOfLifeKgCO2e = (inputs.includeEndOfLife ?? true)
    ? productKgCO2e * eolPct
    : 0;

  const upfrontKgCO2e = productKgCO2e + transportKgCO2e + constructionKgCO2e;
  const intensityPerM2 = upfrontKgCO2e / inputs.grossInternalArea_m2;

  return {
    scope: 'embodied',
    productKgCO2e: round3(productKgCO2e),
    transportKgCO2e: round3(transportKgCO2e),
    constructionKgCO2e: round3(constructionKgCO2e),
    endOfLifeKgCO2e: round3(endOfLifeKgCO2e),
    upfrontKgCO2e: round3(upfrontKgCO2e),
    intensityPerM2: round3(intensityPerM2),
    materialBreakdown: Object.freeze(breakdown),
  };
}

function round3(n: number): KgCO2e {
  return Math.round(n * 1000) / 1000;
}

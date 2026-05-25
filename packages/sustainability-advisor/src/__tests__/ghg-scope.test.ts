/**
 * GHG scope calculator tests — Scope 1, 2, 3 + embodied.
 *
 * Drives the REAL calculators with known activity quantities and
 * checks against the published factor tables. No mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  computeScope1,
  FUEL_FACTORS,
  REFRIGERANT_GWP100,
} from '../ghg-scope/scope1-calc.js';
import {
  computeScope2,
  GRID_INTENSITY_KGCO2_PER_KWH,
} from '../ghg-scope/scope2-calc.js';
import {
  computeScope3,
  WASTE_FACTORS_PER_TONNE,
  TRAVEL_FACTORS_PER_PAX_KM,
} from '../ghg-scope/scope3-calc.js';
import { computeEmbodiedCarbon } from '../ghg-scope/embodied-carbon-calc.js';

describe('scope1 / fuels', () => {
  it('multiplies natural-gas kWh by DEFRA factor', () => {
    const r = computeScope1({
      fuels: [{ fuel: 'natural_gas_kwh', quantity: 10_000 }],
      refrigerants: [],
    });
    expect(r.lines).toHaveLength(1);
    const expected = 10_000 * FUEL_FACTORS.natural_gas_kwh;
    expect(r.totalKgCO2e).toBeCloseTo(expected, 3);
  });

  it('handles a multi-fuel inventory', () => {
    const r = computeScope1({
      fuels: [
        { fuel: 'natural_gas_kwh', quantity: 5_000 },
        { fuel: 'diesel_litre', quantity: 100 },
        { fuel: 'lpg_kg', quantity: 50 },
      ],
      refrigerants: [],
    });
    const expected =
      5_000 * FUEL_FACTORS.natural_gas_kwh
      + 100 * FUEL_FACTORS.diesel_litre
      + 50 * FUEL_FACTORS.lpg_kg;
    expect(r.totalKgCO2e).toBeCloseTo(expected, 3);
    expect(r.lines).toHaveLength(3);
  });

  it('rejects negative fuel quantity', () => {
    expect(() => computeScope1({
      fuels: [{ fuel: 'natural_gas_kwh', quantity: -1 }],
      refrigerants: [],
    })).toThrow(/negative/);
  });

  it('rejects non-finite quantity', () => {
    expect(() => computeScope1({
      fuels: [{ fuel: 'natural_gas_kwh', quantity: NaN }],
      refrigerants: [],
    })).toThrow(/non-finite/);
  });

  it('rejects unknown fuel via factor table', () => {
    expect(() => computeScope1({
      fuels: [{ fuel: 'unobtainium_litre' as any, quantity: 1 }],
      refrigerants: [],
    })).toThrow(/unknown fuel/);
  });

  it('accepts factor overrides for a jurisdiction-specific table', () => {
    const r = computeScope1({
      fuels: [{ fuel: 'natural_gas_kwh', quantity: 1_000 }],
      refrigerants: [],
      factorOverrides: { natural_gas_kwh: 0.20 },
    });
    expect(r.totalKgCO2e).toBeCloseTo(200, 3);
  });
});

describe('scope1 / refrigerants', () => {
  it('uses AR6 GWP100 to value a fugitive leak', () => {
    const r = computeScope1({
      fuels: [],
      refrigerants: [{ refrigerant: 'HFC_410A', leakKg: 2 }],
    });
    expect(r.totalKgCO2e).toBe(2 * REFRIGERANT_GWP100.HFC_410A);
  });

  it('treats low-GWP HFO refrigerants as near-zero', () => {
    const r = computeScope1({
      fuels: [],
      refrigerants: [{ refrigerant: 'HFO_1234ze', leakKg: 5 }],
    });
    expect(r.totalKgCO2e).toBe(35);
  });

  it('rejects negative leak mass', () => {
    expect(() => computeScope1({
      fuels: [],
      refrigerants: [{ refrigerant: 'HFC_410A', leakKg: -0.5 }],
    })).toThrow(/negative leakKg/);
  });
});

describe('scope2 / location vs market', () => {
  it('computes equal location and market with no supplier factor', () => {
    const r = computeScope2({
      country: 'GB',
      electricityKWh: 100_000,
    });
    expect(r.totalKgCO2eLocationBased).toBeCloseTo(100_000 * GRID_INTENSITY_KGCO2_PER_KWH.GB!, 3);
    expect(r.totalKgCO2eMarketBased).toBeCloseTo(r.totalKgCO2eLocationBased, 3);
  });

  it('applies REC offsets only to the market-based number', () => {
    const r = computeScope2({
      country: 'KE',
      electricityKWh: 50_000,
      renewablesCertificatesKWh: 20_000,
    });
    expect(r.totalKgCO2eLocationBased).toBeCloseTo(50_000 * GRID_INTENSITY_KGCO2_PER_KWH.KE!, 3);
    expect(r.totalKgCO2eMarketBased).toBeCloseTo(30_000 * GRID_INTENSITY_KGCO2_PER_KWH.KE!, 3);
  });

  it('uses the supplier-specific factor for market-based', () => {
    const r = computeScope2({
      country: 'DE',
      electricityKWh: 10_000,
      supplierFactor: 0.0,
      renewablesCertificatesKWh: 0,
    });
    expect(r.totalKgCO2eLocationBased).toBeGreaterThan(0);
    expect(r.totalKgCO2eMarketBased).toBe(0);
  });

  it('rejects RECs greater than consumption', () => {
    expect(() => computeScope2({
      country: 'GB',
      electricityKWh: 1_000,
      renewablesCertificatesKWh: 1_500,
    })).toThrow(/exceeds consumption/);
  });

  it('demands an explicit factor for unknown country', () => {
    expect(() => computeScope2({
      country: 'XX',
      electricityKWh: 1_000,
    })).toThrow(/no grid intensity for country XX/);
  });

  it('accepts an override for an unknown country', () => {
    const r = computeScope2({
      country: 'XX',
      electricityKWh: 1_000,
      countryFactorOverride: 0.5,
    });
    expect(r.totalKgCO2eLocationBased).toBe(500);
  });
});

describe('scope3 / waste + travel + downstream', () => {
  it('totals waste correctly with DEFRA factors', () => {
    const r = computeScope3({
      waste: [
        { stream: 'mixed_msw_landfill', tonnes: 2 },
        { stream: 'mixed_recycling', tonnes: 5 },
      ],
    });
    const expected = 2 * WASTE_FACTORS_PER_TONNE.mixed_msw_landfill
      + 5 * WASTE_FACTORS_PER_TONNE.mixed_recycling;
    expect(r.totalKgCO2e).toBeCloseTo(expected, 2);
    expect(r.categoryBreakdown['c5_waste']).toBeCloseTo(expected, 2);
  });

  it('handles long-haul flights pax-km × factor', () => {
    const r = computeScope3({
      travel: [{ mode: 'flight_long_haul_economy', activity: 10_000 }],
    });
    expect(r.totalKgCO2e).toBeCloseTo(
      10_000 * TRAVEL_FACTORS_PER_PAX_KM.flight_long_haul_economy,
      2,
    );
  });

  it('applies PCAF attribution to downstream leased emissions', () => {
    const r = computeScope3({
      downstreamLeased: {
        tenantElectricityKWh: 100_000,
        gridFactor: 0.5,
        attributionFactor: 0.5,
      },
    });
    expect(r.totalKgCO2e).toBeCloseTo(25_000, 1);
  });

  it('rejects negative tonnes', () => {
    expect(() => computeScope3({
      waste: [{ stream: 'mixed_msw_landfill', tonnes: -1 }],
    })).toThrow(/negative/);
  });

  it('rejects out-of-range attribution factor', () => {
    expect(() => computeScope3({
      downstreamLeased: {
        tenantElectricityKWh: 1_000,
        gridFactor: 0.5,
        attributionFactor: 1.5,
      },
    })).toThrow(/attributionFactor/);
  });

  it('passes through extra categories with non-negative validation', () => {
    const r = computeScope3({
      extraCategories: { c1_purchased_goods: 1234 },
    });
    expect(r.categoryBreakdown['c1_purchased_goods']).toBe(1234);
    expect(r.totalKgCO2e).toBe(1234);
  });

  it('rejects bad extra category', () => {
    expect(() => computeScope3({
      extraCategories: { c1_purchased_goods: -5 },
    })).toThrow(/bad extra category/);
  });
});

describe('embodied carbon', () => {
  it('uses quick archetype intensity when no BoQ supplied', () => {
    const r = computeEmbodiedCarbon({
      grossInternalArea_m2: 1000,
      quickArchetype: 'office_medium',
    });
    expect(r.upfrontKgCO2e).toBeGreaterThan(700 * 1000 * 0.9);
    expect(r.intensityPerM2).toBeGreaterThan(700);
    expect(r.intensityPerM2).toBeLessThan(1100);
  });

  it('credits CLT for biogenic sequestration in A1-A3', () => {
    const r = computeEmbodiedCarbon({
      grossInternalArea_m2: 500,
      materials: [
        { material: 'clt_m3', quantity: 100, transportKm: 200 },
      ],
    });
    expect(r.productKgCO2e).toBeLessThan(0);  // negative due to sequestration
    expect(r.transportKgCO2e).toBeGreaterThan(0);
  });

  it('includes A4 transport with rigid HGV by default', () => {
    const r = computeEmbodiedCarbon({
      grossInternalArea_m2: 100,
      materials: [
        { material: 'concrete_cem_i_m3', quantity: 10, transportKm: 50 },
      ],
    });
    // 10 m³ × 2400 kg/m³ = 24 t × 50 km × 0.181 kg/tkm = 217.2
    expect(r.transportKgCO2e).toBeCloseTo(217.2, 1);
  });

  it('requires either materials or quickArchetype', () => {
    expect(() => computeEmbodiedCarbon({
      grossInternalArea_m2: 1000,
    })).toThrow(/materials\[\] or quickArchetype/);
  });

  it('rejects non-positive GIA', () => {
    expect(() => computeEmbodiedCarbon({
      grossInternalArea_m2: 0,
      quickArchetype: 'office_medium',
    })).toThrow(/grossInternalArea_m2/);
  });

  it('computes A5 construction overhead as a fraction of A1-A3', () => {
    const r = computeEmbodiedCarbon({
      grossInternalArea_m2: 100,
      materials: [{ material: 'concrete_cem_iii_a_m3', quantity: 1 }],
      constructionPctOfProduct: 0.10,
    });
    expect(r.constructionKgCO2e).toBeCloseTo(r.productKgCO2e * 0.10, 1);
  });
});

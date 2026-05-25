/**
 * SBTN (Science Based Targets for Nature) — target suggestions.
 *
 * Initial v1 methods released May 2024; first validations 2026. The
 * AR3T framework (Avoid → Reduce → Restore & Regenerate → Transform)
 * underpins target setting. For property the most relevant drivers
 * are land-use change and freshwater (water-quantity / quality).
 *
 * This module is intentionally conservative: it suggests targets,
 * never sets them — formal SBTN validation requires SBTN's process.
 */

import type { SbtnTargetSuggestion } from '../types.js';

export interface SbtnInputs {
  /** ha of site converted from natural / semi-natural land. */
  readonly landConvertedHa: number;
  /** Annual water withdrawal, m³. */
  readonly waterWithdrawalM3: number;
  /** Site located in water-stressed catchment (WRI Aqueduct ≥3)? */
  readonly waterStressed: boolean;
  /** Operational pollution: kgCO2e/m²/yr (proxy for emissions intensity). */
  readonly emissionsIntensityKgM2: number;
  /** Built-area uplift planned (m²) over the next 5y. */
  readonly plannedBuildOutM2: number;
  /** Existing tree cover, ha. */
  readonly treeCoverHa: number;
}

export function suggestSbtnTargets(i: SbtnInputs): ReadonlyArray<SbtnTargetSuggestion> {
  validate(i);
  const out: SbtnTargetSuggestion[] = [];

  // Land — AR3T "Avoid": no further conversion of natural land.
  if (i.landConvertedHa > 0 || i.plannedBuildOutM2 > 0) {
    out.push({
      driver: 'land_use',
      target: 'Avoid any further conversion of natural or semi-natural habitat across the portfolio; '
        + 'restore equivalent area to native habitat within 5 years.',
      horizon: 5,
      rationale: `Site conversion ${i.landConvertedHa.toFixed(2)} ha to date, `
        + `+${(i.plannedBuildOutM2 / 10000).toFixed(2)} ha planned — SBTN Land Step 4 candidate.`,
    });
  }

  // Land — Restore & Regenerate.
  if (i.treeCoverHa < 0.05 * (i.plannedBuildOutM2 / 10000 + 1)) {
    out.push({
      driver: 'land_use',
      target: 'Increase native tree cover to ≥5% of operational site area by 2030.',
      horizon: 5,
      rationale: 'Sub-5% canopy cover; SBTN Restore tier-appropriate uplift identified.',
    });
  }

  // Freshwater.
  if (i.waterStressed) {
    const target = Math.round(i.waterWithdrawalM3 * 0.7);
    out.push({
      driver: 'freshwater',
      target: `Reduce annual withdrawals to ≤${target} m³/yr in water-stressed catchment (-30% vs baseline).`,
      horizon: 5,
      rationale: 'Site in WRI Aqueduct stress band ≥3; SBTN water-quantity target indicated.',
    });
  } else if (i.waterWithdrawalM3 > 5000) {
    const target = Math.round(i.waterWithdrawalM3 * 0.85);
    out.push({
      driver: 'freshwater',
      target: `Reduce annual water withdrawals to ≤${target} m³/yr (-15% vs baseline).`,
      horizon: 5,
      rationale: 'Withdrawal above generic SBTN threshold; reduction targets warranted.',
    });
  }

  // Climate — anchored to SBTi (the climate sibling).
  if (i.emissionsIntensityKgM2 > 20) {
    out.push({
      driver: 'climate',
      target: `Cut operational emissions intensity to ≤10 kgCO2e/m²/yr by 2030 (SBTi 1.5 °C-aligned).`,
      horizon: 5,
      rationale: `Intensity ${i.emissionsIntensityKgM2.toFixed(1)} kg/m² well above 1.5 °C pathway.`,
    });
  }

  // Pollution.
  if (i.emissionsIntensityKgM2 > 30) {
    out.push({
      driver: 'pollution',
      target: 'Eliminate on-site combustion and refrigerant emissions above GWP100 = 10 by 2030.',
      horizon: 5,
      rationale: 'High intensity implies fossil-fuel combustion + high-GWP refrigerants on-site.',
    });
  }

  return out;
}

function validate(i: SbtnInputs): void {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) {
      throw new RangeError(`sbtn: bad ${k}`);
    }
  }
}

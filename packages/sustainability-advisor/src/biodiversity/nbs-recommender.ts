/**
 * Nature-based Solutions (NbS) recommender for property management.
 *
 * Pure function: takes a site description + a constraint set,
 * returns a ranked list of interventions with capex, sequestration,
 * biodiversity uplift, and a climate-fit boolean keyed by Köppen
 * climate zone.
 *
 * Source: IUCN Global Standard for NbS v1.0; UKGBC NbS Guide 2024;
 * Oxford NbS Initiative Evidence Platform; CIRIA SuDS Manual C753.
 */

import type { ClimateZone, CurrencyCode, NbsOpportunity } from '../types.js';

export interface NbsCatalogEntry {
  readonly intervention: string;
  /** GBP per m² or per unit (caller's currency must match). */
  readonly capexPerUnit: number;
  /** kgCO2e sequestered per m² or unit per year. */
  readonly sequestrationPerUnit: number;
  /** Biodiversity uplift in BNG units per m² or per unit. */
  readonly biodivUnitsPerUnit: number;
  /** Litres of stormwater attenuated per unit per year. */
  readonly stormwaterLPerUnitPerYr: number;
  /** Climate zones for which this intervention is viable. */
  readonly viableInZones: ReadonlyArray<ClimateZone>;
  /** Activity unit label ('m²', 'tree', etc.). */
  readonly unit: string;
}

/** Curated default catalogue (GBP, 2026 indicative). */
export const DEFAULT_NBS_CATALOG: ReadonlyArray<NbsCatalogEntry> = Object.freeze([
  {
    intervention: 'extensive_green_roof_sedum',
    capexPerUnit: 110,
    sequestrationPerUnit: 3,
    biodivUnitsPerUnit: 0.00003,
    stormwaterLPerUnitPerYr: 580,
    viableInZones: ['temperate_oceanic', 'temperate_continental', 'temperate_mediterranean', 'cold', 'tropical_savanna'],
    unit: 'm²',
  },
  {
    intervention: 'intensive_green_roof',
    capexPerUnit: 240,
    sequestrationPerUnit: 6,
    biodivUnitsPerUnit: 0.00008,
    stormwaterLPerUnitPerYr: 950,
    viableInZones: ['temperate_oceanic', 'temperate_continental', 'temperate_mediterranean', 'tropical_savanna', 'tropical_monsoon'],
    unit: 'm²',
  },
  {
    intervention: 'permeable_pavement',
    capexPerUnit: 105,
    sequestrationPerUnit: 0,
    biodivUnitsPerUnit: 0,
    stormwaterLPerUnitPerYr: 800,
    viableInZones: [
      'temperate_oceanic', 'temperate_continental', 'temperate_mediterranean',
      'tropical_savanna', 'tropical_monsoon', 'tropical_rainforest',
      'arid_steppe', 'cold',
    ],
    unit: 'm²',
  },
  {
    intervention: 'suds_rain_garden',
    capexPerUnit: 70,
    sequestrationPerUnit: 5,
    biodivUnitsPerUnit: 0.0008,
    stormwaterLPerUnitPerYr: 1200,
    viableInZones: [
      'temperate_oceanic', 'temperate_continental', 'temperate_mediterranean',
      'tropical_savanna', 'tropical_monsoon',
    ],
    unit: 'm²',
  },
  {
    intervention: 'urban_tree_large_canopy',
    capexPerUnit: 600,
    sequestrationPerUnit: 15,    // per tree per year mature
    biodivUnitsPerUnit: 0.18,    // per tree (group habitat unit)
    stormwaterLPerUnitPerYr: 1500,
    viableInZones: [
      'temperate_oceanic', 'temperate_continental', 'temperate_mediterranean',
      'tropical_savanna', 'tropical_monsoon', 'tropical_rainforest',
    ],
    unit: 'tree',
  },
  {
    intervention: 'green_wall_modular',
    capexPerUnit: 550,
    sequestrationPerUnit: 6,
    biodivUnitsPerUnit: 0.0001,
    stormwaterLPerUnitPerYr: 150,
    viableInZones: ['temperate_oceanic', 'temperate_continental', 'temperate_mediterranean', 'tropical_savanna'],
    unit: 'm²',
  },
  {
    intervention: 'constructed_wetland',
    capexPerUnit: 140,
    sequestrationPerUnit: 9,
    biodivUnitsPerUnit: 0.005,
    stormwaterLPerUnitPerYr: 2400,
    viableInZones: [
      'temperate_oceanic', 'temperate_continental', 'temperate_mediterranean',
      'tropical_savanna', 'tropical_monsoon', 'tropical_rainforest',
    ],
    unit: 'm²',
  },
  {
    intervention: 'pollinator_corridor_wildflower',
    capexPerUnit: 25,
    sequestrationPerUnit: 1.5,
    biodivUnitsPerUnit: 0.0006,
    stormwaterLPerUnitPerYr: 220,
    viableInZones: ['temperate_oceanic', 'temperate_continental', 'temperate_mediterranean', 'tropical_savanna'],
    unit: 'm²',
  },
]);

export interface NbsRecommenderInputs {
  readonly climate: ClimateZone;
  readonly availableArea_m2: number;
  readonly availableBudget: number;
  readonly currency: CurrencyCode;
  /** Allocate equal share or skew toward biodiversity/carbon/stormwater. */
  readonly priority?: 'balanced' | 'biodiversity' | 'carbon' | 'stormwater';
  /** Override the default catalogue (e.g. inject local prices). */
  readonly catalog?: ReadonlyArray<NbsCatalogEntry>;
  /** Top-N opportunities to return (default 5). */
  readonly topN?: number;
}

export function recommendNbs(inputs: NbsRecommenderInputs): ReadonlyArray<NbsOpportunity> {
  validate(inputs);
  const priority = inputs.priority ?? 'balanced';
  const catalog = inputs.catalog ?? DEFAULT_NBS_CATALOG;
  const topN = inputs.topN ?? 5;

  const viable = catalog.filter((c) => c.viableInZones.includes(inputs.climate));

  const ranked = viable
    .map((c) => ({
      entry: c,
      score: scoreEntry(c, priority),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  // For each ranked entry, allocate available area / budget pro-rata
  // by share of total score.
  const totalScore = ranked.reduce((acc, r) => acc + r.score, 0);
  if (totalScore === 0) return [];

  return ranked.map((r) => {
    const share = r.score / totalScore;
    const budgetSlice = inputs.availableBudget * share;
    const areaSlice = inputs.availableArea_m2 * share;
    // Use whichever constraint binds first: area or budget.
    const fromArea = r.entry.unit === 'tree'
      ? Math.floor(areaSlice / 25)    // assume 1 tree per 25 m²
      : areaSlice;
    const fromBudget = budgetSlice / r.entry.capexPerUnit;
    const units = Math.max(0, Math.min(fromArea, fromBudget));

    return {
      intervention: r.entry.intervention,
      area_m2_or_units: round2(units),
      capexEstimate: round2(units * r.entry.capexPerUnit),
      currency: inputs.currency,
      annualSequestrationKgCO2e: round2(units * r.entry.sequestrationPerUnit),
      biodiversityUpliftUnits: round3(units * r.entry.biodivUnitsPerUnit),
      stormwaterAttenuationLPerYr: round2(units * r.entry.stormwaterLPerUnitPerYr),
      fitForClimate: r.entry.viableInZones.includes(inputs.climate),
      rationale: rationaleFor(r.entry, priority),
    };
  });
}

function scoreEntry(c: NbsCatalogEntry, priority: NonNullable<NbsRecommenderInputs['priority']>): number {
  // Normalise contributions before weighting.
  const co = c.sequestrationPerUnit / 15;        // 15 kg/yr per unit ceiling
  const bd = c.biodivUnitsPerUnit / 0.2;          // 0.2 unit ceiling
  const sw = c.stormwaterLPerUnitPerYr / 2400;    // L/yr ceiling
  const cost = 1 / Math.max(1, c.capexPerUnit / 100); // cheaper is better
  switch (priority) {
    case 'biodiversity':
      return 0.5 * bd + 0.2 * co + 0.15 * sw + 0.15 * cost;
    case 'carbon':
      return 0.5 * co + 0.2 * bd + 0.15 * sw + 0.15 * cost;
    case 'stormwater':
      return 0.5 * sw + 0.2 * co + 0.15 * bd + 0.15 * cost;
    case 'balanced':
    default:
      return 0.3 * co + 0.3 * bd + 0.25 * sw + 0.15 * cost;
  }
}

function rationaleFor(c: NbsCatalogEntry, priority: NonNullable<NbsRecommenderInputs['priority']>): string {
  const focus = priority === 'balanced' ? 'balanced co-benefits' : priority;
  return `${c.intervention} viable in target climate; selected for ${focus}. `
    + `Capex £${c.capexPerUnit}/${c.unit}, ~${c.sequestrationPerUnit} kgCO2e/${c.unit}/yr, `
    + `${c.biodivUnitsPerUnit} BNG units/${c.unit}, ${c.stormwaterLPerUnitPerYr} L stormwater/${c.unit}/yr.`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function validate(i: NbsRecommenderInputs): void {
  if (!Number.isFinite(i.availableArea_m2) || i.availableArea_m2 < 0) {
    throw new RangeError('nbs: availableArea_m2 must be ≥0');
  }
  if (!Number.isFinite(i.availableBudget) || i.availableBudget < 0) {
    throw new RangeError('nbs: availableBudget must be ≥0');
  }
  if (i.topN !== undefined && (!Number.isInteger(i.topN) || i.topN < 1)) {
    throw new RangeError('nbs: topN must be ≥1 integer');
  }
}

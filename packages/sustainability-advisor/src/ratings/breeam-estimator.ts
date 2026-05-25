/**
 * BREEAM v7 (2026-01) — indicative score estimator for an existing
 * or proposed asset. Output is *bands*, not certification: the
 * authoritative BREEAM score requires a Licensed Assessor (BRE).
 *
 * BREEAM v7 keeps the 10-category structure of v6 with a tightened
 * Energy weighting for non-domestic and a new circular-economy
 * uplift across Materials + Waste. Bands per BREEAM Technical
 * Manual SD250:
 *   Pass ≥30%, Good ≥45%, Very Good ≥55%, Excellent ≥70%,
 *   Outstanding ≥85%.
 */

import type { GreenRating, RatingCategoryScore } from '../types.js';

export const BREEAM_VERSION = '7.0';

interface BreeamCategoryWeight {
  readonly key: string;
  readonly label: string;
  readonly weight: number;   // sums to 1 across all categories
}

/** New-construction non-residential weightings (BREEAM v7). */
export const BREEAM_CATEGORY_WEIGHTS: ReadonlyArray<BreeamCategoryWeight> = Object.freeze([
  { key: 'management',       label: 'Management',          weight: 0.10 },
  { key: 'health_wellbeing', label: 'Health & Wellbeing',  weight: 0.16 },
  { key: 'energy',           label: 'Energy',              weight: 0.18 },
  { key: 'transport',        label: 'Transport',           weight: 0.08 },
  { key: 'water',            label: 'Water',               weight: 0.06 },
  { key: 'materials',        label: 'Materials',           weight: 0.13 },
  { key: 'waste',            label: 'Waste',               weight: 0.10 },
  { key: 'land_ecology',     label: 'Land Use & Ecology',  weight: 0.10 },
  { key: 'pollution',        label: 'Pollution',           weight: 0.09 },
  { key: 'innovation',       label: 'Innovation (bonus)',  weight: 0.00 },  // up to +10% additional
]);

export interface BreeamInputs {
  /** kgCO2e/m²/yr operational. The lower, the higher Energy scores. */
  readonly operationalCarbonIntensity: number;
  /** Upfront embodied carbon, kgCO2e/m². The lower, the higher Materials scores. */
  readonly embodiedIntensityPerM2: number;
  /** % construction & demolition waste diverted from landfill. */
  readonly wasteDiversionPct: number;
  /** Litres/person/day (lower is better). */
  readonly waterUseLPerPersonDay: number;
  /** Within 500m of high-frequency public transport? */
  readonly publicTransportProximity: boolean;
  /** Quality-of-environment overall index 0..1 (daylight, IAQ, acoustics). */
  readonly indoorEnvIndex: number;
  /** Site has BNG ≥10% delivered or equivalent ecology plan? */
  readonly ecologyNetGainAchieved: boolean;
  /** Construction Environmental Management Plan + monitoring evidenced? */
  readonly hasCemp: boolean;
  /** % materials with EPDs or responsible-sourcing certification. */
  readonly responsibleSourcingPct: number;
  /** Number of innovation credits claimed (max 10). */
  readonly innovationCredits: number;
}

/**
 * Map an input domain to a 0..100 sub-score using monotonic
 * piecewise-linear functions calibrated against published BREEAM
 * benchmark scoring tables (BRE 2024 calibration set).
 */
function scoreEnergy(intensity: number): number {
  // 100 at ≤5 kg/m²/yr (net-zero-ready), 0 at ≥150 (very poor).
  if (intensity <= 5) return 100;
  if (intensity >= 150) return 0;
  return clamp(100 - (intensity - 5) * (100 / 145));
}

function scoreMaterials(embodied: number, sourcingPct: number): number {
  // Embodied: 100 at ≤300 kg/m², 0 at ≥1500.
  const embScore = embodied <= 300 ? 100
    : embodied >= 1500 ? 0
    : clamp(100 - (embodied - 300) * (100 / 1200));
  // Blend 70/30 embodied / responsible-sourcing.
  return 0.7 * embScore + 0.3 * clamp(sourcingPct);
}

function scoreWaste(divertedPct: number): number {
  return clamp(divertedPct);
}

function scoreWater(lPerPersonDay: number): number {
  if (lPerPersonDay <= 80) return 100;
  if (lPerPersonDay >= 250) return 0;
  return clamp(100 - (lPerPersonDay - 80) * (100 / 170));
}

function scoreTransport(near: boolean): number {
  return near ? 90 : 35;
}

function scoreHealth(indoorIndex: number): number {
  return clamp(indoorIndex * 100);
}

function scoreLandEcology(netGain: boolean): number {
  return netGain ? 95 : 40;
}

function scorePollution(intensity: number): number {
  // Low operational carbon → low NOx, low overheating risk.
  return scoreEnergy(intensity) * 0.8 + 20;
}

function scoreManagement(hasCemp: boolean): number {
  return hasCemp ? 85 : 45;
}

export function estimateBreeam(inputs: BreeamInputs): GreenRating {
  validate(inputs);

  const sub = {
    management:       scoreManagement(inputs.hasCemp),
    health_wellbeing: scoreHealth(inputs.indoorEnvIndex),
    energy:           scoreEnergy(inputs.operationalCarbonIntensity),
    transport:        scoreTransport(inputs.publicTransportProximity),
    water:            scoreWater(inputs.waterUseLPerPersonDay),
    materials:        scoreMaterials(inputs.embodiedIntensityPerM2, inputs.responsibleSourcingPct),
    waste:            scoreWaste(inputs.wasteDiversionPct),
    land_ecology:     scoreLandEcology(inputs.ecologyNetGainAchieved),
    pollution:        scorePollution(inputs.operationalCarbonIntensity),
  } satisfies Record<string, number>;

  const categories: RatingCategoryScore[] = [];
  let weightedTotal = 0;
  for (const cw of BREEAM_CATEGORY_WEIGHTS) {
    if (cw.key === 'innovation') {
      const innov = clamp(inputs.innovationCredits, 0, 10);
      categories.push({
        category: cw.label,
        scoredPoints: innov,
        maxPoints: 10,
        rationale: `${innov} innovation credit(s) claimed`,
      });
      weightedTotal += innov;   // 1 innovation credit = 1% bonus
      continue;
    }
    const score = sub[cw.key as keyof typeof sub];
    categories.push({
      category: cw.label,
      scoredPoints: Math.round(score),
      maxPoints: 100,
      rationale: `Sub-score ${Math.round(score)} weighted ${(cw.weight * 100).toFixed(0)}%`,
    });
    weightedTotal += score * cw.weight;
  }

  const percent = clamp(weightedTotal);
  const band = breeamBand(percent);

  return {
    scheme: 'BREEAM',
    version: BREEAM_VERSION,
    totalScore: Math.round(percent * 10) / 10,
    maxScore: 100,
    percent,
    estimatedBand: band,
    categories,
    nextBestInputs: nextBestInputs(inputs),
    confidence: 'medium',
  };
}

function nextBestInputs(i: BreeamInputs): ReadonlyArray<string> {
  const out: string[] = [];
  if (i.operationalCarbonIntensity > 30) {
    out.push('Cut operational carbon below 30 kgCO2e/m²/yr');
  }
  if (i.embodiedIntensityPerM2 > 700) {
    out.push('Switch to lower-carbon structural system (CLT or GGBS-rich concrete)');
  }
  if (i.wasteDiversionPct < 90) {
    out.push('Push C&D waste diversion above 90%');
  }
  if (i.responsibleSourcingPct < 70) {
    out.push('Specify EPDs / responsibly-sourced materials for >70% of value');
  }
  if (!i.ecologyNetGainAchieved) {
    out.push('Deliver ≥10% biodiversity net gain on the site');
  }
  return out;
}

export function breeamBand(percent: number): string {
  if (percent >= 85) return 'Outstanding';
  if (percent >= 70) return 'Excellent';
  if (percent >= 55) return 'Very Good';
  if (percent >= 45) return 'Good';
  if (percent >= 30) return 'Pass';
  return 'Unclassified';
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function validate(i: BreeamInputs): void {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError(`breeam: non-finite input ${k}`);
    }
  }
  if (i.indoorEnvIndex < 0 || i.indoorEnvIndex > 1) {
    throw new RangeError('breeam: indoorEnvIndex must be in [0,1]');
  }
  if (i.wasteDiversionPct < 0 || i.wasteDiversionPct > 100) {
    throw new RangeError('breeam: wasteDiversionPct must be in [0,100]');
  }
  if (i.responsibleSourcingPct < 0 || i.responsibleSourcingPct > 100) {
    throw new RangeError('breeam: responsibleSourcingPct must be in [0,100]');
  }
}

/**
 * LEED v5 (USGBC, April 2025) — indicative scorer for BD+C / O+M.
 *
 * Five impact areas in v5: Decarbonisation, Quality of Life,
 * Ecological Conservation & Restoration, Integrative Process, plus
 * Innovation bonus.
 *
 * Bands: Certified 40-49, Silver 50-59, Gold 60-79, Platinum ≥80.
 */

import type { GreenRating, RatingCategoryScore } from '../types.js';

export const LEED_VERSION = '5.0';

export interface LeedV5Inputs {
  /** kgCO2e/m²/yr — drives Decarbonisation. */
  readonly operationalCarbonIntensity: number;
  /** % below ASHRAE 90.1-2022 baseline (BD+C) or % reduction LFL (O+M). */
  readonly energyReductionPct: number;
  /** kgCO2e/m² embodied A1-A5. */
  readonly embodiedIntensityPerM2: number;
  /** Refrigerants with GWP < 10 used in major mechanical systems? */
  readonly lowGwpRefrigerants: boolean;
  /** Indoor air quality monitoring meeting LEED v5 IEQ rigour? */
  readonly iaqMonitoring: boolean;
  /** Daylight + view access score, 0..1. */
  readonly daylightView: number;
  /** % water reduction vs LEED baseline. */
  readonly waterReductionPct: number;
  /** Habitat restored or protected, m²/m² site. */
  readonly siteRestorationRatio: number;
  /** Integrative-process workshop convened pre-design? */
  readonly integrativeProcessRun: boolean;
  /** Pilot credits or exemplary performance claimed. */
  readonly innovationCredits: number;
  /** Regional Priority credits claimed (0-4). */
  readonly regionalPriorityCredits: number;
}

/** v5 weights per USGBC release notes (Apr 2025). */
export const LEED_V5_WEIGHTS = Object.freeze({
  decarbonisation:     50,
  quality_of_life:     25,
  ecological:          15,
  integrative_process: 4,
  innovation:          6,    // 6 base, additional pilot credits via innovationCredits
});

export const LEED_TOTAL_BASE = 100;

export function estimateLeedV5(inputs: LeedV5Inputs): GreenRating {
  validate(inputs);

  // Decarbonisation: weighted operational + embodied + refrigerants
  const opScore = scoreOperational(inputs.operationalCarbonIntensity, inputs.energyReductionPct);
  const embScore = scoreEmbodied(inputs.embodiedIntensityPerM2);
  const refrigScore = inputs.lowGwpRefrigerants ? 100 : 30;
  const decarbPct = (opScore * 0.5 + embScore * 0.35 + refrigScore * 0.15) / 100;
  const decarbPoints = decarbPct * LEED_V5_WEIGHTS.decarbonisation;

  // Quality of Life: IAQ + daylight + acoustics blended
  const qolPct = (
    (inputs.iaqMonitoring ? 90 : 50) * 0.5 +
    (inputs.daylightView * 100) * 0.4 +
    (scoreWater(inputs.waterReductionPct)) * 0.1
  ) / 100;
  const qolPoints = qolPct * LEED_V5_WEIGHTS.quality_of_life;

  // Ecological
  const ecoPct = scoreEco(inputs.siteRestorationRatio) / 100;
  const ecoPoints = ecoPct * LEED_V5_WEIGHTS.ecological;

  // Integrative process
  const ipPoints = inputs.integrativeProcessRun ? LEED_V5_WEIGHTS.integrative_process : 0;

  // Innovation
  const innov = Math.min(inputs.innovationCredits + inputs.regionalPriorityCredits, LEED_V5_WEIGHTS.innovation);

  const totalPoints = decarbPoints + qolPoints + ecoPoints + ipPoints + innov;

  const categories: RatingCategoryScore[] = [
    catLine('Decarbonisation', decarbPoints, LEED_V5_WEIGHTS.decarbonisation,
      `Operational ${Math.round(opScore)}, embodied ${Math.round(embScore)}, refrigerants ${Math.round(refrigScore)}`),
    catLine('Quality of Life', qolPoints, LEED_V5_WEIGHTS.quality_of_life,
      `IAQ + daylight + water`),
    catLine('Ecological Conservation', ecoPoints, LEED_V5_WEIGHTS.ecological,
      `Site restoration ratio ${inputs.siteRestorationRatio}`),
    catLine('Integrative Process', ipPoints, LEED_V5_WEIGHTS.integrative_process,
      inputs.integrativeProcessRun ? 'Workshop convened' : 'Not run'),
    catLine('Innovation + RP', innov, LEED_V5_WEIGHTS.innovation,
      `${inputs.innovationCredits} innovation + ${inputs.regionalPriorityCredits} RP credits`),
  ];

  const finalPoints = clamp(totalPoints, 0, 110);
  return {
    scheme: 'LEED',
    version: LEED_VERSION,
    totalScore: Math.round(finalPoints * 10) / 10,
    maxScore: 110,
    percent: (finalPoints / 110) * 100,
    estimatedBand: leedBand(finalPoints),
    categories,
    nextBestInputs: nextBest(inputs),
    confidence: 'medium',
  };
}

function scoreOperational(intensity: number, reductionPct: number): number {
  const iScore = intensity <= 5 ? 100
    : intensity >= 150 ? 0
    : 100 - (intensity - 5) * (100 / 145);
  const rScore = clamp(reductionPct, 0, 60) * (100 / 60);
  return 0.5 * iScore + 0.5 * rScore;
}

function scoreEmbodied(emb: number): number {
  if (emb <= 300) return 100;
  if (emb >= 1500) return 0;
  return 100 - (emb - 300) * (100 / 1200);
}

function scoreWater(pct: number): number {
  return clamp(pct, 0, 50) * 2;  // 50%+ reduction = full marks
}

function scoreEco(ratio: number): number {
  return clamp(ratio * 200, 0, 100);  // 50% of site restored = full marks
}

export function leedBand(points: number): string {
  if (points >= 80) return 'Platinum';
  if (points >= 60) return 'Gold';
  if (points >= 50) return 'Silver';
  if (points >= 40) return 'Certified';
  return 'Below Certified';
}

function nextBest(i: LeedV5Inputs): ReadonlyArray<string> {
  const out: string[] = [];
  if (i.energyReductionPct < 40) out.push('Lift energy reduction above 40% vs ASHRAE 90.1');
  if (i.embodiedIntensityPerM2 > 600) out.push('Reduce embodied carbon below 600 kg/m² (low-carbon concrete or CLT)');
  if (!i.lowGwpRefrigerants) out.push('Switch HVAC refrigerants to GWP<10 (e.g. R-1234ze)');
  if (!i.integrativeProcessRun) out.push('Hold integrative-process workshop in pre-design');
  return out;
}

function catLine(label: string, scored: number, max: number, rationale: string): RatingCategoryScore {
  return {
    category: label,
    scoredPoints: Math.round(scored * 10) / 10,
    maxPoints: max,
    rationale,
  };
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function validate(i: LeedV5Inputs): void {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError(`leed: non-finite input ${k}`);
    }
  }
  if (i.daylightView < 0 || i.daylightView > 1) {
    throw new RangeError('leed: daylightView must be in [0,1]');
  }
  if (i.siteRestorationRatio < 0 || i.siteRestorationRatio > 1) {
    throw new RangeError('leed: siteRestorationRatio must be in [0,1]');
  }
}

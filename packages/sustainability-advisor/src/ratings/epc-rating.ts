/**
 * EPC (Energy Performance Certificate) band predictor.
 *
 * UK: SAP10.2 (residential) and SBEM (non-domestic) emit an EPC
 * rating A (most efficient) to G (least). Band cutoffs are on the
 * dimensionless EPC score where higher = better.
 *
 * EU EPBD recast (Dec 2024) harmonises bands across MS by 2030;
 * we encode the indicative EU table now in anticipation.
 */

import type { GreenRating, RatingCategoryScore } from '../types.js';

export const EPC_VERSION = 'SAP10.2 / EPBD-recast-2024';

export interface EpcInputs {
  /** Operational energy intensity, kWh/m²/yr (regulated + unregulated). */
  readonly energyUseKWhPerM2: number;
  /** Operational kgCO2/m²/yr. */
  readonly co2KgPerM2: number;
  /** Either 'UK' or 'EU' band scheme. */
  readonly scheme: 'UK' | 'EU';
}

/** UK SAP10.2 EPC band cutoffs (score points). */
export const UK_EPC_BANDS = Object.freeze([
  { band: 'A', min: 92 },
  { band: 'B', min: 81 },
  { band: 'C', min: 69 },
  { band: 'D', min: 55 },
  { band: 'E', min: 39 },
  { band: 'F', min: 21 },
  { band: 'G', min: 0  },
]);

/**
 * EU EPBD-recast indicative bands by kWh/m²/yr for non-residential.
 * Lower kWh/m²/yr = higher band; varies by climate zone but this
 * table is an indicative pan-EU benchmark.
 */
export const EU_EPC_BANDS_KWH_PER_M2 = Object.freeze([
  { band: 'A', maxKwh: 50 },
  { band: 'B', maxKwh: 90 },
  { band: 'C', maxKwh: 150 },
  { band: 'D', maxKwh: 230 },
  { band: 'E', maxKwh: 330 },
  { band: 'F', maxKwh: 450 },
  { band: 'G', maxKwh: 1e9 },
]);

/**
 * UK score derivation — empirical fit on SAP10.2 published
 * benchmark dwellings: score = 100 - 0.36 × kWh/m²/yr - 0.08 × kgCO2/m²/yr.
 * Clamped to [0, 100].
 */
export function ukEpcScore(energyUseKWhPerM2: number, co2KgPerM2: number): number {
  const raw = 100 - 0.36 * energyUseKWhPerM2 - 0.08 * co2KgPerM2;
  return Math.max(0, Math.min(100, raw));
}

export function ukBandFor(score: number): string {
  for (const b of UK_EPC_BANDS) {
    if (score >= b.min) return b.band;
  }
  return 'G';
}

export function euBandFor(kWhPerM2: number): string {
  for (const b of EU_EPC_BANDS_KWH_PER_M2) {
    if (kWhPerM2 <= b.maxKwh) return b.band;
  }
  return 'G';
}

export function estimateEpc(inputs: EpcInputs): GreenRating {
  if (!Number.isFinite(inputs.energyUseKWhPerM2) || inputs.energyUseKWhPerM2 < 0) {
    throw new RangeError('epc: bad energyUseKWhPerM2');
  }
  if (!Number.isFinite(inputs.co2KgPerM2) || inputs.co2KgPerM2 < 0) {
    throw new RangeError('epc: bad co2KgPerM2');
  }

  let band: string;
  let score: number;

  if (inputs.scheme === 'UK') {
    score = ukEpcScore(inputs.energyUseKWhPerM2, inputs.co2KgPerM2);
    band = ukBandFor(score);
  } else {
    band = euBandFor(inputs.energyUseKWhPerM2);
    // Derive a comparable 0-100 score for portfolio rollup.
    score = euScoreFromKwh(inputs.energyUseKWhPerM2);
  }

  const categories: RatingCategoryScore[] = [
    {
      category: 'Energy use intensity',
      scoredPoints: Math.round(score),
      maxPoints: 100,
      rationale: `${inputs.energyUseKWhPerM2.toFixed(1)} kWh/m²/yr`,
    },
    {
      category: 'Operational carbon intensity',
      scoredPoints: Math.max(0, Math.round(100 - inputs.co2KgPerM2)),
      maxPoints: 100,
      rationale: `${inputs.co2KgPerM2.toFixed(1)} kgCO2/m²/yr`,
    },
  ];

  return {
    scheme: 'EPC',
    version: EPC_VERSION,
    totalScore: Math.round(score),
    maxScore: 100,
    percent: score,
    estimatedBand: band,
    categories,
    nextBestInputs: epcNextBest(inputs, band),
    confidence: 'high',
  };
}

function euScoreFromKwh(kwh: number): number {
  if (kwh <= 50) return 95;
  if (kwh <= 90) return 80;
  if (kwh <= 150) return 65;
  if (kwh <= 230) return 50;
  if (kwh <= 330) return 35;
  if (kwh <= 450) return 20;
  return 5;
}

function epcNextBest(i: EpcInputs, currentBand: string): ReadonlyArray<string> {
  const out: string[] = [];
  if (currentBand >= 'D') out.push('Improve fabric (cavity-fill insulation, triple-glaze) — biggest band jump');
  if (i.co2KgPerM2 > 20) out.push('Switch heating to ASHP or district heat to cut kgCO2/m²');
  if (i.energyUseKWhPerM2 > 150) out.push('LED retrofit + smart-zone HVAC controls — typically -25% kWh');
  return out;
}

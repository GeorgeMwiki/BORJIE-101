/**
 * Green Star Buildings v1.3 (GBCA, 2024) — AU/NZ scheme.
 *
 * Score 0..100 across 9 categories. Bands:
 *   4★ ≥45 (Best practice)
 *   5★ ≥60 (Australian Excellence)
 *   6★ ≥75 (World Leadership)
 */

import type { GreenRating, RatingCategoryScore } from '../types.js';

export const GREEN_STAR_VERSION = '1.3';

export interface GreenStarInputs {
  readonly operationalCarbonIntensity: number;   // kgCO2e/m²/yr
  readonly fossilFuelFree: boolean;               // electrified end-use
  readonly netPositiveCarbon: boolean;            // generation > demand
  readonly responsibleProductsPct: number;       // % materials w/ EPDs
  readonly placeQualityIndex: number;            // 0..1
  readonly peopleEngagementIndex: number;        // 0..1
  readonly natureRestorationRatio: number;       // 0..1
  readonly innovationCredits: number;
  readonly resilienceClimateAdaptPct: number;    // 0..100
}

export const GREEN_STAR_WEIGHTS = Object.freeze({
  responsible:   12,
  healthy:       12,
  resilient:     13,
  positive:      18,    // climate-positive bucket
  places:        10,
  people:        10,
  nature:        13,
  leadership:    6,
  innovation:    6,
});

export function estimateGreenStar(inputs: GreenStarInputs): GreenRating {
  validate(inputs);

  const responsible = inputs.responsibleProductsPct;
  const healthy = inputs.placeQualityIndex * 100;
  const resilient = inputs.resilienceClimateAdaptPct;
  const positive = inputs.netPositiveCarbon ? 100
    : inputs.fossilFuelFree ? 80
    : Math.max(0, 100 - inputs.operationalCarbonIntensity);
  const places = inputs.placeQualityIndex * 100;
  const people = inputs.peopleEngagementIndex * 100;
  const nature = inputs.natureRestorationRatio * 100;
  const leadership = inputs.fossilFuelFree ? 90 : 50;
  const innovation = Math.min(inputs.innovationCredits * 10, 100);

  const categories: RatingCategoryScore[] = [
    line('Responsible', responsible, GREEN_STAR_WEIGHTS.responsible),
    line('Healthy', healthy, GREEN_STAR_WEIGHTS.healthy),
    line('Resilient', resilient, GREEN_STAR_WEIGHTS.resilient),
    line('Positive (climate)', positive, GREEN_STAR_WEIGHTS.positive),
    line('Places', places, GREEN_STAR_WEIGHTS.places),
    line('People', people, GREEN_STAR_WEIGHTS.people),
    line('Nature', nature, GREEN_STAR_WEIGHTS.nature),
    line('Leadership', leadership, GREEN_STAR_WEIGHTS.leadership),
    line('Innovation', innovation, GREEN_STAR_WEIGHTS.innovation),
  ];

  // Weighted sum normalised so max = 100.
  let weighted = 0;
  const maxWeighted = Object.values(GREEN_STAR_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const c of categories) {
    const score = (c.scoredPoints / c.maxPoints) * 100;
    weighted += score * (c.maxPoints / 100);
  }
  const percent = (weighted / maxWeighted) * 100;
  const totalScore = Math.round(percent * 10) / 10;

  return {
    scheme: 'GreenStar',
    version: GREEN_STAR_VERSION,
    totalScore,
    maxScore: 100,
    percent,
    estimatedBand: greenStarBand(percent),
    categories,
    nextBestInputs: greenStarNextBest(inputs),
    confidence: 'medium',
  };
}

export function greenStarBand(pct: number): string {
  if (pct >= 75) return '6 Star (World Leadership)';
  if (pct >= 60) return '5 Star (Excellence)';
  if (pct >= 45) return '4 Star (Best Practice)';
  return 'Not certified';
}

function greenStarNextBest(i: GreenStarInputs): ReadonlyArray<string> {
  const out: string[] = [];
  if (!i.fossilFuelFree) out.push('Eliminate fossil-fuel end uses (heat pumps, induction)');
  if (!i.netPositiveCarbon) out.push('Add on-site PV to push toward net-positive carbon');
  if (i.responsibleProductsPct < 80) out.push('Specify EPD-backed products for ≥80% of value');
  if (i.natureRestorationRatio < 0.3) out.push('Restore at least 30% of site to native habitat');
  return out;
}

function line(label: string, score: number, weight: number): RatingCategoryScore {
  const s = clamp(score, 0, 100);
  return {
    category: label,
    scoredPoints: Math.round(s),
    maxPoints: 100,
    rationale: `Score ${Math.round(s)}/100 weighted ${weight}`,
  };
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function validate(i: GreenStarInputs): void {
  if (i.placeQualityIndex < 0 || i.placeQualityIndex > 1)
    throw new RangeError('green-star: placeQualityIndex must be in [0,1]');
  if (i.peopleEngagementIndex < 0 || i.peopleEngagementIndex > 1)
    throw new RangeError('green-star: peopleEngagementIndex must be in [0,1]');
  if (i.natureRestorationRatio < 0 || i.natureRestorationRatio > 1)
    throw new RangeError('green-star: natureRestorationRatio must be in [0,1]');
  if (i.responsibleProductsPct < 0 || i.responsibleProductsPct > 100)
    throw new RangeError('green-star: responsibleProductsPct must be in [0,100]');
  if (i.resilienceClimateAdaptPct < 0 || i.resilienceClimateAdaptPct > 100)
    throw new RangeError('green-star: resilienceClimateAdaptPct must be in [0,100]');
}

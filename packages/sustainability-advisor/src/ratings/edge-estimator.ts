/**
 * EDGE (Excellence in Design for Greater Efficiencies) — IFC v3.1
 * (2024) green building scheme for emerging markets, including
 * East Africa. Three dimensions, EACH must hit a per-dimension
 * threshold versus a base-case building of the same archetype.
 *
 * Bands (per IFC EDGE User Guide v3.1):
 *   EDGE certified  : ≥20% in EACH of Energy / Water / Materials
 *   EDGE Advanced   : ≥40% Energy + ≥20% Water + ≥20% Materials
 *   EDGE Zero Carbon: 100% operational emissions reduction (incl. offsets)
 */

import type { GreenRating, RatingCategoryScore } from '../types.js';

export const EDGE_VERSION = '3.1';

export interface EdgeInputs {
  /** % energy reduction vs baseline (cooling + lighting + DHW + plug). */
  readonly energyReductionPct: number;
  /** % water reduction vs baseline. */
  readonly waterReductionPct: number;
  /** % embodied-material carbon reduction vs baseline. */
  readonly materialReductionPct: number;
  /** Operational emissions remaining (kgCO2e/m²/yr) AFTER on-site + offsets.
   *  0 = certified zero-carbon eligible. */
  readonly remainingOpCarbonAfterOffsets: number;
}

export function estimateEdge(inputs: EdgeInputs): GreenRating {
  validate(inputs);

  const e = clamp(inputs.energyReductionPct);
  const w = clamp(inputs.waterReductionPct);
  const m = clamp(inputs.materialReductionPct);

  let band = 'Not certified';
  if (e >= 20 && w >= 20 && m >= 20) band = 'EDGE Certified';
  if (e >= 40 && w >= 20 && m >= 20) band = 'EDGE Advanced';
  if (e >= 40 && w >= 20 && m >= 20 && inputs.remainingOpCarbonAfterOffsets <= 0) {
    band = 'EDGE Zero Carbon';
  }

  // We synthesise a unified 0-100 view as the mean of the three
  // dimensions, capped at 100. Useful for portfolio rollup.
  const percent = clamp((e + w + m) / 3, 0, 100);
  const totalScore = Math.round(percent * 10) / 10;

  const categories: RatingCategoryScore[] = [
    {
      category: 'Energy',
      scoredPoints: Math.round(e),
      maxPoints: 100,
      rationale: `${Math.round(e)}% reduction vs baseline (threshold 20% / advanced 40%)`,
    },
    {
      category: 'Water',
      scoredPoints: Math.round(w),
      maxPoints: 100,
      rationale: `${Math.round(w)}% reduction vs baseline (threshold 20%)`,
    },
    {
      category: 'Materials (embodied)',
      scoredPoints: Math.round(m),
      maxPoints: 100,
      rationale: `${Math.round(m)}% reduction vs baseline (threshold 20%)`,
    },
  ];

  return {
    scheme: 'EDGE',
    version: EDGE_VERSION,
    totalScore,
    maxScore: 100,
    percent,
    estimatedBand: band,
    categories,
    nextBestInputs: edgeNextBest(inputs),
    confidence: 'high',
  };
}

function edgeNextBest(i: EdgeInputs): ReadonlyArray<string> {
  const out: string[] = [];
  if (i.energyReductionPct < 20) out.push('Add reflective roof + improved glazing to hit 20% energy reduction');
  else if (i.energyReductionPct < 40) out.push('Add PV + LED retrofit to lift energy reduction past 40% (Advanced)');
  if (i.waterReductionPct < 20) out.push('Install low-flow fittings + rainwater harvesting to reach 20% water reduction');
  if (i.materialReductionPct < 20) out.push('Switch to GGBS-rich concrete + locally-sourced timber framing');
  if (i.remainingOpCarbonAfterOffsets > 0) out.push('Add or buy renewable certificates to reach zero-carbon');
  return out;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function validate(i: EdgeInputs): void {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError(`edge: non-finite input ${k}`);
    }
  }
}

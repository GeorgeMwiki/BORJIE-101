/**
 * Portfolio aggregator — rolls per-asset grades up to a portfolio grade.
 *
 * Three weighting strategies:
 *   - 'equal'       — every asset counts the same
 *   - 'site_count'  — assets weighted by number of producing sites
 *   - 'asset_value' — assets weighted by appraised asset value
 *
 * All three converge on the same algorithm: weighted average of the
 * underlying scores, then map to grade via the shared cutoffs.
 */

import {
  GRADE_ORDER,
  PortfolioGrade,
  AssetGrade,
  AssetGradeReport,
} from './asset-grading-types.js';
import { scoreToGrade } from './scoring-model.js';

export type WeightBy = 'equal' | 'site_count' | 'asset_value';

export interface AggregateOptions {
  readonly weightBy?: WeightBy | undefined;
  /** Optional per-asset weights used when `weightBy` requires a number. */
  readonly weightsByAssetId?: Readonly<Record<string, number>> | undefined;
  /** Previous portfolio score (for trajectory). */
  readonly previousScore?: number | undefined;
}

/** Build an empty distribution record keyed by every AssetGrade. */
function emptyDistribution(): Record<AssetGrade, number> {
  const record = {} as Record<AssetGrade, number>;
  for (const grade of GRADE_ORDER) record[grade] = 0;
  record.INSUFFICIENT_DATA = 0;
  return record;
}

function resolveWeight(
  report: AssetGradeReport,
  weightBy: WeightBy,
  weightsByAssetId: Readonly<Record<string, number>> | undefined,
): number {
  if (weightBy === 'equal') return 1;
  const lookup = weightsByAssetId?.[report.assetId];
  if (typeof lookup === 'number' && lookup > 0) return lookup;
  // Fallback — we still produce a grade even if the caller forgot to
  // supply a weight; we just silently equal-weight that asset.
  return 1;
}

export function aggregatePortfolioGrade(
  tenantId: string,
  reports: readonly AssetGradeReport[],
  opts: AggregateOptions = {},
): PortfolioGrade {
  const weightBy: WeightBy = opts.weightBy ?? 'site_count';
  const distribution = emptyDistribution();
  let weightedSum = 0;
  let weightTotal = 0;
  const scoredReports = reports.filter((r) => r.grade !== 'INSUFFICIENT_DATA');

  for (const report of reports) {
    distribution[report.grade] += 1;
    if (report.grade === 'INSUFFICIENT_DATA') continue;
    const weight = resolveWeight(report, weightBy, opts.weightsByAssetId);
    weightedSum += report.score * weight;
    weightTotal += weight;
  }

  const score =
    weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0;
  const grade: AssetGrade =
    scoredReports.length === 0 ? 'INSUFFICIENT_DATA' : scoreToGrade(score);

  // Strongest + weakest assets, guarded against empty portfolios.
  const sortedByScore = [...scoredReports].sort((a, b) => b.score - a.score);
  const topStrengths = sortedByScore.slice(0, 3);
  const topWeaknesses = sortedByScore.slice(-3).reverse();

  const trajectory =
    opts.previousScore !== undefined
      ? {
          previousScore: opts.previousScore,
          delta: Math.round((score - opts.previousScore) * 10) / 10,
          direction: directionFromDelta(score - opts.previousScore),
        }
      : undefined;

  return {
    tenantId,
    grade,
    score,
    totalAssets: reports.length,
    distribution,
    topStrengths,
    topWeaknesses,
    trajectory,
    weightBy,
    computedAt: new Date().toISOString(),
  };
}

function directionFromDelta(delta: number): 'up' | 'down' | 'flat' {
  if (Math.abs(delta) < 0.5) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/**
 * Narrow a portfolio distribution to "A/B/C/D/F" family-level counts —
 * useful for owner-facing summaries that collapse the +/- modifiers.
 */
export function collapseDistributionByFamily(
  distribution: Readonly<Record<AssetGrade, number>>,
): Readonly<Record<'A' | 'B' | 'C' | 'D' | 'F' | 'INSUFFICIENT_DATA', number>> {
  const out = { A: 0, B: 0, C: 0, D: 0, F: 0, INSUFFICIENT_DATA: 0 };
  for (const grade of GRADE_ORDER) {
    const count = distribution[grade] ?? 0;
    if (grade.startsWith('A')) out.A += count;
    else if (grade.startsWith('B')) out.B += count;
    else if (grade.startsWith('C')) out.C += count;
    else if (grade.startsWith('D')) out.D += count;
    else if (grade === 'F') out.F += count;
  }
  out.INSUFFICIENT_DATA = distribution.INSUFFICIENT_DATA ?? 0;
  return out;
}

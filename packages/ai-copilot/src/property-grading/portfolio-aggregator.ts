/**
 * Portfolio aggregator — rolls per-property grades up to a portfolio grade.
 *
 * Three weighting strategies:
 *   - 'equal'       — every property counts the same
 *   - 'unit_count'  — properties weighted by number of units
 *   - 'asset_value' — properties weighted by appraised asset value
 *
 * All three converge on the same algorithm: weighted average of the
 * underlying scores, then map to grade via the shared cutoffs.
 */

import {
  GRADE_ORDER,
  PortfolioGrade,
  PropertyGrade,
  PropertyGradeReport,
} from './property-grading-types.js';
import { scoreToGrade } from './scoring-model.js';

export type WeightBy = 'equal' | 'unit_count' | 'asset_value';

export interface AggregateOptions {
  readonly weightBy?: WeightBy;
  /** Optional per-property weights used when `weightBy` requires a number. */
  readonly weightsByPropertyId?: Readonly<Record<string, number>>;
  /** Previous portfolio score (for trajectory). */
  readonly previousScore?: number;
}

/** Build an empty distribution record keyed by every PropertyGrade. */
function emptyDistribution(): Record<PropertyGrade, number> {
  const record = {} as Record<PropertyGrade, number>;
  for (const grade of GRADE_ORDER) record[grade] = 0;
  record.INSUFFICIENT_DATA = 0;
  return record;
}

function resolveWeight(
  report: PropertyGradeReport,
  weightBy: WeightBy,
  weightsByPropertyId: Readonly<Record<string, number>> | undefined,
): number {
  if (weightBy === 'equal') return 1;
  const lookup = weightsByPropertyId?.[report.propertyId];
  if (typeof lookup === 'number' && lookup > 0) return lookup;
  // Fallback — we still produce a grade even if the caller forgot to
  // supply a weight; we just silently equal-weight that property.
  return 1;
}

export function aggregatePortfolioGrade(
  tenantId: string,
  reports: readonly PropertyGradeReport[],
  opts: AggregateOptions = {},
): PortfolioGrade {
  const weightBy: WeightBy = opts.weightBy ?? 'unit_count';
  const distribution = emptyDistribution();
  let weightedSum = 0;
  let weightTotal = 0;
  const scoredReports = reports.filter((r) => r.grade !== 'INSUFFICIENT_DATA');

  for (const report of reports) {
    distribution[report.grade] += 1;
    if (report.grade === 'INSUFFICIENT_DATA') continue;
    const weight = resolveWeight(report, weightBy, opts.weightsByPropertyId);
    weightedSum += report.score * weight;
    weightTotal += weight;
  }

  const score =
    weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0;
  const grade: PropertyGrade =
    scoredReports.length === 0 ? 'INSUFFICIENT_DATA' : scoreToGrade(score);

  // Strongest + weakest properties, guarded against empty portfolios.
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
    totalProperties: reports.length,
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
  distribution: Readonly<Record<PropertyGrade, number>>,
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

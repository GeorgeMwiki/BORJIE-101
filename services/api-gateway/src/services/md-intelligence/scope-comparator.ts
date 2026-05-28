/**
 * Scope comparator — Wave SCOPE-SEGMENTATION.
 *
 * Compares a metric across multiple scopes (pit vs pit, site vs site,
 * subsidiary vs subsidiary). Returns deltas + ranking.
 */

import type { ScopeMetricSample } from './scope-roller';

export interface ScopeComparatorInput {
  readonly metricId: string;
  readonly samples: ReadonlyArray<ScopeMetricSample>;
}

export interface ScopeRank {
  readonly scopeNodeId: string;
  readonly value: number;
  readonly rank: number;
  readonly deltaFromMean: number;
}

export interface ScopeComparatorResult {
  readonly metricId: string;
  readonly mean: number;
  readonly ranking: ReadonlyArray<ScopeRank>;
  readonly topScopeNodeId: string | null;
  readonly bottomScopeNodeId: string | null;
}

export function compareScopes(
  input: ScopeComparatorInput,
): ScopeComparatorResult {
  const samples = [...input.samples];
  const count = samples.length;
  const sum = samples.reduce((s, x) => s + x.value, 0);
  const mean = count > 0 ? sum / count : 0;
  const sorted = samples
    .slice()
    .sort((a, b) => b.value - a.value);
  const ranking: ScopeRank[] = sorted.map((s, idx) => ({
    scopeNodeId: s.scopeNodeId,
    value: s.value,
    rank: idx + 1,
    deltaFromMean: s.value - mean,
  }));
  return {
    metricId: input.metricId,
    mean,
    ranking,
    topScopeNodeId: ranking[0]?.scopeNodeId ?? null,
    bottomScopeNodeId: ranking[ranking.length - 1]?.scopeNodeId ?? null,
  };
}

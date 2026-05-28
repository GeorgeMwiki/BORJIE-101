/**
 * Scope roller — Wave SCOPE-SEGMENTATION.
 *
 * Rolls a metric up across a set of scope_node ids. Pure functional;
 * data fetching is delegated to a reader port.
 */

export interface ScopeMetricSample {
  readonly scopeNodeId: string;
  readonly value: number;
  readonly unit?: string;
}

export interface ScopeRollerInput {
  readonly scopeNodeIds: ReadonlyArray<string>;
  readonly metricId: string;
  readonly fetchSample: (
    scopeNodeId: string,
    metricId: string,
  ) => Promise<ScopeMetricSample | null>;
}

export interface ScopeRollerResult {
  readonly metricId: string;
  readonly perScope: ReadonlyArray<ScopeMetricSample>;
  readonly total: number;
  readonly mean: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly count: number;
}

export async function rollUp(
  input: ScopeRollerInput,
): Promise<ScopeRollerResult> {
  const samples: ScopeMetricSample[] = [];
  for (const id of input.scopeNodeIds) {
    const s = await input.fetchSample(id, input.metricId);
    if (s) samples.push(s);
  }
  const values = samples.map((s) => s.value);
  const total = values.reduce((sum, v) => sum + v, 0);
  const count = values.length;
  const mean = count > 0 ? total / count : 0;
  const min = count > 0 ? Math.min(...values) : null;
  const max = count > 0 ? Math.max(...values) : null;
  return {
    metricId: input.metricId,
    perScope: samples,
    total,
    mean,
    min,
    max,
    count,
  };
}

/**
 * Cube-style semantic layer — definers.
 *
 * Inspired by Cube.dev 0.36 and dbt Semantic Layer: metrics, dimensions,
 * and cubes are declared once, referenced everywhere by id. The cube is
 * the unit of access control — every query against a cube is tenant
 * scoped at compile time (see `compile.ts`).
 *
 * These functions are pure factories. They never touch I/O. They exist
 * mostly to give callers helpful type inference + runtime sanity checks
 * (duplicate ids, empty cubes, etc.).
 */

import type { CubeDef, CubeSource, DimensionDef, MetricDef } from '../types.js';

/** Cap dimension/metric ids to a safe identifier shape. */
const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertId(kind: string, id: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(
      `[analytics/semantic] invalid ${kind} id '${id}': must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
    );
  }
}

export function defineMetric(input: MetricDef): MetricDef {
  assertId('metric', input.id);
  if (!input.column || input.column.length === 0) {
    throw new Error(`[analytics/semantic] metric '${input.id}' requires a column`);
  }
  // Preserve `filters` optionality so `exactOptionalPropertyTypes` doesn't
  // force callers to spell `filters: undefined`.
  const out: Record<string, unknown> = { ...input };
  if (input.filters) {
    out['filters'] = Object.freeze([...input.filters]);
  }
  return Object.freeze(out as unknown as MetricDef);
}

export function defineDimension(input: DimensionDef): DimensionDef {
  assertId('dimension', input.id);
  if (!input.column || input.column.length === 0) {
    throw new Error(`[analytics/semantic] dimension '${input.id}' requires a column`);
  }
  return Object.freeze({ ...input });
}

export interface DefineCubeInput {
  readonly name: string;
  readonly source: CubeSource;
  readonly metrics: readonly MetricDef[];
  readonly dimensions: readonly DimensionDef[];
  readonly tenantColumn?: string;
}

export function defineCube(input: DefineCubeInput): CubeDef {
  if (!input.name || input.name.length === 0) {
    throw new Error('[analytics/semantic] cube requires a name');
  }
  if (input.metrics.length === 0 && input.dimensions.length === 0) {
    throw new Error(`[analytics/semantic] cube '${input.name}' has no metrics or dimensions`);
  }
  const metricIds = new Set<string>();
  for (const m of input.metrics) {
    if (metricIds.has(m.id)) {
      throw new Error(`[analytics/semantic] cube '${input.name}' has duplicate metric '${m.id}'`);
    }
    metricIds.add(m.id);
  }
  const dimIds = new Set<string>();
  for (const d of input.dimensions) {
    if (dimIds.has(d.id)) {
      throw new Error(`[analytics/semantic] cube '${input.name}' has duplicate dimension '${d.id}'`);
    }
    dimIds.add(d.id);
  }
  return Object.freeze({
    name: input.name,
    source: input.source,
    metrics: Object.freeze([...input.metrics]),
    dimensions: Object.freeze([...input.dimensions]),
    tenantColumn: input.tenantColumn ?? 'tenant_id',
  });
}

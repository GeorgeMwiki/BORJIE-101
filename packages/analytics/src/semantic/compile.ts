/**
 * Semantic-layer query compiler.
 *
 * Takes a typed `Query` referencing metrics + dimensions by id and
 * compiles it to:
 *
 *   - `SqlQuery` for cubes with `source.kind === 'sql'`
 *   - `ApiQuery` for cubes with `source.kind === 'api'`
 *   - `MemoryQuery` for cubes with `source.kind === 'memory'`
 *
 * Every compiled query is tenant-scoped: the `tenantColumn = $tenant`
 * filter is injected first, before any caller filters. This is
 * enforced by construction — there is no code path that skips it. The
 * `tenantScoped: true` literal on the result is a type-level proof you
 * can assert against in tests.
 *
 * SQL safety:
 *
 *   - Identifiers (table, columns, agg expressions) are validated
 *     against a strict `/^[a-zA-Z_][a-zA-Z0-9_]*$/` regex. We refuse to
 *     compile a query whose cube has any identifier we cannot quote
 *     safely. This is a coarse-but-safe boundary; cubes are declared
 *     by developers, not by users.
 *   - Values flow through parameters only. The `params` map keys are
 *     all `:p<n>` placeholders so the executor can map them to its
 *     native parameter style (`$1`, `?`, named, etc.).
 */

import type {
  ApiQuery,
  CompiledQuery,
  CubeDef,
  FilterClause,
  MemoryQuery,
  MetricDef,
  Query,
  SqlQuery,
  TimeGrain,
} from '../types.js';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function safeIdent(ident: string, what: string): string {
  if (!IDENT_RE.test(ident)) {
    throw new Error(`[analytics/semantic] unsafe ${what} identifier '${ident}'`);
  }
  return ident;
}

export interface CompileError extends Error {
  readonly code:
    | 'UNKNOWN_METRIC'
    | 'UNKNOWN_DIMENSION'
    | 'TENANT_MISSING'
    | 'UNSAFE_IDENT'
    | 'TIME_GRAIN_REQUIRES_TIME_DIM';
}

class CompileErr extends Error implements CompileError {
  readonly code: CompileError['code'];
  constructor(code: CompileError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'CompileError';
  }
}

export function compileQuery(cube: CubeDef, query: Query): CompiledQuery {
  if (!query.tenantId || query.tenantId.length === 0) {
    throw new CompileErr('TENANT_MISSING', '[analytics/semantic] query requires non-empty tenantId');
  }

  // Resolve metrics + dimensions against the cube.
  const metrics = query.metrics.map((id) => {
    const m = cube.metrics.find((mm) => mm.id === id);
    if (!m) {
      throw new CompileErr('UNKNOWN_METRIC', `[analytics/semantic] cube '${cube.name}' has no metric '${id}'`);
    }
    return m;
  });

  const dimensions = (query.dimensions ?? []).map((id) => {
    const d = cube.dimensions.find((dd) => dd.id === id);
    if (!d) {
      throw new CompileErr('UNKNOWN_DIMENSION', `[analytics/semantic] cube '${cube.name}' has no dimension '${id}'`);
    }
    return d;
  });

  if (query.timeGrain) {
    const hasTimeDim = dimensions.some((d) => d.kind === 'time');
    if (!hasTimeDim) {
      throw new CompileErr(
        'TIME_GRAIN_REQUIRES_TIME_DIM',
        `[analytics/semantic] timeGrain '${query.timeGrain}' requires at least one time dimension in query.dimensions`,
      );
    }
  }

  const tenantColumn = safeIdent(cube.tenantColumn ?? 'tenant_id', 'tenant column');

  switch (cube.source.kind) {
    case 'sql':
      return compileSql(cube, query, metrics, dimensions, tenantColumn);
    case 'api':
      return compileApi(cube, query, metrics, dimensions, tenantColumn);
    case 'memory':
      return compileMemory(cube, query, metrics, dimensions);
  }
}

// ───────────────────────── SQL backend ─────────────────────────

function compileSql(
  cube: CubeDef,
  query: Query,
  metrics: readonly MetricDef[],
  dimensions: readonly { readonly column: string; readonly kind: string; readonly id: string }[],
  tenantColumn: string,
): SqlQuery {
  if (cube.source.kind !== 'sql') throw new Error('expected sql cube');
  const table = safeIdent(cube.source.table, 'table');

  const selectParts: string[] = [];
  const groupByParts: string[] = [];

  for (const d of dimensions) {
    const col = safeIdent(d.column, 'dimension column');
    const id = safeIdent(d.id, 'dimension id');
    if (d.kind === 'time' && query.timeGrain) {
      selectParts.push(`${timeGrainSql(query.timeGrain, col)} AS ${id}`);
      groupByParts.push(id);
    } else {
      selectParts.push(`${col} AS ${id}`);
      groupByParts.push(id);
    }
  }

  for (const m of metrics) {
    const col = safeIdent(m.column, 'metric column');
    const id = safeIdent(m.id, 'metric id');
    selectParts.push(`${aggSql(m.agg, col)} AS ${id}`);
  }

  // Filters: tenant first, then caller filters, then metric-level filters.
  const params: Record<string, unknown> = {};
  const whereParts: string[] = [];
  const tenantParam = nextParam(params);
  params[tenantParam] = query.tenantId;
  whereParts.push(`${tenantColumn} = :${tenantParam}`);

  if (query.timeRange) {
    const tcol = safeIdent(query.timeRange.column ?? 'created_at', 'time range column');
    const startP = nextParam(params);
    const endP = nextParam(params);
    params[startP] = query.timeRange.start;
    params[endP] = query.timeRange.end;
    whereParts.push(`${tcol} >= :${startP}`);
    whereParts.push(`${tcol} < :${endP}`);
  }

  for (const f of query.filters ?? []) {
    whereParts.push(filterSql(f, params));
  }

  for (const m of metrics) {
    for (const f of m.filters ?? []) {
      // Metric-level filters are AND'd to the WHERE — sufficient for
      // the cube model we support. Per-metric FILTER (WHERE ...) would
      // be a future upgrade.
      whereParts.push(filterSql(f, params));
    }
  }

  let sql = `SELECT ${selectParts.join(', ')} FROM ${table} WHERE ${whereParts.join(' AND ')}`;
  if (groupByParts.length > 0) {
    sql += ` GROUP BY ${groupByParts.join(', ')}`;
  }
  if (query.orderBy && query.orderBy.length > 0) {
    const orderParts = query.orderBy.map((o) => {
      const id = safeIdent(o.id, 'order by id');
      const dir = o.direction === 'desc' ? 'DESC' : 'ASC';
      return `${id} ${dir}`;
    });
    sql += ` ORDER BY ${orderParts.join(', ')}`;
  }
  if (typeof query.limit === 'number' && query.limit > 0 && Number.isInteger(query.limit)) {
    sql += ` LIMIT ${query.limit}`;
  }

  return Object.freeze({
    kind: 'sql',
    sql,
    params: Object.freeze(params),
    tenantScoped: true,
  });
}

function aggSql(agg: MetricDef['agg'], column: string): string {
  switch (agg) {
    case 'sum':
      return `SUM(${column})`;
    case 'count':
      return `COUNT(${column})`;
    case 'count_distinct':
      return `COUNT(DISTINCT ${column})`;
    case 'avg':
      return `AVG(${column})`;
    case 'min':
      return `MIN(${column})`;
    case 'max':
      return `MAX(${column})`;
    case 'median':
      // Portable: PERCENTILE_CONT in PostgreSQL; the executor is free
      // to rewrite for its dialect. We emit the ANSI-standard form.
      return `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${column})`;
  }
}

function timeGrainSql(grain: TimeGrain, column: string): string {
  // PostgreSQL `date_trunc` syntax — the executor may rewrite. We do
  // NOT accept user-controlled grain strings; `TimeGrain` is a closed
  // union so this switch is exhaustive.
  switch (grain) {
    case 'minute':
      return `date_trunc('minute', ${column})`;
    case 'hour':
      return `date_trunc('hour', ${column})`;
    case 'day':
      return `date_trunc('day', ${column})`;
    case 'week':
      return `date_trunc('week', ${column})`;
    case 'month':
      return `date_trunc('month', ${column})`;
    case 'quarter':
      return `date_trunc('quarter', ${column})`;
    case 'year':
      return `date_trunc('year', ${column})`;
  }
}

function filterSql(f: FilterClause, params: Record<string, unknown>): string {
  const col = safeIdent(f.column, 'filter column');
  switch (f.op) {
    case 'eq': {
      const p = nextParam(params);
      params[p] = f.value;
      return `${col} = :${p}`;
    }
    case 'neq': {
      const p = nextParam(params);
      params[p] = f.value;
      return `${col} <> :${p}`;
    }
    case 'gt': {
      const p = nextParam(params);
      params[p] = f.value;
      return `${col} > :${p}`;
    }
    case 'gte': {
      const p = nextParam(params);
      params[p] = f.value;
      return `${col} >= :${p}`;
    }
    case 'lt': {
      const p = nextParam(params);
      params[p] = f.value;
      return `${col} < :${p}`;
    }
    case 'lte': {
      const p = nextParam(params);
      params[p] = f.value;
      return `${col} <= :${p}`;
    }
    case 'in':
    case 'not_in': {
      if (!Array.isArray(f.value) || f.value.length === 0) {
        throw new CompileErr('UNSAFE_IDENT', `[analytics/semantic] filter ${f.op} requires a non-empty array value`);
      }
      const placeholders = f.value.map((v) => {
        const p = nextParam(params);
        params[p] = v;
        return `:${p}`;
      });
      return `${col} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${placeholders.join(', ')})`;
    }
    case 'contains': {
      const p = nextParam(params);
      params[p] = `%${String(f.value)}%`;
      return `${col} LIKE :${p}`;
    }
    case 'starts_with': {
      const p = nextParam(params);
      params[p] = `${String(f.value)}%`;
      return `${col} LIKE :${p}`;
    }
    case 'between': {
      if (!Array.isArray(f.value) || f.value.length !== 2) {
        throw new CompileErr('UNSAFE_IDENT', `[analytics/semantic] filter between requires [low, high]`);
      }
      // Assign in order so `nextParam` keeps counting up.
      const pLow = nextParam(params);
      params[pLow] = f.value[0];
      const pHigh = nextParam(params);
      params[pHigh] = f.value[1];
      return `${col} BETWEEN :${pLow} AND :${pHigh}`;
    }
  }
}

function nextParam(params: Record<string, unknown>): string {
  const n = Object.keys(params).length;
  return `p${n}`;
}

// ───────────────────────── API backend ─────────────────────────

function compileApi(
  cube: CubeDef,
  query: Query,
  metrics: readonly MetricDef[],
  dimensions: readonly { readonly id: string }[],
  tenantColumn: string,
): ApiQuery {
  if (cube.source.kind !== 'api') throw new Error('expected api cube');
  const params: Record<string, unknown> = {
    cube: cube.name,
    metrics: metrics.map((m) => m.id),
    dimensions: dimensions.map((d) => d.id),
  };
  params[tenantColumn] = query.tenantId; // tenant first
  if (query.timeRange) params.timeRange = query.timeRange;
  if (query.timeGrain) params.timeGrain = query.timeGrain;
  if (query.filters && query.filters.length > 0) params.filters = query.filters;
  if (query.orderBy && query.orderBy.length > 0) params.orderBy = query.orderBy;
  if (typeof query.limit === 'number') params.limit = query.limit;
  return Object.freeze({
    kind: 'api',
    endpoint: cube.source.endpoint,
    params: Object.freeze(params),
    tenantScoped: true,
  });
}

// ───────────────────────── Memory backend ─────────────────────────

function compileMemory(
  cube: CubeDef,
  query: Query,
  metrics: readonly MetricDef[],
  dimensions: readonly { readonly id: string; readonly column: string }[],
): MemoryQuery {
  if (cube.source.kind !== 'memory') throw new Error('expected memory cube');
  // The memory executor (`evaluateMemory`) does the filtering, so we
  // surface the projection here. Tenant filter is added FIRST so it
  // can never be dropped by caller filters.
  const tenantColumn = cube.tenantColumn ?? 'tenant_id';
  const filters = [
    { column: tenantColumn, op: 'eq' as const, value: query.tenantId },
    ...(query.filters ?? []),
  ];
  return Object.freeze({
    kind: 'memory',
    rows: cube.source.rows,
    projection: Object.freeze({
      metrics: metrics.map((m) => ({ id: m.id, column: m.column, agg: m.agg })),
      dimensions: dimensions.map((d) => {
        const dimDef = cube.dimensions.find((cd) => cd.id === d.id);
        return dimDef?.kind === 'time' && query.timeGrain
          ? { id: d.id, column: d.column, grain: query.timeGrain }
          : { id: d.id, column: d.column };
      }),
      filters,
    }),
    tenantScoped: true,
  });
}

/**
 * In-memory query evaluator for `MemoryQuery`. Pure function.
 *
 * Useful for: tests, AI chart authoring on uploaded data, dashboards
 * over CSV/XLSX uploads before they are loaded into the warehouse.
 *
 * Time grain bucketing uses `Date` truncation — the implementation is
 * portable across runtimes and does NOT rely on any locale.
 */

import type { FilterClause, MemoryQuery, ParsedRow, TimeGrain } from '../types.js';

export function evaluateMemory(query: MemoryQuery): readonly ParsedRow[] {
  const filtered = query.rows.filter((row) =>
    query.projection.filters.every((f) => applyFilter(row, f)),
  );

  // Group by dimensions, aggregate metrics.
  if (query.projection.dimensions.length === 0) {
    // No groupings — single aggregated row.
    const out: Record<string, unknown> = {};
    for (const m of query.projection.metrics) {
      out[m.id] = aggregate(m.agg, filtered.map((r) => r[m.column]));
    }
    return [Object.freeze(out)];
  }

  const groups = new Map<string, { key: Record<string, unknown>; rows: ParsedRow[] }>();
  for (const row of filtered) {
    const key: Record<string, unknown> = {};
    for (const d of query.projection.dimensions) {
      const value = row[d.column];
      key[d.id] = d.grain ? truncTime(value, d.grain) : value;
    }
    const k = JSON.stringify(key);
    const existing = groups.get(k);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(k, { key, rows: [row] });
    }
  }

  const result: ParsedRow[] = [];
  for (const { key, rows } of groups.values()) {
    const out: Record<string, unknown> = { ...key };
    for (const m of query.projection.metrics) {
      out[m.id] = aggregate(m.agg, rows.map((r) => r[m.column]));
    }
    result.push(Object.freeze(out));
  }
  return result;
}

function applyFilter(row: ParsedRow, f: FilterClause): boolean {
  const v = row[f.column];
  switch (f.op) {
    case 'eq':
      return v === f.value;
    case 'neq':
      return v !== f.value;
    case 'gt':
      return typeof v === 'number' && typeof f.value === 'number' && v > f.value;
    case 'gte':
      return typeof v === 'number' && typeof f.value === 'number' && v >= f.value;
    case 'lt':
      return typeof v === 'number' && typeof f.value === 'number' && v < f.value;
    case 'lte':
      return typeof v === 'number' && typeof f.value === 'number' && v <= f.value;
    case 'in':
      return Array.isArray(f.value) && f.value.includes(v);
    case 'not_in':
      return Array.isArray(f.value) && !f.value.includes(v);
    case 'contains':
      return typeof v === 'string' && typeof f.value === 'string' && v.includes(f.value);
    case 'starts_with':
      return typeof v === 'string' && typeof f.value === 'string' && v.startsWith(f.value);
    case 'between':
      return (
        Array.isArray(f.value) &&
        f.value.length === 2 &&
        typeof v === 'number' &&
        typeof f.value[0] === 'number' &&
        typeof f.value[1] === 'number' &&
        v >= f.value[0] &&
        v <= f.value[1]
      );
  }
}

function aggregate(agg: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_distinct' | 'median', values: readonly unknown[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (agg === 'count') return values.filter((v) => v !== null && v !== undefined).length;
  if (agg === 'count_distinct') return new Set(values.filter((v) => v !== null && v !== undefined)).size;
  if (nums.length === 0) return null;
  switch (agg) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
    }
  }
}

function truncTime(value: unknown, grain: TimeGrain): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;

  // Truncate to grain in UTC for reproducibility.
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  let trunc: Date;
  switch (grain) {
    case 'minute':
      trunc = new Date(Date.UTC(y, m, day, h, min));
      break;
    case 'hour':
      trunc = new Date(Date.UTC(y, m, day, h));
      break;
    case 'day':
      trunc = new Date(Date.UTC(y, m, day));
      break;
    case 'week': {
      // ISO week — start Monday.
      const dow = (d.getUTCDay() + 6) % 7; // 0 = Mon
      trunc = new Date(Date.UTC(y, m, day - dow));
      break;
    }
    case 'month':
      trunc = new Date(Date.UTC(y, m, 1));
      break;
    case 'quarter': {
      const qm = Math.floor(m / 3) * 3;
      trunc = new Date(Date.UTC(y, qm, 1));
      break;
    }
    case 'year':
      trunc = new Date(Date.UTC(y, 0, 1));
      break;
  }
  return trunc.toISOString();
}

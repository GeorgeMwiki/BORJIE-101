/**
 * Schema inference over `ParsedRow[]`. Pure function.
 *
 * Produces a `SchemaProfile`: per-column inferred type, null count,
 * distinct count, a small sample, and (for numerics) min/max/mean/median.
 *
 * Heuristics:
 *   - 'integer' if every non-null value passes `Number.isInteger`.
 *   - 'number' if every non-null value is finite and at least one is float.
 *   - 'boolean' if every non-null value is `true|false`.
 *   - 'timestamp' if every non-null value parses as a `Date` with both
 *     date + time components.
 *   - 'date' if every non-null value is an ISO-date string `YYYY-MM-DD`.
 *   - 'string' otherwise.
 *   - 'unknown' for a column that is entirely null.
 */

import type { ColumnProfile, InferredType, ParsedRow, SchemaProfile } from '../types.js';

export interface InferSchemaOptions {
  /** Cap on samples kept per column. Default 5. */
  readonly sampleSize?: number;
}

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function inferSchema(rows: readonly ParsedRow[], opts: InferSchemaOptions = {}): SchemaProfile {
  const sampleSize = opts.sampleSize ?? 5;
  if (rows.length === 0) {
    return Object.freeze({ rowCount: 0, columns: [] });
  }

  // Discover columns from the union of all row keys.
  const cols = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) cols.add(k);
  }

  const profiles: ColumnProfile[] = [];
  for (const col of cols) {
    const values: unknown[] = [];
    const distinct = new Set<unknown>();
    let nullCount = 0;
    for (const r of rows) {
      const v = r[col];
      if (v === null || v === undefined || v === '') {
        nullCount++;
        continue;
      }
      values.push(v);
      distinct.add(v);
    }
    const samples = values.slice(0, sampleSize);
    const inferred = inferType(values);

    let numericSummary: ColumnProfile['numericSummary'];
    if (inferred === 'integer' || inferred === 'number') {
      const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (nums.length > 0) {
        const sorted = [...nums].sort((a, b) => a - b);
        const sum = nums.reduce((a, b) => a + b, 0);
        const mean = sum / nums.length;
        const mid = Math.floor(sorted.length / 2);
        const median =
          sorted.length % 2 === 0
            ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
            : (sorted[mid] ?? 0);
        numericSummary = Object.freeze({
          min: sorted[0] ?? 0,
          max: sorted[sorted.length - 1] ?? 0,
          mean,
          median,
        });
      }
    }

    profiles.push(
      Object.freeze({
        name: col,
        inferredType: inferred,
        nullCount,
        distinctCount: distinct.size,
        samples: Object.freeze(samples),
        ...(numericSummary ? { numericSummary } : {}),
      }) as ColumnProfile,
    );
  }

  return Object.freeze({
    rowCount: rows.length,
    columns: Object.freeze(profiles),
  });
}

function inferType(values: readonly unknown[]): InferredType {
  if (values.length === 0) return 'unknown';

  let allBoolean = true;
  let allInteger = true;
  let allNumber = true;
  let allDateOnly = true;
  let allTimestamp = true;

  for (const v of values) {
    if (typeof v !== 'boolean') allBoolean = false;
    if (typeof v !== 'number' || !Number.isInteger(v)) allInteger = false;
    if (typeof v !== 'number' || !Number.isFinite(v)) allNumber = false;
    if (typeof v !== 'string' || !ISO_DATE_ONLY_RE.test(v)) allDateOnly = false;
    if (typeof v !== 'string' || !ISO_TIMESTAMP_RE.test(v) || Number.isNaN(Date.parse(v))) {
      allTimestamp = false;
    }
  }

  if (allBoolean) return 'boolean';
  if (allInteger) return 'integer';
  if (allNumber) return 'number';
  if (allTimestamp) return 'timestamp';
  if (allDateOnly) return 'date';
  return 'string';
}

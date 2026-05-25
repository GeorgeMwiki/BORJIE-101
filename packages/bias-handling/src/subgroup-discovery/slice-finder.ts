/**
 * Slice Finder (Chung et al. ICDE 2019, "Slice Finder: Automated
 * Data Slicing for Model Validation").
 *
 * Goal: find subgroups (slices) defined by simple categorical
 * predicates where the model performs *worse* than the global
 * population. Detects intersectional bias hidden by aggregate
 * metrics.
 *
 * Our implementation handles:
 *  - single-attribute slices,
 *  - two-attribute (intersectional) slices when
 *    `maxPredicateDepth >= 2` (default 2).
 *
 * Performance per slice = error rate (1 - accuracy).
 *
 * We filter:
 *  - `size >= minSliceSize`,
 *  - statistical significance via two-sided binomial p-value.
 *
 * Output is sorted by descending `delta`. SliceLine (Sagadeeva
 * & Boehm SIGMOD 2021) is faster on big data via linear algebra;
 * for our purposes (subgroup audits, not interactive viz), the
 * direct enumeration is straightforward and correct.
 */

import type { SliceFinderRow, SubgroupSlice } from '../types.js';
import { twoSidedBinomialPValue } from './binomial-test.js';

export interface FindSlicesArgs {
  readonly rows: ReadonlyArray<SliceFinderRow>;
  /** Which attributes to slice on. If omitted, uses all attribute keys. */
  readonly attributes?: ReadonlyArray<string>;
  /** Minimum rows in a slice to be reported. Default 20. */
  readonly minSliceSize?: number;
  /** Max number of conjoined predicates per slice. Default 2. */
  readonly maxPredicateDepth?: number;
  /** Maximum number of slices to return. Default 20. */
  readonly topK?: number;
  /** Only report slices that are statistically significant at this α. */
  readonly significanceLevel?: number;
}

function errorRate(rows: ReadonlyArray<SliceFinderRow>): number {
  if (rows.length === 0) return 0;
  let errs = 0;
  for (const r of rows) {
    if (r.prediction !== r.label) errs += 1;
  }
  return errs / rows.length;
}

function matchPredicates(
  row: SliceFinderRow,
  preds: Readonly<Record<string, string>>,
): boolean {
  for (const [k, v] of Object.entries(preds)) {
    if (row.attrs[k] !== v) return false;
  }
  return true;
}

export function findSlices(args: FindSlicesArgs): ReadonlyArray<SubgroupSlice> {
  const minSize = args.minSliceSize ?? 20;
  const depth = args.maxPredicateDepth ?? 2;
  const topK = args.topK ?? 20;
  const alpha = args.significanceLevel ?? 0.05;
  if (depth < 1) {
    throw new Error('[bias-handling] maxPredicateDepth must be >= 1.');
  }

  // Collect attributes + their distinct values.
  const attrs = args.attributes ?? collectAttrKeys(args.rows);
  const valuesPerAttr = collectValues(args.rows, attrs);
  const globalRate = errorRate(args.rows);

  const slices: SubgroupSlice[] = [];

  // Depth 1: single-attribute slices.
  for (const a of attrs) {
    for (const v of valuesPerAttr[a] ?? []) {
      const pred = { [a]: v };
      pushIfQualifies(slices, pred, args.rows, minSize, globalRate);
    }
  }

  // Depth >= 2: intersectional slices.
  if (depth >= 2) {
    for (let i = 0; i < attrs.length; i++) {
      for (let j = i + 1; j < attrs.length; j++) {
        const a = attrs[i]!;
        const b = attrs[j]!;
        for (const va of valuesPerAttr[a] ?? []) {
          for (const vb of valuesPerAttr[b] ?? []) {
            const pred = { [a]: va, [b]: vb };
            pushIfQualifies(slices, pred, args.rows, minSize, globalRate);
          }
        }
      }
    }
  }

  // Filter by significance.
  const significant = slices.filter((s) => s.pValue <= alpha);
  // Sort descending by abs delta.
  const sorted = [...significant].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return sorted.slice(0, topK);
}

function pushIfQualifies(
  out: SubgroupSlice[],
  pred: Readonly<Record<string, string>>,
  rows: ReadonlyArray<SliceFinderRow>,
  minSize: number,
  globalRate: number,
): void {
  const sliceRows = rows.filter((r) => matchPredicates(r, pred));
  if (sliceRows.length < minSize) return;
  const rate = errorRate(sliceRows);
  const delta = rate - globalRate;
  const observedFailures = sliceRows.filter((r) => r.prediction !== r.label).length;
  const pValue = twoSidedBinomialPValue({
    observedFailures,
    n: sliceRows.length,
    baselineRate: globalRate,
  });
  out.push({
    predicates: pred,
    size: sliceRows.length,
    errorRate: rate,
    globalErrorRate: globalRate,
    delta,
    pValue,
  });
}

function collectAttrKeys(
  rows: ReadonlyArray<SliceFinderRow>,
): ReadonlyArray<string> {
  const set = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.attrs)) set.add(k);
  }
  return [...set].sort();
}

function collectValues(
  rows: ReadonlyArray<SliceFinderRow>,
  attrs: ReadonlyArray<string>,
): Readonly<Record<string, ReadonlyArray<string>>> {
  const out: Record<string, Set<string>> = {};
  for (const a of attrs) out[a] = new Set();
  for (const r of rows) {
    for (const a of attrs) {
      const v = r.attrs[a];
      if (v !== undefined) out[a]!.add(v);
    }
  }
  const final: Record<string, ReadonlyArray<string>> = {};
  for (const [a, s] of Object.entries(out)) {
    final[a] = [...s].sort();
  }
  return final;
}

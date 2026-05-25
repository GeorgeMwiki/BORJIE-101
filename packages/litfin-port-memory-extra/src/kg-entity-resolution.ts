/**
 * KG entity-resolution heuristics — deduplication beyond exact-match.
 *
 * LITFIN ref: src/core/knowledge-graph/triple-store.ts +
 * src/core/knowledge-intelligence/* — uses a chain of cheap-to-expensive
 * comparators with early-exit and per-domain thresholds.
 *
 * Ported here without the LLM-confirmation tail; the caller plugs that
 * in via the `disambiguator` port if desired.
 */

import type { EntityId } from './types.js';

export type EntityKind = 'person' | 'org' | 'property' | 'address' | 'generic';

export interface EntityRecord {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  /** Optional structural identifiers: email, phone, dom registry, etc. */
  readonly identifiers: Readonly<Record<string, string>>;
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s: string): readonly string[] => normalize(s).split(' ').filter((t) => t.length > 0);

/** Jaccard over token sets. Cheap and stable for short strings. */
export const jaccard = (a: string, b: string): number => {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect++;
  const union = ta.size + tb.size - intersect;
  return union === 0 ? 0 : intersect / union;
};

/** Damerau-Levenshtein bounded by `cap` (returns `cap` if exceeded). */
export const editDistanceCapped = (a: string, b: string, cap: number): number => {
  if (Math.abs(a.length - b.length) > cap) return cap;
  const m = a.length;
  const n = b.length;
  if (m === 0) return Math.min(n, cap);
  if (n === 0) return Math.min(m, cap);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = new Array(n + 1);
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const above = (prev[j] ?? 0) + 1;
      const left = (curr[j - 1] ?? 0) + 1;
      const diag = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(above, left, diag);
      if ((curr[j] ?? 0) < rowMin) rowMin = curr[j] ?? rowMin;
    }
    if (rowMin >= cap) return cap;
    prev = curr;
  }
  return Math.min(prev[n] ?? cap, cap);
};

/** Default per-kind decision thresholds. Property requires high confidence. */
export const DEFAULT_KIND_THRESHOLD: Readonly<Record<EntityKind, number>> = {
  person: 0.78,
  org: 0.7,
  property: 0.88,
  address: 0.82,
  generic: 0.75,
};

export type MergeDecision =
  | { readonly verdict: 'merge'; readonly score: number; readonly reason: string }
  | { readonly verdict: 'keep-separate'; readonly score: number; readonly reason: string }
  | { readonly verdict: 'needs-review'; readonly score: number; readonly reason: string };

export interface ResolutionOptions {
  readonly kindThresholds?: Readonly<Record<EntityKind, number>>;
  /** Score band below threshold that escalates to needs-review. */
  readonly reviewBandWidth?: number;
}

export const resolve = (
  a: EntityRecord,
  b: EntityRecord,
  opts: ResolutionOptions = {},
): MergeDecision => {
  if (a.kind !== b.kind) {
    return { verdict: 'keep-separate', score: 0, reason: 'kind-mismatch' };
  }
  // Hard rule: any matching strong identifier (email/phone/registry) is a merge.
  for (const [key, val] of Object.entries(a.identifiers)) {
    if (b.identifiers[key] !== undefined && b.identifiers[key] === val) {
      return { verdict: 'merge', score: 1, reason: `identifier-match:${key}` };
    }
  }
  const candidatesA = [a.canonicalName, ...a.aliases];
  const candidatesB = [b.canonicalName, ...b.aliases];
  let bestScore = 0;
  for (const ca of candidatesA) {
    for (const cb of candidatesB) {
      const j = jaccard(ca, cb);
      // Edit distance gives a chance for typos (within 2 chars).
      const ed = editDistanceCapped(normalize(ca), normalize(cb), 3);
      const longer = Math.max(ca.length, cb.length, 1);
      const edScore = 1 - ed / longer;
      const combo = 0.6 * j + 0.4 * edScore;
      if (combo > bestScore) bestScore = combo;
    }
  }
  const thresholds = opts.kindThresholds ?? DEFAULT_KIND_THRESHOLD;
  const threshold = thresholds[a.kind] ?? thresholds.generic;
  const reviewBand = opts.reviewBandWidth ?? 0.08;
  if (bestScore >= threshold) {
    return { verdict: 'merge', score: bestScore, reason: 'similarity-above-threshold' };
  }
  if (bestScore >= threshold - reviewBand) {
    return { verdict: 'needs-review', score: bestScore, reason: 'similarity-in-review-band' };
  }
  return { verdict: 'keep-separate', score: bestScore, reason: 'similarity-below-threshold' };
};

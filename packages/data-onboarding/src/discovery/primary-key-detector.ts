/**
 * Stage 2.c — Primary-key detection.
 *
 * Walks discovered columns and returns the best primary-key candidate:
 * uniqueness, low nullability, and a strong-key inferred type (nida >
 * tin > email > number > string with `_id` suffix).
 */

import type { DiscoveredColumn, InferredType } from '../types.js';

const STRONG_KEY_TYPES: ReadonlyArray<InferredType> = Object.freeze([
  'nida',
  'tin',
  'email',
  'number',
]);

interface ScoredCandidate {
  readonly column: DiscoveredColumn;
  readonly score: number;
}

function scoreColumn(column: DiscoveredColumn): number {
  if (column.cardinality !== 'unique') return 0;
  if (column.nullability > 0.05) return 0;

  let score = 0.6; // unique + low-null
  if (STRONG_KEY_TYPES.includes(column.inferred_type)) score += 0.3;
  if (/_id$|^id$|_no$|_number$/.test(column.name.toLowerCase())) score += 0.1;
  return Number(Math.min(1, score).toFixed(2));
}

export function detectPrimaryKey(
  columns: ReadonlyArray<DiscoveredColumn>,
): string | null {
  const scored: ReadonlyArray<ScoredCandidate> = columns
    .map((column) => Object.freeze({ column, score: scoreColumn(column) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  return top !== undefined ? top.column.name : null;
}

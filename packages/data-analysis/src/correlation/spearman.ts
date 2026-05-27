/**
 * Spearman rank correlation — Pearson r on rank-transformed inputs
 * (with mid-rank ties), valid in the presence of ties.
 *
 * Reference: Spearman, C. (1904). *The proof and measurement of
 * association between two things.* American Journal of Psychology
 * 15(1):72-101. URL: <https://doi.org/10.2307/1412159>.
 * Date checked: 2026-05-27.
 */

import { pearson } from './pearson.js';
import { tiedRanks } from '../util/ranks.js';

export function spearman(
  x: ReadonlyArray<number>,
  y: ReadonlyArray<number>,
): number {
  if (x.length !== y.length) {
    throw new Error('spearman: x and y must have equal length');
  }
  const { ranks: rx } = tiedRanks(x);
  const { ranks: ry } = tiedRanks(y);
  return pearson(rx, ry);
}

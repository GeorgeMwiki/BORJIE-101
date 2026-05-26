/**
 * Phoneme Error Rate (PER) scorer.
 *
 * Classical Levenshtein-edit-distance computation over phoneme
 * sequences. Used to score the agreement between the reference IPA
 * sequence (the "canonical" pronunciation) and the hypothesis (what
 * the user actually produced).
 *
 * Returns the PER as a fraction in [0, +∞) — note PER can exceed 1.0
 * when the hypothesis contains more inserts than the reference has
 * characters. The downstream pipeline clamps this for reporting.
 *
 * Reference: Deepgram PER guide (2025), Wikipedia WER.
 *
 *   PER = (S + D + I) / N
 *
 * where N is the reference phoneme count, S = substitutions, D =
 * deletions, I = insertions.
 */

import type { Phoneme } from '../types.js';

export interface PerScore {
  readonly per: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  readonly referenceCount: number;
}

/**
 * Score the PER between a reference IPA string array and a hypothesis
 * `Phoneme[]` (from the aligner). The hypothesis carries timing + GOP
 * but only the IPA labels are consumed by this function.
 */
export function computePer(
  reference: ReadonlyArray<string>,
  hypothesis: ReadonlyArray<Phoneme>,
): PerScore {
  const hypoIpa: ReadonlyArray<string> = hypothesis.map((p) => p.ipa);
  return computePerOverIpa(reference, hypoIpa);
}

/**
 * Lower-level IPA-only entry point — used when only the labels matter
 * (e.g. when comparing two reference strings during test setup).
 */
export function computePerOverIpa(
  reference: ReadonlyArray<string>,
  hypothesis: ReadonlyArray<string>,
): PerScore {
  const m = reference.length;
  const n = hypothesis.length;

  if (m === 0) {
    return {
      per: n === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: n,
      referenceCount: 0,
    };
  }

  // Standard DP table for Levenshtein with backtrace counters.
  const dp: number[][] = [];
  const back: ('s' | 'd' | 'i' | 'm' | 'init')[][] = [];
  for (let i = 0; i <= m; i += 1) {
    dp.push(new Array(n + 1).fill(0));
    back.push(new Array(n + 1).fill('init'));
  }
  for (let i = 0; i <= m; i += 1) {
    dp[i]![0] = i;
    back[i]![0] = i === 0 ? 'init' : 'd';
  }
  for (let j = 0; j <= n; j += 1) {
    dp[0]![j] = j;
    back[0]![j] = j === 0 ? 'init' : 'i';
  }
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const refChar = reference[i - 1]!;
      const hypChar = hypothesis[j - 1]!;
      if (refChar === hypChar) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
        back[i]![j] = 'm';
        continue;
      }
      const sub = dp[i - 1]![j - 1]! + 1;
      const del = dp[i - 1]![j]! + 1;
      const ins = dp[i]![j - 1]! + 1;
      let best = sub;
      let bestOp: 's' | 'd' | 'i' = 's';
      if (del < best) {
        best = del;
        bestOp = 'd';
      }
      if (ins < best) {
        best = ins;
        bestOp = 'i';
      }
      dp[i]![j] = best;
      back[i]![j] = bestOp;
    }
  }
  let i = m;
  let j = n;
  let s = 0;
  let d = 0;
  let ins = 0;
  while (i > 0 || j > 0) {
    const op = back[i]![j]!;
    if (op === 'm') {
      i -= 1;
      j -= 1;
    } else if (op === 's') {
      s += 1;
      i -= 1;
      j -= 1;
    } else if (op === 'd') {
      d += 1;
      i -= 1;
    } else if (op === 'i') {
      ins += 1;
      j -= 1;
    } else {
      break;
    }
  }
  return {
    per: (s + d + ins) / m,
    substitutions: s,
    deletions: d,
    insertions: ins,
    referenceCount: m,
  };
}

/**
 * Cleanlab-style noise detection on a label set.
 *
 * Flags labels that disagree with the consensus across multiple
 * oracles for the same caseId. Useful for re-routing dubious labels
 * back through human review.
 */
import type { Label, UncertainCase } from '../types.js';

export interface DetectNoiseArgs<T = unknown> {
  readonly labels: ReadonlyArray<Label<T>>;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Returns the noisy labels — those whose value disagrees with the
 * majority for their caseId.
 */
export function detectNoisyLabels<T = unknown>(
  args: DetectNoiseArgs<T>,
): ReadonlyArray<Label<T>> {
  const byCase = new Map<string, Label<T>[]>();
  for (const l of args.labels) {
    const arr = byCase.get(l.caseId);
    if (arr) arr.push(l);
    else byCase.set(l.caseId, [l]);
  }
  const noisy: Label<T>[] = [];
  for (const [, arr] of byCase) {
    if (arr.length < 2) continue;
    // Find the majority value (first value with highest count).
    const counts = new Map<string, { value: T; count: number }>();
    for (const l of arr) {
      const k = JSON.stringify(l.value);
      const prior = counts.get(k);
      if (prior) prior.count += 1;
      else counts.set(k, { value: l.value, count: 1 });
    }
    let majority = arr[0]?.value as T;
    let max = 0;
    for (const [, v] of counts) {
      if (v.count > max) {
        max = v.count;
        majority = v.value;
      }
    }
    for (const l of arr) {
      if (!deepEqual(l.value, majority)) noisy.push(l);
    }
  }
  return noisy;
}

/**
 * Convert noisy labels back into UncertainCase entries so they can be
 * re-flagged for human review.
 */
export function noisyLabelsToCases<T = unknown>(
  noisy: ReadonlyArray<Label<T>>,
): ReadonlyArray<UncertainCase<T>> {
  return noisy.map((l) => ({
    id: l.caseId,
    prediction: {
      id: l.caseId,
      value: l.value,
      confidence: l.oracleConfidence ?? 0.5,
      input: {},
    },
    gap: 1 - (l.oracleConfidence ?? 0.5),
    reason: 'noisy_label' as const,
  }));
}

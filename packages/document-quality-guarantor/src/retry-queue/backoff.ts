/**
 * Backoff helpers — pure, deterministic-when-jitter-is-zero, easy to
 * reason about. Kept in their own file so they're trivially unit-
 * testable without spinning the queue.
 */

import type { RetryPolicy } from '../types.js';

export function nextDelayMs(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  // attempt is 1-based: attempt=1 → baseDelay; attempt=2 → baseDelay*multiplier; …
  const exponent = Math.max(0, attempt - 1);
  const base = policy.baseDelayMs * Math.pow(policy.multiplier, exponent);
  const jitterSpan = base * policy.jitterRatio;
  // Centered jitter in [-jitterSpan/2, +jitterSpan/2].
  const jitter = (random() - 0.5) * jitterSpan;
  return Math.max(0, Math.round(base + jitter));
}

export function expectedSeries(policy: RetryPolicy): ReadonlyArray<number> {
  const out: number[] = [];
  for (let i = 1; i <= policy.maxAttempts; i += 1) {
    out.push(policy.baseDelayMs * Math.pow(policy.multiplier, i - 1));
  }
  return Object.freeze(out);
}

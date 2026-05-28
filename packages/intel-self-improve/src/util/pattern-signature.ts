/**
 * `patternSignature` — sha256-truncated fingerprint of a canonical-
 * JSON projection of an intel call's input. Used by the wrapper to
 * tick `intel_skill_traces.success_count` / `failure_count` for the
 * matching pattern.
 *
 * Truncated to 16 hex chars (64 bits) — collision probability for
 * 10^9 patterns is ≈ 1 / 36 billion, well below the noise floor of
 * the success/failure counter.
 *
 * @module @borjie/intel-self-improve/util/pattern-signature
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

export function patternSignature(
  seed: Readonly<Record<string, unknown>>,
): string {
  const json = canonicalJson(seed);
  const hash = createHash('sha256').update(json).digest('hex');
  return hash.slice(0, 16);
}

/**
 * Canary-token leak detector.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4
 *
 * On leak: refuse + alert + revoke session (orchestration done by the
 * runtime-defense-composer; this module is the pure detector).
 */

import { type CanaryDetectionResult, type CanaryToken } from './types.js';

/**
 * Detect whether the LLM's response contains the canary string.
 *
 * Direct exact-match scan against the canary value. Returns position
 * (or -1) and a structured result. The scan is case-sensitive — the
 * canary itself is fixed-case so this is safe.
 */
export function detectCanaryLeak(response: string, canary: CanaryToken): CanaryDetectionResult {
  const position = response.indexOf(canary.value);
  const leaked = position >= 0;
  return Object.freeze({
    leaked,
    canary,
    position,
    reason: leaked
      ? `canary value present in response at offset ${String(position)}`
      : 'canary value not detected',
  });
}

/**
 * Detect leakage of ANY canary from a set (rotation-aware). Useful when
 * we have grace-period overlap between an old and new canary.
 */
export function detectAnyCanaryLeak(
  response: string,
  canaries: readonly CanaryToken[]
): CanaryDetectionResult | null {
  for (const c of canaries) {
    const r = detectCanaryLeak(response, c);
    if (r.leaked) return r;
  }
  return null;
}

/**
 * Heuristic — also detect partial-canary leaks (first 8 chars after the
 * prefix). Catches base64-encoded or otherwise mangled exfiltration.
 */
export function detectPartialCanaryLeak(
  response: string,
  canary: CanaryToken
): CanaryDetectionResult {
  // Take the nonce (16-char hex/upper) — high entropy, unlikely to false-positive
  if (canary.nonce.length < 8) {
    return detectCanaryLeak(response, canary);
  }
  const fingerprint = canary.nonce;
  const position = response.indexOf(fingerprint);
  const leaked = position >= 0;
  return Object.freeze({
    leaked,
    canary,
    position,
    reason: leaked
      ? `canary nonce-fingerprint present at offset ${String(position)}`
      : 'canary nonce-fingerprint not detected',
  });
}

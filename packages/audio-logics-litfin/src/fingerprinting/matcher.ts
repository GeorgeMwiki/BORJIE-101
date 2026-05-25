/**
 * Fingerprint matching.
 *
 * Two-step compare:
 *   1. Hash equality → 1.0 confidence, instant match.
 *   2. Otherwise hamming distance over the decoded compact signature.
 *      Distance is normalised by length → confidence = 1 - normDist.
 */

import { createHash } from 'node:crypto';
import { AudioLogicsLitfinError, type AudioFingerprint, type FingerprintMatchResult } from '../types.js';

export interface MatchOptions {
  /** Confidence required to declare a match. Defaults to 0.85. */
  readonly threshold?: number;
}

/**
 * Compare two fingerprints and return a match decision + confidence.
 *
 * @throws AudioLogicsLitfinError when signatures are unparsable.
 */
export function matchFingerprint(
  a: AudioFingerprint,
  b: AudioFingerprint,
  options: MatchOptions = {},
): FingerprintMatchResult {
  const threshold = options.threshold ?? 0.85;
  if (threshold < 0 || threshold > 1) {
    throw new AudioLogicsLitfinError(
      `threshold must be in [0,1]; got ${threshold}`,
      'fingerprint-bad-threshold',
    );
  }

  if (a.hash === b.hash) {
    return {
      matched: true,
      confidence: 1,
      hammingDistance: 0,
      thresholdUsed: threshold,
    };
  }

  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a.compactSignature, 'base64');
    bufB = Buffer.from(b.compactSignature, 'base64');
  } catch (cause) {
    throw new AudioLogicsLitfinError(
      'failed to decode compactSignature',
      'fingerprint-decode',
      cause,
    );
  }

  const minLen = Math.min(bufA.length, bufB.length);
  const maxLen = Math.max(bufA.length, bufB.length);
  if (maxLen === 0) {
    return { matched: false, confidence: 0, hammingDistance: 0, thresholdUsed: threshold };
  }

  let hammingDistance = 0;
  for (let i = 0; i < minLen; i++) {
    const xor = (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
    // popcount on a byte (Brian Kernighan).
    let v = xor;
    while (v) {
      v &= v - 1;
      hammingDistance++;
    }
  }
  // Penalise length difference — each missing byte counts as 4 bits flipped.
  hammingDistance += (maxLen - minLen) * 4;

  const maxPossibleBits = maxLen * 8;
  const normalisedDistance = maxPossibleBits === 0 ? 1 : hammingDistance / maxPossibleBits;
  const confidence = Math.max(0, 1 - normalisedDistance);

  return {
    matched: confidence >= threshold,
    confidence,
    hammingDistance,
    thresholdUsed: threshold,
  };
}

/**
 * Tamper detection — returns true if the fingerprint's compactSignature
 * fails to round-trip to the stored hash. Useful as an audit gate before
 * trusting an evidence claim that references a fingerprint id.
 */
export function detectTampering(fingerprint: AudioFingerprint): boolean {
  let buf: Buffer;
  try {
    buf = Buffer.from(fingerprint.compactSignature, 'base64');
  } catch {
    return true;
  }
  if (buf.length === 0) {
    return true;
  }
  const recomputed = createHash('sha256').update(buf).digest('hex');
  return recomputed !== fingerprint.hash;
}

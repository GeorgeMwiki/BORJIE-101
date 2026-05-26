/**
 * Phoneme aligner — port + per-tenant baseline builder.
 *
 * The forced-alignment driver is supplied via `PhonemeAlignerPort`
 * (defined in `../types.ts`). The reference production implementation
 * wraps Montreal Forced Aligner (MFA, Read-the-Docs 3.X), but the
 * package itself ships no MFA binding — that lives in the downstream
 * 19H wave where the binary toolchain is acceptable.
 *
 * Beyond the port, this module provides the **baseline builder**:
 * given a stream of utterances from one user it produces the
 * `GopBaseline` map (mean, std, samples per IPA phoneme) consumed by
 * the prosody-controller to bias TTS output toward the user's
 * pronunciation.
 */

import type { GopBaseline, Phoneme } from '../types.js';

/**
 * Aggregate one or more utterances' phoneme arrays into a per-IPA
 * `GopBaseline` map. The mean and stddev are sample (n-1) statistics;
 * a phoneme with only one sample reports stddev 0.
 */
export function buildBaseline(
  phonemeStreams: ReadonlyArray<ReadonlyArray<Phoneme>>,
): Readonly<Record<string, GopBaseline>> {
  // Collect per-IPA samples in temporary mutable buckets.
  const buckets = new Map<string, number[]>();
  for (const stream of phonemeStreams) {
    for (const p of stream) {
      const bucket = buckets.get(p.ipa);
      if (bucket === undefined) {
        buckets.set(p.ipa, [p.gop]);
      } else {
        bucket.push(p.gop);
      }
    }
  }
  const out: Record<string, GopBaseline> = {};
  for (const [ipa, samples] of buckets.entries()) {
    out[ipa] = summarise(samples);
  }
  return Object.freeze(out);
}

function summarise(samples: ReadonlyArray<number>): GopBaseline {
  const n = samples.length;
  if (n === 0) {
    return { gopMean: 0, gopStd: 0, samples: 0 };
  }
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / n;
  if (n === 1) {
    return { gopMean: mean, gopStd: 0, samples: 1 };
  }
  let sqSum = 0;
  for (const s of samples) {
    const d = s - mean;
    sqSum += d * d;
  }
  const std = Math.sqrt(sqSum / (n - 1));
  return { gopMean: mean, gopStd: std, samples: n };
}

/**
 * Merge an incoming baseline delta into the existing baseline. Used
 * by the user-profile manager to update the baseline after each
 * captured utterance without recomputing from scratch.
 *
 * The combined mean and stddev follow Welford's online algorithm
 * (the version reformulated for two pre-aggregated populations).
 */
export function mergeBaseline(
  base: Readonly<Record<string, GopBaseline>>,
  delta: Readonly<Record<string, GopBaseline>>,
): Readonly<Record<string, GopBaseline>> {
  const out: Record<string, GopBaseline> = { ...base };
  for (const [ipa, d] of Object.entries(delta)) {
    const b = out[ipa];
    if (b === undefined) {
      out[ipa] = d;
      continue;
    }
    out[ipa] = mergePair(b, d);
  }
  return Object.freeze(out);
}

function mergePair(a: GopBaseline, b: GopBaseline): GopBaseline {
  const nA = a.samples;
  const nB = b.samples;
  const n = nA + nB;
  if (n === 0) {
    return { gopMean: 0, gopStd: 0, samples: 0 };
  }
  const meanA = a.gopMean;
  const meanB = b.gopMean;
  const mean = (meanA * nA + meanB * nB) / n;
  // Variance combination (sample-variance):
  //   M2 = (nA - 1) * varA + (nB - 1) * varB + delta^2 * nA * nB / n
  if (n === 1) {
    return { gopMean: mean, gopStd: 0, samples: 1 };
  }
  const varA = nA > 1 ? a.gopStd * a.gopStd : 0;
  const varB = nB > 1 ? b.gopStd * b.gopStd : 0;
  const dlt = meanB - meanA;
  const m2 = (nA - 1) * varA + (nB - 1) * varB + (dlt * dlt * nA * nB) / n;
  const variance = m2 / (n - 1);
  return { gopMean: mean, gopStd: Math.sqrt(Math.max(0, variance)), samples: n };
}

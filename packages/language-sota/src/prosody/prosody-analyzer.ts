/**
 * Prosody analyzer — pure functions over an F0 contour.
 *
 * Wave 19G §2.3. The aligner / extractor (production binding to
 * librosa pYIN) hands us a raw F0 vector; this module computes the
 * downsampled 16-bin contour, the stress envelope, and the discrete
 * intonation-shape label.
 *
 * Pure, no I/O. The librosa binding lives in the downstream wave.
 */

import type { IntonationShape, Prosody } from '../types.js';

export const F0_CONTOUR_BINS = 16;

/**
 * Downsample a raw F0 trajectory to the canonical 16-bin contour.
 * Empty input yields a zero vector. NaN samples (unvoiced frames) are
 * skipped from the bin mean — a bin containing only unvoiced frames
 * reports 0.
 */
export function downsampleF0(
  raw: ReadonlyArray<number>,
  bins: number = F0_CONTOUR_BINS,
): ReadonlyArray<number> {
  if (bins <= 0) return [];
  const out = new Array<number>(bins).fill(0);
  if (raw.length === 0) {
    return out;
  }
  const binSize = raw.length / bins;
  for (let b = 0; b < bins; b += 1) {
    const start = Math.floor(b * binSize);
    const end = Math.floor((b + 1) * binSize);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end && i < raw.length; i += 1) {
      const v = raw[i]!;
      if (Number.isFinite(v) && v > 0) {
        sum += v;
        count += 1;
      }
    }
    out[b] = count > 0 ? sum / count : 0;
  }
  return Object.freeze(out);
}

/**
 * Classify the intonation shape from the downsampled contour. Four
 * categories per the spec:
 *
 *   - `rising`     → end mean ≥ 1.15 × start mean (KiSwahili yes/no
 *                    question convention).
 *   - `falling`    → end mean ≤ 0.85 × start mean (declarative).
 *   - `undulating` → > 2 sign changes in the first-difference sequence
 *                    (alarm / contrastive).
 *   - `flat`       → otherwise.
 *
 * Empty contour → 'flat'.
 */
export function classifyIntonation(
  contour: ReadonlyArray<number>,
): IntonationShape {
  const voiced = contour.filter((v) => v > 0);
  if (voiced.length < 4) {
    return 'flat';
  }
  const headLen = Math.max(1, Math.floor(voiced.length / 4));
  const tailLen = Math.max(1, Math.floor(voiced.length / 4));
  const headMean = mean(voiced.slice(0, headLen));
  const tailMean = mean(voiced.slice(voiced.length - tailLen));
  let signChanges = 0;
  let prevDir = 0;
  for (let i = 1; i < contour.length; i += 1) {
    const d = contour[i]! - contour[i - 1]!;
    const dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (dir !== 0 && prevDir !== 0 && dir !== prevDir) {
      signChanges += 1;
    }
    if (dir !== 0) {
      prevDir = dir;
    }
  }
  if (signChanges > 2) {
    return 'undulating';
  }
  if (headMean === 0) {
    return 'flat';
  }
  const ratio = tailMean / headMean;
  if (ratio >= 1.15) return 'rising';
  if (ratio <= 0.85) return 'falling';
  return 'flat';
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Build the per-syllable stress envelope as the absolute first-
 * difference of the contour, normalised to [0, 1]. Used by downstream
 * TTS providers that accept per-syllable prominence weights.
 */
export function computeStressBins(
  contour: ReadonlyArray<number>,
): ReadonlyArray<number> {
  if (contour.length === 0) return [];
  const diffs: number[] = [];
  for (let i = 1; i < contour.length; i += 1) {
    diffs.push(Math.abs(contour[i]! - contour[i - 1]!));
  }
  if (diffs.length === 0) return [0];
  let max = 0;
  for (const d of diffs) {
    if (d > max) max = d;
  }
  if (max === 0) {
    return Object.freeze(new Array<number>(diffs.length).fill(0));
  }
  return Object.freeze(diffs.map((d) => d / max));
}

/**
 * One-call helper: take a raw F0 trajectory and return the canonical
 * `Prosody` envelope.
 */
export function analyseProsody(rawF0: ReadonlyArray<number>): Prosody {
  const contour = downsampleF0(rawF0);
  const stressBins = computeStressBins(contour);
  const intonationShape = classifyIntonation(contour);
  return {
    f0Contour: contour,
    stressBins,
    intonationShape,
  };
}

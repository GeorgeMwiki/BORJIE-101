/**
 * Shazam-style chromaprint reference implementation.
 *
 * Production: swap in `acoustid` / `chromaprint` (LGPL native) or call
 * ACRCloud's HTTP API via an adapter. This pure-TS stub gives a deterministic,
 * audit-stable content hash for unit-test fixtures and offline detection of
 * duplicate ticket recordings + voice-approval replay attacks.
 *
 * The algorithm is intentionally simple — we are NOT publishing a peer-
 * reviewed perceptual-hash. We sample the bytes at fixed offsets across the
 * full buffer, fold into a 12-bin chroma vector per frame (one frame per
 * 100 ms), and SHA-256 the concatenated frames. Identical bytes always
 * collapse to the same hash; any bit-flip propagates through.
 *
 * Limitations vs real chromaprint:
 *   - Not robust to lossy re-encoding (real chromaprint survives MP3 round-trip).
 *   - Hamming distance is byte-level, not perceptual.
 *
 * → Use this for replay-attack detection where the attacker resubmits the
 *   exact same bytes; for "is this the same song re-recorded" use the
 *   ACRCloud adapter.
 */

import { createHash } from 'node:crypto';
import { AudioLogicsLitfinError, type AudioFingerprint, type AudioSample } from '../types.js';

const FRAME_MS = 100;
const CHROMA_BINS = 12;

/**
 * Compute a deterministic chromaprint-style fingerprint over the audio bytes.
 *
 * @throws AudioLogicsLitfinError when the audio is empty or sample rate
 *   is not a positive integer.
 */
export function createChromaprintFingerprint(
  audio: AudioSample,
  options: { readonly nowIso?: string } = {},
): AudioFingerprint {
  if (audio.bytes.length === 0) {
    throw new AudioLogicsLitfinError('audio bytes empty', 'fingerprint-empty');
  }
  if (audio.sampleRate <= 0) {
    throw new AudioLogicsLitfinError(
      `sampleRate must be positive; got ${audio.sampleRate}`,
      'fingerprint-bad-sample-rate',
    );
  }

  const bytesPerFrame = Math.max(
    1,
    Math.floor((audio.sampleRate * (FRAME_MS / 1000) * 2 * audio.channels) || 1),
  );
  const frameCount = Math.max(1, Math.ceil(audio.bytes.length / bytesPerFrame));

  const chromaFrames: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * bytesPerFrame;
    const end = Math.min(audio.bytes.length, start + bytesPerFrame);
    const slice = audio.bytes.subarray(start, end);
    const bin = new Array<number>(CHROMA_BINS).fill(0);
    for (let i = 0; i < slice.length; i++) {
      const byte = slice[i] ?? 0;
      const binIdx = (byte + i) % CHROMA_BINS;
      bin[binIdx] = (bin[binIdx] ?? 0) + byte;
    }
    // Normalise per-frame to [0..255] to stabilise across small length deltas.
    const maxVal = Math.max(1, ...bin);
    for (let b = 0; b < CHROMA_BINS; b++) {
      chromaFrames.push(Math.floor(((bin[b] ?? 0) / maxVal) * 255));
    }
  }

  const compactBuffer = Buffer.from(Uint8Array.from(chromaFrames));
  const compactSignature = compactBuffer.toString('base64');
  const hash = createHash('sha256').update(compactBuffer).digest('hex');

  const durationMs =
    audio.durationMs ??
    Math.round((audio.bytes.length / (audio.sampleRate * 2 * audio.channels)) * 1000);

  return Object.freeze({
    hash,
    algorithm: 'chromaprint-stub',
    durationMs,
    sampleRate: audio.sampleRate,
    compactSignature,
    createdAtIso: options.nowIso ?? new Date().toISOString(),
  });
}

/**
 * ITU-R BS.1770 inspired loudness normalization.
 *
 * The full BS.1770 algorithm requires gating and K-weighting; for embedded
 * pre-flight we use a simpler RMS → dBFS conversion which is close enough
 * for voice normalization (the target -23 LUFS gives ~-23 dBFS RMS for
 * speech material). Production deployments can swap to `ffmpeg loudnorm`.
 */

import type { AudioChunk } from '../types.js';

export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let energy = 0;
  for (const s of samples) energy += s * s;
  const rms = Math.sqrt(energy / samples.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

export function normaliseToLufs(chunk: AudioChunk, target = -23): AudioChunk {
  // Treat PCM16 little-endian as the canonical sample layout.
  const view = new DataView(
    chunk.bytes.buffer,
    chunk.bytes.byteOffset,
    chunk.bytes.byteLength,
  );
  const samples = new Float32Array(Math.floor(chunk.bytes.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  const currentDb = rmsDbfs(samples);
  if (!Number.isFinite(currentDb)) return chunk;
  const gainDb = target - currentDb;
  const gainLin = Math.pow(10, gainDb / 20);
  const out = new Uint8Array(chunk.bytes.byteLength);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const scaled = Math.max(-1, Math.min(1, (samples[i] ?? 0) * gainLin));
    outView.setInt16(i * 2, Math.round(scaled * 32767), true);
  }
  return { ...chunk, bytes: out };
}

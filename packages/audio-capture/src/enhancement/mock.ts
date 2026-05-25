/**
 * Mock enhancement.
 *
 * - `denoise` zero-crosses anything below the noise floor (10% amplitude).
 * - `normalize` runs BS.1770-style RMS normalization.
 * - `dereverb` applies a one-pole high-pass IIR (`y = x - prev`) as a placeholder.
 * - `all` chains all three.
 */

import type { AudioChunk, EnhancementSpec } from '../types.js';
import { normaliseToLufs } from './loudness.js';
import type { EnhancementPort } from './index.js';

export function createMockEnhancement(): EnhancementPort {
  const enhance = async (spec: EnhancementSpec): Promise<AudioChunk> => {
    let chunk = spec.audio;
    if (spec.target === 'denoise' || spec.target === 'all') {
      chunk = denoise(chunk);
    }
    if (spec.target === 'dereverb' || spec.target === 'all') {
      chunk = dereverb(chunk);
    }
    if (spec.target === 'normalize' || spec.target === 'all') {
      chunk = normaliseToLufs(chunk, spec.targetLoudnessLUFS ?? -23);
    }
    return chunk;
  };
  return { provider: 'mock-enhance', enhance };
}

function denoise(chunk: AudioChunk): AudioChunk {
  const view = new DataView(
    chunk.bytes.buffer,
    chunk.bytes.byteOffset,
    chunk.bytes.byteLength,
  );
  const out = new Uint8Array(chunk.bytes.byteLength);
  const outView = new DataView(out.buffer);
  const noiseFloor = Math.round(0.1 * 32767);
  for (let i = 0; i + 1 < chunk.bytes.byteLength; i += 2) {
    const sample = view.getInt16(i, true);
    outView.setInt16(i, Math.abs(sample) < noiseFloor ? 0 : sample, true);
  }
  return { ...chunk, bytes: out };
}

function dereverb(chunk: AudioChunk): AudioChunk {
  const view = new DataView(
    chunk.bytes.buffer,
    chunk.bytes.byteOffset,
    chunk.bytes.byteLength,
  );
  const out = new Uint8Array(chunk.bytes.byteLength);
  const outView = new DataView(out.buffer);
  let prev = 0;
  for (let i = 0; i + 1 < chunk.bytes.byteLength; i += 2) {
    const sample = view.getInt16(i, true);
    const filtered = sample - Math.round(prev * 0.8);
    outView.setInt16(i, Math.max(-32768, Math.min(32767, filtered)), true);
    prev = sample;
  }
  return { ...chunk, bytes: out };
}

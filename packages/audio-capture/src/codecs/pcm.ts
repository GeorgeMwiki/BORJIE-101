/**
 * PCM helpers — conversion + resampling.
 *
 * `resampleAudio` supports two modes:
 *   - 'linear' (default): interpolated nearest-neighbour, cheap, good enough
 *     for VAD / speech routing.
 *   - 'sinc': windowed-sinc kernel, higher fidelity, slower.
 *
 * Both work over Float32 sample buffers so callers compose with
 * `pcm16ToFloat32` and `float32ToPcm16`.
 */

export function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

export function float32ToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}

export type ResampleMode = 'linear' | 'sinc';

export function resampleAudio(
  input: Float32Array,
  fromRate: number,
  toRate: number,
  mode: ResampleMode = 'linear',
): Float32Array {
  if (fromRate === toRate) return Float32Array.from(input);
  if (toRate <= 0 || fromRate <= 0) {
    throw new Error('sample rates must be positive');
  }
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  if (mode === 'linear') {
    for (let i = 0; i < outLen; i += 1) {
      const srcIdx = i * ratio;
      const lower = Math.floor(srcIdx);
      const upper = Math.min(lower + 1, input.length - 1);
      const t = srcIdx - lower;
      out[i] = (input[lower] ?? 0) * (1 - t) + (input[upper] ?? 0) * t;
    }
    return out;
  }
  // sinc — Hann-windowed, 8-tap.
  const half = 4;
  for (let i = 0; i < outLen; i += 1) {
    const srcIdx = i * ratio;
    let sum = 0;
    let weight = 0;
    for (let k = -half; k <= half; k += 1) {
      const idx = Math.round(srcIdx) + k;
      if (idx < 0 || idx >= input.length) continue;
      const x = srcIdx - idx;
      const w = sinc(x) * hann(x, half);
      sum += (input[idx] ?? 0) * w;
      weight += w;
    }
    out[i] = weight === 0 ? 0 : sum / weight;
  }
  return out;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const piX = Math.PI * x;
  return Math.sin(piX) / piX;
}

function hann(x: number, half: number): number {
  if (Math.abs(x) > half) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * x) / half));
}

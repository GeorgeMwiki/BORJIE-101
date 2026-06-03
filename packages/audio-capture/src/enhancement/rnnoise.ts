/**
 * RNNoise denoise stage (LP-27).
 *
 * A lightweight, CPU-only speech denoiser that sits BEHIND the existing Krisp
 * adapter as a cheaper first-pass / offline fallback. RNNoise (Xiph) is a
 * tiny RNN that runs on 480-sample (10ms @ 48kHz) frames and needs no GPU or
 * network — ideal for low-bandwidth mining sites and air-gapped tenants where
 * the Krisp REST round-trip is unavailable or too slow.
 *
 * The adapter satisfies the same `EnhancementPort` as Krisp/Resemble, so
 * callers swap with a single factory change, or chain them (RNNoise first,
 * Krisp for the hard cases).
 *
 * The real RNNoise inference is a WASM module loaded through an injected
 * `RnnoiseModule` port. When none is supplied, the adapter applies a
 * deterministic, dependency-free spectral noise-gate so the stage is always
 * usable in tests + offline. TODO(LP-27): wire the `@jitsi/rnnoise-wasm`
 * binding behind `RnnoiseModule` once the WASM asset is bundled.
 *
 * @module @borjie/audio-capture/enhancement/rnnoise
 */

import { AudioCaptureError, type AudioChunk, type EnhancementSpec } from '../types.js';
import type { EnhancementPort } from './index.js';

/**
 * Injected RNNoise WASM module. The host binds this to a real RNNoise build;
 * `process(frame)` consumes a Float32 frame in [-1,1] and returns the
 * denoised frame (same length).
 */
export interface RnnoiseModule {
  /** Frame size the model expects (RNNoise: 480 samples). */
  readonly frameSize: number;
  process(frame: Float32Array): Float32Array;
}

export interface RnnoiseAdapterOptions {
  /** Real WASM model. Omit to use the deterministic noise-gate fallback. */
  readonly module?: RnnoiseModule;
  /**
   * Noise-gate threshold (linear amplitude 0..1) for the fallback path.
   * Samples whose short-window RMS is below this are attenuated. Default 0.02.
   */
  readonly gateThreshold?: number;
}

const DEFAULT_GATE_THRESHOLD = 0.02;
const FALLBACK_WINDOW = 160; // 10ms @ 16kHz

/**
 * Build an RNNoise enhancement adapter. Only acts on `denoise` / `all`
 * targets; other targets pass the audio through unchanged so it can be
 * chained safely in an enhancement pipeline.
 */
export function createRnnoiseAdapter(options: RnnoiseAdapterOptions = {}): EnhancementPort {
  const gateThreshold = options.gateThreshold ?? DEFAULT_GATE_THRESHOLD;

  const enhance = async (spec: EnhancementSpec): Promise<AudioChunk> => {
    if (spec.target !== 'denoise' && spec.target !== 'all') {
      return spec.audio;
    }
    if (spec.audio.format !== 'pcm' && spec.audio.format !== 'wav') {
      // RNNoise operates on raw PCM frames; refuse compressed formats rather
      // than silently corrupting them. Callers decode upstream.
      throw new AudioCaptureError(
        `rnnoise requires pcm/wav input, got ${spec.audio.format}`,
        'UNSUPPORTED_FORMAT',
      );
    }

    const samples = pcm16ToFloat(spec.audio.bytes);
    const denoised = options.module
      ? runWasm(options.module, samples)
      : runNoiseGate(samples, gateThreshold);
    return { ...spec.audio, bytes: floatToPcm16(denoised) };
  };

  return { provider: options.module ? 'rnnoise-wasm' : 'rnnoise-gate-fallback', enhance };
}

// ----------------------------------------------------------------------------
// WASM path
// ----------------------------------------------------------------------------

function runWasm(module: RnnoiseModule, samples: Float32Array): Float32Array {
  const frameSize = module.frameSize > 0 ? module.frameSize : 480;
  const out = new Float32Array(samples.length);
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(samples.length, offset + frameSize);
    const frame = samples.subarray(offset, end);
    // Pad a short trailing frame so the model always sees frameSize samples.
    const input = frame.length === frameSize ? frame : padFrame(frame, frameSize);
    const processed = module.process(input);
    out.set(processed.subarray(0, end - offset), offset);
  }
  return out;
}

function padFrame(frame: Float32Array, frameSize: number): Float32Array {
  const padded = new Float32Array(frameSize);
  padded.set(frame);
  return padded;
}

// ----------------------------------------------------------------------------
// Deterministic fallback: short-window RMS noise gate
// ----------------------------------------------------------------------------

/**
 * Attenuate low-energy windows (background hiss / room tone) while leaving
 * speech-energy windows intact. Deterministic, dependency-free — good enough
 * to verify the pipeline and to give offline tenants a real first-pass.
 */
function runNoiseGate(samples: Float32Array, threshold: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let start = 0; start < samples.length; start += FALLBACK_WINDOW) {
    const end = Math.min(samples.length, start + FALLBACK_WINDOW);
    let sumSq = 0;
    for (let i = start; i < end; i += 1) {
      const v = samples[i] ?? 0;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - start));
    // Below threshold: heavy attenuation. Above: pass through.
    const gain = rms < threshold ? 0.1 : 1;
    for (let i = start; i < end; i += 1) {
      out[i] = (samples[i] ?? 0) * gain;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// PCM16 <-> Float32 helpers
// ----------------------------------------------------------------------------

function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = Math.max(-1, Math.min(1, view.getInt16(i * 2, true) / 32768));
  }
  return out;
}

function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}

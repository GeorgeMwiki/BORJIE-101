/**
 * Silero VAD port — production wraps `onnxruntime-node` and the Silero v5
 * VAD model. We expose an injection seam (`runner`) so tests can supply a
 * deterministic stub and the package stays dependency-free.
 *
 * Audio expected: 16 kHz mono PCM in 32 ms frames (512 samples).
 */

import type { AudioChunk, VADResult } from '../types.js';
import { pruneUndefined } from '../_internal/bytes.js';
import type { VADPort } from './index.js';

export interface SileroVADRunner {
  (input: Float32Array, sampleRate: number): Promise<number>;
}

export interface SileroVADOptions {
  readonly modelPath: string;
  readonly runner?: SileroVADRunner;
  readonly threshold?: number;
}

export function createSileroVAD(options: SileroVADOptions): VADPort {
  const threshold = options.threshold ?? 0.5;
  const runner =
    options.runner ??
    (async (input) => {
      // Default heuristic when no ONNX runner is wired: energy-based.
      let energy = 0;
      for (const s of input) energy += s * s;
      const rms = Math.sqrt(energy / Math.max(input.length, 1));
      return Math.min(1, rms * 4);
    });

  const detect = async (chunk: AudioChunk): Promise<VADResult> => {
    const samples = pcmToFloat32(chunk);
    const probability = await runner(samples, chunk.sampleRate);
    return pruneUndefined({
      isSpeech: probability >= threshold,
      probability,
      chunkSequence: chunk.sequence,
    }) as VADResult;
  };

  const streamDetect = async function* (
    audio: AsyncIterable<AudioChunk>,
  ): AsyncIterable<VADResult> {
    for await (const chunk of audio) {
      yield await detect(chunk);
    }
  };

  return { provider: `silero(${options.modelPath})`, detect, streamDetect };
}

function pcmToFloat32(chunk: AudioChunk): Float32Array {
  if (chunk.format !== 'pcm' && chunk.format !== 'wav') {
    // Best-effort fallback: treat bytes as PCM16 little-endian.
  }
  const view = new DataView(
    chunk.bytes.buffer,
    chunk.bytes.byteOffset,
    chunk.bytes.byteLength,
  );
  const out = new Float32Array(Math.floor(chunk.bytes.byteLength / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

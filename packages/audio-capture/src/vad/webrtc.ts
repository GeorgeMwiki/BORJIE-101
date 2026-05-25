/**
 * WebRTC VAD — bundled with browsers via the `Web Audio API` AudioWorklet,
 * but we ship an aggressive-energy stub here so the package has zero runtime
 * deps. The signature matches Google's libfvad: `aggressiveness ∈ {0..3}`.
 *
 * For a real deployment, host this in an AudioWorklet that calls into a
 * libfvad WASM build; the JS contract is identical so swapping is free.
 */

import type { AudioChunk, VADResult } from '../types.js';
import { pruneUndefined } from '../_internal/bytes.js';
import type { VADPort } from './index.js';

export interface WebRTCVADOptions {
  /** 0 (least aggressive) … 3 (most aggressive). */
  readonly aggressiveness?: 0 | 1 | 2 | 3;
}

export function createWebRTCVAD(options: WebRTCVADOptions = {}): VADPort {
  const aggressiveness = options.aggressiveness ?? 1;
  // Higher aggressiveness ⇒ higher RMS threshold to declare speech.
  const thresholdMap: Record<number, number> = {
    0: 0.005,
    1: 0.015,
    2: 0.025,
    3: 0.04,
  };
  const threshold = thresholdMap[aggressiveness] ?? 0.015;

  const detect = (chunk: AudioChunk): VADResult => {
    const samples = pcmToFloat32(chunk);
    let energy = 0;
    for (const s of samples) energy += s * s;
    const rms = Math.sqrt(energy / Math.max(samples.length, 1));
    const probability = Math.min(1, rms / Math.max(threshold * 2, 0.0001));
    return pruneUndefined({
      isSpeech: rms >= threshold,
      probability,
      chunkSequence: chunk.sequence,
    }) as VADResult;
  };

  const streamDetect = async function* (
    audio: AsyncIterable<AudioChunk>,
  ): AsyncIterable<VADResult> {
    for await (const chunk of audio) {
      yield detect(chunk);
    }
  };

  return { provider: `webrtc-vad(${aggressiveness})`, detect, streamDetect };
}

function pcmToFloat32(chunk: AudioChunk): Float32Array {
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

/**
 * VAD (voice activity detection) port.
 *
 * Concrete impls (Silero, WebRTC, Pyannote) are injected at the host
 * boundary. The port returns either `null` (no voice in this frame —
 * pipeline must NOT proceed) or a `VadHit` describing the speech span.
 *
 * Reference docs:
 *   - Silero VAD          https://github.com/snakers4/silero-vad
 *   - WebRTC VAD          https://webrtc.org/getting-started/media-devices
 *   - Pyannote VAD        https://huggingface.co/pyannote/voice-activity-detection
 *
 * The accompanying `noop-vad.ts` is for tests + hermetic CI runs; it
 * NEVER ships to production unless explicitly wired in by the host.
 */

export {
  type VadPort,
  type VadHit,
} from '../types.js';

import type { AudioPayload, VadHit, VadPort } from '../types.js';

/**
 * No-op VAD — returns a fixed hit. ONLY for tests; the production
 * pipeline must inject a real Silero/WebRTC/Pyannote impl.
 */
export function createNoopVad(hit?: Partial<VadHit>): VadPort {
  return {
    detect(_audio: AudioPayload): Promise<VadHit | null> {
      const merged: VadHit = {
        start_ms: hit?.start_ms ?? 0,
        end_ms: hit?.end_ms ?? 1000,
        confidence: hit?.confidence ?? 0.95,
      };
      return Promise.resolve(merged);
    },
  };
}

/**
 * VAD that always rejects — useful for testing the silent-disable
 * path when there is no voice in the frame.
 */
export function createSilentVad(): VadPort {
  return {
    detect(_audio: AudioPayload): Promise<VadHit | null> {
      return Promise.resolve(null);
    },
  };
}

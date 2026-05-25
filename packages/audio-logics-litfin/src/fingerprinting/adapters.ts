/**
 * Adapter ports for production fingerprinting providers.
 *
 * The pure-TS chromaprint stub in `chromaprint.ts` is good enough for
 * replay-attack detection and CI determinism. Real perceptual matching
 * (e.g. "is this a re-recorded copy of the same call?") requires a
 * production provider. We define the adapter interface here; concrete
 * adapters live behind dynamic-imports so the build does not require the
 * optional dependency.
 */

import type { AudioFingerprint, AudioSample } from '../types.js';

export interface FingerprintAdapter {
  readonly name: 'chromaprint' | 'acoustid' | 'acrcloud';
  fingerprint(audio: AudioSample): Promise<AudioFingerprint>;
}

/**
 * Returns the default fingerprint adapter — the deterministic chromaprint
 * stub. Production callers should pass an `acrcloudAdapter()` instead.
 */
export function defaultAdapter(): FingerprintAdapter {
  return {
    name: 'chromaprint',
    fingerprint: async (audio) => {
      const { createChromaprintFingerprint } = await import('./chromaprint.js');
      return createChromaprintFingerprint(audio);
    },
  };
}

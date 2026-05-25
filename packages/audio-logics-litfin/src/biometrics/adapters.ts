/**
 * Adapter ports for production voice-biometrics providers.
 *
 * The mock implementation in `voiceprint.ts` is suitable only for CI +
 * unit tests. Production deployments MUST swap in one of these adapters
 * via `createAudioLogicsLitfin({ biometricsAdapter })`.
 *
 * All three vendors (Amazon Connect Voice ID, Microsoft Speaker Recognition,
 * Pindrop) are HTTP-based; we keep the interface synchronous-friendly via
 * Promise return values. Concrete adapters live in the consuming service
 * to avoid pulling SDKs into the modular-monolith core.
 */

import type {
  AudioSample,
  VoiceBiometricEnrollment,
  VoiceVerificationResult,
} from '../types.js';

export interface BiometricsAdapter {
  readonly name: 'mock' | 'amazon-connect-voice-id' | 'azure-speaker-recognition' | 'pindrop';
  enroll(args: {
    userId: string;
    samples: ReadonlyArray<AudioSample>;
    threshold?: number;
  }): Promise<VoiceBiometricEnrollment>;
  verify(args: {
    enrollment: VoiceBiometricEnrollment;
    sample: AudioSample;
    threshold?: number;
    livenessPhrase?: string;
    livenessPhraseTranscript?: string;
  }): Promise<VoiceVerificationResult>;
}

/**
 * The default (mock) biometrics adapter — wraps the deterministic
 * pure-TS implementation. CI uses this; prod swaps it.
 */
export function defaultBiometricsAdapter(): BiometricsAdapter {
  return {
    name: 'mock',
    enroll: async (args) => {
      const { enrollVoiceBiometric } = await import('./voiceprint.js');
      return enrollVoiceBiometric({
        userId: args.userId,
        samples: args.samples,
        ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
      });
    },
    verify: async (args) => {
      const { verifyVoice } = await import('./voiceprint.js');
      return verifyVoice({
        enrollment: args.enrollment,
        sample: args.sample,
        ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
        ...(args.livenessPhrase !== undefined ? { livenessPhrase: args.livenessPhrase } : {}),
        ...(args.livenessPhraseTranscript !== undefined
          ? { livenessPhraseTranscript: args.livenessPhraseTranscript }
          : {}),
      });
    },
  };
}

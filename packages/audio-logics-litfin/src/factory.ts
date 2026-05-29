/**
 * `createAudioLogicsLitfin()` — factory bundle.
 *
 * Convenience wrapper for callers (api-gateway composition root) who want
 * a single object exposing every subsystem with the same set of
 * production adapters injected. Each subsystem remains usable standalone
 * via its own named export.
 */

import {
  defaultBiometricsAdapter,
  type BiometricsAdapter,
} from './biometrics/index.js';
import { defaultAdapter as defaultFingerprintAdapter, type FingerprintAdapter } from './fingerprinting/index.js';
import {
  signAudioAsEvidence,
  verifyAudioEvidence,
  DEFAULT_DEV_KEY,
  loadAudioEvidenceSigningKeyFromEnv,
  type SigningKey,
} from './evidence-chain/index.js';
import { analyzeEmotionalState } from './emotion-escalation/index.js';
import { scoreAudioQuality } from './quality-scoring/index.js';
import { TalkTimeMeter } from './talk-time-meter/index.js';
import { generateWaveformPeaks, extractSpeakerTimeline } from './waveform-ui/index.js';
import {
  parseWhatsAppVoiceMessage,
  downloadAudio,
  convertOpusToWav,
} from './whatsapp-voice-intake/index.js';
import {
  getRecordingNotice,
  recordConsent,
  verifyConsentBeforeStorage,
} from './compliance-recording/index.js';
import type { BrainPort } from './types.js';

export interface CreateAudioLogicsLitfinOptions {
  readonly brain?: BrainPort;
  readonly evidenceSigner?: SigningKey;
  readonly biometricsAdapter?: BiometricsAdapter;
  readonly fingerprintAdapter?: FingerprintAdapter;
}

type SignArgs = Omit<Parameters<typeof signAudioAsEvidence>[0], 'signerKey'>;
type VerifyArgs = Omit<Parameters<typeof verifyAudioEvidence>[0], 'keys'>;
type EmotionArgs = Parameters<typeof analyzeEmotionalState>[0];

export interface AudioLogicsLitfin {
  readonly fingerprinting: FingerprintAdapter;
  readonly biometrics: BiometricsAdapter;
  readonly compliance: {
    readonly getRecordingNotice: typeof getRecordingNotice;
    readonly recordConsent: typeof recordConsent;
    readonly verifyConsentBeforeStorage: typeof verifyConsentBeforeStorage;
  };
  readonly evidence: {
    signAudioAsEvidence: (args: SignArgs) => ReturnType<typeof signAudioAsEvidence>;
    verifyAudioEvidence: (args: VerifyArgs) => ReturnType<typeof verifyAudioEvidence>;
  };
  readonly whatsapp: {
    readonly parseWhatsAppVoiceMessage: typeof parseWhatsAppVoiceMessage;
    readonly downloadAudio: typeof downloadAudio;
    readonly convertOpusToWav: typeof convertOpusToWav;
  };
  readonly emotion: {
    analyze: (args: EmotionArgs) => ReturnType<typeof analyzeEmotionalState>;
  };
  readonly waveform: {
    readonly generatePeaks: typeof generateWaveformPeaks;
    readonly extractSpeakerTimeline: typeof extractSpeakerTimeline;
  };
  readonly quality: {
    readonly score: typeof scoreAudioQuality;
  };
  readonly createTalkTimeMeter: () => TalkTimeMeter;
}

/**
 * Build the LITFIN-audio-logics bundle. All adapters are optional —
 * unspecified ports fall back to deterministic reference implementations
 * suitable for CI + dev.
 */
export function createAudioLogicsLitfin(
  options: CreateAudioLogicsLitfinOptions = {},
): AudioLogicsLitfin {
  const fingerprinting = options.fingerprintAdapter ?? defaultFingerprintAdapter();
  const biometrics = options.biometricsAdapter ?? defaultBiometricsAdapter();
  // Resolution order: explicit option → env-supplied key → dev-stub fallback.
  // In production the dev-stub key triggers a refuse-in-prod throw inside
  // `signAudioAsEvidence` (see signer.ts::refuseDevKeyInProduction).
  const signerKey =
    options.evidenceSigner ?? loadAudioEvidenceSigningKeyFromEnv() ?? DEFAULT_DEV_KEY;
  const brain = options.brain;

  return Object.freeze({
    fingerprinting,
    biometrics,
    compliance: Object.freeze({
      getRecordingNotice,
      recordConsent,
      verifyConsentBeforeStorage,
    }),
    evidence: Object.freeze({
      signAudioAsEvidence: (args: SignArgs) => signAudioAsEvidence({ ...args, signerKey }),
      verifyAudioEvidence: (args: VerifyArgs) =>
        verifyAudioEvidence({ ...args, keys: [signerKey] }),
    }),
    whatsapp: Object.freeze({
      parseWhatsAppVoiceMessage,
      downloadAudio,
      convertOpusToWav,
    }),
    emotion: Object.freeze({
      analyze: (args: EmotionArgs) =>
        analyzeEmotionalState({ ...args, ...(brain ? { brain } : {}) }),
    }),
    waveform: Object.freeze({
      generatePeaks: generateWaveformPeaks,
      extractSpeakerTimeline,
    }),
    quality: Object.freeze({ score: scoreAudioQuality }),
    createTalkTimeMeter: () => new TalkTimeMeter(),
  });
}

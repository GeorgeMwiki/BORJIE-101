/**
 * Voice-hardening — shared types (LP-27).
 *
 * Defends the voice channel against synthesised / replayed / impersonated
 * audio and meets synthetic-voice disclosure law. Pure data shapes; the
 * acoustic features are supplied by a DSP worklet (browser-side) or the
 * audio-capture pipeline, never computed here.
 *
 * @module @borjie/audio-logics-litfin/voice-hardening/types
 */

// ----------------------------------------------------------------------------
// Adversarial classifier
// ----------------------------------------------------------------------------

export interface AcousticAdversarialFeatures {
  /** Energy share across low (0-2k), mid (2-4k), hi (4-8k) bands. */
  readonly bandEnergy: { readonly lo: number; readonly mid: number; readonly hi: number };
  /** Jitter % (cycle-to-cycle frequency variability). */
  readonly jitterPct: number;
  /** Shimmer % (cycle-to-cycle amplitude variability). */
  readonly shimmerPct: number;
  /** Double-reverb signature score 0..1 (replay-from-speaker tell). */
  readonly doubleReverbScore: number;
  /** Voiceprint Euclidean delta vs enrollment, or null if no enrollment. */
  readonly voiceprintDelta: number | null;
  /** Optional signal-to-noise ratio (dB). */
  readonly snrDb?: number;
}

export type AdversarialVerdictLabel =
  | 'natural'
  | 'uncertain'
  | 'likely_synthesised'
  | 'likely_replay'
  | 'likely_impersonation';

export interface AdversarialContributor {
  readonly feature: string;
  readonly contribution: number;
  readonly note: string;
}

export interface AdversarialVerdict {
  readonly label: AdversarialVerdictLabel;
  /** 0..1, 1 = certainly adversarial. */
  readonly score: number;
  readonly contributors: readonly AdversarialContributor[];
  readonly recommended: 'accept' | 'challenge' | 'escalate';
}

// ----------------------------------------------------------------------------
// Challenge phrase
// ----------------------------------------------------------------------------

export type ChallengeLocale = 'en' | 'sw' | 'mixed';

export interface ChallengePhrase {
  readonly locale: ChallengeLocale;
  /** 4-digit numeric nonce. */
  readonly nonce: string;
  /** Full phrase the speaker must read. */
  readonly text: string;
  /** Tokens the verifier compares against (lowercased). */
  readonly tokens: readonly string[];
  readonly generatedAt: string;
  readonly expiresAt: string;
}

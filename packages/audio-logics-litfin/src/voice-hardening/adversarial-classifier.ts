/**
 * Adversarial / deepfake / replay voice classifier (LP-27).
 *
 * Borjie's voice biometrics are INBOUND (who is speaking). This is the
 * ADVERSARIAL complement: it detects synthesised / replayed / impersonated
 * voice before it reaches the brain kernel. Cheap, deterministic, no GPU
 * model — it scores acoustic features the DSP worklet already computes:
 *
 *   1. Spectral-band shape (TTS under-fills the 4-8 kHz band).
 *   2. Jitter / shimmer micro-prosody (replays are suspiciously regular).
 *   3. Double-reverb tail (replay-from-speaker carries two reverbs).
 *   4. Voiceprint delta vs enrollment (impersonation tell).
 *
 * On a non-natural verdict the caller consults the kill-switch (sovereign-
 * tier may demand four-eye review) and may issue a nonce challenge.
 *
 * Pure module.
 *
 * @module @borjie/audio-logics-litfin/voice-hardening/adversarial-classifier
 */

import type {
  AcousticAdversarialFeatures,
  AdversarialContributor,
  AdversarialVerdict,
  AdversarialVerdictLabel,
  ChallengePhrase,
} from './types.js';
import { scoreChallengeResponse } from './challenge-phrase.js';

const JITTER_HEALTHY = { lo: 0.4, hi: 2.5 };
const SHIMMER_HEALTHY = { lo: 0.5, hi: 4 };

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Classify a single voice frame's adversarial likelihood from its acoustic
 * features. Returns a verdict label, a composite 0..1 score, the per-feature
 * contributions (for audit), and a recommended action.
 */
export function classifyAdversarialVoice(f: AcousticAdversarialFeatures): AdversarialVerdict {
  const contributors: AdversarialContributor[] = [];

  // 1. Spectral band shape.
  const bandTotal = f.bandEnergy.lo + f.bandEnergy.mid + f.bandEnergy.hi;
  const hiShare = bandTotal > 0 ? f.bandEnergy.hi / bandTotal : 0;
  let bandScore = 0;
  if (hiShare < 0.05) {
    bandScore = clamp01((0.05 - hiShare) / 0.05);
    contributors.push({
      feature: 'spectral_hi_band_underfilled',
      contribution: bandScore * 0.25,
      note: `4-8 kHz share ${(hiShare * 100).toFixed(1)}% < 5%, typical of TTS synthesis`,
    });
  }

  // 2. Jitter / shimmer micro-prosody.
  let microProsodyScore = 0;
  if (f.jitterPct < JITTER_HEALTHY.lo) {
    const j = clamp01((JITTER_HEALTHY.lo - f.jitterPct) / JITTER_HEALTHY.lo);
    microProsodyScore += j;
    contributors.push({
      feature: 'jitter_too_low',
      contribution: j * 0.15,
      note: `jitter ${f.jitterPct.toFixed(2)}% < healthy floor ${JITTER_HEALTHY.lo}%`,
    });
  }
  if (f.shimmerPct < SHIMMER_HEALTHY.lo) {
    const s = clamp01((SHIMMER_HEALTHY.lo - f.shimmerPct) / SHIMMER_HEALTHY.lo);
    microProsodyScore += s * 0.5;
    contributors.push({
      feature: 'shimmer_too_low',
      contribution: s * 0.1,
      note: `shimmer ${f.shimmerPct.toFixed(2)}% < healthy floor ${SHIMMER_HEALTHY.lo}%`,
    });
  }
  microProsodyScore = clamp01(microProsodyScore);

  // 3. Double reverb (replay-from-speaker).
  let reverbScore = 0;
  if (f.doubleReverbScore > 0.4) {
    reverbScore = clamp01(f.doubleReverbScore);
    contributors.push({
      feature: 'double_reverb_signature',
      contribution: reverbScore * 0.25,
      note: `double-reverb ${f.doubleReverbScore.toFixed(2)} > 0.4, consistent with replay`,
    });
  }

  // 4. Voiceprint delta vs enrollment.
  let voiceprintScore = 0;
  if (typeof f.voiceprintDelta === 'number' && f.voiceprintDelta > 0.5) {
    voiceprintScore = clamp01((f.voiceprintDelta - 0.5) / 0.5);
    contributors.push({
      feature: 'voiceprint_mismatch',
      contribution: voiceprintScore * 0.4,
      note: `voiceprint delta ${f.voiceprintDelta.toFixed(2)} > 0.5, likely impersonation`,
    });
  }

  const score = clamp01(
    bandScore * 0.25 + microProsodyScore * 0.25 + reverbScore * 0.25 + voiceprintScore * 0.4,
  );

  let label: AdversarialVerdictLabel = 'natural';
  if (voiceprintScore > 0.6) label = 'likely_impersonation';
  else if (reverbScore > 0.6) label = 'likely_replay';
  else if (bandScore > 0.6 || microProsodyScore > 0.6) label = 'likely_synthesised';
  else if (score > 0.3) label = 'uncertain';

  const recommended: AdversarialVerdict['recommended'] =
    label === 'natural' ? 'accept' : label === 'uncertain' ? 'challenge' : 'escalate';

  return { label, score, contributors, recommended };
}

// ----------------------------------------------------------------------------
// Deepfake liveness (classifier + nonce challenge)
// ----------------------------------------------------------------------------

export interface DeepfakeLivenessInput {
  readonly features: AcousticAdversarialFeatures;
  readonly challenge: ChallengePhrase;
  /** Transcript of what the speaker actually said. */
  readonly transcript: string;
}

export interface DeepfakeLivenessVerdict {
  readonly verdict: AdversarialVerdict;
  readonly challengeMatched: boolean;
  readonly challengeCoverage: number;
  /** Final recommendation considering BOTH the spoof score and the phrase. */
  readonly recommended: AdversarialVerdict['recommended'];
}

/**
 * Run the spectral classifier AND the nonce-challenge check. If the spoken
 * phrase does not match the random challenge, the verdict escalates
 * regardless of the spectral score — this defeats pre-recorded replay where
 * the audio sounds natural but carries the wrong text. Used on suspicious
 * sovereign-tier / high-value operations.
 */
export function detectDeepfakeLiveness(input: DeepfakeLivenessInput): DeepfakeLivenessVerdict {
  const verdict = classifyAdversarialVoice(input.features);
  const challenge = scoreChallengeResponse(input.challenge, input.transcript);
  const recommended: AdversarialVerdict['recommended'] = challenge.matched
    ? verdict.recommended
    : 'escalate';
  return {
    verdict,
    challengeMatched: challenge.matched,
    challengeCoverage: challenge.coverage,
    recommended,
  };
}

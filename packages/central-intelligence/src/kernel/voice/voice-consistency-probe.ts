/**
 * Voice-clone consistency probe — Phase D D7.
 *
 * Given a synthesized voice clip, computes a fixed-length feature
 * vector and compares it against a per-voice baseline. When drift
 * crosses a per-dim or aggregate threshold, the probe emits a
 * structured `VoiceDriftAlert`.
 *
 * Architecture:
 *
 *   - VoiceFeatureExtractor — injectable port. Production wires this
 *     to ElevenLabs / Resemble.ai / Coqui feature endpoints; tests
 *     wire a stub that returns deterministic feature vectors per
 *     `voiceProfileId`.
 *
 *   - VoiceBaselineStore    — readonly port over the registered
 *     baselines for each voice. Production wires a Drizzle-backed
 *     baseline store; tests wire an in-memory map.
 *
 *   - probeVoiceConsistency() — the entry point. Pure verdict; the
 *     caller decides whether to alert / pause TTS / re-record.
 *
 * Threshold model is deliberately conservative (per-dim eighteen-
 * hundredths, aggregate L2 ten-hundredths) — voice synthesis introduces
 * drift more easily than text persona because the underlying acoustic
 * features are noisier turn-to-turn. Not a tax rate.
 */

/** Fixed 12-dim voice fingerprint. Order matters. */
export const VOICE_FEATURE_DIMS = [
  'pitch_mean_hz',
  'pitch_std_hz',
  'formant_f1_hz',
  'formant_f2_hz',
  'formant_f3_hz',
  'speech_rate_syl_per_sec',
  'articulation_clarity',
  'breathiness',
  'jitter_pct',
  'shimmer_pct',
  'spectral_tilt_db',
  'voiced_unvoiced_ratio',
] as const;

export type VoiceFeatureDim = (typeof VOICE_FEATURE_DIMS)[number];

export type VoiceFeatureVector = {
  readonly [K in VoiceFeatureDim]: number;
};

export interface VoiceFeatureExtractor {
  /**
   * Compute the feature vector for a synthesized clip. Implementations
   * may issue HTTP calls to ElevenLabs / Resemble.ai etc. Errors must
   * be thrown so the caller can route around the failed extraction.
   */
  extract(args: {
    readonly voiceProfileId: string;
    readonly clipBytes: Uint8Array;
    readonly sampleRateHz?: number;
  }): Promise<VoiceFeatureVector>;
}

export interface VoiceBaselineStore {
  /** Returns the registered baseline for the voice, or null when missing. */
  getBaseline(voiceProfileId: string): Promise<VoiceFeatureVector | null>;
}

export interface VoiceDriftAlert {
  readonly breached: boolean;
  readonly voiceProfileId: string;
  readonly worstDim: VoiceFeatureDim;
  /** Normalised per-dim drift (0..1). */
  readonly worstDimDrift: number;
  /** Normalised aggregate L2 distance (0..1). */
  readonly aggregateDrift: number;
  readonly severity: 'low' | 'medium' | 'high';
  readonly reasons: ReadonlyArray<string>;
}

export interface VoiceConsistencyProbe {
  probe(args: {
    readonly voiceProfileId: string;
    readonly clipBytes: Uint8Array;
    readonly sampleRateHz?: number;
    /** Override the default per-dim drift threshold. */
    readonly perDimThreshold?: number;
    /** Override the default aggregate L2 threshold. */
    readonly aggregateThreshold?: number;
  }): Promise<VoiceDriftAlert>;
}

export interface CreateVoiceConsistencyProbeArgs {
  readonly extractor: VoiceFeatureExtractor;
  readonly baselineStore: VoiceBaselineStore;
}

export const DEFAULT_PER_DIM_THRESHOLD = 0.18;
export const DEFAULT_AGGREGATE_THRESHOLD = 0.1;

/**
 * Approximate per-dim normalisers. We don't divide raw Hz against
 * each other; we squash each feature into [0,1] using a reasonable
 * upper bound so the drift number is comparable across dimensions.
 */
const FEATURE_SCALE: Record<VoiceFeatureDim, number> = {
  pitch_mean_hz: 400,
  pitch_std_hz: 80,
  formant_f1_hz: 1000,
  formant_f2_hz: 2500,
  formant_f3_hz: 3500,
  speech_rate_syl_per_sec: 8,
  articulation_clarity: 1,
  breathiness: 1,
  jitter_pct: 5,
  shimmer_pct: 12,
  spectral_tilt_db: 30,
  voiced_unvoiced_ratio: 1,
};

function normalisedDelta(
  dim: VoiceFeatureDim,
  sample: number,
  baseline: number,
): number {
  const scale = FEATURE_SCALE[dim] || 1;
  return Math.min(1, Math.abs(sample - baseline) / scale);
}

export function createVoiceConsistencyProbe(
  args: CreateVoiceConsistencyProbeArgs,
): VoiceConsistencyProbe {
  if (!args.extractor) {
    throw new Error('createVoiceConsistencyProbe: extractor is required');
  }
  if (!args.baselineStore) {
    throw new Error('createVoiceConsistencyProbe: baselineStore is required');
  }

  return {
    async probe(input) {
      const baseline = await args.baselineStore.getBaseline(
        input.voiceProfileId,
      );
      if (!baseline) {
        return {
          breached: false,
          voiceProfileId: input.voiceProfileId,
          worstDim: 'pitch_mean_hz',
          worstDimDrift: 0,
          aggregateDrift: 0,
          severity: 'low',
          reasons: ['no baseline registered — drift cannot be computed'],
        };
      }

      const extractArgs: {
        voiceProfileId: string;
        clipBytes: Uint8Array;
        sampleRateHz?: number;
      } = {
        voiceProfileId: input.voiceProfileId,
        clipBytes: input.clipBytes,
      };
      if (typeof input.sampleRateHz === 'number') {
        extractArgs.sampleRateHz = input.sampleRateHz;
      }
      const sample = await args.extractor.extract(extractArgs);

      let worstDim: VoiceFeatureDim = VOICE_FEATURE_DIMS[0];
      let worstDelta = 0;
      let sqSum = 0;
      for (const dim of VOICE_FEATURE_DIMS) {
        const delta = normalisedDelta(dim, sample[dim], baseline[dim]);
        sqSum += delta * delta;
        if (delta > worstDelta) {
          worstDelta = delta;
          worstDim = dim;
        }
      }
      // Aggregate drift = L2 norm of the per-dim normalised drift
      // vector (clamped to [0,1]). A pure L2 lets several moderate
      // dim drifts compound to breach the aggregate threshold even
      // when no single dim is above the per-dim ceiling — the case
      // voice synthesis defects actually look like in production.
      const aggregate = Math.min(1, Math.sqrt(sqSum));

      const perDimThreshold =
        input.perDimThreshold ?? DEFAULT_PER_DIM_THRESHOLD;
      const aggregateThreshold =
        input.aggregateThreshold ?? DEFAULT_AGGREGATE_THRESHOLD;

      const reasons: string[] = [];
      if (worstDelta >= perDimThreshold) {
        reasons.push(
          `dim ${worstDim} drifted by ${worstDelta.toFixed(3)} (threshold ${perDimThreshold})`,
        );
      }
      if (aggregate >= aggregateThreshold) {
        reasons.push(
          `aggregate L2 drift ${aggregate.toFixed(3)} ≥ ${aggregateThreshold}`,
        );
      }

      const breached = reasons.length > 0;
      const severity: VoiceDriftAlert['severity'] =
        worstDelta >= 0.4 ? 'high' : worstDelta >= 0.25 ? 'medium' : 'low';

      return {
        breached,
        voiceProfileId: input.voiceProfileId,
        worstDim,
        worstDimDrift: worstDelta,
        aggregateDrift: aggregate,
        severity,
        reasons,
      };
    },
  };
}

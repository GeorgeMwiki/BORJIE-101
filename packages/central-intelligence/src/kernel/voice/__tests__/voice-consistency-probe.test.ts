/**
 * Voice-clone consistency probe tests (Phase D D7).
 */

import { describe, it, expect } from 'vitest';
import {
  createVoiceConsistencyProbe,
  VOICE_FEATURE_DIMS,
  type VoiceBaselineStore,
  type VoiceFeatureExtractor,
  type VoiceFeatureVector,
} from '../voice-consistency-probe.js';

function baseline(): VoiceFeatureVector {
  return {
    pitch_mean_hz: 180,
    pitch_std_hz: 20,
    formant_f1_hz: 500,
    formant_f2_hz: 1500,
    formant_f3_hz: 2500,
    speech_rate_syl_per_sec: 4.5,
    articulation_clarity: 0.85,
    breathiness: 0.2,
    jitter_pct: 0.8,
    shimmer_pct: 3.0,
    spectral_tilt_db: -12,
    voiced_unvoiced_ratio: 0.65,
  };
}

function stubExtractor(sample: VoiceFeatureVector): VoiceFeatureExtractor {
  return {
    async extract() {
      return sample;
    },
  };
}

function stubBaselineStore(
  baselines: Record<string, VoiceFeatureVector | null>,
): VoiceBaselineStore {
  return {
    async getBaseline(id) {
      return baselines[id] ?? null;
    },
  };
}

describe('Phase D D7 — voice-consistency probe', () => {
  it('returns non-breached + empty reasons when sample matches baseline', async () => {
    const b = baseline();
    const probe = createVoiceConsistencyProbe({
      extractor: stubExtractor({ ...b }),
      baselineStore: stubBaselineStore({ voice_a: { ...b } }),
    });
    const verdict = await probe.probe({
      voiceProfileId: 'voice_a',
      clipBytes: new Uint8Array(0),
    });
    expect(verdict.breached).toBe(false);
    expect(verdict.reasons).toHaveLength(0);
    expect(verdict.severity).toBe('low');
  });

  it('returns no-baseline soft response when baseline missing', async () => {
    const probe = createVoiceConsistencyProbe({
      extractor: stubExtractor(baseline()),
      baselineStore: stubBaselineStore({}),
    });
    const verdict = await probe.probe({
      voiceProfileId: 'unknown',
      clipBytes: new Uint8Array(0),
    });
    expect(verdict.breached).toBe(false);
    expect(verdict.reasons[0]).toMatch(/no baseline/i);
  });

  it('breaches when pitch mean drifts beyond threshold', async () => {
    const b = baseline();
    const drifted: VoiceFeatureVector = { ...b, pitch_mean_hz: 280 };
    const probe = createVoiceConsistencyProbe({
      extractor: stubExtractor(drifted),
      baselineStore: stubBaselineStore({ voice_a: b }),
    });
    const verdict = await probe.probe({
      voiceProfileId: 'voice_a',
      clipBytes: new Uint8Array(0),
    });
    expect(verdict.breached).toBe(true);
    expect(verdict.worstDim).toBe('pitch_mean_hz');
    expect(verdict.worstDimDrift).toBeGreaterThanOrEqual(0.18);
  });

  it('aggregate drift breaches even when no single dim is severe', async () => {
    const b = baseline();
    // Small drift across many dims — aggregate L2 exceeds 0.10.
    const drifted: VoiceFeatureVector = {
      ...b,
      pitch_mean_hz: b.pitch_mean_hz + 40,
      formant_f1_hz: b.formant_f1_hz + 100,
      formant_f2_hz: b.formant_f2_hz + 200,
      formant_f3_hz: b.formant_f3_hz + 250,
      shimmer_pct: b.shimmer_pct + 1.2,
    };
    const probe = createVoiceConsistencyProbe({
      extractor: stubExtractor(drifted),
      baselineStore: stubBaselineStore({ voice_a: b }),
    });
    const verdict = await probe.probe({
      voiceProfileId: 'voice_a',
      clipBytes: new Uint8Array(0),
    });
    expect(verdict.aggregateDrift).toBeGreaterThanOrEqual(0.1);
    expect(verdict.breached).toBe(true);
  });

  it('escalates severity to high on severe per-dim drift', async () => {
    const b = baseline();
    const drifted: VoiceFeatureVector = { ...b, pitch_mean_hz: 380 };
    const probe = createVoiceConsistencyProbe({
      extractor: stubExtractor(drifted),
      baselineStore: stubBaselineStore({ voice_a: b }),
    });
    const verdict = await probe.probe({
      voiceProfileId: 'voice_a',
      clipBytes: new Uint8Array(0),
    });
    expect(verdict.severity).toBe('high');
  });

  it('respects caller-overridden thresholds', async () => {
    const b = baseline();
    const drifted: VoiceFeatureVector = { ...b, pitch_mean_hz: 200 };
    const probe = createVoiceConsistencyProbe({
      extractor: stubExtractor(drifted),
      baselineStore: stubBaselineStore({ voice_a: b }),
    });
    const verdict = await probe.probe({
      voiceProfileId: 'voice_a',
      clipBytes: new Uint8Array(0),
      perDimThreshold: 0.01,
    });
    expect(verdict.breached).toBe(true);
  });

  it('iterates all 12 dimensions in fixed order', () => {
    expect(VOICE_FEATURE_DIMS).toHaveLength(12);
    expect(VOICE_FEATURE_DIMS[0]).toBe('pitch_mean_hz');
  });
});

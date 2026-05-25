import { describe, it, expect } from 'vitest';
import { enrollVoiceBiometric, verifyVoice } from '../voiceprint.js';
import { defaultBiometricsAdapter } from '../adapters.js';
import type { AudioSample } from '../../types.js';

function makeAudio(seed: number, length = 4096): AudioSample {
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = (i * seed + (i % 17) + (i & 3 ? 0 : 1)) % 256;
  }
  // Inject natural silence pockets so the liveness silence-distribution check
  // does not flag this synthetic fixture as a TTS stream.
  for (let i = 0; i < length; i += 31) {
    arr[i] = 0;
  }
  return {
    bytes: arr,
    format: 'pcm',
    sampleRate: 16000,
    channels: 1,
    durationMs: 256,
  };
}

const userId = 'user-test-1';
const samples = [makeAudio(3), makeAudio(5), makeAudio(7)];
const enrollment = enrollVoiceBiometric({ userId, samples, nowIso: '2026-05-25T00:00:00.000Z' });

describe('enrollVoiceBiometric', () => {
  it('returns an enrollment with deterministic id format', () => {
    expect(enrollment.userId).toBe(userId);
    expect(enrollment.sampleCount).toBe(3);
    expect(enrollment.enrollmentId).toMatch(/^vb_[0-9a-f-]+$/);
    expect(enrollment.voiceprintHash).toMatch(/^[0-9a-f]{64}$/);
    expect(enrollment.provider).toBe('mock');
  });

  it('rejects fewer than 3 samples', () => {
    expect(() =>
      enrollVoiceBiometric({ userId, samples: [makeAudio(3), makeAudio(5)] }),
    ).toThrow(/at least 3/);
  });

  it('rejects an out-of-range threshold', () => {
    expect(() =>
      enrollVoiceBiometric({ userId, samples, threshold: 2 }),
    ).toThrow(/threshold/);
  });

  it('produces different voiceprint hashes for different users', () => {
    const otherUser = enrollVoiceBiometric({ userId: 'user-test-2', samples });
    expect(otherUser.voiceprintHash).not.toBe(enrollment.voiceprintHash);
  });
});

describe('verifyVoice', () => {
  it('matches the same user with one of the enrolled samples', () => {
    const sample = samples[0]!;
    const result = verifyVoice({
      enrollment,
      sample,
      threshold: 0,
      livenessPhrase: 'open sesame',
      livenessPhraseTranscript: 'open sesame',
    });
    expect(result.matched).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.livenessCheck.passed).toBe(true);
  });

  it('rejects when the score is below threshold', () => {
    const result = verifyVoice({
      enrollment,
      sample: samples[0]!,
      threshold: 0.99,
      livenessPhrase: 'open sesame',
      livenessPhraseTranscript: 'open sesame',
    });
    expect(result.matched).toBe(false);
  });

  it('fails liveness when the random-phrase challenge does not match', () => {
    const result = verifyVoice({
      enrollment,
      sample: samples[0]!,
      threshold: 0,
      livenessPhrase: 'open sesame',
      livenessPhraseTranscript: 'wrong words',
    });
    expect(result.matched).toBe(false);
    const phraseCheck = result.livenessCheck.checks.find((c) => c.name === 'random-phrase');
    expect(phraseCheck?.passed).toBe(false);
  });

  it('passes liveness when no phrase challenge is supplied', () => {
    const result = verifyVoice({
      enrollment,
      sample: samples[0]!,
      threshold: 0,
    });
    const phraseCheck = result.livenessCheck.checks.find((c) => c.name === 'random-phrase');
    expect(phraseCheck?.passed).toBe(true);
  });

  it('records spectral-flatness and silence-distribution checks', () => {
    const result = verifyVoice({ enrollment, sample: samples[0]!, threshold: 0 });
    const names = result.livenessCheck.checks.map((c) => c.name).sort();
    expect(names).toEqual(['random-phrase', 'silence-distribution', 'spectral-flatness']);
  });
});

describe('defaultBiometricsAdapter', () => {
  it('round-trips enroll + verify via the adapter port', async () => {
    const adapter = defaultBiometricsAdapter();
    const e = await adapter.enroll({ userId: 'adapter-user', samples });
    expect(e.provider).toBe('mock');
    const v = await adapter.verify({ enrollment: e, sample: samples[0]!, threshold: 0 });
    expect(v.verifiedAtIso).toMatch(/^\d{4}-/);
  });
});

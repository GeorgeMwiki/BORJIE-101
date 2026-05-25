import { describe, it, expect } from 'vitest';
import { createAudioLogicsLitfin } from '../index.js';
import type { AudioSample } from '../types.js';

function sample(): AudioSample {
  const arr = new Uint8Array(2048);
  for (let i = 0; i < arr.length; i++) arr[i] = 128 + Math.floor(50 * Math.sin(i / 20));
  return { bytes: arr, format: 'pcm', sampleRate: 16000, channels: 1, durationMs: 128 };
}

describe('createAudioLogicsLitfin', () => {
  it('returns a bundle with every subsystem wired', () => {
    const bundle = createAudioLogicsLitfin();
    expect(bundle.fingerprinting.name).toBe('chromaprint');
    expect(bundle.biometrics.name).toBe('mock');
    expect(typeof bundle.compliance.getRecordingNotice).toBe('function');
    expect(typeof bundle.evidence.signAudioAsEvidence).toBe('function');
    expect(typeof bundle.whatsapp.parseWhatsAppVoiceMessage).toBe('function');
    expect(typeof bundle.emotion.analyze).toBe('function');
    expect(typeof bundle.waveform.generatePeaks).toBe('function');
    expect(typeof bundle.quality.score).toBe('function');
    expect(typeof bundle.createTalkTimeMeter).toBe('function');
  });

  it('round-trips evidence sign + verify using the default key', () => {
    const bundle = createAudioLogicsLitfin();
    const audio = sample();
    const manifest = bundle.evidence.signAudioAsEvidence({
      audio,
      tenantId: 'factory-tenant',
      captureTimestampIso: '2026-05-25T10:00:00.000Z',
      captureDeviceFingerprint: 'factory-device',
    });
    const verified = bundle.evidence.verifyAudioEvidence({ audio, manifest });
    expect(verified.valid).toBe(true);
  });

  it('createTalkTimeMeter returns independent meter instances', () => {
    const bundle = createAudioLogicsLitfin();
    const m1 = bundle.createTalkTimeMeter();
    const m2 = bundle.createTalkTimeMeter();
    m1.observe({
      tenantId: 't',
      agentId: 'a',
      audioMs: 1000,
      isSpeech: true,
      speaker: 'tenant',
      observedAtIso: '',
    });
    expect(m1.bill('t').totalSeconds).toBeCloseTo(1);
    expect(m2.bill('t').totalSeconds).toBe(0);
  });

  it('honors a brain adapter for emotion analysis', async () => {
    let calls = 0;
    const bundle = createAudioLogicsLitfin({
      brain: {
        analyzeEmotion: async () => {
          calls++;
          return [{ timestampMs: 0, emotion: 'anger', score: 0.95 }];
        },
      },
    });
    await bundle.emotion.analyze({ transcript: '' });
    expect(calls).toBe(1);
  });

  it('compliance getRecordingNotice returns a TZ notice via the bundle', () => {
    const bundle = createAudioLogicsLitfin();
    const tz = bundle.compliance.getRecordingNotice('TZ');
    expect(tz.jurisdiction).toBe('TZ');
  });
});

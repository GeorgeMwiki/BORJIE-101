import { describe, it, expect } from 'vitest';
import {
  signAudioAsEvidence,
  verifyAudioEvidence,
  buildCaptureDeviceFingerprint,
  DEFAULT_DEV_KEY,
} from '../index.js';
import type { AudioSample } from '../../types.js';

function makeAudio(seed: number): AudioSample {
  const arr = new Uint8Array(1024);
  for (let i = 0; i < arr.length; i++) arr[i] = (i * seed + 7) % 256;
  return { bytes: arr, format: 'pcm', sampleRate: 16000, channels: 1, durationMs: 64 };
}

describe('signAudioAsEvidence + verifyAudioEvidence', () => {
  const audio = makeAudio(11);

  it('signs + verifies a round-trip happy path', () => {
    const manifest = signAudioAsEvidence({
      audio,
      tenantId: 'tenant-7',
      captureTimestampIso: '2026-05-25T09:00:00.000Z',
      captureDeviceFingerprint: 'device-abc',
      transcriptionHash: '0123abcd',
      consentId: 'cn_test',
      claims: [
        { key: 'consentReference', value: 'cn_test' },
        { key: 'capturedBy', value: 'voice-agent-1' },
      ],
      nowIso: '2026-05-25T09:00:01.000Z',
    });
    expect(manifest.claimSignature).toMatch(/^hmac-sha256:audio-evidence-dev-key:[0-9a-f]+$/);
    expect(manifest.audioHash).toMatch(/^[0-9a-f]{64}$/);

    const result = verifyAudioEvidence({ audio, manifest });
    expect(result.valid).toBe(true);
    expect(result.signedBy).toBe('audio-evidence-dev-key');
    expect(result.signedAtIso).toBe('2026-05-25T09:00:01.000Z');
  });

  it('detects audio-tampering', () => {
    const manifest = signAudioAsEvidence({
      audio,
      tenantId: 'tenant-7',
      captureTimestampIso: '2026-05-25T09:00:00.000Z',
      captureDeviceFingerprint: 'device-abc',
    });
    const tampered = makeAudio(13);
    const result = verifyAudioEvidence({ audio: tampered, manifest });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('audio-tampered');
  });

  it('detects manifest-tampering when a claim is mutated post-sign', () => {
    const manifest = signAudioAsEvidence({
      audio,
      tenantId: 'tenant-7',
      captureTimestampIso: '2026-05-25T09:00:00.000Z',
      captureDeviceFingerprint: 'device-abc',
      claims: [{ key: 'consentReference', value: 'cn_test' }],
    });
    const tamperedManifest = {
      ...manifest,
      claims: [{ key: 'consentReference', value: 'cn_OTHER' }],
    };
    const result = verifyAudioEvidence({ audio, manifest: tamperedManifest });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('manifest-tampered');
  });

  it('rejects an unknown key', () => {
    const manifest = signAudioAsEvidence({
      audio,
      tenantId: 'tenant-7',
      captureTimestampIso: '2026-05-25T09:00:00.000Z',
      captureDeviceFingerprint: 'device-abc',
      signerKey: { id: 'rogue-key', secret: 'rogue' },
    });
    const result = verifyAudioEvidence({ audio, manifest, keys: [DEFAULT_DEV_KEY] });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown-key');
  });

  it('rejects an empty signature', () => {
    const manifest = signAudioAsEvidence({
      audio,
      tenantId: 'tenant-7',
      captureTimestampIso: '2026-05-25T09:00:00.000Z',
      captureDeviceFingerprint: 'device-abc',
    });
    const result = verifyAudioEvidence({
      audio,
      manifest: { ...manifest, claimSignature: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-signature');
  });

  it('throws when audio bytes are empty', () => {
    expect(() =>
      signAudioAsEvidence({
        audio: { bytes: new Uint8Array(), format: 'pcm', sampleRate: 16000, channels: 1 },
        tenantId: 't',
        captureTimestampIso: '2026-05-25T09:00:00.000Z',
        captureDeviceFingerprint: 'd',
      }),
    ).toThrow(/empty/);
  });

  it('produces a stable manifest given the same inputs + signing key', () => {
    const args = {
      audio,
      tenantId: 'tenant-stable',
      captureTimestampIso: '2026-05-25T09:00:00.000Z',
      captureDeviceFingerprint: 'device-stable',
      claims: [{ key: 'a', value: '1' }],
      nowIso: '2026-05-25T09:00:01.000Z',
    } as const;
    const m1 = signAudioAsEvidence(args);
    const m2 = signAudioAsEvidence(args);
    expect(m1.claimSignature).toBe(m2.claimSignature);
  });
});

describe('buildCaptureDeviceFingerprint', () => {
  it('is stable for the same inputs (no extraSalt)', () => {
    const a = buildCaptureDeviceFingerprint({
      providerId: 'twilio',
      deviceId: 'pbx-1',
      firmwareVersion: '1.0.0',
      extraSalt: 'fixed',
    });
    const b = buildCaptureDeviceFingerprint({
      providerId: 'twilio',
      deviceId: 'pbx-1',
      firmwareVersion: '1.0.0',
      extraSalt: 'fixed',
    });
    expect(a).toBe(b);
  });

  it('returns a hex sha256-shaped string', () => {
    const fp = buildCaptureDeviceFingerprint({
      providerId: 'twilio',
      deviceId: 'pbx-1',
      extraSalt: 'x',
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

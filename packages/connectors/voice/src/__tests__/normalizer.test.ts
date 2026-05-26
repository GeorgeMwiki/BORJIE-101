/**
 * Twilio Voice normalizer tests + salted-hash redaction.
 */

import { describe, it, expect } from 'vitest';

import { normaliseVoiceCall } from '../ingest/normalizer.js';
import { createSaltedHashRedactor } from '../redact/pii-redactor.js';

const SALT_PROVIDER = {
  forTenant: async () => 'salt-for-tenant-mwikila',
};

describe('voice/normalizer', () => {
  it('normalises a Calls payload (already-redacted form)', () => {
    const raw = {
      sid: 'CA' + 'd'.repeat(30),
      direction: 'inbound',
      from: 'sha256:abc',
      to: 'sha256:def',
      status: 'completed',
      duration: '184',
      start_time: '2026-02-15T10:00:00Z',
    };
    const n = normaliseVoiceCall({ raw, recordingUri: 'https://signed.twil.io/rec.wav' });
    expect(n).not.toBeNull();
    expect(n?.callSid).toContain('CA');
    expect(n?.fromPhoneHashed).toBe('sha256:abc');
    expect(n?.toPhoneHashed).toBe('sha256:def');
    expect(n?.durationS).toBe(184);
    expect(n?.direction).toBe('inbound');
    expect(n?.recordingUri).toBe('https://signed.twil.io/rec.wav');
  });

  it('returns null when sid is missing', () => {
    expect(normaliseVoiceCall({ raw: { start_time: '2026-02-15T10:00:00Z' } })).toBeNull();
  });

  it('returns null when start_time is missing', () => {
    expect(normaliseVoiceCall({ raw: { sid: 'CA-x' } })).toBeNull();
  });

  it('coerces unknown direction to "outbound"', () => {
    const n = normaliseVoiceCall({
      raw: { sid: 'CA-y', start_time: '2026-02-15T10:00:00Z', direction: 'weird' },
    });
    expect(n?.direction).toBe('outbound');
  });

  it('salted-hash redactor replaces from/to phone fields', async () => {
    const redactor = createSaltedHashRedactor({
      tenantId: 'tenant-mwikila',
      saltProvider: SALT_PROVIDER,
    });
    const { redacted, redactedFields } = await redactor.redact({
      sid: 'CA-1',
      from: '+255700000001',
      to: '+255700000002',
      start_time: '2026-02-15T10:00:00Z',
    });
    expect((redacted as Record<string, unknown>).from).toMatch(/^sha256:/);
    expect((redacted as Record<string, unknown>).to).toMatch(/^sha256:/);
    expect(redactedFields).toContain('from');
    expect(redactedFields).toContain('to');
  });

  it('salted-hash redactor scans E.164 numbers inside transcript text', async () => {
    const redactor = createSaltedHashRedactor({
      tenantId: 'tenant-mwikila',
      saltProvider: SALT_PROVIDER,
    });
    const { redacted, redactedFields } = await redactor.redact({
      transcript: 'Caller said: call me on +255700111222 later.',
    });
    const t = (redacted as Record<string, unknown>).transcript as string;
    expect(t).not.toContain('+255700111222');
    expect(t).toMatch(/sha256:[0-9a-f]+/);
    expect(redactedFields).toContain('transcript');
  });
});

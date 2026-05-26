/**
 * Twilio Voice dedup-on-startedAt tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryVoiceRepository, type VoiceCallRow } from '../repositories/in-memory.js';

const SUB = 'AC' + '1'.repeat(30);

function row(startedAt: string, status: string): VoiceCallRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    twilioAccount: SUB,
    callSid: 'CA' + 'a'.repeat(30),
    payload: {
      callSid: 'CA' + 'a'.repeat(30),
      direction: 'inbound',
      fromPhoneHashed: 'sha256:abc',
      toPhoneHashed: 'sha256:def',
      durationS: 120,
      status,
      recordingUri: null,
      transcriptText: null,
      startedAt,
    },
    raw: { sid: 'CA' + 'a'.repeat(30) },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('voice/dedup', () => {
  it('upserts a new row', async () => {
    const repo = createInMemoryVoiceRepository();
    await repo.upsert(row('2026-02-01T10:00:00.000Z', 'completed'));
    expect((await repo.all()).length).toBe(1);
  });

  it('overwrites with a strictly newer startedAt', async () => {
    const repo = createInMemoryVoiceRepository();
    await repo.upsert(row('2026-02-01T10:00:00.000Z', 'completed'));
    await repo.upsert(row('2026-03-01T10:00:00.000Z', 'in-progress'));
    const r = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      twilioAccount: SUB,
      callSid: 'CA' + 'a'.repeat(30),
    });
    expect(r?.payload.status).toBe('in-progress');
  });

  it('keeps the existing row when the incoming startedAt is equal or older', async () => {
    const repo = createInMemoryVoiceRepository();
    await repo.upsert(row('2026-03-01T10:00:00.000Z', 'in-progress'));
    await repo.upsert(row('2026-02-01T10:00:00.000Z', 'completed-stale'));
    const r = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      twilioAccount: SUB,
      callSid: 'CA' + 'a'.repeat(30),
    });
    expect(r?.payload.status).toBe('in-progress');
  });
});

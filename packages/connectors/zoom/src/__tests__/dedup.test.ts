/**
 * Zoom dedup-on-startAt tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryZoomRepository, type ZoomMeetingRow } from '../repositories/in-memory.js';

function row(startAt: string, topic: string): ZoomMeetingRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    account: 'zoom-account-id',
    meetingId: '123',
    payload: {
      meetingId: '123',
      topic,
      startAt,
      endAt: null,
      participants: [],
      recordingUri: null,
      transcriptText: null,
    },
    raw: { id: 123 },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('zoom/dedup', () => {
  it('upserts a new row', async () => {
    const repo = createInMemoryZoomRepository();
    await repo.upsert(row('2026-02-01T10:00:00.000Z', 'topic-1'));
    expect((await repo.all()).length).toBe(1);
  });

  it('overwrites with a strictly newer startAt', async () => {
    const repo = createInMemoryZoomRepository();
    await repo.upsert(row('2026-02-01T10:00:00.000Z', 'topic-1'));
    await repo.upsert(row('2026-03-01T10:00:00.000Z', 'topic-2'));
    const r = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      account: 'zoom-account-id',
      meetingId: '123',
    });
    expect(r?.payload.topic).toBe('topic-2');
  });

  it('keeps the existing row when the incoming startAt is equal or older', async () => {
    const repo = createInMemoryZoomRepository();
    await repo.upsert(row('2026-03-01T10:00:00.000Z', 'topic-2'));
    await repo.upsert(row('2026-02-01T10:00:00.000Z', 'topic-old'));
    const r = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      account: 'zoom-account-id',
      meetingId: '123',
    });
    expect(r?.payload.topic).toBe('topic-2');
  });
});

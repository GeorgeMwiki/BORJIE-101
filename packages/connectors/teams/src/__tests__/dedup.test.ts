/**
 * Teams dedup-on-sentAt tests.
 */

import { describe, it, expect } from 'vitest';

import { createInMemoryTeamsRepository, type TeamsMessageRow } from '../repositories/in-memory.js';

function row(sentAt: string, content: string): TeamsMessageRow {
  return {
    id: 'r',
    tenantId: 'tenant-mwikila',
    account: '11111111-1111-1111-1111-111111111111',
    teamId: 't1',
    channelId: 'c1',
    messageId: 'msg-1',
    payload: {
      teamId: 't1',
      channelId: 'c1',
      messageId: 'msg-1',
      fromDisplayName: 'Mr. Mwikila',
      fromEmailHashed: null,
      content,
      attachments: [],
      sentAt,
    },
    raw: { id: 'msg-1' },
    ingestedAt: '2026-01-15T10:00:00.000Z',
    auditHash: 'a'.repeat(64),
  };
}

describe('teams/dedup', () => {
  it('upserts new row', async () => {
    const repo = createInMemoryTeamsRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    expect((await repo.all()).length).toBe(1);
  });
  it('overwrites with newer sentAt', async () => {
    const repo = createInMemoryTeamsRepository();
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'v2'));
    const r = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      account: '11111111-1111-1111-1111-111111111111',
      teamId: 't1',
      channelId: 'c1',
      messageId: 'msg-1',
    });
    expect(r?.payload.content).toBe('v2');
  });
  it('does not overwrite with older sentAt', async () => {
    const repo = createInMemoryTeamsRepository();
    await repo.upsert(row('2026-02-15T10:00:00.000Z', 'v2'));
    await repo.upsert(row('2026-01-15T10:00:00.000Z', 'v1'));
    const r = await repo.findByKey({
      tenantId: 'tenant-mwikila',
      account: '11111111-1111-1111-1111-111111111111',
      teamId: 't1',
      channelId: 'c1',
      messageId: 'msg-1',
    });
    expect(r?.payload.content).toBe('v2');
  });
});

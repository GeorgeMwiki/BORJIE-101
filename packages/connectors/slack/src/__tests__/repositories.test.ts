import { describe, expect, it } from 'vitest';
import {
  createInMemorySlackMessagesRepository,
} from '../repositories/messages.js';
import {
  createInMemoryCredentialsRepository,
} from '../repositories/credentials.js';
import {
  createInMemoryCursorRepository,
} from '../repositories/cursors.js';
import type { SlackMessage, StoredCredentials } from '../types.js';

function buildMessage(ts: string): SlackMessage {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenant_id: 'tenant-001',
    workspace_id: 'T01TEAM',
    channel_id: 'C01OPS',
    ts,
    user_id: 'U01ADMIN',
    text: 'hi',
    thread_ts: null,
    reactions: [],
    files: [],
    raw: { type: 'message' },
    ingested_at: '2026-05-26T12:00:00.000Z',
    audit_hash: 'h',
  };
}

describe('Slack repositories — in-memory round-trip', () => {
  it('messages: put + findByDedupKey round-trip with dedup', async () => {
    const repo = createInMemorySlackMessagesRepository();
    const a = buildMessage('1700000000.000100');
    const b = buildMessage('1700000000.000100'); // same dedup key
    const first = await repo.put(a);
    const second = await repo.put(b);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    const found = await repo.findByDedupKey({
      tenantId: a.tenant_id,
      workspaceId: a.workspace_id,
      channelId: a.channel_id,
      ts: a.ts,
    });
    expect(found?.ts).toBe(a.ts);
  });

  it('credentials: put + get + delete round-trip', async () => {
    const repo = createInMemoryCredentialsRepository();
    const creds: StoredCredentials = {
      tenant_id: 'tenant-001',
      connector_kind: 'slack',
      connector_account: 'T01TEAM',
      access_token_enc: new Uint8Array([1, 2, 3]),
      refresh_token_enc: new Uint8Array([4, 5, 6]),
      scopes: ['channels:history'],
      expires_at: '2026-06-26T00:00:00.000Z',
      audit_hash: 'h',
    };
    await repo.put(creds);
    const got = await repo.get({
      tenantId: 'tenant-001',
      connectorAccount: 'T01TEAM',
    });
    expect(got?.access_token_enc).toEqual(creds.access_token_enc);
    await repo.delete({ tenantId: 'tenant-001', connectorAccount: 'T01TEAM' });
    expect(
      await repo.get({ tenantId: 'tenant-001', connectorAccount: 'T01TEAM' }),
    ).toBeNull();
  });

  it('cursors: put + get round-trip preserves null', async () => {
    const repo = createInMemoryCursorRepository();
    await repo.put({ tenantId: 'tenant-001', connectorAccount: 'T01TEAM' }, 'c1');
    expect(
      await repo.get({ tenantId: 'tenant-001', connectorAccount: 'T01TEAM' }),
    ).toBe('c1');
    await repo.put({ tenantId: 'tenant-001', connectorAccount: 'T01TEAM' }, null);
    expect(
      await repo.get({ tenantId: 'tenant-001', connectorAccount: 'T01TEAM' }),
    ).toBeNull();
  });
});

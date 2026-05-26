import { describe, expect, it } from 'vitest';
import { createInMemoryEmailMessagesRepository } from '../repositories/messages.js';
import { createInMemoryEmailCredentialsRepository } from '../repositories/credentials.js';
import { createInMemoryCursorRepository } from '../repositories/cursors.js';
import type { EmailMessage, StoredEmailCredentials } from '../types.js';

function buildMessage(messageId: string): EmailMessage {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenant_id: 'tenant-001',
    provider: 'gmail',
    account: 'mwikila@example.com',
    message_id: messageId,
    thread_id: 't-1',
    from_addr: '[email:xxxx]',
    to_addrs: ['[email:yyyy]'],
    subject: 'redacted-subject',
    body_text: 'redacted-body',
    body_html: null,
    attachments: [],
    raw: { labelIds: [] },
    ingested_at: '2026-05-26T12:00:00.000Z',
    audit_hash: 'h',
  };
}

describe('Email repositories — in-memory round-trip', () => {
  it('messages: dedup on (tenant, provider, account, message_id)', async () => {
    const repo = createInMemoryEmailMessagesRepository();
    const a = buildMessage('msg-1');
    const b = buildMessage('msg-1');
    const first = await repo.put(a);
    const second = await repo.put(b);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
  });

  it('credentials: put + get + delete', async () => {
    const repo = createInMemoryEmailCredentialsRepository();
    const creds: StoredEmailCredentials = {
      tenant_id: 'tenant-001',
      connector_kind: 'gmail',
      connector_account: 'mwikila@example.com',
      access_token_enc: new Uint8Array([1, 2, 3]),
      refresh_token_enc: new Uint8Array([4, 5, 6]),
      scopes: ['gmail.readonly'],
      expires_at: '2026-06-26T00:00:00.000Z',
      audit_hash: 'h',
    };
    await repo.put(creds);
    const got = await repo.get({
      tenantId: 'tenant-001',
      provider: 'gmail',
      account: 'mwikila@example.com',
    });
    expect(got?.access_token_enc).toEqual(creds.access_token_enc);
    await repo.delete({
      tenantId: 'tenant-001',
      provider: 'gmail',
      account: 'mwikila@example.com',
    });
    expect(
      await repo.get({
        tenantId: 'tenant-001',
        provider: 'gmail',
        account: 'mwikila@example.com',
      }),
    ).toBeNull();
  });

  it('cursors: put + get round-trip', async () => {
    const repo = createInMemoryCursorRepository();
    const key = {
      tenantId: 'tenant-001',
      provider: 'gmail' as const,
      account: 'mwikila@example.com',
    };
    await repo.put(key, 'history-token-1');
    expect(await repo.get(key)).toBe('history-token-1');
    await repo.put(key, null);
    expect(await repo.get(key)).toBeNull();
  });
});

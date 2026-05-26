import { describe, it, expect } from 'vitest';
import { createInMemoryWhatsappRepository } from '../repositories/in-memory.js';
import type { WhatsappMessage } from '../types.js';

function makeRow(overrides: Partial<WhatsappMessage> = {}): WhatsappMessage {
  return {
    id: 'uuid-1',
    tenantId: 'tenant_a',
    wabaId: 'waba_1',
    phoneNumberId: 'pn_1',
    waMessageId: 'wamid.X',
    fromPhone: 'hash_from',
    toPhone: 'hash_to',
    direction: 'inbound',
    kind: 'text',
    text: 'hash_text',
    media: null,
    contacts: null,
    raw: {},
    ingestedAt: '2026-05-26T10:00:00.000Z',
    auditHash: 'audit_1',
    ...overrides,
  };
}

describe('in-memory WhatsApp repository', () => {
  it('inserts a new row and returns inserted=true', async () => {
    const repo = createInMemoryWhatsappRepository();
    const result = await repo.insert(makeRow());
    expect(result.inserted).toBe(true);
  });

  it('is idempotent on (tenant_id, waba_id, wa_message_id)', async () => {
    const repo = createInMemoryWhatsappRepository();
    await repo.insert(makeRow());
    const replay = await repo.insert(makeRow({ ingestedAt: 'later' }));
    expect(replay.inserted).toBe(false);
    const all = await repo.listByTenant('tenant_a');
    expect(all.length).toBe(1);
  });

  it('separates rows across tenants', async () => {
    const repo = createInMemoryWhatsappRepository();
    await repo.insert(makeRow({ tenantId: 'tenant_a' }));
    await repo.insert(makeRow({ tenantId: 'tenant_b' }));
    const a = await repo.listByTenant('tenant_a');
    const b = await repo.listByTenant('tenant_b');
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it('find returns null for missing rows', async () => {
    const repo = createInMemoryWhatsappRepository();
    const result = await repo.find('tenant_a', 'waba_1', 'wamid.MISSING');
    expect(result).toBeNull();
  });
});

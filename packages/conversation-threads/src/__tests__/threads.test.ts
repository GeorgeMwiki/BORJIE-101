/**
 * Tests for threads.ts.
 *
 * Cover:
 *   - createThread sets chain root hash
 *   - fork carries fork_of_thread_id and fork_of_message_id
 *   - WhatsApp 24h window: same session within 24h reuses thread, no
 *     rotation; arriving after 24h rotates external_channel_session_id
 *   - list filters by projectId, includeArchived
 *   - archive marks archivedAt
 */
import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_24H_WINDOW_MS,
  archiveThread,
  computeChainRootHash,
  createInMemoryThreadRepository,
  createThread,
  findOrCreateCustomerThread,
  forkThread,
  listThreads,
} from '../threads.js';

describe('createThread', () => {
  it('sets a chain root hash (64 hex chars)', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const idGen = (): string => `t_${++n}`;
    const t = await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      idGenerator: idGen,
      repository: repo,
    });
    expect(t.messageChainRootHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the provided "now" clock for createdAt', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const fixed = new Date('2026-05-22T08:00:00.000Z');
    const t = await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      idGenerator: () => `t_${++n}`,
      now: () => fixed,
      repository: repo,
    });
    expect(t.createdAt?.toISOString()).toBe(fixed.toISOString());
  });

  it('computeChainRootHash is deterministic', () => {
    const args = {
      tenantId: 't_abc',
      ownerPersonaId: 'p_1',
      threadId: 't_1',
      createdAtIso: '2026-05-22T08:00:00.000Z',
    };
    expect(computeChainRootHash(args)).toBe(computeChainRootHash(args));
  });
});

describe('forkThread', () => {
  it('carries fork_of_thread_id + fork_of_message_id', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const idGen = (): string => `t_${++n}`;
    const source = await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      title: 'Source',
      idGenerator: idGen,
      repository: repo,
    });
    const fork = await forkThread({
      tenantId: 't_abc',
      sourceThreadId: source.id,
      atMessageId: 'msg_42',
      idGenerator: idGen,
      repository: repo,
    });
    expect(fork.forkOfThreadId).toBe(source.id);
    expect(fork.forkOfMessageId).toBe('msg_42');
    expect(fork.title).toContain('Source');
    expect(fork.messageChainRootHash).not.toBe(source.messageChainRootHash);
  });

  it('throws when source thread not found', async () => {
    const repo = createInMemoryThreadRepository();
    await expect(
      forkThread({
        tenantId: 't_abc',
        sourceThreadId: 'missing',
        atMessageId: 'msg_1',
        idGenerator: () => 'new',
        repository: repo,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('findOrCreateCustomerThread — 24h window', () => {
  it('creates a fresh thread when no thread exists for (user, channel)', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const result = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      repository: repo,
    });
    expect(result.thread.externalChannelSessionId).toBe('wa_sess_1');
    expect(result.sessionRotated).toBe(false);
  });

  it('reuses thread + same session within 24h', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const t0 = new Date('2026-05-22T08:00:00.000Z');
    const first = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      now: () => t0,
      repository: repo,
    });
    // Mark lastMessageAt manually (simulating a message having been
    // appended) so the window calc has a basis to evaluate.
    await repo.update({
      tenantId: 't_abc',
      id: first.thread.id,
      patch: { lastMessageAt: t0 },
    });
    const t1 = new Date(t0.getTime() + 10 * 60 * 1000); // 10 min later
    const second = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      now: () => t1,
      repository: repo,
    });
    expect(second.sessionRotated).toBe(false);
    expect(second.thread.id).toBe(first.thread.id);
  });

  it('rotates session id when outside 24h window', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const t0 = new Date('2026-05-22T08:00:00.000Z');
    const first = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      now: () => t0,
      repository: repo,
    });
    await repo.update({
      tenantId: 't_abc',
      id: first.thread.id,
      patch: { lastMessageAt: t0 },
    });
    const t2 = new Date(t0.getTime() + WHATSAPP_24H_WINDOW_MS + 60 * 1000);
    const second = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1', // upstream may re-send the old one
      sessionIdGenerator: () => 'wa_sess_2',
      idGenerator: () => `t_${++n}`,
      now: () => t2,
      repository: repo,
    });
    expect(second.sessionRotated).toBe(true);
    expect(second.thread.id).toBe(first.thread.id);
    expect(second.thread.externalChannelSessionId).toBe('wa_sess_2');
  });

  it('updates session id when upstream resends a different id inside the window', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const t0 = new Date('2026-05-22T08:00:00.000Z');
    const first = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      now: () => t0,
      repository: repo,
    });
    await repo.update({
      tenantId: 't_abc',
      id: first.thread.id,
      patch: { lastMessageAt: t0 },
    });
    const t1 = new Date(t0.getTime() + 60 * 1000); // 1 min later
    const second = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_NEW',
      idGenerator: () => `t_${++n}`,
      now: () => t1,
      repository: repo,
    });
    expect(second.sessionRotated).toBe(false);
    expect(second.thread.externalChannelSessionId).toBe('wa_sess_NEW');
  });

  it('falls back to existing session id when sessionIdGenerator omitted on rotation', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const t0 = new Date('2026-05-22T08:00:00.000Z');
    const first = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      now: () => t0,
      repository: repo,
    });
    await repo.update({
      tenantId: 't_abc',
      id: first.thread.id,
      patch: { lastMessageAt: t0 },
    });
    const tLate = new Date(t0.getTime() + WHATSAPP_24H_WINDOW_MS + 1);
    const second = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_RESEND',
      idGenerator: () => `t_${++n}`,
      now: () => tLate,
      repository: repo,
    });
    expect(second.sessionRotated).toBe(true);
    expect(second.thread.externalChannelSessionId).toBe('wa_sess_RESEND');
  });

  it('respects a custom windowMs override', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const t0 = new Date('2026-05-22T08:00:00.000Z');
    const first = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      idGenerator: () => `t_${++n}`,
      now: () => t0,
      windowMs: 60_000,
      repository: repo,
    });
    await repo.update({
      tenantId: 't_abc',
      id: first.thread.id,
      patch: { lastMessageAt: t0 },
    });
    const t1 = new Date(t0.getTime() + 120_000); // 2 min later — outside our 60s window
    const second = await findOrCreateCustomerThread({
      tenantId: 't_abc',
      ownerUserId: 'u_cust',
      ownerPersonaId: 'persona_customer',
      channel: 'whatsapp',
      externalChannelSessionId: 'wa_sess_1',
      sessionIdGenerator: () => 'wa_sess_2',
      idGenerator: () => `t_${++n}`,
      now: () => t1,
      windowMs: 60_000,
      repository: repo,
    });
    expect(second.sessionRotated).toBe(true);
    expect(second.thread.externalChannelSessionId).toBe('wa_sess_2');
  });
});

describe('listThreads', () => {
  it('filters by projectId', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const idGen = (): string => `t_${++n}`;
    await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_a',
      idGenerator: idGen,
      repository: repo,
    });
    await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_b',
      idGenerator: idGen,
      repository: repo,
    });
    await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      idGenerator: idGen,
      repository: repo,
    });
    const a = await listThreads({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_a',
      repository: repo,
    });
    expect(a.length).toBe(1);
    const unbinded = await listThreads({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      projectId: null,
      repository: repo,
    });
    expect(unbinded.length).toBe(1);
  });
});

describe('archiveThread', () => {
  it('marks archivedAt', async () => {
    const repo = createInMemoryThreadRepository();
    let n = 0;
    const t = await createThread({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      idGenerator: () => `t_${++n}`,
      repository: repo,
    });
    await archiveThread({
      tenantId: 't_abc',
      id: t.id,
      repository: repo,
    });
    const list = await listThreads({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      repository: repo,
    });
    expect(list.length).toBe(0);
    const listAll = await listThreads({
      tenantId: 't_abc',
      ownerUserId: 'u_1',
      ownerPersonaId: 'persona_1',
      includeArchived: true,
      repository: repo,
    });
    expect(listAll.length).toBe(1);
  });

  it('throws when archiving a missing thread', async () => {
    const repo = createInMemoryThreadRepository();
    await expect(
      archiveThread({ tenantId: 't_abc', id: 'missing', repository: repo }),
    ).rejects.toThrow(/not found/);
  });
});

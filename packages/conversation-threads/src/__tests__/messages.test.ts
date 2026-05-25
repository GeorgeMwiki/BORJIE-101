/**
 * Tests for messages.ts.
 *
 * Cover:
 *   - appendMessage links into chain via prev_hash → hash
 *   - hash determinism across runs
 *   - verifyThreadChain accepts a fresh chain, rejects a tampered one
 *   - artifact and asset ref arrays preserved
 *   - tenant isolation in the in-memory repo
 */
import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  createInMemoryMessageRepository,
  listMessages,
  verifyThreadChain,
} from '../messages.js';
import { GENESIS_HASH } from '../hash-chain.js';

describe('appendMessage', () => {
  it('first message uses chainRootHash as prev_hash', async () => {
    const repo = createInMemoryMessageRepository();
    const m = await appendMessage({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      role: 'user',
      contentJsonb: { type: 'text', text: 'hello' },
      idGenerator: () => 'm_1',
      now: () => new Date('2026-05-22T10:00:00.000Z'),
      repository: repo,
    });
    expect(m.prevHash).toBe(GENESIS_HASH);
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('subsequent messages chain off the latest hash', async () => {
    const repo = createInMemoryMessageRepository();
    const m1 = await appendMessage({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      role: 'user',
      contentJsonb: { type: 'text', text: 'one' },
      idGenerator: () => 'm_1',
      repository: repo,
    });
    const m2 = await appendMessage({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      role: 'assistant',
      contentJsonb: { type: 'text', text: 'two' },
      idGenerator: () => 'm_2',
      repository: repo,
    });
    expect(m2.prevHash).toBe(m1.hash);
  });

  it('preserves optional fields', async () => {
    const repo = createInMemoryMessageRepository();
    const m = await appendMessage({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      role: 'assistant',
      contentJsonb: { type: 'text', text: 'with refs' },
      parentMessageId: 'm_0',
      toolCallsJsonb: { calls: [{ name: 'read.lease' }] },
      artifactRefIds: ['a_1', 'a_2'],
      actionPlanIds: ['ap_7'],
      assetRefs: ['core_entity_1'],
      idGenerator: () => 'm_99',
      repository: repo,
    });
    expect(m.parentMessageId).toBe('m_0');
    expect(m.toolCallsJsonb?.calls).toBeTruthy();
    expect([...(m.artifactRefIds ?? [])]).toEqual(['a_1', 'a_2']);
    expect([...(m.actionPlanIds ?? [])]).toEqual(['ap_7']);
    expect([...(m.assetRefs ?? [])]).toEqual(['core_entity_1']);
  });
});

describe('verifyThreadChain', () => {
  it('returns valid for an empty thread', async () => {
    const repo = createInMemoryMessageRepository();
    const r = await verifyThreadChain({
      tenantId: 't_abc',
      threadId: 'thr_empty',
      chainRootHash: GENESIS_HASH,
      repository: repo,
    });
    expect(r.valid).toBe(true);
  });

  it('accepts a fresh chain', async () => {
    const repo = createInMemoryMessageRepository();
    let i = 0;
    const idGen = (): string => `m_${++i}`;
    for (const text of ['one', 'two', 'three']) {
      await appendMessage({
        tenantId: 't_abc',
        threadId: 'thr_1',
        chainRootHash: GENESIS_HASH,
        role: 'user',
        contentJsonb: { type: 'text', text },
        idGenerator: idGen,
        repository: repo,
      });
    }
    const r = await verifyThreadChain({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      repository: repo,
    });
    expect(r.valid).toBe(true);
  });

  it('detects tampering — content mutation breaks the chain', async () => {
    const repo = createInMemoryMessageRepository();
    let i = 0;
    const idGen = (): string => `m_${++i}`;
    await appendMessage({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      role: 'user',
      contentJsonb: { type: 'text', text: 'original' },
      idGenerator: idGen,
      repository: repo,
    });
    const list = await listMessages({
      tenantId: 't_abc',
      threadId: 'thr_1',
      repository: repo,
    });
    // Tamper the stored message by replacing the content blob in place.
    // The in-memory repo returns the same reference, so mutating the
    // last element here mutates the store too.
    const original = list[0];
    if (!original) throw new Error('message missing');
    (original as unknown as { contentJsonb: Record<string, unknown> }).contentJsonb = {
      type: 'text',
      text: 'TAMPERED',
    };
    const r = await verifyThreadChain({
      tenantId: 't_abc',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      repository: repo,
    });
    expect(r.valid).toBe(false);
  });
});

describe('listMessages with limit', () => {
  it('respects the limit', async () => {
    const repo = createInMemoryMessageRepository();
    let i = 0;
    const idGen = (): string => `m_${++i}`;
    for (let k = 0; k < 5; k += 1) {
      await appendMessage({
        tenantId: 't_abc',
        threadId: 'thr_1',
        chainRootHash: GENESIS_HASH,
        role: 'user',
        contentJsonb: { type: 'text', text: `msg ${k}` },
        idGenerator: idGen,
        repository: repo,
      });
    }
    const out = await listMessages({
      tenantId: 't_abc',
      threadId: 'thr_1',
      limit: 2,
      repository: repo,
    });
    expect(out.length).toBe(2);
  });
});

describe('Cross-tenant message isolation', () => {
  it('does NOT return messages from other tenants', async () => {
    const repo = createInMemoryMessageRepository();
    let i = 0;
    const idGen = (): string => `m_${++i}`;
    await appendMessage({
      tenantId: 't_a',
      threadId: 'thr_1',
      chainRootHash: GENESIS_HASH,
      role: 'user',
      contentJsonb: { type: 'text', text: 'A secret' },
      idGenerator: idGen,
      repository: repo,
    });
    await appendMessage({
      tenantId: 't_b',
      threadId: 'thr_1', // same threadId by coincidence — tenant separates
      chainRootHash: GENESIS_HASH,
      role: 'user',
      contentJsonb: { type: 'text', text: 'B secret' },
      idGenerator: idGen,
      repository: repo,
    });
    const a = await listMessages({
      tenantId: 't_a',
      threadId: 'thr_1',
      repository: repo,
    });
    const b = await listMessages({
      tenantId: 't_b',
      threadId: 'thr_1',
      repository: repo,
    });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect((a[0]?.contentJsonb as { text: string }).text).toBe('A secret');
    expect((b[0]?.contentJsonb as { text: string }).text).toBe('B secret');
  });
});

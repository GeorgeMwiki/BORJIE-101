/**
 * Tests for retrieval.ts.
 *
 * Critical:
 *   - cross-thread retrieval respects (tenant, persona, project) namespace —
 *     no leak between projects, personas, or tenants
 *   - fuseRrf does reciprocal rank fusion on lexical + vector scores
 */
import { describe, expect, it } from 'vitest';
import {
  createInMemoryRetrievalRepository,
  fuseRrf,
  retrieveCrossThread,
  type InMemoryRetrievalIndexEntry,
} from '../retrieval.js';
import { GENESIS_HASH } from '../hash-chain.js';
import type { Message } from '../types.js';

function makeMessage(
  id: string,
  threadId: string,
  text: string,
): Message {
  return {
    id,
    threadId,
    tenantId: 't_abc',
    role: 'user',
    contentJsonb: { type: 'text', text },
    prevHash: GENESIS_HASH,
    hash: 'h_' + id,
    createdAt: new Date(),
  };
}

describe('retrieveCrossThread — tenant isolation', () => {
  it('does not return messages from other tenants', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_1',
        message: makeMessage('m_1', 'thr_a', 'eviction protocol'),
      },
      {
        tenantId: 't_b',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_1',
        message: makeMessage('m_2', 'thr_b', 'eviction protocol'),
      },
    ];
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_1',
      query: 'eviction',
      repository: repo,
    });
    expect(result.length).toBe(1);
    expect(result[0]?.threadId).toBe('thr_a');
  });
});

describe('retrieveCrossThread — persona isolation', () => {
  it('does not return messages from other personas', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_admin',
        projectId: 'proj_1',
        message: makeMessage('m_1', 'thr_a', 'admin secret'),
      },
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_customer',
        projectId: 'proj_1',
        message: makeMessage('m_2', 'thr_b', 'customer note'),
      },
    ];
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_customer',
      projectId: 'proj_1',
      query: 'note',
      repository: repo,
    });
    expect(result.length).toBe(1);
    expect(result[0]?.threadId).toBe('thr_b');
  });
});

describe('retrieveCrossThread — project isolation', () => {
  it('does not return messages from other projects', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_left',
        message: makeMessage('m_1', 'thr_a', 'unique-token-12345'),
      },
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_right',
        message: makeMessage('m_2', 'thr_b', 'unique-token-12345'),
      },
    ];
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_left',
      query: 'unique-token-12345',
      repository: repo,
    });
    expect(result.length).toBe(1);
    expect(result[0]?.threadId).toBe('thr_a');
  });

  it('null project matches only null-project entries', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_1',
        message: makeMessage('m_1', 'thr_a', 'in project'),
      },
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: null,
        message: makeMessage('m_2', 'thr_b', 'in project'),
      },
    ];
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_1',
      projectId: null,
      query: 'project',
      repository: repo,
    });
    expect(result.length).toBe(1);
    expect(result[0]?.threadId).toBe('thr_b');
  });
});

describe('retrieveCrossThread — limit', () => {
  it('respects an explicit limit', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [];
    for (let i = 0; i < 10; i += 1) {
      entries.push({
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_1',
        message: makeMessage(`m_${i}`, `thr_${i}`, `hit ${i}`),
      });
    }
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_1',
      query: 'hit',
      limit: 3,
      repository: repo,
    });
    expect(result.length).toBe(3);
  });

  it('returns empty when nothing matches', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_1',
        message: makeMessage('m_1', 'thr_a', 'hello world'),
      },
    ];
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_1',
      query: 'absent',
      repository: repo,
    });
    expect(result.length).toBe(0);
  });

  it('skips messages without text content', async () => {
    const entries: InMemoryRetrievalIndexEntry[] = [
      {
        tenantId: 't_a',
        ownerPersonaId: 'persona_1',
        projectId: 'proj_1',
        message: {
          ...makeMessage('m_1', 'thr_a', ''),
          contentJsonb: { type: 'tool_use', name: 'read.lease' },
        },
      },
    ];
    const repo = createInMemoryRetrievalRepository({ entries });
    const result = await retrieveCrossThread({
      tenantId: 't_a',
      ownerPersonaId: 'persona_1',
      projectId: 'proj_1',
      query: 'read',
      repository: repo,
    });
    expect(result.length).toBe(0);
  });
});

describe('fuseRrf', () => {
  it('returns higher fused score for items ranked high in both lists', () => {
    const cands = [
      {
        messageId: 'm_top',
        threadId: 'thr',
        content: 'top',
        lexicalScore: 0.9,
        vectorScore: 0.9,
      },
      {
        messageId: 'm_mid',
        threadId: 'thr',
        content: 'mid',
        lexicalScore: 0.5,
        vectorScore: 0.5,
      },
      {
        messageId: 'm_bot',
        threadId: 'thr',
        content: 'bot',
        lexicalScore: 0.1,
        vectorScore: 0.1,
      },
    ];
    const fused = fuseRrf(cands);
    expect(fused[0]?.messageId).toBe('m_top');
    expect(fused[2]?.messageId).toBe('m_bot');
  });

  it('handles candidates without scores', () => {
    const cands = [
      { messageId: 'a', threadId: 't', content: 'a' },
      { messageId: 'b', threadId: 't', content: 'b' },
    ];
    const fused = fuseRrf(cands);
    expect(fused.length).toBe(2);
  });
});

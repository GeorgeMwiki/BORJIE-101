/**
 * Semantic memory tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import {
  createSemanticMemory,
  createInMemorySemanticMemoryRepo,
  createHashEmbedder,
  cosineSimilarity,
} from '../memory/semantic-memory.js';
import { TenantBoundaryError, assertTenantScope } from '../security/tenant-isolation.js';

describe('semantic-memory', () => {
  it('recalls top-k memories ordered by similarity', async () => {
    const repo = createInMemorySemanticMemoryRepo();
    // Crafted embedder: exact-substring matches rank highest.
    const embedder = async (text: string) => {
      const norm = text.toLowerCase();
      return [
        norm.includes('whatsapp') ? 1 : 0,
        norm.includes('leaking') ? 1 : 0,
        norm.includes('waiver') ? 1 : 0,
      ];
    };
    const memory = createSemanticMemory({ repo, embedder });
    await memory.remember({ tenantId: 't1', content: 'Tenant prefers WhatsApp for rent reminders' });
    await memory.remember({ tenantId: 't1', content: 'Unit 4B has leaking pipes in the kitchen' });
    await memory.remember({ tenantId: 't1', content: 'Owner authorised late-fee waiver for April' });

    const results = await memory.recall('t1', 'WhatsApp contact preference', { limit: 2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].similarity).toBeGreaterThan(0);
    expect(results[0].memory.content.toLowerCase()).toContain('whatsapp');
  });

  it('isolates recall to the supplied tenant', async () => {
    const repo = createInMemorySemanticMemoryRepo();
    const memory = createSemanticMemory({
      repo,
      embedder: createHashEmbedder(64),
    });
    await memory.remember({ tenantId: 't1', content: 'Tenant prefers WhatsApp' });
    await memory.remember({ tenantId: 't2', content: 'Tenant prefers WhatsApp' });

    const resultsT1 = await memory.recall('t1', 'whatsapp');
    expect(resultsT1.every((r) => r.memory.tenantId === 't1')).toBe(true);
  });

  it('throws a TenantBoundaryError when cross-tenant memory is assembled', async () => {
    const repo = createInMemorySemanticMemoryRepo();
    const memory = createSemanticMemory({
      repo,
      embedder: createHashEmbedder(64),
    });
    const stored = await memory.remember({
      tenantId: 't2',
      content: 'Cross-tenant leakage',
    });
    const payload = { assembled: [stored] };
    expect(() => assertTenantScope(payload, { tenantId: 't1' })).toThrow(TenantBoundaryError);
  });

  it('cosineSimilarity returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

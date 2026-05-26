/**
 * Observe operation tests (Wave 18AA).
 */

import { describe, expect, it } from 'vitest';
import { createObserve } from '../operations/observe.js';
import {
  createInMemoryAuditChain,
} from '../audit/audit-chain-link.js';
import { createInMemoryCellRepository } from '../storage/cell-repository.js';
import { EMBEDDING_DIM, type EmbeddingService } from '../types.js';

function deterministicEmbedder(): EmbeddingService {
  return {
    async embed(text: string): Promise<ReadonlyArray<number>> {
      // Map each char to a slot — produces a 1536-dim vector
      // deterministic per input for test stability.
      const vec = new Array<number>(EMBEDDING_DIM).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        const slot = i % EMBEDDING_DIM;
        const existing = vec[slot] ?? 0;
        vec[slot] = existing + text.charCodeAt(i);
      }
      return vec;
    },
  };
}

let counter = 0;
const seqId = (): string => {
  counter += 1;
  return `cell-${counter.toString().padStart(4, '0')}`;
};

describe('memory.observe', () => {
  it('records a new observed cell with provenance and audit hash', async () => {
    const cells = createInMemoryCellRepository();
    const audit = createInMemoryAuditChain();
    const observe = createObserve({
      cells,
      embedder: deterministicEmbedder(),
      audit,
      id: seqId,
      now: () => '2026-05-26T10:00:00.000Z',
    });
    const cell = await observe(
      {
        content_text: 'Geita ore-grade peaks at 180m depth',
        kind: 'fact',
        initial_confidence: 0.6,
      },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 'geology',
        turn_id: 'turn-1',
      },
    );
    expect(cell.promotion_status).toBe('observed');
    expect(cell.kind).toBe('fact');
    expect(cell.contributed_by_specialisation).toBe('geology');
    expect(cell.content.embedding.length).toBe(EMBEDDING_DIM);
    expect(cell.audit_hash.length).toBeGreaterThan(0);
    expect(audit.history()).toHaveLength(1);
  });

  it('rejects empty content_text', async () => {
    const observe = createObserve({
      cells: createInMemoryCellRepository(),
      embedder: deterministicEmbedder(),
      audit: createInMemoryAuditChain(),
      id: seqId,
    });
    await expect(
      observe(
        { content_text: '', kind: 'fact' },
        {
          tenant_id: 't1',
          scope_id: 'tenant_root',
          specialisation: 'geology',
          turn_id: 'turn-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'observe.invalid_input' });
  });

  it('rejects missing tenant_id', async () => {
    const observe = createObserve({
      cells: createInMemoryCellRepository(),
      embedder: deterministicEmbedder(),
      audit: createInMemoryAuditChain(),
      id: seqId,
    });
    await expect(
      observe(
        { content_text: 'x', kind: 'fact' },
        {
          tenant_id: '',
          scope_id: 'tenant_root',
          specialisation: 'g',
          turn_id: 't',
        },
      ),
    ).rejects.toMatchObject({ code: 'observe.invalid_context' });
  });
});

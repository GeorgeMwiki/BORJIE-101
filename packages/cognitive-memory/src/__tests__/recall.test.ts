/**
 * Recall operation tests (Wave 18AA).
 *
 * The in-memory cell repository uses cosine similarity over the
 * embedding vectors — same shape as the production pgvector path,
 * just executed in-process. These tests verify scoping, status
 * filtering, and the include_decayed flag.
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { createObserve } from '../operations/observe.js';
import { createRecall } from '../operations/recall.js';
import { createInMemoryCellRepository } from '../storage/cell-repository.js';
import { EMBEDDING_DIM, type EmbeddingService } from '../types.js';

function deterministicEmbedder(): EmbeddingService {
  return {
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const vec = new Array<number>(EMBEDDING_DIM).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        const slot = i % EMBEDDING_DIM;
        vec[slot] = (vec[slot] ?? 0) + text.charCodeAt(i);
      }
      return vec;
    },
  };
}

let counter = 0;
const seqId = (): string => {
  counter += 1;
  return `id-${counter.toString().padStart(4, '0')}`;
};

describe('memory.recall', () => {
  it('returns semantically nearest cells within tenant + scope', async () => {
    const cells = createInMemoryCellRepository();
    const audit = createInMemoryAuditChain();
    const embedder = deterministicEmbedder();
    const observe = createObserve({ cells, embedder, audit, id: seqId });
    const recall = createRecall({ cells, embedder });

    await observe(
      { content_text: 'Geita gold mine output Q1', kind: 'fact' },
      { tenant_id: 't1', scope_id: 'tenant_root', specialisation: 'geology', turn_id: 'a' },
    );
    await observe(
      { content_text: 'Westlands lease velocity benchmark', kind: 'fact' },
      { tenant_id: 't1', scope_id: 'tenant_root', specialisation: 'market', turn_id: 'b' },
    );
    // Different tenant — should be invisible.
    await observe(
      { content_text: 'Geita gold mine output Q1', kind: 'fact' },
      { tenant_id: 't2', scope_id: 'tenant_root', specialisation: 'geology', turn_id: 'x' },
    );

    const hits = await recall({
      tenant_id: 't1',
      scope_id: 'tenant_root',
      intent: 'Geita gold mine output',
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.cell.tenant_id).toBe('t1');
    // The geology cell should outrank the marketplace cell on this query.
    expect(hits[0]?.cell.content.text).toContain('Geita');
  });

  it('honours scope: child scope sees own + tenant_root only', async () => {
    const cells = createInMemoryCellRepository();
    const audit = createInMemoryAuditChain();
    const embedder = deterministicEmbedder();
    const observe = createObserve({ cells, embedder, audit, id: seqId });
    const recall = createRecall({ cells, embedder });

    await observe(
      { content_text: 'Geita-South shift starts 06:00', kind: 'rule' },
      {
        tenant_id: 't1',
        scope_id: 'unit-south',
        specialisation: 'ops',
        turn_id: 's1',
      },
    );
    await observe(
      { content_text: 'Geita-North shift starts 07:00', kind: 'rule' },
      {
        tenant_id: 't1',
        scope_id: 'unit-north',
        specialisation: 'ops',
        turn_id: 'n1',
      },
    );
    await observe(
      { content_text: 'All tenants observe weekly safety briefings', kind: 'rule' },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 'safety',
        turn_id: 'r1',
      },
    );

    const southHits = await recall({
      tenant_id: 't1',
      scope_id: 'unit-south',
      intent: 'shift schedule briefing',
      limit: 5,
    });
    const southScopes = southHits.map((h) => h.cell.scope_id);
    expect(southScopes).toContain('unit-south');
    expect(southScopes).toContain('tenant_root');
    expect(southScopes).not.toContain('unit-north');
  });

  it('excludes decayed cells by default; includes them on include_decayed', async () => {
    const cells = createInMemoryCellRepository();
    const audit = createInMemoryAuditChain();
    const embedder = deterministicEmbedder();
    const observe = createObserve({ cells, embedder, audit, id: seqId });
    const recall = createRecall({ cells, embedder });

    const cell = await observe(
      { content_text: 'Legacy rate card 2018', kind: 'fact' },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 'sales',
        turn_id: 'l',
      },
    );
    await cells.update(cell.id, 't1', { promotion_status: 'decayed' });

    const defaultHits = await recall({
      tenant_id: 't1',
      scope_id: 'tenant_root',
      intent: 'Legacy rate card',
      limit: 5,
    });
    expect(defaultHits.find((h) => h.cell.id === cell.id)).toBeUndefined();

    const withDecayed = await recall({
      tenant_id: 't1',
      scope_id: 'tenant_root',
      intent: 'Legacy rate card',
      limit: 5,
      include_decayed: true,
    });
    expect(withDecayed.find((h) => h.cell.id === cell.id)).toBeDefined();
  });
});

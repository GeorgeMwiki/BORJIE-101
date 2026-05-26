/**
 * End-to-end smoke test for the 5 operations (Wave 18AA).
 *
 * Exercises observe → recall → cite → reinforce → contradict across
 * the in-memory adapters, verifying that:
 *   1. all five ops execute against the same shared store;
 *   2. audit-chain entries fire for every mutation;
 *   3. promotion lifecycle transitions trigger as expected.
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { createCite } from '../operations/cite.js';
import { createContradict } from '../operations/contradict.js';
import { createObserve } from '../operations/observe.js';
import { createRecall } from '../operations/recall.js';
import { createReinforce } from '../operations/reinforce.js';
import { createInMemoryCellRepository } from '../storage/cell-repository.js';
import { createInMemoryReinforcementRepository } from '../storage/reinforcement-repository.js';
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

describe('cognitive-memory smoke — all five ops on a shared store', () => {
  it('exercises observe → reinforce → recall → cite → contradict end-to-end', async () => {
    const cells = createInMemoryCellRepository();
    const reinforcements = createInMemoryReinforcementRepository();
    const audit = createInMemoryAuditChain();
    const embedder = deterministicEmbedder();
    const ctx_base = { tenant_id: 't1', scope_id: 'tenant_root' as const };

    const observe = createObserve({ cells, embedder, audit, id: seqId });
    const reinforce = createReinforce({ cells, reinforcements, audit, id: seqId });
    const recall = createRecall({ cells, embedder });
    const cite = createCite({ cells, audit });
    const contradict = createContradict({ cells, embedder, audit, id: seqId });

    // 1. observe — geology contributes a fact
    const observed = await observe(
      {
        content_text: 'Geita ore-grade peaks at 180m depth',
        kind: 'fact',
        initial_confidence: 0.6,
      },
      { ...ctx_base, specialisation: 'geology', turn_id: 't-1' },
    );
    expect(observed.promotion_status).toBe('observed');

    // 2. reinforce — marketplace + finance each agree (cross-specialisation)
    await reinforce(
      { cell_id: observed.id },
      { ...ctx_base, specialisation: 'marketplace', turn_id: 't-2' },
    );
    const after_finance = await reinforce(
      { cell_id: observed.id },
      { ...ctx_base, specialisation: 'finance', turn_id: 't-3' },
    );
    expect(after_finance.promotion_status).toBe('reinforced');

    // 3. recall — should find the cell
    const hits = await recall({
      ...ctx_base,
      intent: 'Geita ore grade depth',
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.cell.id).toBe(observed.id);

    // 4. cite — bumps access_count + last_accessed_at
    const cited = await cite(
      {
        cell_id: observed.id,
        artifact_id: 'doc-42',
        artifact_kind: 'doc',
      },
      { ...ctx_base, specialisation: 'reporting', turn_id: 't-4' },
    );
    expect(cited.access_count).toBe(1);
    expect(cited.last_accessed_at).not.toBeNull();

    // 5. contradict — new evidence claims peak is at 200m
    const result = await contradict(
      {
        cell_id: observed.id,
        new_evidence_text: 'Geita ore-grade actually peaks at 200m depth',
        new_evidence_confidence: 0.85,
      },
      { ...ctx_base, specialisation: 'geology', turn_id: 't-5' },
    );
    expect(result.original.promotion_status).toBe('contradicted');
    expect(result.original.contradicting_cell_id).toBe(result.replacement.id);
    expect(result.replacement.promotion_status).toBe('observed');

    // Audit chain wrote a row per mutation:
    // observe + reinforce x2 + cite + observe(replacement) + contradict = 6+
    expect(audit.history().length).toBeGreaterThanOrEqual(6);
  });

  it('rejects weak contradictions', async () => {
    const cells = createInMemoryCellRepository();
    const reinforcements = createInMemoryReinforcementRepository();
    const audit = createInMemoryAuditChain();
    const embedder = deterministicEmbedder();
    void reinforcements;

    const observe = createObserve({ cells, embedder, audit, id: seqId });
    const contradict = createContradict({ cells, embedder, audit, id: seqId });

    const c = await observe(
      { content_text: 'x', kind: 'fact' },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 's',
        turn_id: 't',
      },
    );
    await expect(
      contradict(
        {
          cell_id: c.id,
          new_evidence_text: 'maybe x',
          new_evidence_confidence: 0.5,
        },
        {
          tenant_id: 't1',
          scope_id: 'tenant_root',
          specialisation: 's',
          turn_id: 't',
        },
      ),
    ).rejects.toMatchObject({ code: 'contradict.evidence_too_weak' });
  });
});

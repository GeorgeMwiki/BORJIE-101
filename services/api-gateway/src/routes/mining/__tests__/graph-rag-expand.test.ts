/**
 * Unit tests for GraphRAG neighbourhood expansion.
 *
 * Asserts the two contractually-important behaviours:
 *   1. EMPTY-GRAPH FALLBACK — when the tenant graph yields no new chunk nodes,
 *      expansion returns `[]` (the caller stays byte-identical to vector-only;
 *      no fabrication).
 *   2. EXPANSION — when the graph reaches additional `corpus_chunk` nodes, their
 *      REAL text is resolved from intelligence_corpus_chunks and returned as
 *      extra evidence, de-duplicated against the seed chunks.
 */

import { describe, expect, it, vi } from 'vitest';
import { expandGraphEvidence } from '../graph-rag-expand.js';
import type { KgDbExec } from '../../../composition/knowledge-graph/postgres-kg-store.js';
import type { CorpusEvidence } from '../chat-corpus-evidence.js';

const TENANT = 'tenant-xyz';

const SEED: ReadonlyArray<CorpusEvidence> = [
  { id: 'chunk-1', text: 'royalty rate for gold', sourceFile: 'reg.md', url: null },
];

/** Stub db.execute with a per-call response queue. */
function stubDb(responses: ReadonlyArray<unknown>): KgDbExec {
  let i = 0;
  return {
    execute: vi.fn(async () => {
      const r = responses[i] ?? [];
      i += 1;
      return r;
    }),
  };
}

describe('expandGraphEvidence', () => {
  it('returns [] when there are no seed chunks', async () => {
    const db = stubDb([]);
    const out = await expandGraphEvidence({ db, tenantId: TENANT, seedChunks: [] });
    expect(out).toEqual([]);
  });

  it('falls back to [] cleanly when the graph reaches no new chunks', async () => {
    // expandFromSeed hydrates the seed node, then asks for neighbours.
    // Responses: getNode(seed) → the chunk node itself; getNeighbors → none.
    const db = stubDb([
      // getNode('corpus_chunk:chunk-1')
      [
        {
          id: 'corpus_chunk:chunk-1',
          tenant_id: TENANT,
          kind: 'corpus_chunk',
          entity_ref: 'chunk-1',
          label: 'reg',
          props: { entity_ref: 'chunk-1' },
        },
      ],
      // getNeighbors → no edges
      [],
    ]);
    const out = await expandGraphEvidence({
      db,
      tenantId: TENANT,
      seedChunks: SEED,
      depth: 1,
    });
    expect(out).toEqual([]);
  });

  it('returns extra real chunks reachable through the graph (deduped)', async () => {
    const db = stubDb([
      // getNode('corpus_chunk:chunk-1') (seed hydration)
      [
        {
          id: 'corpus_chunk:chunk-1',
          tenant_id: TENANT,
          kind: 'corpus_chunk',
          entity_ref: 'chunk-1',
          label: 'reg',
          props: { entity_ref: 'chunk-1' },
        },
      ],
      // getNeighbors(chunk-1): mentions an entity → chunk-2 via that entity.
      // We return edges + the involved nodes in one getNeighbors response set.
      // 1) edges
      [
        {
          id: 'corpus_chunk:chunk-1|mentions|estate_entity:e1',
          tenant_id: TENANT,
          src_node_id: 'corpus_chunk:chunk-1',
          dst_node_id: 'estate_entity:e1',
          relation: 'mentions',
          weight: 1,
          props: {},
        },
        {
          id: 'corpus_chunk:chunk-2|mentions|estate_entity:e1',
          tenant_id: TENANT,
          src_node_id: 'corpus_chunk:chunk-2',
          dst_node_id: 'estate_entity:e1',
          relation: 'mentions',
          weight: 1,
          props: {},
        },
      ],
      // 2) hydrate nodes for getNeighbors
      [
        {
          id: 'estate_entity:e1',
          tenant_id: TENANT,
          kind: 'estate_entity',
          entity_ref: 'e1',
          label: 'Acme',
          props: {},
        },
        {
          id: 'corpus_chunk:chunk-2',
          tenant_id: TENANT,
          kind: 'corpus_chunk',
          entity_ref: 'chunk-2',
          label: 'reg2',
          props: { entity_ref: 'chunk-2' },
        },
        {
          id: 'corpus_chunk:chunk-1',
          tenant_id: TENANT,
          kind: 'corpus_chunk',
          entity_ref: 'chunk-1',
          label: 'reg',
          props: { entity_ref: 'chunk-1' },
        },
      ],
      // depth=1 → no second hop. Final query: resolve text for [chunk-2].
      [
        {
          id: 'chunk-2',
          chunk_text: 'related gold royalty schedule',
          source_file: 'reg2.md',
          url: 'https://gov.example/reg2',
        },
      ],
    ]);
    const out = await expandGraphEvidence({
      db,
      tenantId: TENANT,
      seedChunks: SEED,
      depth: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('chunk-2');
    expect(out[0]?.text).toContain('royalty');
    expect(out[0]?.url).toBe('https://gov.example/reg2');
    // The seed chunk (chunk-1) must NOT be re-emitted.
    expect(out.some((c) => c.id === 'chunk-1')).toBe(false);
  });

  it('degrades to [] when a DB error is thrown (never fabricates)', async () => {
    const db: KgDbExec = {
      execute: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    };
    const out = await expandGraphEvidence({
      db,
      tenantId: TENANT,
      seedChunks: SEED,
    });
    expect(out).toEqual([]);
  });
});

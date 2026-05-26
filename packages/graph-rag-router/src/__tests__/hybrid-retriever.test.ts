/**
 * Tests for the hybrid retriever — verify the right backend is
 * dispatched per mode, RRF fuses two lists correctly, and the
 * router classifies + retrieves end-to-end with mocked backends.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createRouter,
  reciprocalRankFuse,
} from '../routing/hybrid-retriever.js';
import type {
  GraphBackendPort,
  QueryContext,
  RetrievedChunk,
  VectorBackendPort,
} from '../types.js';

function chunk(id: string, score: number, source: 'vector' | 'graph_local' | 'graph_global'): RetrievedChunk {
  return { id, text: `text-${id}`, score, source };
}

function mockVector(out: ReadonlyArray<RetrievedChunk>): VectorBackendPort {
  return {
    async retrieve() {
      return out;
    },
  };
}

function mockGraph(
  local: ReadonlyArray<RetrievedChunk>,
  global: ReadonlyArray<RetrievedChunk>,
): GraphBackendPort {
  return {
    async retrieveLocal() {
      return local;
    },
    async retrieveGlobal() {
      return global;
    },
  };
}

const ctx: QueryContext = { tenantId: 't1', topK: 5 };

describe('reciprocalRankFuse', () => {
  it('returns empty array when given empty lists', () => {
    const out = reciprocalRankFuse([], 5);
    expect(out).toEqual([]);
  });

  it('boosts chunks that appear in multiple lists', () => {
    const a = [chunk('a', 1, 'vector'), chunk('b', 0.9, 'vector')];
    const b = [chunk('a', 1, 'graph_local'), chunk('c', 0.8, 'graph_local')];
    const out = reciprocalRankFuse([a, b], 5);
    expect(out[0]!.id).toBe('a');
    expect(out.length).toBe(3);
  });

  it('respects topK cap', () => {
    const a = ['1', '2', '3', '4', '5', '6'].map((id) => chunk(id, 1, 'vector'));
    const out = reciprocalRankFuse([a], 3);
    expect(out).toHaveLength(3);
  });
});

describe('router', () => {
  it('dispatches to vector for vector mode', async () => {
    const vector = mockVector([chunk('v1', 0.9, 'vector')]);
    const graph = mockGraph([], []);
    const vSpy = vi.spyOn(vector, 'retrieve');
    const gLocalSpy = vi.spyOn(graph, 'retrieveLocal');
    const router = createRouter({ vector, graph });
    const result = await router.retrieve(
      'q',
      { mode: 'vector', reason: 'r', confidence: 1 },
      ctx,
    );
    expect(result[0]!.id).toBe('v1');
    expect(vSpy).toHaveBeenCalledTimes(1);
    expect(gLocalSpy).not.toHaveBeenCalled();
  });

  it('dispatches to graph_local for graph_local mode', async () => {
    const vector = mockVector([]);
    const graph = mockGraph([chunk('g1', 0.7, 'graph_local')], []);
    const gSpy = vi.spyOn(graph, 'retrieveLocal');
    const router = createRouter({ vector, graph });
    const out = await router.retrieve(
      'q',
      { mode: 'graph_local', reason: 'r', confidence: 1 },
      ctx,
    );
    expect(out[0]!.id).toBe('g1');
    expect(gSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatches to graph_global for graph_global mode', async () => {
    const vector = mockVector([]);
    const graph = mockGraph([], [chunk('gg1', 0.6, 'graph_global')]);
    const gSpy = vi.spyOn(graph, 'retrieveGlobal');
    const router = createRouter({ vector, graph });
    const out = await router.retrieve(
      'q',
      { mode: 'graph_global', reason: 'r', confidence: 1 },
      ctx,
    );
    expect(out[0]!.id).toBe('gg1');
    expect(gSpy).toHaveBeenCalledTimes(1);
  });

  it('runs both backends in parallel for hybrid mode and fuses', async () => {
    const vector = mockVector([chunk('a', 1, 'vector')]);
    const graph = mockGraph([chunk('a', 1, 'graph_local'), chunk('b', 1, 'graph_local')], []);
    const router = createRouter({ vector, graph });
    const out = await router.retrieve(
      'q',
      { mode: 'hybrid', reason: 'r', confidence: 0.5 },
      ctx,
    );
    expect(out[0]!.id).toBe('a'); // appears in both lists → ranks highest
  });

  it('classify() forwards to query-classifier', () => {
    const router = createRouter({
      vector: mockVector([]),
      graph: mockGraph([], []),
    });
    const d = router.classify('summarise the themes across the quarter', ctx);
    expect(d.mode).toBe('graph_global');
  });

  it('uses default topK when ctx.topK is unset', async () => {
    let receivedTopK = -1;
    const vector: VectorBackendPort = {
      async retrieve({ topK }) {
        receivedTopK = topK;
        return [];
      },
    };
    const router = createRouter({
      vector,
      graph: mockGraph([], []),
    });
    await router.retrieve(
      'q',
      { mode: 'vector', reason: 'r', confidence: 1 },
      { tenantId: 't1' },
    );
    expect(receivedTopK).toBe(10);
  });
});

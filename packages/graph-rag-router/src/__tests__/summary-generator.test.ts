/**
 * Tests for the summary generator — verify drift-detection short
 * circuit, member-node filtering, and LLM port orchestration. The
 * LLM is mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  summariseCommunity,
  summaryId,
} from '../graph/summary-generator.js';
import type {
  Community,
  CommunitySummariserPort,
  CommunitySummary,
  GraphEdge,
  GraphNode,
} from '../types.js';

const nodes: GraphNode[] = [
  { id: 'n1', name: 'Alpha', type: 'concept', description: 'a' },
  { id: 'n2', name: 'Beta', type: 'concept', description: 'b' },
  { id: 'n3', name: 'Gamma', type: 'concept', description: 'c' },
];

const edges: GraphEdge[] = [
  { id: 'e1', fromId: 'n1', toId: 'n2', kind: 'k', weight: 1 },
  { id: 'e2', fromId: 'n2', toId: 'n3', kind: 'k', weight: 1 },
  // edge that bridges outside the community — should be filtered out
  { id: 'e3', fromId: 'n3', toId: 'nOut', kind: 'k', weight: 1 },
];

const community: Community = {
  id: 'c1',
  level: 0,
  parentCommunityId: null,
  memberEntityIds: ['n1', 'n2', 'n3'],
  signatureHash: 'sig-1',
};

function mockSummariser(summaryMd: string): CommunitySummariserPort {
  return {
    async summarise() {
      return { summaryMd, tokenCount: summaryMd.length };
    },
  };
}

const now = () => new Date('2026-05-26T03:30:00.000Z');

describe('summariseCommunity', () => {
  it('skips regeneration when signature is unchanged', async () => {
    const previous: CommunitySummary = {
      id: 'old',
      communityId: 'c1',
      summaryMd: 'old',
      tokenCount: 3,
      modelId: 'm-1',
      signatureHash: 'sig-1',
      generatedAt: '2026-05-25T00:00:00.000Z',
    };
    const summariser = mockSummariser('NEW summary');
    const summariseSpy = vi.spyOn(summariser, 'summarise');
    const out = await summariseCommunity({
      community,
      allNodes: nodes,
      allEdges: edges,
      summariser,
      modelId: 'm-1',
      previousSummary: previous,
      now,
    });
    expect(out.skipped).toBe(true);
    expect(out.summary).toBeNull();
    expect(summariseSpy).not.toHaveBeenCalled();
  });

  it('generates a summary when signature differs', async () => {
    const previous: CommunitySummary = {
      id: 'old',
      communityId: 'c1',
      summaryMd: 'old',
      tokenCount: 3,
      modelId: 'm-1',
      signatureHash: 'sig-OLD',
      generatedAt: '2026-05-25T00:00:00.000Z',
    };
    const out = await summariseCommunity({
      community,
      allNodes: nodes,
      allEdges: edges,
      summariser: mockSummariser('Fresh summary text.'),
      modelId: 'm-1',
      previousSummary: previous,
      now,
    });
    expect(out.skipped).toBe(false);
    expect(out.summary).not.toBeNull();
    expect(out.summary!.summaryMd).toBe('Fresh summary text.');
    expect(out.summary!.signatureHash).toBe('sig-1');
    expect(out.summary!.generatedAt).toBe('2026-05-26T03:30:00.000Z');
  });

  it('only passes nodes that belong to the community', async () => {
    let seenNodeIds: ReadonlyArray<string> = [];
    const summariser: CommunitySummariserPort = {
      async summarise({ nodes: ns }) {
        seenNodeIds = ns.map((n) => n.id);
        return { summaryMd: 's', tokenCount: 1 };
      },
    };
    await summariseCommunity({
      community: {
        ...community,
        memberEntityIds: ['n1', 'n2'],
        signatureHash: 'sig-2',
      },
      allNodes: nodes,
      allEdges: edges,
      summariser,
      modelId: 'm-1',
      previousSummary: null,
      now,
    });
    expect(seenNodeIds.sort()).toEqual(['n1', 'n2']);
  });

  it('only passes edges whose endpoints are both members', async () => {
    let seenEdgeIds: ReadonlyArray<string> = [];
    const summariser: CommunitySummariserPort = {
      async summarise({ edges: es }) {
        seenEdgeIds = es.map((e) => e.id);
        return { summaryMd: 's', tokenCount: 1 };
      },
    };
    await summariseCommunity({
      community,
      allNodes: nodes,
      allEdges: edges,
      summariser,
      modelId: 'm-1',
      previousSummary: null,
      now,
    });
    expect(seenEdgeIds).toEqual(['e1', 'e2']);
  });

  it('returns null + reason when no member nodes exist', async () => {
    const out = await summariseCommunity({
      community: { ...community, memberEntityIds: ['nope'] },
      allNodes: nodes,
      allEdges: edges,
      summariser: mockSummariser('whatever'),
      modelId: 'm-1',
      previousSummary: null,
      now,
    });
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('no-member-nodes');
  });

  it('summaryId is deterministic per (community, signature)', () => {
    expect(summaryId('c1', 'sig-1')).toBe(summaryId('c1', 'sig-1'));
    expect(summaryId('c1', 'sig-1')).not.toBe(summaryId('c1', 'sig-2'));
  });
});

import { describe, it, expect } from 'vitest';
import { buildGraph } from '../builder.js';
import {
  summariseOrganMap,
  queryBodySchema,
  blastRadius,
} from '../query.js';
import type { EdgeCandidate, NodeCandidate, SystemGraph } from '../types.js';

function fixture(): SystemGraph {
  const nodes: NodeCandidate[] = [
    { id: 'org:borjie', kind: 'org', label: 'Borjie', derivedFrom: 'self' },
    { id: 'surface:owner-web', kind: 'surface', label: 'owner-web', derivedFrom: 'screens' },
    { id: 'screen:owner-web/royalties', kind: 'screen', label: 'Royalties', derivedFrom: 'screens' },
    {
      id: 'capability:offtake',
      kind: 'capability',
      label: 'Offtake',
      derivedFrom: 'capabilities',
      health: { state: 'injured', competence: 0.1, calibrationError: 0.6, source: 'otel' },
    },
    { id: 'capability:royalty', kind: 'capability', label: 'Royalty', derivedFrom: 'capabilities' },
  ];
  const edges: EdgeCandidate[] = [
    { srcId: 'screen:owner-web/royalties', dstId: 'surface:owner-web', edgeType: 'renders_on' },
    { srcId: 'capability:royalty', dstId: 'capability:offtake', edgeType: 'depends_on' },
    { srcId: 'screen:owner-web/royalties', dstId: 'capability:royalty', edgeType: 'depends_on' },
  ];
  return buildGraph({ nodes, edges, derivedAt: '2026-06-08T00:00:00.000Z' });
}

describe('summariseOrganMap', () => {
  it('counts by kind and rolls up injured limbs', () => {
    const s = summariseOrganMap(fixture());
    expect(s.totalNodes).toBe(5);
    expect(s.countsByKind.capability).toBe(2);
    expect(s.countsByKind.surface).toBe(1);
    expect(s.injuredLimbs).toContain('capability:offtake');
  });
});

describe('queryBodySchema', () => {
  it('filters by kind', () => {
    const page = queryBodySchema(fixture(), { kind: 'capability' });
    expect(page.totalMatches).toBe(2);
    expect(page.nodes.every((n) => n.kind === 'capability')).toBe(true);
  });

  it('filters by injuredOnly', () => {
    const page = queryBodySchema(fixture(), { injuredOnly: true });
    expect(page.totalMatches).toBe(1);
    expect(page.nodes[0]!.id).toBe('capability:offtake');
  });

  it('searches id + label case-insensitively', () => {
    const page = queryBodySchema(fixture(), { search: 'ROYAL' });
    const ids = page.nodes.map((n) => n.id).sort();
    expect(ids).toContain('capability:royalty');
    expect(ids).toContain('screen:owner-web/royalties');
  });

  it('clamps limit and paginates', () => {
    const page = queryBodySchema(fixture(), { limit: 2, offset: 0 });
    expect(page.nodes).toHaveLength(2);
    expect(page.limit).toBe(2);
    const page2 = queryBodySchema(fixture(), { limit: 999 });
    expect(page2.limit).toBe(200);
  });

  it('orders by layer then id', () => {
    const page = queryBodySchema(fixture());
    const layers = page.nodes.map((n) => n.layer);
    const sorted = [...layers].sort((a, b) => a - b);
    expect(layers).toEqual(sorted);
  });
});

describe('blastRadius', () => {
  it('returns transitive dependents of an injured node', () => {
    // offtake <- royalty <- screen (via depends_on edges)
    const radius = blastRadius(fixture(), 'capability:offtake');
    expect(radius).toContain('capability:royalty');
    expect(radius).toContain('screen:owner-web/royalties');
  });

  it('excludes the node itself', () => {
    const radius = blastRadius(fixture(), 'capability:offtake');
    expect(radius).not.toContain('capability:offtake');
  });

  it('respects bounded depth', () => {
    const radius = blastRadius(fixture(), 'capability:offtake', 1);
    expect(radius).toEqual(['capability:royalty']);
  });
});

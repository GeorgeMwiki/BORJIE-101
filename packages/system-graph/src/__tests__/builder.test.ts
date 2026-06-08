import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  composeFragments,
  computeRevision,
  hasBodyChanged,
} from '../builder.js';
import type {
  EdgeCandidate,
  GraphFragment,
  NodeCandidate,
} from '../types.js';

const AT = '2026-06-08T00:00:00.000Z';

function node(id: string, kind: NodeCandidate['kind'] = 'package'): NodeCandidate {
  return { id, kind, label: id, derivedFrom: 'test' };
}

describe('buildGraph', () => {
  it('fills layer from kind and defaults health to null', () => {
    const g = buildGraph({ nodes: [node('package:a')], edges: [], derivedAt: AT });
    expect(g.nodes[0]!.layer).toBe(2);
    expect(g.nodes[0]!.health).toBeNull();
  });

  it('de-dupes nodes by id (morphology kept, health merged in)', () => {
    const withHealth: NodeCandidate = {
      ...node('package:a'),
      health: { state: 'injured', competence: 0.1, calibrationError: 0.5, source: 'otel' },
    };
    const g = buildGraph({
      nodes: [node('package:a'), withHealth],
      edges: [],
      derivedAt: AT,
    });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]!.health?.state).toBe('injured');
  });

  it('drops dangling edges (both endpoints must exist)', () => {
    const edges: EdgeCandidate[] = [
      { srcId: 'package:a', dstId: 'package:missing', edgeType: 'depends_on' },
      { srcId: 'package:a', dstId: 'package:b', edgeType: 'depends_on' },
    ];
    const g = buildGraph({
      nodes: [node('package:a'), node('package:b')],
      edges,
      derivedAt: AT,
    });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.dstId).toBe('package:b');
  });

  it('de-dupes identical edges', () => {
    const e: EdgeCandidate = { srcId: 'package:a', dstId: 'package:b', edgeType: 'depends_on' };
    const g = buildGraph({
      nodes: [node('package:a'), node('package:b')],
      edges: [e, { ...e }],
      derivedAt: AT,
    });
    expect(g.edges).toHaveLength(1);
  });

  it('defaults edge weight to 1', () => {
    const g = buildGraph({
      nodes: [node('package:a'), node('package:b')],
      edges: [{ srcId: 'package:a', dstId: 'package:b', edgeType: 'depends_on' }],
      derivedAt: AT,
    });
    expect(g.edges[0]!.weight).toBe(1);
  });
});

describe('computeRevision', () => {
  it('is order-independent', () => {
    const g1 = buildGraph({
      nodes: [node('package:a'), node('package:b')],
      edges: [],
      derivedAt: AT,
    });
    const g2 = buildGraph({
      nodes: [node('package:b'), node('package:a')],
      edges: [],
      derivedAt: '2099-01-01T00:00:00.000Z',
    });
    expect(g1.revision).toBe(g2.revision);
  });

  it('changes when a node changes', () => {
    const r1 = computeRevision(
      [{ id: 'x', kind: 'package', label: 'x', layer: 2, summary: '', derivedFrom: 't', health: null }],
      [],
    );
    const r2 = computeRevision(
      [{ id: 'x', kind: 'package', label: 'y', layer: 2, summary: '', derivedFrom: 't', health: null }],
      [],
    );
    expect(r1).not.toBe(r2);
  });

  it('changes when health flips', () => {
    const base = { id: 'x', kind: 'package' as const, label: 'x', layer: 2, summary: '', derivedFrom: 't' };
    const r1 = computeRevision([{ ...base, health: null }], []);
    const r2 = computeRevision(
      [{ ...base, health: { state: 'injured', competence: 0, calibrationError: 1, source: 'otel' } }],
      [],
    );
    expect(r1).not.toBe(r2);
  });
});

describe('composeFragments', () => {
  it('merges fragments order-independently', () => {
    const f1: GraphFragment = { nodes: [{ ...node('a'), id: 'a' }], edges: [] };
    const f2: GraphFragment = {
      nodes: [{ ...node('b'), id: 'b' }],
      edges: [{ srcId: 'a', dstId: 'b', edgeType: 'depends_on' }],
    };
    const g1 = composeFragments([f1, f2], AT);
    const g2 = composeFragments([f2, f1], AT);
    expect(g1.revision).toBe(g2.revision);
    expect(g1.nodes).toHaveLength(2);
    expect(g1.edges).toHaveLength(1);
  });
});

describe('hasBodyChanged', () => {
  it('is true when prev is null (first derivation)', () => {
    const g = buildGraph({ nodes: [node('a')], edges: [], derivedAt: AT });
    expect(hasBodyChanged(null, g)).toBe(true);
  });

  it('is false when revisions match (no-op re-derivation)', () => {
    const a = buildGraph({ nodes: [node('a')], edges: [], derivedAt: AT });
    const b = buildGraph({ nodes: [node('a')], edges: [], derivedAt: '2099-01-01T00:00:00.000Z' });
    expect(hasBodyChanged(a, b)).toBe(false);
  });

  it('is true when the body changed', () => {
    const a = buildGraph({ nodes: [node('a')], edges: [], derivedAt: AT });
    const b = buildGraph({ nodes: [node('a'), node('b')], edges: [], derivedAt: AT });
    expect(hasBodyChanged(a, b)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  bfs,
  buildShortestPathCte,
  buildTraversalCte,
  findAllReachableInMemory,
  findShortestPathInMemory,
  DEFAULT_MAX_HOPS,
} from '../traverse.js';
import type { OrgGraphEdge } from '../index.js';

const NOW = new Date('2026-05-22T06:00:00.000Z');

function edge(
  id: string,
  src: string,
  dst: string,
  edgeType: OrgGraphEdge['edgeType'],
  opts: { validTo?: Date | null } = {},
): OrgGraphEdge {
  return {
    id,
    tenantId: 'ten_trc',
    srcEntityId: src,
    dstEntityId: dst,
    edgeType,
    weight: 1.0,
    validFrom: NOW,
    validTo: opts.validTo ?? null,
    evidenceRefs: [],
    createdAt: NOW,
  };
}

describe('bfs / in-memory traversal', () => {
  it('returns direct neighbours at depth 1', () => {
    const edges = [
      edge('e1', 'a', 'b', 'reports_to'),
      edge('e2', 'a', 'c', 'reports_to'),
    ];
    const hops = bfs({
      edges,
      startEntityId: 'a',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(hops).toHaveLength(2);
    expect(hops.every((h) => h.depth === 1)).toBe(true);
  });

  it('walks transitive chains up to maxHops', () => {
    const edges = [
      edge('e1', 'a', 'b', 'reports_to'),
      edge('e2', 'b', 'c', 'reports_to'),
      edge('e3', 'c', 'd', 'reports_to'),
    ];
    const reachable = findAllReachableInMemory({
      edges,
      startEntityId: 'a',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(reachable).toContain('b');
    expect(reachable).toContain('c');
    expect(reachable).toContain('d');
  });

  it('stops at maxHops', () => {
    const edges = [
      edge('e1', 'a', 'b', 'reports_to'),
      edge('e2', 'b', 'c', 'reports_to'),
      edge('e3', 'c', 'd', 'reports_to'),
    ];
    const reachable = findAllReachableInMemory({
      edges,
      startEntityId: 'a',
      edgeTypes: ['reports_to'],
      maxHops: 2,
    });
    expect(reachable).toContain('b');
    expect(reachable).toContain('c');
    expect(reachable).not.toContain('d');
  });

  it('ignores edges with validTo set (closed edges)', () => {
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    const edges = [
      edge('e1', 'a', 'b', 'reports_to', { validTo: yesterday }),
      edge('e2', 'a', 'c', 'reports_to'),
    ];
    const reachable = findAllReachableInMemory({
      edges,
      startEntityId: 'a',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(reachable).not.toContain('b');
    expect(reachable).toContain('c');
  });

  it('handles cycles without infinite loop', () => {
    const edges = [
      edge('e1', 'a', 'b', 'reports_to'),
      edge('e2', 'b', 'a', 'reports_to'),
    ];
    const reachable = findAllReachableInMemory({
      edges,
      startEntityId: 'a',
      edgeTypes: ['reports_to'],
      maxHops: 10,
    });
    expect(reachable).toEqual(['b']);
  });

  it('supports reverse traversal (managed_by descendants)', () => {
    // a manages b and c; b manages d
    const edges = [
      edge('e1', 'b', 'a', 'managed_by'),
      edge('e2', 'c', 'a', 'managed_by'),
      edge('e3', 'd', 'b', 'managed_by'),
    ];
    // Find all assets managed by 'a' walking dst → src.
    const reachable = findAllReachableInMemory({
      edges,
      startEntityId: 'a',
      edgeTypes: ['managed_by'],
      maxHops: 3,
      direction: 'reverse',
    });
    expect(reachable).toContain('b');
    expect(reachable).toContain('c');
    expect(reachable).toContain('d');
  });

  it('respects edge type filter', () => {
    const edges = [
      edge('e1', 'a', 'b', 'reports_to'),
      edge('e2', 'a', 'c', 'leased_to'),
    ];
    const reachable = findAllReachableInMemory({
      edges,
      startEntityId: 'a',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(reachable).toContain('b');
    expect(reachable).not.toContain('c');
  });

  it('returns empty array when no neighbours match', () => {
    const reachable = findAllReachableInMemory({
      edges: [edge('e1', 'a', 'b', 'reports_to')],
      startEntityId: 'z',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(reachable).toEqual([]);
  });
});

describe('findShortestPathInMemory', () => {
  it('returns null when no path', () => {
    const edges = [edge('e1', 'a', 'b', 'reports_to')];
    const path = findShortestPathInMemory({
      edges,
      fromEntityId: 'a',
      toEntityId: 'z',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(path).toBeNull();
  });

  it('returns a 1-hop path when entities are directly connected', () => {
    const edges = [edge('e1', 'a', 'b', 'reports_to')];
    const path = findShortestPathInMemory({
      edges,
      fromEntityId: 'a',
      toEntityId: 'b',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(path).not.toBeNull();
    expect(path!.totalDepth).toBe(1);
  });

  it('finds shorter path when one exists', () => {
    const edges = [
      edge('e1', 'a', 'b', 'reports_to'),
      edge('e2', 'b', 'c', 'reports_to'),
      edge('e3', 'a', 'c', 'reports_to'),
    ];
    const path = findShortestPathInMemory({
      edges,
      fromEntityId: 'a',
      toEntityId: 'c',
      edgeTypes: ['reports_to'],
      maxHops: 3,
    });
    expect(path!.totalDepth).toBe(1);
  });
});

describe('SQL templates', () => {
  it('buildTraversalCte forward includes correct seed expression', () => {
    const sql = buildTraversalCte('forward');
    expect(sql).toContain('e.src_entity_id = $2');
    expect(sql).toContain('e.dst_entity_id');
    expect(sql).toContain('NOT (e.id = ANY(c.path))');
  });

  it('buildTraversalCte reverse includes correct seed expression', () => {
    const sql = buildTraversalCte('reverse');
    expect(sql).toContain('e.dst_entity_id = $2');
    expect(sql).toContain('e.src_entity_id');
  });

  it('buildShortestPathCte filters by tenant + edge types', () => {
    const sql = buildShortestPathCte();
    expect(sql).toContain('e.tenant_id = $1');
    expect(sql).toContain('e.edge_type = ANY($4::text[])');
    expect(sql).toContain('LIMIT 1');
  });

  it('DEFAULT_MAX_HOPS is 3', () => {
    expect(DEFAULT_MAX_HOPS).toBe(3);
  });
});

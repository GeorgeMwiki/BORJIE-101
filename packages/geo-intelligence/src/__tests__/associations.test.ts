import { describe, expect, it } from 'vitest';
import { createParcelGraph } from '../associations/index.js';
import type { GraphEdge, GraphNode } from '../types.js';

const parcel: GraphNode = { kind: 'parcel', id: 'p1', label: 'Plot 1' };
const unit: GraphNode = { kind: 'unit', id: 'u1', label: 'Unit 1' };
const lease: GraphNode = { kind: 'lease', id: 'l1', label: 'Lease 1' };
const tenant: GraphNode = { kind: 'tenant', id: 'te1', label: 'Tenant 1' };
const payment: GraphNode = { kind: 'payment', id: 'pay1' };
const doc: GraphNode = { kind: 'document', id: 'doc1' };

const edges: GraphEdge[] = [
  { from: parcel, to: unit, relation: 'contains' },
  { from: unit, to: lease, relation: 'has_lease' },
  { from: lease, to: tenant, relation: 'leased_to' },
  { from: tenant, to: payment, relation: 'paid' },
  { from: payment, to: doc, relation: 'evidenced_by' },
];

describe('associations — parcel graph', () => {
  it('builds with nodes + edges', () => {
    const g = createParcelGraph({ nodes: [parcel, unit, lease, tenant, payment, doc], edges });
    expect(g.getNode('parcel', 'p1')).toEqual(parcel);
  });

  it('1-hop association from parcel returns immediate neighbors', () => {
    const g = createParcelGraph({ edges });
    const sub = g.getAssociations('p1');
    const ids = sub.nodes.map((n) => `${n.kind}:${n.id}`).sort();
    expect(ids).toContain('parcel:p1');
    expect(ids).toContain('unit:u1');
    expect(ids).not.toContain('document:doc1');
  });

  it('multi-hop traversal reaches downstream entities', () => {
    const g = createParcelGraph({ edges });
    const sub = g.traverseFrom({ nodeKind: 'parcel', nodeId: 'p1', hops: 5 });
    const kinds = new Set(sub.nodes.map((n) => n.kind));
    expect(kinds.has('document')).toBe(true);
  });

  it('reverse traversal from a tenant reaches the parcel', () => {
    const g = createParcelGraph({ edges });
    const sub = g.traverseFrom({ nodeKind: 'tenant', nodeId: 'te1', hops: 5 });
    expect(sub.nodes.some((n) => n.kind === 'parcel')).toBe(true);
  });

  it('edge filter restricts traversal', () => {
    const g = createParcelGraph({ edges });
    const sub = g.traverseFrom({
      nodeKind: 'parcel',
      nodeId: 'p1',
      hops: 5,
      edgeFilter: (e) => e.relation === 'contains',
    });
    const kinds = new Set(sub.nodes.map((n) => n.kind));
    expect(kinds.has('document')).toBe(false);
  });

  it('addNode is immutable', () => {
    const g1 = createParcelGraph();
    const g2 = g1.addNode(parcel);
    expect(g1.getNode('parcel', 'p1')).toBeNull();
    expect(g2.getNode('parcel', 'p1')).toEqual(parcel);
  });

  it('addEdge auto-creates endpoint nodes', () => {
    const g = createParcelGraph().addEdge({ from: parcel, to: unit, relation: 'contains' });
    expect(g.getNode('unit', 'u1')).toEqual(unit);
  });
});

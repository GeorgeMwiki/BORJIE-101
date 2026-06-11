import { describe, it, expect } from 'vitest';
import {
  deriveSelf,
  deriveRoutes,
  deriveScreens,
  derivePackages,
  deriveSchemas,
  deriveMcpTools,
  deriveCapabilities,
  deriveJuniors,
} from '../derive.js';

describe('deriveSelf', () => {
  it('emits the LAYER-0 org node', () => {
    const f = deriveSelf();
    expect(f.nodes).toHaveLength(1);
    expect(f.nodes[0]!.kind).toBe('org');
    expect(f.nodes[0]!.id).toBe('org:borjie');
  });
});

describe('deriveRoutes', () => {
  it('de-dupes services across many routes', () => {
    const f = deriveRoutes([
      { service: 'api-gateway', group: 'mining/bids', route: 'mining/bids' },
      { service: 'api-gateway', group: 'mining/buyers', route: 'mining/buyers' },
    ]);
    expect(f.nodes).toHaveLength(1);
    expect(f.nodes[0]!.kind).toBe('service');
  });
});

describe('deriveScreens', () => {
  it('emits surface + screen nodes with a renders_on edge', () => {
    const f = deriveScreens([
      { surface: 'owner-web', screen: 'royalties', label: 'Royalties' },
    ]);
    const kinds = f.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(['screen', 'surface']);
    expect(f.edges[0]!.edgeType).toBe('renders_on');
    expect(f.edges[0]!.dstId).toBe('surface:owner-web');
  });

  it('shares a surface node across screens', () => {
    const f = deriveScreens([
      { surface: 'owner-web', screen: 'a', label: 'A' },
      { surface: 'owner-web', screen: 'b', label: 'B' },
    ]);
    expect(f.nodes.filter((n) => n.kind === 'surface')).toHaveLength(1);
    expect(f.nodes.filter((n) => n.kind === 'screen')).toHaveLength(2);
  });
});

describe('derivePackages', () => {
  it('emits depends_on edges only between known packages', () => {
    const f = derivePackages([
      { name: '@borjie/a', deps: ['@borjie/b', '@borjie/unknown'] },
      { name: '@borjie/b', deps: [] },
    ]);
    expect(f.nodes).toHaveLength(2);
    expect(f.edges).toHaveLength(1);
    expect(f.edges[0]!.dstId).toBe('package:@borjie/b');
  });
});

describe('deriveSchemas', () => {
  it('emits one node per table', () => {
    const f = deriveSchemas([
      { table: 'marketplace_bids', file: 'marketplace-bids.schema.ts' },
    ]);
    expect(f.nodes[0]!.kind).toBe('schema');
    expect(f.nodes[0]!.id).toBe('schema:marketplace_bids');
  });
});

describe('deriveMcpTools', () => {
  it('emits exposes edge from service to tool', () => {
    const f = deriveMcpTools([{ tool: 'mining.bids.list', service: 'api-gateway' }]);
    expect(f.edges[0]!.edgeType).toBe('exposes');
    expect(f.edges[0]!.srcId).toBe('service:api-gateway');
    expect(f.edges[0]!.dstId).toBe('mcp:mining.bids.list');
  });
});

describe('deriveCapabilities', () => {
  it('skips draft + deprecated capabilities', () => {
    const f = deriveCapabilities([
      { id: 'live-cap', label: 'Live', lifecycle: 'live' },
      { id: 'draft-cap', label: 'Draft', lifecycle: 'draft' },
      { id: 'dead-cap', label: 'Dead', lifecycle: 'deprecated' },
    ]);
    const ids = f.nodes.filter((n) => n.kind === 'capability').map((n) => n.id);
    expect(ids).toEqual(['capability:live-cap']);
  });

  it('emits governed_by edge to a rail node', () => {
    const f = deriveCapabilities([
      { id: 'offtake', label: 'Offtake', lifecycle: 'live', governedBy: 'four_eye' },
    ]);
    const govEdge = f.edges.find((e) => e.edgeType === 'governed_by');
    expect(govEdge).toBeDefined();
    expect(govEdge!.dstId).toBe('rail:four_eye');
  });
});

describe('deriveJuniors', () => {
  it('emits serves edges to capabilities', () => {
    const f = deriveJuniors([
      { id: 'metallurgy', label: 'Metallurgy', serves: ['ore-grade', 'recovery'] },
    ]);
    expect(f.nodes[0]!.kind).toBe('junior');
    expect(f.edges.map((e) => e.dstId).sort()).toEqual([
      'capability:ore-grade',
      'capability:recovery',
    ]);
  });
});

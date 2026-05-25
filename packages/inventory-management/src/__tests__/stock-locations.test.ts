/**
 * Stock-location tests — hierarchy, ancestors/descendants, default
 * per-property location, tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  ancestorsOf,
  buildLocationTree,
  createLocation,
  defaultPropertyLocation,
  descendantsOf,
  findLocation,
  listLocations,
} from '../locations/stock-locations.js';
import type { LocationId, StockLocation } from '../types.js';

const tenantId = 't-1';

function seedHierarchy(): ReadonlyArray<StockLocation> {
  let tree: ReadonlyArray<StockLocation> = [];
  let i = 0;
  const gen = () => `loc-${++i}` as LocationId;
  const ware = createLocation(tree, tenantId, { name: 'Main Warehouse', kind: 'warehouse', parentLocationId: null }, gen);
  if (!ware.ok) throw new Error('seed');
  tree = ware.value.tree;
  const zone = createLocation(tree, tenantId, { name: 'Zone A', kind: 'zone', parentLocationId: ware.value.location.id }, gen);
  if (!zone.ok) throw new Error('seed');
  tree = zone.value.tree;
  const rack = createLocation(tree, tenantId, { name: 'Rack 1', kind: 'rack', parentLocationId: zone.value.location.id }, gen);
  if (!rack.ok) throw new Error('seed');
  tree = rack.value.tree;
  const bin = createLocation(tree, tenantId, { name: 'Bin 01', kind: 'bin', parentLocationId: rack.value.location.id }, gen);
  if (!bin.ok) throw new Error('seed');
  tree = bin.value.tree;
  return tree;
}

describe('createLocation', () => {
  it('seeds a 4-level hierarchy', () => {
    const tree = seedHierarchy();
    expect(tree).toHaveLength(4);
  });

  it('rejects an unknown parent', () => {
    const r = createLocation([], tenantId, { name: 'orphan', kind: 'zone', parentLocationId: 'nope' }, () => 'x' as LocationId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('PARENT_NOT_FOUND');
  });

  it('rejects a parent from another tenant', () => {
    const seed = createLocation([], 't-other', { name: 'W', kind: 'warehouse', parentLocationId: null }, () => 'p1' as LocationId);
    if (!seed.ok) throw new Error('seed');
    const r = createLocation(seed.value.tree, tenantId, { name: 'Z', kind: 'zone', parentLocationId: 'p1' }, () => 'p2' as LocationId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('ancestorsOf / descendantsOf', () => {
  it('walks parents up to the root', () => {
    const tree = seedHierarchy();
    const bin = tree[3]!;
    const chain = ancestorsOf(tree, bin.id);
    expect(chain.map((l) => l.name)).toEqual(['Rack 1', 'Zone A', 'Main Warehouse']);
  });

  it('walks descendants from root', () => {
    const tree = seedHierarchy();
    const root = tree[0]!;
    const desc = descendantsOf(tree, root.id);
    expect(desc.map((l) => l.name)).toEqual(['Zone A', 'Rack 1', 'Bin 01']);
  });
});

describe('buildLocationTree', () => {
  it('builds a nested tree for the tenant only', () => {
    const tree = seedHierarchy();
    const built = buildLocationTree(tree, tenantId);
    expect(built).toHaveLength(1);
    expect(built[0]!.location.name).toBe('Main Warehouse');
    expect(built[0]!.children).toHaveLength(1);
    expect(built[0]!.children[0]!.children[0]!.children[0]!.location.name).toBe('Bin 01');
  });
});

describe('findLocation + listLocations', () => {
  it('isolates by tenant', () => {
    const tree = seedHierarchy();
    expect(findLocation(tree, 'attacker', tree[0]!.id)).toBeNull();
    expect(findLocation(tree, tenantId, tree[0]!.id)?.name).toBe('Main Warehouse');
  });

  it('filters by kind', () => {
    const tree = seedHierarchy();
    expect(listLocations(tree, tenantId, { kind: 'warehouse' })).toHaveLength(1);
    expect(listLocations(tree, tenantId, { kind: 'bin' })).toHaveLength(1);
  });
});

describe('defaultPropertyLocation', () => {
  it('creates a property location on first call, reuses it after', () => {
    let i = 0;
    const gen = () => `prop-loc-${++i}` as LocationId;
    const a = defaultPropertyLocation([], tenantId, 'PROP-1', gen);
    expect(a.tree).toHaveLength(1);
    expect(a.location.kind).toBe('property');
    const b = defaultPropertyLocation(a.tree, tenantId, 'PROP-1', gen);
    expect(b.tree).toHaveLength(1);
    expect(b.location.id).toBe(a.location.id); // reuse
  });
});

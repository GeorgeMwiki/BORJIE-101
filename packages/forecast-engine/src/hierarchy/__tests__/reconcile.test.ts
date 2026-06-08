/**
 * Hierarchical reconciliation (MinT-lite) — coherence proof.
 */

import { describe, it, expect } from 'vitest';
import { reconcile, isCoherent, type HierarchyNode } from '../reconcile.js';

// estate -> [sub-a, sub-b]; sub-a -> [site-1, site-2]; sub-b -> [site-3]
const NODES: HierarchyNode[] = [
  { id: 'estate', children: ['sub-a', 'sub-b'] },
  { id: 'sub-a', children: ['site-1', 'site-2'] },
  { id: 'sub-b', children: ['site-3'] },
  { id: 'site-1', children: [] },
  { id: 'site-2', children: [] },
  { id: 'site-3', children: [] },
];

describe('reconcile (MinT-lite)', () => {
  it('produces COHERENT forecasts: parent == sum(children)', () => {
    // incoherent base: estate says 100 but children sum to 90.
    const base = {
      estate: 100,
      'sub-a': 60,
      'sub-b': 30,
      'site-1': 35,
      'site-2': 20,
      'site-3': 35,
    };
    const { reconciled } = reconcile({ nodes: NODES, base, method: 'ols' });
    expect(isCoherent(NODES, reconciled)).toBe(true);
    // every node present
    for (const n of NODES) expect(reconciled[n.id]).toBeDefined();
  });

  it('leaves an already-coherent set close to its base', () => {
    const base = {
      estate: 90,
      'sub-a': 55,
      'sub-b': 35,
      'site-1': 30,
      'site-2': 25,
      'site-3': 35,
    };
    const { reconciled } = reconcile({ nodes: NODES, base, method: 'ols' });
    expect(isCoherent(NODES, reconciled)).toBe(true);
    // total mass is preserved within the reconciliation (root ~ mean of
    // top-down and bottom-up signals, all of which agree here).
    expect(reconciled['estate']!).toBeGreaterThan(80);
    expect(reconciled['estate']!).toBeLessThan(100);
  });

  it('wls-struct down-weights aggregated nodes vs ols', () => {
    const base = {
      estate: 1000, // very wrong top-level
      'sub-a': 60,
      'sub-b': 30,
      'site-1': 35,
      'site-2': 20,
      'site-3': 35,
    };
    const ols = reconcile({ nodes: NODES, base, method: 'ols' }).reconciled;
    const wls = reconcile({ nodes: NODES, base, method: 'wls-struct' }).reconciled;
    expect(isCoherent(NODES, ols)).toBe(true);
    expect(isCoherent(NODES, wls)).toBe(true);
    // wls-struct trusts the (noisier) aggregate estate value LESS, so
    // its estate estimate is pulled closer to the leaf sum than OLS's.
    const leafSum = base['site-1'] + base['site-2'] + base['site-3'];
    expect(Math.abs(wls['estate']! - leafSum)).toBeLessThan(
      Math.abs(ols['estate']! - leafSum),
    );
  });

  it('handles a 4-level estate->subsidiary->site->mineral tree', () => {
    const nodes: HierarchyNode[] = [
      { id: 'estate', children: ['sub'] },
      { id: 'sub', children: ['site'] },
      { id: 'site', children: ['au', 'ag'] },
      { id: 'au', children: [] },
      { id: 'ag', children: [] },
    ];
    const base = { estate: 50, sub: 48, site: 47, au: 30, ag: 12 };
    const { reconciled } = reconcile({ nodes, base, method: 'ols' });
    expect(isCoherent(nodes, reconciled)).toBe(true);
    expect(reconciled['estate']).toBeCloseTo(
      reconciled['au']! + reconciled['ag']!,
      9,
    );
  });

  it('detects a cycle and throws (no silent infinite recursion)', () => {
    const cyclic: HierarchyNode[] = [
      { id: 'a', children: ['b'] },
      { id: 'b', children: ['a'] },
    ];
    expect(() =>
      reconcile({ nodes: cyclic, base: { a: 1, b: 1 } }),
    ).toThrow(/cycle/);
  });

  it('isCoherent returns false for an incoherent set', () => {
    const incoherent = {
      estate: 100,
      'sub-a': 10,
      'sub-b': 10,
      'site-1': 5,
      'site-2': 5,
      'site-3': 10,
    };
    expect(isCoherent(NODES, incoherent)).toBe(false);
  });
});

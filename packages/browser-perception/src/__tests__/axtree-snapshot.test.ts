/**
 * axtree-snapshot.ts tests — verify Playwright a11y-tree extraction,
 * depth + node caps, hidden-node filtering, empty-subtree pruning.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  captureAxTreeSnapshot,
  flattenAxNodes,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  type RawAxNode,
} from '../axtree-snapshot.js';

function mockPage(raw: RawAxNode | null, url = 'https://itax.kra.go.ke/') {
  return {
    url: () => url,
    accessibility: {
      snapshot: vi.fn(async () => raw),
    },
  };
}

describe('captureAxTreeSnapshot', () => {
  it('returns a null root when Playwright snapshot is null', async () => {
    const snap = await captureAxTreeSnapshot(mockPage(null));
    expect(snap.root).toBeNull();
    expect(snap.nodeCount).toBe(0);
  });

  it('keeps actionable controls with empty names (button etc.)', async () => {
    const raw: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [
        { role: 'button', name: '', children: [] },
      ],
    };
    const snap = await captureAxTreeSnapshot(mockPage(raw));
    expect(snap.root?.children?.[0]?.role).toBe('button');
  });

  it('prunes hidden / ignored subtrees', async () => {
    const raw: RawAxNode = {
      role: 'WebArea',
      name: 'KRA',
      children: [
        { role: 'button', name: 'Login' },
        { role: 'generic', name: '', ignored: true, children: [{ role: 'button', name: 'Hidden' }] },
      ],
    };
    const snap = await captureAxTreeSnapshot(mockPage(raw));
    const flat = flattenAxNodes(snap.root);
    expect(flat.some((n) => n.name === 'Hidden')).toBe(false);
    expect(flat.some((n) => n.name === 'Login')).toBe(true);
  });

  it('drops role="presentation" wrappers', async () => {
    const raw: RawAxNode = {
      role: 'WebArea',
      name: 'KRA',
      children: [
        {
          role: 'presentation',
          name: '',
          children: [{ role: 'button', name: 'File Return' }],
        },
      ],
    };
    const snap = await captureAxTreeSnapshot(mockPage(raw));
    const flat = flattenAxNodes(snap.root);
    expect(flat.some((n) => n.role === 'presentation')).toBe(false);
    // The button is also dropped because its parent was pruned. This is
    // intentional — `presentation` wrappers are noise; if a button is
    // semantically meaningful it should not be wrapped in one. The
    // brain's caller will re-fetch with `interestingOnly: false` if it
    // suspects a pruning issue.
  });

  it('respects maxDepth cap', async () => {
    let leaf: RawAxNode = { role: 'button', name: 'L0' };
    for (let i = 1; i < 20; i += 1) {
      leaf = { role: 'group', name: `n${i}`, children: [leaf] };
    }
    const root: RawAxNode = { role: 'WebArea', name: 'root', children: [leaf] };
    const snap = await captureAxTreeSnapshot(mockPage(root), { maxDepth: 5 });
    expect(snap.truncated).toBe(true);
  });

  it('respects maxNodes cap', async () => {
    const children: RawAxNode[] = Array.from({ length: 50 }, (_, i) => ({
      role: 'button',
      name: `btn-${i}`,
    }));
    const root: RawAxNode = { role: 'WebArea', name: 'root', children };
    const snap = await captureAxTreeSnapshot(mockPage(root), { maxNodes: 20 });
    expect(snap.nodeCount).toBeLessThanOrEqual(20);
    expect(snap.truncated).toBe(true);
  });

  it('emits canonical defaults: depth 12, nodes 200', () => {
    expect(DEFAULT_MAX_DEPTH).toBe(12);
    expect(DEFAULT_MAX_NODES).toBe(200);
  });

  it('attaches url + capturedAt metadata', async () => {
    const raw: RawAxNode = {
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'OK' }],
    };
    const snap = await captureAxTreeSnapshot(mockPage(raw, 'https://gepg.go.tz/'));
    expect(snap.url).toBe('https://gepg.go.tz/');
    expect(snap.capturedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('flattenAxNodes', () => {
  it('returns [] for null root', () => {
    expect(flattenAxNodes(null)).toEqual([]);
  });

  it('walks the tree in pre-order', () => {
    const root = {
      role: 'WebArea',
      name: 'R',
      children: [
        { role: 'button', name: 'A' },
        { role: 'button', name: 'B' },
      ],
    };
    const names = flattenAxNodes(root).map((n) => n.name);
    expect(names).toEqual(['R', 'A', 'B']);
  });
});

/**
 * axtree-diff.ts tests — added / removed / changed buckets + the
 * `diffContainsAdded` matcher the driver uses.
 */

import { describe, it, expect } from 'vitest';
import {
  diffAxSnapshots,
  diffSize,
  diffContainsAdded,
} from '../axtree-diff.js';
import type { AxTreeSnapshot } from '../axtree-snapshot.js';

function snap(root: AxTreeSnapshot['root']): AxTreeSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    nodeCount: 0,
    truncated: false,
    root,
  };
}

describe('diffAxSnapshots', () => {
  it('identical when both snapshots equal', () => {
    const a = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'OK' }],
    });
    const b = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'OK' }],
    });
    const d = diffAxSnapshots(a, b);
    expect(d.identical).toBe(true);
    expect(diffSize(d)).toBe(0);
  });

  it('detects added nodes', () => {
    const a = snap({ role: 'WebArea', name: 'X', children: [] });
    const b = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'Submit' }],
    });
    const d = diffAxSnapshots(a, b);
    expect(d.added.length).toBe(1);
    expect(d.added[0]?.name).toBe('Submit');
    expect(d.identical).toBe(false);
  });

  it('detects removed nodes', () => {
    const a = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'Submit' }],
    });
    const b = snap({ role: 'WebArea', name: 'X', children: [] });
    const d = diffAxSnapshots(a, b);
    expect(d.removed.length).toBe(1);
    expect(d.removed[0]?.name).toBe('Submit');
  });

  it('detects field changes (focused, disabled)', () => {
    const a = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'Submit', disabled: true }],
    });
    const b = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'Submit', disabled: false }],
    });
    const d = diffAxSnapshots(a, b);
    expect(d.changed.length).toBe(1);
    expect(d.changed[0]?.fields).toContain('disabled');
    expect(d.changed[0]?.before.disabled).toBe(true);
    expect(d.changed[0]?.after.disabled).toBe(false);
  });

  it('null before snapshot treats everything in after as added', () => {
    const after = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'button', name: 'Yes' }],
    });
    const d = diffAxSnapshots(null, after);
    expect(d.added.length).toBeGreaterThan(0);
    expect(d.removed.length).toBe(0);
  });

  it('diffContainsAdded matches by regex on name', () => {
    const a = snap({ role: 'WebArea', name: 'X', children: [] });
    const b = snap({
      role: 'WebArea',
      name: 'X',
      children: [{ role: 'alert', name: 'Return filed successfully' }],
    });
    const d = diffAxSnapshots(a, b);
    expect(diffContainsAdded(d, 'alert', /filed successfully/i)).toBe(true);
    expect(diffContainsAdded(d, 'alert', /payment/i)).toBe(false);
  });

  it('keys are stable by (role, name, path) so reordering is detected', () => {
    const a = snap({
      role: 'WebArea',
      name: 'X',
      children: [
        { role: 'button', name: 'A' },
        { role: 'button', name: 'B' },
      ],
    });
    const b = snap({
      role: 'WebArea',
      name: 'X',
      children: [
        { role: 'button', name: 'B' },
        { role: 'button', name: 'A' },
      ],
    });
    const d = diffAxSnapshots(a, b);
    // Reorder = both removed + added at new paths.
    expect(d.added.length).toBeGreaterThan(0);
    expect(d.removed.length).toBeGreaterThan(0);
  });
});

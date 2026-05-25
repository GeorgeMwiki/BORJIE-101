/**
 * presence-packet — unit tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { assemblePresence } from '../presence-packet';
import { snapshotA11yTree } from '../a11y-tree-snapshot';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('assemblePresence()', () => {
  it('returns a complete packet with route, surface, and viewport size', () => {
    document.body.innerHTML = `<main><h1>HQ</h1></main>`;
    const p = assemblePresence({ surface: 'admin-web' });
    expect(p.surface).toBe('admin-web');
    expect(typeof p.route).toBe('string');
    expect(typeof p.a11yTreeDigest).toBe('string');
    expect(p.visibleRoles.length).toBeGreaterThan(0);
    expect(p.viewportSize.w).toBeGreaterThanOrEqual(0);
    expect(p.viewportSize.h).toBeGreaterThanOrEqual(0);
  });

  it('omits selection when none is active', () => {
    document.body.innerHTML = '<p>nothing selected</p>';
    const p = assemblePresence({ surface: 's' });
    expect(p.selection).toBeUndefined();
  });

  it('honours a supplied snapshot (test seam)', () => {
    const seeded = snapshotA11yTree();
    const p = assemblePresence({ surface: 's', snapshot: seeded });
    expect(p.a11yTreeDigest).toBe(seeded.digest);
  });

  it('includes lastQueryAt when supplied', () => {
    const p = assemblePresence({ surface: 's', lastQueryAt: 12345 });
    expect(p.lastQueryAt).toBe(12345);
  });

  it('includes focusedElement when the active element is not body', () => {
    document.body.innerHTML = `<input id="x" name="email" aria-label="email" />`;
    (document.getElementById('x') as HTMLElement).focus();
    const p = assemblePresence({ surface: 's' });
    expect(p.focusedElement).toBeDefined();
    expect(p.focusedElement?.ariaLabel).toBe('email');
  });
});

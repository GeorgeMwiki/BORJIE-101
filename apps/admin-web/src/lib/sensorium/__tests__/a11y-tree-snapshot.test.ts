/**
 * a11y-tree-snapshot — unit tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  A11Y_MAX_NODES,
  A11Y_NAME_MAX,
  snapshotA11yTree,
} from '../a11y-tree-snapshot';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a11y-tree-snapshot', () => {
  it('produces a stable digest for identical DOM', () => {
    document.body.innerHTML = `
      <main>
        <h1>Hello</h1>
        <button>Save</button>
      </main>`;
    const s1 = snapshotA11yTree();
    const s2 = snapshotA11yTree();
    expect(s1.digest).toBe(s2.digest);
  });

  it('produces a different digest when DOM changes', () => {
    document.body.innerHTML = `<main><h1>Hello</h1></main>`;
    const before = snapshotA11yTree();
    document.body.innerHTML = `<main><h1>Different</h1></main>`;
    const after = snapshotA11yTree();
    expect(before.digest).not.toBe(after.digest);
  });

  it('infers roles from common tags', () => {
    document.body.innerHTML = `
      <nav><a href="#">Home</a></nav>
      <main><button>Save</button></main>`;
    const snap = snapshotA11yTree();
    expect(snap.visibleRoles).toContain('navigation');
    expect(snap.visibleRoles).toContain('main');
    expect(snap.visibleRoles).toContain('button');
    expect(snap.visibleRoles).toContain('link');
  });

  it('skips aria-hidden subtrees', () => {
    document.body.innerHTML = `
      <main>
        <button>Visible</button>
        <div aria-hidden="true"><button>Hidden</button></div>
      </main>`;
    const snap = snapshotA11yTree();
    const names = collectNames(snap.root);
    expect(names).toContain('Visible');
    expect(names).not.toContain('Hidden');
  });

  it('caps total node count', () => {
    let html = '<main>';
    for (let i = 0; i < 600; i += 1) {
      html += `<div>node-${i}</div>`;
    }
    html += '</main>';
    document.body.innerHTML = html;
    const snap = snapshotA11yTree();
    expect(snap.nodeCount).toBeLessThanOrEqual(A11Y_MAX_NODES);
  });

  it('truncates long names', () => {
    const longLabel = 'x'.repeat(500);
    document.body.innerHTML = `<button aria-label="${longLabel}">btn</button>`;
    const snap = snapshotA11yTree();
    const buttonNames = collectNames(snap.root).filter((n) =>
      n.startsWith('x'),
    );
    expect(buttonNames.length).toBeGreaterThan(0);
    expect(buttonNames[0]!.length).toBeLessThanOrEqual(A11Y_NAME_MAX);
  });

  it('caps depth', () => {
    let html = '';
    let close = '';
    for (let i = 0; i < 20; i += 1) {
      html += `<div data-d="${i}">`;
      close = `</div>${close}`;
    }
    html += 'leaf' + close;
    document.body.innerHTML = html;
    const snap = snapshotA11yTree(undefined, { maxDepth: 5 });
    expect(measureMaxDepth(snap.root)).toBeLessThanOrEqual(5);
  });

  it('emits focusedRole when an element has focus', () => {
    document.body.innerHTML = `<input id="x" />`;
    (document.getElementById('x') as HTMLElement).focus();
    const snap = snapshotA11yTree();
    expect(snap.focusedRole).toBeTruthy();
  });
});

function collectNames(node: {
  name?: string;
  children?: ReadonlyArray<{ name?: string; children?: unknown }>;
}): string[] {
  const out: string[] = [];
  function walk(n: typeof node): void {
    if (n.name) out.push(n.name);
    if (n.children) for (const c of n.children) walk(c as typeof node);
  }
  walk(node);
  return out;
}

function measureMaxDepth(node: {
  children?: ReadonlyArray<{ children?: unknown }>;
}): number {
  if (!node.children || node.children.length === 0) return 1;
  let max = 0;
  for (const c of node.children) {
    const d = measureMaxDepth(c as typeof node);
    if (d > max) max = d;
  }
  return max + 1;
}

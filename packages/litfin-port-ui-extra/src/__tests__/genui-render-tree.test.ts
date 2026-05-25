import { describe, expect, it } from 'vitest';
import {
  collectEvents,
  compile,
  walk,
  type GenUINode,
} from '../genui-render-tree.js';

const valid: GenUINode = {
  id: 'root',
  type: 'container',
  props: {},
  children: [
    {
      id: 'h',
      type: 'heading',
      props: { text: 'Hello', level: 1 },
      children: [],
    },
    {
      id: 'b',
      type: 'button',
      props: { text: 'Click', intent: 'primary', onClickEventId: 'evt-1' },
      children: [],
    },
  ],
};

describe('genui-render-tree', () => {
  it('compile accepts a valid tree', () => {
    const out = compile(valid);
    expect(out.tree).not.toBeNull();
    expect(out.errors.length).toBe(0);
  });

  it('compile rejects unknown type', () => {
    const out = compile({ ...valid, type: 'unknown', children: [] });
    expect(out.tree).toBeNull();
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it('compile rejects extra props', () => {
    const out = compile({
      id: 'x',
      type: 'heading',
      props: { text: 'a', bogus: true },
      children: [],
    });
    expect(out.tree).toBeNull();
  });

  it('compile rejects depth > MAX_DEPTH', () => {
    let node: unknown = { id: 'leaf', type: 'paragraph', props: {}, children: [] };
    for (let i = 0; i < 25; i++) {
      node = { id: `n${i}`, type: 'container', props: {}, children: [node] };
    }
    const out = compile(node);
    expect(out.tree).toBeNull();
    expect(out.errors.some((e) => e.startsWith('depth-exceeded'))).toBe(true);
  });

  it('compile rejects node count > MAX_NODE_COUNT', () => {
    const children = Array.from({ length: 600 }, (_, i) => ({
      id: `c${i}`,
      type: 'paragraph' as const,
      props: { text: 'x' },
      children: [],
    }));
    const out = compile({ id: 'r', type: 'container', props: {}, children });
    expect(out.tree).toBeNull();
    expect(out.errors.some((e) => e.startsWith('node-count-exceeded'))).toBe(true);
  });

  it('walk visits all nodes', () => {
    let count = 0;
    walk(valid, () => count++);
    expect(count).toBe(3);
  });

  it('walk reports depth', () => {
    const depths: number[] = [];
    walk(valid, (_, d) => depths.push(d));
    expect(Math.max(...depths)).toBe(1);
  });

  it('collectEvents finds all event ids', () => {
    const evts = collectEvents(valid);
    expect(evts).toContain('evt-1');
    expect(evts.length).toBe(1);
  });

  it('collectEvents on tree with no events returns empty', () => {
    const noEvts: GenUINode = {
      id: 'r',
      type: 'paragraph',
      props: { text: 'x' },
      children: [],
    };
    expect(collectEvents(noEvts).length).toBe(0);
  });

  it('compile preserves children order', () => {
    const out = compile(valid);
    expect(out.tree?.children[0]?.id).toBe('h');
    expect(out.tree?.children[1]?.id).toBe('b');
  });

  it('compile rejects empty id', () => {
    const out = compile({ ...valid, id: '' });
    expect(out.tree).toBeNull();
  });
});

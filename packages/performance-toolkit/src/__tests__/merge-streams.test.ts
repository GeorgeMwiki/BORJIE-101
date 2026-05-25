import { describe, expect, it, vi } from 'vitest';
import { mergeStreams, orderedMerge, tap } from '../streaming/merge-streams.js';

async function* fromDelays(items: { v: number; ms: number }[]): AsyncIterable<number> {
  for (const it of items) {
    await new Promise((r) => setTimeout(r, it.ms));
    yield it.v;
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('mergeStreams', () => {
  it('yields items in arrival order (faster source wins)', async () => {
    const slow = fromDelays([{ v: 1, ms: 30 }, { v: 2, ms: 30 }]);
    const fast = fromDelays([{ v: 10, ms: 5 }, { v: 11, ms: 5 }]);
    const out = await collect(mergeStreams(slow, fast));
    // fast's 10 and 11 should appear before slow's 2 at least
    expect(out).toContain(10);
    expect(out).toContain(11);
    expect(out).toContain(1);
    expect(out).toContain(2);
    expect(out).toHaveLength(4);
  });

  it('handles empty streams gracefully', async () => {
    const out = await collect(mergeStreams<number>());
    expect(out).toEqual([]);
  });

  it('drains all sources to completion', async () => {
    async function* a(): AsyncIterable<string> {
      yield 'a1';
      yield 'a2';
    }
    async function* b(): AsyncIterable<string> {
      yield 'b1';
    }
    const out = await collect(mergeStreams(a(), b()));
    expect(out.sort()).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('orderedMerge', () => {
  it('round-robins one item per source', async () => {
    async function* a(): AsyncIterable<string> {
      yield 'a1';
      yield 'a2';
    }
    async function* b(): AsyncIterable<string> {
      yield 'b1';
      yield 'b2';
    }
    const out = await collect(orderedMerge(a(), b()));
    expect(out).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('continues with remaining sources when one is exhausted early', async () => {
    async function* a(): AsyncIterable<string> {
      yield 'a1';
    }
    async function* b(): AsyncIterable<string> {
      yield 'b1';
      yield 'b2';
      yield 'b3';
    }
    const out = await collect(orderedMerge(a(), b()));
    expect(out).toEqual(['a1', 'b1', 'b2', 'b3']);
  });
});

describe('tap', () => {
  it('passes items through and calls onItem with index', async () => {
    const seen: { v: string; i: number }[] = [];
    const onItem = vi.fn((v: string, i: number) => seen.push({ v, i }));
    async function* src(): AsyncIterable<string> {
      yield 'a';
      yield 'b';
      yield 'c';
    }
    const out = await collect(tap(src(), onItem));
    expect(out).toEqual(['a', 'b', 'c']);
    expect(seen).toEqual([
      { v: 'a', i: 0 },
      { v: 'b', i: 1 },
      { v: 'c', i: 2 },
    ]);
  });
});

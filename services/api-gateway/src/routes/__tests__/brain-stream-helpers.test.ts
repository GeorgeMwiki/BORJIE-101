/**
 * Brain-stream helpers — latency wins 3 (streaming first-token chunking)
 * and 4 (async-offload of non-critical post-response work).
 */

import { describe, it, expect } from 'vitest';
import {
  chunkTextToSse,
  resolveStreamChunkChars,
  deferPostResponseWork,
  DEFAULT_STREAM_CHUNK_CHARS,
} from '../brain-stream-helpers.js';

describe('chunkTextToSse — streaming first-token', () => {
  it('splits text into ordered chunks of at most chunkChars', () => {
    const chunks = chunkTextToSse('abcdefg', 3);
    expect(chunks).toEqual(['abc', 'def', 'g']);
    expect(chunks.join('')).toBe('abcdefg'); // lossless
  });

  it('returns [] for empty/non-string input', () => {
    expect(chunkTextToSse('', 10)).toEqual([]);
    expect(chunkTextToSse(undefined as never, 10)).toEqual([]);
  });

  it('uses a default chunk smaller than the legacy 80 (sooner first paint)', () => {
    expect(DEFAULT_STREAM_CHUNK_CHARS).toBeLessThan(80);
    const chunks = chunkTextToSse('x'.repeat(100));
    expect(chunks[0]?.length).toBe(DEFAULT_STREAM_CHUNK_CHARS);
  });

  it('never produces a zero-size chunk even if chunkChars <= 0', () => {
    const chunks = chunkTextToSse('abc', 0);
    expect(chunks.join('')).toBe('abc');
    expect(chunks.every((c) => c.length >= 1)).toBe(true);
  });
});

describe('resolveStreamChunkChars', () => {
  it('defaults when unset', () => {
    expect(resolveStreamChunkChars({})).toBe(DEFAULT_STREAM_CHUNK_CHARS);
  });

  it('honours a valid override', () => {
    expect(resolveStreamChunkChars({ BORJIE_STREAM_CHUNK_CHARS: '32' })).toBe(32);
  });

  it('clamps to [16, 240]', () => {
    expect(resolveStreamChunkChars({ BORJIE_STREAM_CHUNK_CHARS: '1' })).toBe(16);
    expect(resolveStreamChunkChars({ BORJIE_STREAM_CHUNK_CHARS: '9999' })).toBe(240);
  });

  it('falls back on garbage input', () => {
    expect(resolveStreamChunkChars({ BORJIE_STREAM_CHUNK_CHARS: 'abc' })).toBe(
      DEFAULT_STREAM_CHUNK_CHARS,
    );
  });
});

describe('deferPostResponseWork — async-offload', () => {
  it('runs the work AFTER the current sync frame (off the critical path)', async () => {
    const order: string[] = [];
    deferPostResponseWork(() => {
      order.push('deferred');
    });
    order.push('inline'); // runs first — deferred is on a microtask
    // Flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['inline', 'deferred']);
  });

  it('STILL RUNS the work (fire-and-forget, not dropped)', async () => {
    let ran = false;
    deferPostResponseWork(async () => {
      ran = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it('swallows sync errors and reports via onError (never throws to caller)', async () => {
    let captured: unknown = null;
    expect(() =>
      deferPostResponseWork(
        () => {
          throw new Error('boom');
        },
        (err) => {
          captured = err;
        },
      ),
    ).not.toThrow();
    await Promise.resolve();
    expect((captured as Error)?.message).toBe('boom');
  });

  it('swallows async rejections via onError', async () => {
    let captured: unknown = null;
    deferPostResponseWork(
      async () => {
        throw new Error('async-boom');
      },
      (err) => {
        captured = err;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect((captured as Error)?.message).toBe('async-boom');
  });
});

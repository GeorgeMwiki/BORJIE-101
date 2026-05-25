/**
 * Unit tests for `providers/_runtime.ts`. These do NOT touch the network —
 * they exercise the AsyncQueue contract, the env-var helper, and the
 * non-throw-on-non-2xx behaviour of `fetchWithTimeout` against a stubbed
 * global `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AsyncQueue,
  fetchWithTimeout,
  liveProviderTestsEnabled,
  readEnv,
} from '../providers/_runtime.js';

describe('readEnv', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('returns undefined for unset / empty / whitespace vars', () => {
    delete process.env['VOICE_AGENT_TEST_X'];
    expect(readEnv('VOICE_AGENT_TEST_X')).toBeUndefined();
    process.env['VOICE_AGENT_TEST_X'] = '';
    expect(readEnv('VOICE_AGENT_TEST_X')).toBeUndefined();
    process.env['VOICE_AGENT_TEST_X'] = '   ';
    expect(readEnv('VOICE_AGENT_TEST_X')).toBeUndefined();
  });

  it('returns the trimmed value when present', () => {
    process.env['VOICE_AGENT_TEST_X'] = '  hello  ';
    expect(readEnv('VOICE_AGENT_TEST_X')).toBe('hello');
  });
});

describe('liveProviderTestsEnabled', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('returns false unless LIVE_PROVIDER_TESTS=true', () => {
    delete process.env['LIVE_PROVIDER_TESTS'];
    expect(liveProviderTestsEnabled()).toBe(false);
    process.env['LIVE_PROVIDER_TESTS'] = 'false';
    expect(liveProviderTestsEnabled()).toBe(false);
    process.env['LIVE_PROVIDER_TESTS'] = '1';
    expect(liveProviderTestsEnabled()).toBe(false);
    process.env['LIVE_PROVIDER_TESTS'] = 'true';
    expect(liveProviderTestsEnabled()).toBe(true);
  });
});

describe('AsyncQueue', () => {
  it('delivers values pushed before the consumer reads', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.close();
    const collected: number[] = [];
    for await (const v of q) collected.push(v);
    expect(collected).toEqual([1, 2]);
  });

  it('delivers values pushed after the consumer is waiting', async () => {
    const q = new AsyncQueue<string>();
    const consumer = (async () => {
      const collected: string[] = [];
      for await (const v of q) collected.push(v);
      return collected;
    })();
    // Schedule pushes on the microtask queue so the iterator has time to await.
    queueMicrotask(() => {
      q.push('a');
      q.push('b');
      q.close();
    });
    await expect(consumer).resolves.toEqual(['a', 'b']);
  });

  it('propagates fail() to the consumer', async () => {
    const q = new AsyncQueue<number>();
    queueMicrotask(() => q.fail(new Error('boom')));
    await expect(async () => {
      for await (const _ of q) {
        // never gets here
      }
    }).rejects.toThrow('boom');
  });

  it('ignores push / close / fail after close', () => {
    const q = new AsyncQueue<number>();
    q.close();
    q.push(1); // no-op
    q.fail(new Error('ignored'));
    q.close(); // idempotent
    expect(true).toBe(true); // no throw
  });
});

describe('fetchWithTimeout', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // reset stub between tests
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true for 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('hi', { status: 200, statusText: 'OK' }),
    );
    const result = await fetchWithTimeout('https://example.test/x', { timeoutMs: 1000 });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with bodyText (NOT throw) on non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
    );
    const result = await fetchWithTimeout('https://example.test/x', { timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.bodyText).toContain('rate limited');
      expect(result.providerError).toMatch(/upstream 429/);
    }
  });

  it('aborts when externalSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      // Real fetch would honour the signal; simulate that.
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Response('ok');
    });
    await expect(
      fetchWithTimeout('https://example.test/x', {
        timeoutMs: 1000,
        externalSignal: controller.signal,
      }),
    ).rejects.toBeTruthy();
  });

  it('truncates very large error bodies to 2 KB', async () => {
    const big = 'x'.repeat(10_000);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(big, { status: 500, statusText: 'Internal Server Error' }),
    );
    const result = await fetchWithTimeout('https://example.test/x', { timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.bodyText.length).toBeLessThanOrEqual(2048 + '…[truncated]'.length);
      expect(result.bodyText.endsWith('[truncated]')).toBe(true);
    }
  });
});

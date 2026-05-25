/**
 * Tests for `resolver.ts` — 3-level resolver (L1 cache / L2 refresh /
 * L3 baseline). Covers inflight dedupe, baseline-on-miss, L2-fail
 * caching, and `warmAllFamilies`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetInflight,
  getModelLatest,
  scheduleRefresh,
  warmAllFamilies,
} from '../resolver.js';
import { cache } from '../cache.js';
import { MODELS, MODEL_FAMILIES } from '../baselines.js';
import {
  clearFetchPort,
  setFetchPort,
  type DynamicRegistryFetchPort,
  type DynamicRegistryFetchResult,
} from '../fetch-port.js';
import {
  clearLogger,
  setLogger,
  type ResolverLogger,
} from '../logger-port.js';

function okResult(body: unknown): DynamicRegistryFetchResult {
  return {
    status: 200,
    ok: true,
    headers: {},
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  cache.clear();
  cache.clearNowFn();
  cache.resetDefaultTtlCache();
  __resetInflight();
  clearFetchPort();
  clearLogger();
  // Wipe provider keys so untouched families always fall to L3.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.COHERE_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
  cache.clear();
  cache.clearNowFn();
  cache.resetDefaultTtlCache();
  __resetInflight();
  clearFetchPort();
  clearLogger();
});

describe('getModelLatest — L1 cache hit', () => {
  it('returns cached value when L1 is warm', () => {
    cache.set('opus', 'claude-opus-4-99');
    expect(getModelLatest('opus')).toBe('claude-opus-4-99');
  });

  it('returns cached value for every supported family', () => {
    for (const f of MODEL_FAMILIES) {
      cache.set(f, `cached-${f}`);
      expect(getModelLatest(f)).toBe(`cached-${f}`);
    }
  });
});

describe('getModelLatest — L1 miss returns L3 baseline immediately', () => {
  it('returns the baseline synchronously on first call', () => {
    // No API key → L2 will also return null, but the hot path
    // returns baseline *before* awaiting anything.
    expect(getModelLatest('opus')).toBe(MODELS.opus);
    expect(getModelLatest('sonnet')).toBe(MODELS.sonnet);
    expect(getModelLatest('haiku')).toBe(MODELS.haiku);
  });

  it('throws on unknown family (caller bypassed types)', () => {
    expect(() =>
      getModelLatest('not-a-real-family' as unknown as 'opus'),
    ).toThrow(/unknown family/);
  });
});

describe('scheduleRefresh — L2 happy path', () => {
  it('populates the cache with the L2 result', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () =>
      okResult({
        data: [{ id: 'claude-opus-4-8' }, { id: 'claude-opus-4-7' }],
      }),
    );
    await scheduleRefresh('opus');
    expect(cache.get('opus')).toBe('claude-opus-4-8');
    // Now hot-path returns L1.
    expect(getModelLatest('opus')).toBe('claude-opus-4-8');
  });

  it('logs L2 success via injected logger', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => okResult({ data: [{ id: 'claude-opus-4-8' }] }));
    const calls: Array<{ level: string; msg: string }> = [];
    const log: ResolverLogger = {
      debug: (_c, m) => calls.push({ level: 'debug', msg: m }),
      info: (_c, m) => calls.push({ level: 'info', msg: m }),
      warn: (_c, m) => calls.push({ level: 'warn', msg: m }),
      error: (_c, m) => calls.push({ level: 'error', msg: m }),
    };
    setLogger(log);
    await scheduleRefresh('opus');
    expect(calls.some((c) => c.level === 'info' && /L2 refresh succeeded/.test(c.msg))).toBe(
      true,
    );
  });
});

describe('scheduleRefresh — L2 failure caches baseline for 5min', () => {
  it('caches baseline when L2 returns nothing (no key)', async () => {
    // No API key → fetchLatestForFamily returns null without calling port.
    await scheduleRefresh('opus');
    expect(cache.get('opus')).toBe(MODELS.opus);
  });

  it('caches baseline when port throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => {
      throw new Error('boom');
    });
    await scheduleRefresh('opus');
    // fetcher catches; resolver still writes baseline.
    expect(cache.get('opus')).toBe(MODELS.opus);
  });

  it('baseline TTL is short (~5 min)', async () => {
    let now = 0;
    cache.setNowFn(() => now);
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => okResult({ data: [] })); // empty → no match
    await scheduleRefresh('opus');
    expect(cache.get('opus')).toBe(MODELS.opus);
    // Just under 5 min: still cached.
    now += 4 * 60 * 1000 + 59_000;
    expect(cache.get('opus')).toBe(MODELS.opus);
    // Just over 5 min: evicted.
    now += 2_000;
    expect(cache.get('opus')).toBeNull();
  });

  it('logs L2-miss warning via injected logger', async () => {
    const calls: Array<{ level: string }> = [];
    setLogger({
      debug: () => calls.push({ level: 'debug' }),
      info: () => calls.push({ level: 'info' }),
      warn: () => calls.push({ level: 'warn' }),
      error: () => calls.push({ level: 'error' }),
    });
    await scheduleRefresh('opus'); // no key → null
    expect(calls.some((c) => c.level === 'warn')).toBe(true);
  });
});

describe('scheduleRefresh — inflight dedupe', () => {
  it('returns the same promise for concurrent refresh requests', () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    let resolvePort: (v: DynamicRegistryFetchResult) => void = () => {};
    const port: DynamicRegistryFetchPort = () =>
      new Promise<DynamicRegistryFetchResult>((res) => {
        resolvePort = res;
      });
    setFetchPort(port);

    const p1 = scheduleRefresh('opus');
    const p2 = scheduleRefresh('opus');
    const p3 = scheduleRefresh('opus');
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    // resolve the inflight port so the test doesn't hang
    resolvePort(okResult({ data: [{ id: 'claude-opus-4-8' }] }));
  });

  it('only calls the port once for N concurrent misses', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    const port = vi.fn(async () =>
      okResult({ data: [{ id: 'claude-opus-4-8' }] }),
    );
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    // Five concurrent first-call misses.
    await Promise.all([
      scheduleRefresh('opus'),
      scheduleRefresh('opus'),
      scheduleRefresh('opus'),
      scheduleRefresh('opus'),
      scheduleRefresh('opus'),
    ]);
    expect(port).toHaveBeenCalledTimes(1);
  });

  it('clears inflight slot after completion (next refresh re-calls)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    const port = vi.fn(async () =>
      okResult({ data: [{ id: 'claude-opus-4-8' }] }),
    );
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    await scheduleRefresh('opus');
    cache.clear();
    await scheduleRefresh('opus');
    expect(port).toHaveBeenCalledTimes(2);
  });
});

describe('getModelLatest — schedules refresh on miss', () => {
  it('triggers an L2 refresh in the background', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    const port = vi.fn(async () =>
      okResult({ data: [{ id: 'claude-opus-4-8' }] }),
    );
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    const first = getModelLatest('opus');
    expect(first).toBe(MODELS.opus); // baseline
    // Let the scheduled microtask + promise complete.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(port).toHaveBeenCalledTimes(1);
    expect(cache.get('opus')).toBe('claude-opus-4-8');
    // Second call now hits L1.
    expect(getModelLatest('opus')).toBe('claude-opus-4-8');
  });
});

describe('warmAllFamilies', () => {
  it('awaits every family refresh', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    process.env.OPENAI_API_KEY = 'ok';
    process.env.GOOGLE_AI_API_KEY = 'gk';
    process.env.COHERE_API_KEY = 'ck';
    process.env.ELEVENLABS_API_KEY = 'ek';
    process.env.DEEPSEEK_API_KEY = 'dk';

    const port = vi.fn(async (url: string) => {
      if (url.includes('anthropic')) {
        return okResult({
          data: [
            { id: 'claude-opus-4-9' },
            { id: 'claude-sonnet-4-9' },
            { id: 'claude-haiku-4-9' },
          ],
        });
      }
      if (url.includes('openai')) {
        return okResult({
          data: [
            { id: 'gpt-5.9' },
            { id: 'gpt-5.9-mini' },
            { id: 'gpt-5-realtime-preview-2025' },
            { id: 'whisper-2' },
            { id: 'tts-2' },
            { id: 'dall-e-4' },
          ],
        });
      }
      if (url.includes('generativelanguage')) {
        return okResult({
          models: [
            { name: 'models/gemini-3.0-pro' },
            { name: 'models/gemini-3.0-flash' },
          ],
        });
      }
      if (url.includes('cohere')) {
        return okResult({
          models: [{ name: 'embed-v5.0' }, { name: 'rerank-4.0' }],
        });
      }
      if (url.includes('elevenlabs')) {
        return okResult([{ model_id: 'eleven_v4' }, { model_id: 'scribe_v2' }]);
      }
      if (url.includes('deepseek')) {
        return okResult({
          data: [{ id: 'deepseek-chat-v3' }, { id: 'deepseek-coder-v3' }],
        });
      }
      return okResult({ data: [] });
    });
    setFetchPort(port as unknown as DynamicRegistryFetchPort);

    await warmAllFamilies();

    // Every family should now have a fresh cached value (not necessarily
    // matching, but populated).
    for (const f of MODEL_FAMILIES) {
      expect(cache.get(f)).not.toBeNull();
    }
  });

  it('never throws even when every port call fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    process.env.OPENAI_API_KEY = 'ok';
    setFetchPort(async () => {
      throw new Error('all down');
    });
    await expect(warmAllFamilies()).resolves.toBeUndefined();
    // Every family fell to baseline-cached.
    for (const f of MODEL_FAMILIES) {
      expect(cache.get(f)).toBe(MODELS[f]);
    }
  });
});

describe('contract — never throws on hot path', () => {
  it('hot path returns a string even when everything is broken', () => {
    // No env, no port, no cache. Should still return baseline.
    cache.clear();
    expect(typeof getModelLatest('opus')).toBe('string');
    expect(typeof getModelLatest('gemini-pro')).toBe('string');
    expect(typeof getModelLatest('eleven-tts')).toBe('string');
  });
});

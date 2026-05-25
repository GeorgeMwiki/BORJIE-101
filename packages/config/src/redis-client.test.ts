/**
 * Tests for the Z5 HA Sentinel-aware Redis factory.
 *
 * The DA3 audit flagged that every service constructed `new Redis(url)`
 * directly, silently ignoring `REDIS_SENTINEL_HOSTS`. These tests pin
 * down the resolver branches so a future refactor cannot regress the
 * Sentinel wiring without flipping a red bar.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseSentinelHosts,
  resolveRedisConfig,
  createRedisClient,
  resolveRedisOptionsFromEnv,
} from './redis-client.js';

describe('parseSentinelHosts', () => {
  it('returns an empty array when input is undefined', () => {
    expect(parseSentinelHosts(undefined)).toEqual([]);
  });

  it('returns an empty array when input is empty string', () => {
    expect(parseSentinelHosts('')).toEqual([]);
  });

  it('parses a single host:port pair', () => {
    expect(parseSentinelHosts('sentinel-1:26379')).toEqual([
      { host: 'sentinel-1', port: 26379 },
    ]);
  });

  it('parses a comma-separated list of three sentinels', () => {
    expect(
      parseSentinelHosts('sentinel-1:26379,sentinel-2:26379,sentinel-3:26380'),
    ).toEqual([
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
      { host: 'sentinel-3', port: 26380 },
    ]);
  });

  it('trims whitespace around entries and colons', () => {
    expect(parseSentinelHosts(' sentinel-1 : 26379 , sentinel-2:26379 ')).toEqual([
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
    ]);
  });

  it('drops entries with missing port', () => {
    expect(parseSentinelHosts('sentinel-1,sentinel-2:26379')).toEqual([
      { host: 'sentinel-2', port: 26379 },
    ]);
  });

  it('drops entries with non-numeric port', () => {
    expect(parseSentinelHosts('sentinel-1:abc,sentinel-2:26379')).toEqual([
      { host: 'sentinel-2', port: 26379 },
    ]);
  });

  it('drops entries with out-of-range port', () => {
    expect(parseSentinelHosts('sentinel-1:0,sentinel-2:99999')).toEqual([]);
  });
});

describe('resolveRedisConfig', () => {
  it('returns mode=none when neither url nor sentinels are set', () => {
    expect(resolveRedisConfig({})).toEqual({ mode: 'none' });
  });

  it('returns mode=single with the URL when only REDIS_URL is set', () => {
    const config = resolveRedisConfig({ url: 'redis://localhost:6379' });
    expect(config).toEqual({
      mode: 'single',
      url: 'redis://localhost:6379',
      options: {},
    });
  });

  it('returns mode=sentinel when REDIS_SENTINEL_HOSTS is set', () => {
    const config = resolveRedisConfig({
      sentinelHosts: 'sentinel-1:26379,sentinel-2:26379',
      sentinelName: 'borjie-master',
      password: 'secret',
    });
    expect(config.mode).toBe('sentinel');
    if (config.mode !== 'sentinel') return;
    expect(config.options.sentinels).toEqual([
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
    ]);
    expect(config.options.name).toBe('borjie-master');
    expect(config.options['password']).toBe('secret');
    expect(config.options['sentinelPassword']).toBe('secret');
  });

  it('defaults the sentinel master name to "mymaster"', () => {
    const config = resolveRedisConfig({
      sentinelHosts: 'sentinel-1:26379',
    });
    expect(config.mode).toBe('sentinel');
    if (config.mode !== 'sentinel') return;
    expect(config.options.name).toBe('mymaster');
  });

  it('prefers Sentinel mode when BOTH REDIS_URL and sentinels are set', () => {
    // DA3 root cause: ignoring sentinels in favour of REDIS_URL. The
    // Sentinel topology MUST win when the operator opts in.
    const config = resolveRedisConfig({
      sentinelHosts: 'sentinel-1:26379',
      url: 'redis://primary:6379',
    });
    expect(config.mode).toBe('sentinel');
  });

  it('merges clientOptions into the Sentinel options bag', () => {
    const config = resolveRedisConfig({
      sentinelHosts: 'sentinel-1:26379',
      clientOptions: {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      },
    });
    expect(config.mode).toBe('sentinel');
    if (config.mode !== 'sentinel') return;
    expect(config.options['maxRetriesPerRequest']).toBe(3);
    expect(config.options['enableReadyCheck']).toBe(true);
  });

  it('merges clientOptions into single-instance options bag', () => {
    const config = resolveRedisConfig({
      url: 'redis://localhost:6379',
      clientOptions: { lazyConnect: true },
    });
    expect(config.mode).toBe('single');
    if (config.mode !== 'single') return;
    expect(config.options['lazyConnect']).toBe(true);
  });

  it('falls back to mode=none when sentinelHosts parses to empty', () => {
    // Malformed input → empty parse → no sentinels → no URL → 'none'.
    expect(resolveRedisConfig({ sentinelHosts: ':::,abc' })).toEqual({
      mode: 'none',
    });
  });
});

describe('createRedisClient', () => {
  it('returns null when Redis is not configured', () => {
    const ctor = vi.fn();
    const client = createRedisClient(ctor as never, {});
    expect(client).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('engages Sentinel mode when REDIS_SENTINEL_HOSTS is set', () => {
    const FakeIORedis = vi.fn();
    createRedisClient(FakeIORedis as never, {
      sentinelHosts: 'sentinel-1:26379,sentinel-2:26379,sentinel-3:26379',
      sentinelName: 'borjie-master',
      password: 'pw',
      clientOptions: { maxRetriesPerRequest: 2 },
    });
    expect(FakeIORedis).toHaveBeenCalledTimes(1);
    const callArg = FakeIORedis.mock.calls[0]?.[0] as {
      sentinels?: unknown;
      name?: unknown;
      password?: unknown;
      maxRetriesPerRequest?: unknown;
    };
    expect(callArg.sentinels).toEqual([
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
      { host: 'sentinel-3', port: 26379 },
    ]);
    expect(callArg.name).toBe('borjie-master');
    expect(callArg.password).toBe('pw');
    expect(callArg.maxRetriesPerRequest).toBe(2);
  });

  it('uses single-instance mode when only REDIS_URL is set', () => {
    const FakeIORedis = vi.fn();
    createRedisClient(FakeIORedis as never, {
      url: 'redis://localhost:6379',
      clientOptions: { lazyConnect: false },
    });
    expect(FakeIORedis).toHaveBeenCalledWith('redis://localhost:6379', {
      lazyConnect: false,
    });
  });

  it('returns the constructed instance back to the caller', () => {
    // Vitest 4 requires the mock to be invoked with `new` — define the
    // fake as a class so `new FakeIORedis(...)` is the call form.
    const fakeInstance = { id: 'fake-redis' };
    class FakeIORedis {
      constructor(public readonly url: string) {
        // Pretend we returned the canonical instance — used by the
        // assertion below.
        Object.assign(this, fakeInstance);
      }
    }
    const result = createRedisClient<{ id: string }>(
      FakeIORedis as unknown as never,
      { url: 'redis://localhost:6379' },
    );
    expect(result).toBeInstanceOf(FakeIORedis);
    expect((result as { id?: string }).id).toBe('fake-redis');
  });
});

describe('resolveRedisOptionsFromEnv', () => {
  it('plucks the four Redis env vars from a stub environment', () => {
    const stub = {
      REDIS_SENTINEL_HOSTS: 'sentinel-1:26379',
      REDIS_SENTINEL_NAME: 'borjie-master',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_PASSWORD: 'pw',
    } as unknown as NodeJS.ProcessEnv;
    expect(resolveRedisOptionsFromEnv(stub)).toEqual({
      sentinelHosts: 'sentinel-1:26379',
      sentinelName: 'borjie-master',
      url: 'redis://localhost:6379',
      password: 'pw',
    });
  });

  it('returns undefined fields when env is empty', () => {
    expect(resolveRedisOptionsFromEnv({} as NodeJS.ProcessEnv)).toEqual({
      sentinelHosts: undefined,
      sentinelName: undefined,
      url: undefined,
      password: undefined,
    });
  });
});

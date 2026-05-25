/**
 * Tests for the composite market-rate adapter.
 *
 * Covers:
 *   - Throws when constructed with zero adapters.
 *   - `mode: 'merge'` (default) — concatenates results from all adapters.
 *   - `mode: 'merge'` — failing adapter logs + is skipped (others succeed).
 *   - `mode: 'failover'` — returns first non-empty result and short-circuits.
 *   - `mode: 'failover'` — failing adapter falls through to next.
 *   - `createCompositeAdapterFromEnv` returns null when no env vars set.
 *   - `createCompositeAdapterFromEnv` builds composite from configured envs.
 *   - Composite `adapterId` reflects the active inner adapters.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createCompositeAdapter,
  createCompositeAdapterFromEnv,
} from '../composite-adapter';
import type {
  ComparableListing,
  MarketRatePort,
} from '@borjie/ai-copilot/ai-native';

const params = {
  tenantId: 't1',
  unitId: 'u1',
  latitude: 40.7,
  longitude: -74.0,
  radiusKm: 2,
  bedrooms: 2,
};

function makeFakeAdapter(
  id: string,
  result: readonly ComparableListing[] | Error,
): MarketRatePort {
  return {
    adapterId: id,
    async fetchComparables() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const sampleA: ComparableListing = {
  adapterId: 'fake-a',
  url: null,
  title: 'a',
  rawDescription: 'rent A',
  latitude: null,
  longitude: null,
};

const sampleB: ComparableListing = {
  adapterId: 'fake-b',
  url: null,
  title: 'b',
  rawDescription: 'rent B',
  latitude: null,
  longitude: null,
};

describe('createCompositeAdapter', () => {
  it('throws when constructed with zero adapters', () => {
    expect(() => createCompositeAdapter({ adapters: [] })).toThrow(
      /at least one adapter required/,
    );
  });

  it('exposes a composite adapterId reflecting inner adapters', () => {
    const a = makeFakeAdapter('rentometer', []);
    const b = makeFakeAdapter('zillow', []);
    const composite = createCompositeAdapter({ adapters: [a, b] });
    expect(composite.adapterId).toBe('composite[rentometer+zillow]');
  });
});

describe('composite adapter — merge mode', () => {
  it('concatenates results from every inner adapter', async () => {
    const a = makeFakeAdapter('a', [sampleA]);
    const b = makeFakeAdapter('b', [sampleB]);
    const composite = createCompositeAdapter({ adapters: [a, b] });
    const out = await composite.fetchComparables(params);
    expect(out).toHaveLength(2);
    expect(out).toEqual(expect.arrayContaining([sampleA, sampleB]));
  });

  it('skips a failing adapter, logs, and returns the others', async () => {
    const warnings: Array<{ meta: object; msg: string }> = [];
    const a = makeFakeAdapter('a', new Error('a-down'));
    const b = makeFakeAdapter('b', [sampleB]);
    const composite = createCompositeAdapter({
      adapters: [a, b],
      logger: {
        warn(meta, msg) {
          warnings.push({ meta, msg });
        },
      },
    });
    const out = await composite.fetchComparables(params);
    expect(out).toEqual([sampleB]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toContain('inner adapter failed');
  });

  it('returns [] when every adapter fails', async () => {
    const a = makeFakeAdapter('a', new Error('a-down'));
    const b = makeFakeAdapter('b', new Error('b-down'));
    const composite = createCompositeAdapter({ adapters: [a, b] });
    const out = await composite.fetchComparables(params);
    expect(out).toEqual([]);
  });
});

describe('composite adapter — failover mode', () => {
  it('returns first non-empty success and short-circuits', async () => {
    const a = makeFakeAdapter('a', [sampleA]);
    const b = vi.fn();
    const bAdapter: MarketRatePort = {
      adapterId: 'b',
      fetchComparables: b as unknown as MarketRatePort['fetchComparables'],
    };
    const composite = createCompositeAdapter({
      adapters: [a, bAdapter],
      mode: 'failover',
    });
    const out = await composite.fetchComparables(params);
    expect(out).toEqual([sampleA]);
    expect(b).not.toHaveBeenCalled();
  });

  it('falls through past failures and empty results to the next adapter', async () => {
    const a = makeFakeAdapter('a', new Error('a-down'));
    const b = makeFakeAdapter('b', []);
    const c = makeFakeAdapter('c', [sampleB]);
    const composite = createCompositeAdapter({
      adapters: [a, b, c],
      mode: 'failover',
    });
    const out = await composite.fetchComparables(params);
    expect(out).toEqual([sampleB]);
  });

  it('returns [] when every adapter is empty / failing', async () => {
    const a = makeFakeAdapter('a', new Error('a-down'));
    const b = makeFakeAdapter('b', []);
    const composite = createCompositeAdapter({
      adapters: [a, b],
      mode: 'failover',
    });
    const out = await composite.fetchComparables(params);
    expect(out).toEqual([]);
  });
});

describe('createCompositeAdapterFromEnv', () => {
  it('returns null when no env vars are configured', () => {
    expect(createCompositeAdapterFromEnv({})).toBeNull();
  });

  it('builds a composite spanning whichever env vars are set', () => {
    const composite = createCompositeAdapterFromEnv({
      RENTOMETER_API_KEY: 'rk_test_secret',
      ZILLOW_API_KEY: 'zk_test_secret',
    });
    expect(composite).not.toBeNull();
    expect(composite?.adapterId).toContain('rentometer');
    expect(composite?.adapterId).toContain('zillow');
    expect(composite?.adapterId).not.toContain('airbnb');
  });

  it('builds with all three when all keys present', () => {
    const composite = createCompositeAdapterFromEnv({
      RENTOMETER_API_KEY: 'rk',
      ZILLOW_API_KEY: 'zk',
      AIRBNB_API_KEY: 'ak',
    });
    expect(composite?.adapterId).toBe(
      'composite[rentometer+zillow+airbnb]',
    );
  });
});

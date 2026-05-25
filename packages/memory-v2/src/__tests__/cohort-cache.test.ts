import { describe, expect, it } from 'vitest';
import { createInMemoryCohortCacheStore } from '../cohort-cache/store-inmemory.js';

const TENANT = 'tenant-1';

describe('cohort cache', () => {
  it('round-trips a value', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'tax-table',
      value: { rate: 0.16 },
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    const got = await cache.get<{ rate: number }>(TENANT, 'KE', 'tax-table');
    expect(got?.value.rate).toBeCloseTo(0.16, 5);
  });

  it('returns null when missing', async () => {
    const cache = createInMemoryCohortCacheStore();
    const got = await cache.get(TENANT, 'KE', 'missing');
    expect(got).toBeNull();
  });

  it('isolates by tenantId', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'k',
      value: 'a',
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    await cache.set({
      tenantId: 'tenant-other',
      jurisdiction: 'KE',
      key: 'k',
      value: 'b',
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    const a = await cache.get<string>(TENANT, 'KE', 'k');
    const b = await cache.get<string>('tenant-other', 'KE', 'k');
    expect(a?.value).toBe('a');
    expect(b?.value).toBe('b');
  });

  it('isolates by jurisdiction', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'tax',
      value: 0.16,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'TZ',
      key: 'tax',
      value: 0.18,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    const ke = await cache.get<number>(TENANT, 'KE', 'tax');
    const tz = await cache.get<number>(TENANT, 'TZ', 'tax');
    expect(ke?.value).toBe(0.16);
    expect(tz?.value).toBe(0.18);
  });

  it('expires entries past expiresAt', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: null,
      key: 'short',
      value: 'gone',
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const got = await cache.get(TENANT, null, 'short');
    expect(got).toBeNull();
  });

  it('keeps entries whose expiresAt is in the future', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: null,
      key: 'still-here',
      value: 42,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const got = await cache.get<number>(TENANT, null, 'still-here');
    expect(got?.value).toBe(42);
  });

  it('invalidates by tenant + jurisdiction', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'k1',
      value: 1,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'k2',
      value: 2,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    await cache.invalidate(TENANT, 'KE');
    expect(await cache.get(TENANT, 'KE', 'k1')).toBeNull();
    expect(await cache.get(TENANT, 'KE', 'k2')).toBeNull();
  });

  it('invalidates by keyPrefix when supplied', async () => {
    const cache = createInMemoryCohortCacheStore();
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'tax-2025',
      value: 1,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    await cache.set({
      tenantId: TENANT,
      jurisdiction: 'KE',
      key: 'fx-2025',
      value: 2,
      recordedAt: '2026-05-25T00:00:00.000Z',
      expiresAt: null,
    });
    await cache.invalidate(TENANT, 'KE', 'tax-');
    expect(await cache.get(TENANT, 'KE', 'tax-2025')).toBeNull();
    expect(await cache.get(TENANT, 'KE', 'fx-2025')).not.toBeNull();
  });
});

/**
 * Currency-preferences resolver tests — pure unit, fake Drizzle.
 *
 * Covers the resolution chain (user → tenant → platform-default →
 * fallback) and the don't-throw-on-DB-failure invariant. Uses a
 * minimal in-memory fake DatabaseClient that captures select-from
 * shape; matches the pattern in kernel-cohort.service.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { createCurrencyPreferencesService } from './currency-preferences.service.js';

// ─────────────────────────────────────────────────────────────────────
// Fake Drizzle client — only implements the methods the service uses.
// ─────────────────────────────────────────────────────────────────────

interface FakeRow {
  scopeKind: string;
  scopeId: string;
  currency: string;
  source: string | null;
  updatedAt: Date;
}

function fakeDb(rows: ReadonlyArray<FakeRow>, opts: { throwOnSelect?: boolean } = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          if (opts.throwOnSelect) throw new Error('hard db error');
          return rows.map((r) => ({ ...r }));
        }),
        // also support no-where path (for list())
        then: undefined,
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => undefined),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  };
}

describe('CurrencyPreferencesService.resolve', () => {
  it('user override beats tenant beats platform-default', async () => {
    const db = fakeDb([
      { scopeKind: 'user',             scopeId: 'u1', currency: 'EUR', source: 'self-selected', updatedAt: new Date() },
      { scopeKind: 'tenant',           scopeId: 't1', currency: 'TZS', source: 'admin-set',     updatedAt: new Date() },
      { scopeKind: 'platform-default', scopeId: '*',  currency: 'USD', source: 'seed',          updatedAt: new Date() },
    ]);
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({ userId: 'u1', tenantId: 't1' });
    expect(r).toEqual({ currency: 'EUR', source: 'user' });
  });

  it('tenant default applies when no user override', async () => {
    const db = fakeDb([
      { scopeKind: 'tenant',           scopeId: 't1', currency: 'KES', source: 'admin-set', updatedAt: new Date() },
      { scopeKind: 'platform-default', scopeId: '*',  currency: 'USD', source: 'seed',      updatedAt: new Date() },
    ]);
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({ userId: 'u1', tenantId: 't1' });
    expect(r).toEqual({ currency: 'KES', source: 'tenant' });
  });

  it('platform-default applies when no user or tenant row', async () => {
    const db = fakeDb([
      { scopeKind: 'platform-default', scopeId: '*', currency: 'USD', source: 'seed', updatedAt: new Date() },
    ]);
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({ userId: 'u1', tenantId: 't1' });
    expect(r).toEqual({ currency: 'USD', source: 'platform-default' });
  });

  it('falls back to USD when even the platform-default row is missing', async () => {
    const db = fakeDb([]);
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({ userId: 'u1', tenantId: 't1' });
    expect(r).toEqual({ currency: 'USD', source: 'fallback' });
  });

  it('hard DB error returns USD/fallback (never throws)', async () => {
    const db = fakeDb([], { throwOnSelect: true });
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({ userId: 'u1', tenantId: 't1' });
    expect(r).toEqual({ currency: 'USD', source: 'fallback' });
  });

  it('lowercases input and uppercases output', async () => {
    const db = fakeDb([
      { scopeKind: 'user', scopeId: 'u1', currency: 'eur', source: 'self-selected', updatedAt: new Date() },
    ]);
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({ userId: 'u1' });
    expect(r.currency).toBe('EUR');
  });

  it('handles missing userId / tenantId gracefully', async () => {
    const db = fakeDb([
      { scopeKind: 'platform-default', scopeId: '*', currency: 'USD', source: 'seed', updatedAt: new Date() },
    ]);
    const svc = createCurrencyPreferencesService(db as any);
    const r = await svc.resolve({}); // both missing
    expect(r.source).toBe('platform-default');
  });
});

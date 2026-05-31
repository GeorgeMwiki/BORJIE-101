/**
 * Drizzle cache adapter tests using an in-memory SqlRunner stub so we
 * don't need a real Postgres in unit tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDrizzleTranslationCache } from '../drizzle-cache.js';
import type { SqlRunner } from '../drizzle-cache.js';

function makeStubRunner() {
  const rows = new Map<
    string,
    { target_text: string; provider: string; glossary_version: string }
  >();
  const updateCalls: string[] = [];
  const insertCalls: string[] = [];

  const runner: SqlRunner = {
    async query<Row>(sql: string, params: ReadonlyArray<unknown>) {
      if (sql.includes('SELECT target_text')) {
        const hash = params[0] as string;
        const r = rows.get(hash);
        return (r ? [r as unknown as Row] : []) as ReadonlyArray<Row>;
      }
      return [];
    },
    async exec(sql: string, params: ReadonlyArray<unknown>) {
      if (sql.includes('INSERT INTO translation_cache')) {
        const hash = params[0] as string;
        rows.set(hash, {
          target_text: params[7] as string,
          provider: params[8] as string,
          glossary_version: params[9] as string,
        });
        insertCalls.push(hash);
      } else if (sql.includes('UPDATE translation_cache')) {
        const hash = params[0] as string;
        updateCalls.push(hash);
      }
    },
  };

  return { runner, rows, updateCalls, insertCalls };
}

describe('drizzle translation cache', () => {
  it('returns null on miss', async () => {
    const { runner } = makeStubRunner();
    const cache = createDrizzleTranslationCache({ runner });
    const result = await cache.get({
      tenantId: 't1',
      sourceText: 'Welcome',
      sourceLang: 'en',
      targetLang: 'sw',
      register: 'neutral',
      surface: 'email',
    });
    expect(result).toBeNull();
  });

  it('writes on set and reads back on get', async () => {
    const { runner, insertCalls } = makeStubRunner();
    const cache = createDrizzleTranslationCache({ runner });

    const key = {
      tenantId: 't1',
      sourceText: 'Welcome',
      sourceLang: 'en' as const,
      targetLang: 'sw' as const,
      register: 'neutral' as const,
      surface: 'email',
    };

    await cache.set(key, {
      targetText: 'Karibu',
      provider: 'claude-opus-4-7',
      glossaryVersion: 'v1',
    });
    expect(insertCalls).toHaveLength(1);

    const got = await cache.get(key);
    expect(got).toBe('Karibu');
  });

  it('cache-hits bump the hits counter via UPDATE', async () => {
    const { runner, updateCalls } = makeStubRunner();
    const cache = createDrizzleTranslationCache({ runner });

    const key = {
      tenantId: 't1',
      sourceText: 'Welcome',
      sourceLang: 'en' as const,
      targetLang: 'sw' as const,
      register: 'neutral' as const,
      surface: 'email',
    };

    await cache.set(key, {
      targetText: 'Karibu',
      provider: 'claude-opus-4-7',
      glossaryVersion: 'v1',
    });
    await cache.get(key);

    // give the fire-and-forget update a tick
    await new Promise((r) => setImmediate(r));
    expect(updateCalls).toHaveLength(1);
  });

  it('does not throw when get fails — returns null and logs', async () => {
    const broken: SqlRunner = {
      async query() {
        throw new Error('connection lost');
      },
      async exec() {},
    };
    const warn = vi.fn();
    const cache = createDrizzleTranslationCache({
      runner: broken,
      logger: { warn },
    });

    const result = await cache.get({
      tenantId: 't1',
      sourceText: 'x',
      sourceLang: 'en',
      targetLang: 'sw',
      register: 'neutral',
      surface: 's',
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('content-addresses across tenants — same content collapses', async () => {
    const { runner } = makeStubRunner();
    const cache = createDrizzleTranslationCache({ runner });

    const baseKey = {
      sourceText: 'Welcome',
      sourceLang: 'en' as const,
      targetLang: 'sw' as const,
      register: 'neutral' as const,
      surface: 'email',
    };

    await cache.set(
      { ...baseKey, tenantId: 't1' },
      { targetText: 'Karibu', provider: 'p', glossaryVersion: 'v1' },
    );
    const t2 = await cache.get({ ...baseKey, tenantId: 't2' });
    expect(t2).toBe('Karibu');
  });
});

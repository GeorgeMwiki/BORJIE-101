/**
 * fx-feed-cron — single-tick orchestration tests.
 */
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createFxFeedCron } from '../fx-feed-cron.js';

const silentLogger = pino({ level: 'silent' });

/**
 * Reconstruct the SQL text + ordered params from a drizzle `sql` template.
 * The raw template object exposes `queryChunks`: `StringChunk`s (literal SQL
 * fragments, `.value` is a string[]) interleaved with param chunks (boxed
 * primitives). We render literals verbatim and each param as a `?` slot so
 * assertions can match ON CONFLICT clauses and dedupe on the param tuple.
 */
function renderSql(q: unknown): { text: string; params: unknown[] } {
  const chunks = (q as { queryChunks?: unknown[] } | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return { text: '', params: [] };
  const params: unknown[] = [];
  const text = chunks
    .map((c) => {
      const v = (c as { value?: unknown }).value;
      if (Array.isArray(v)) return v.join('');
      // Param chunk: a boxed primitive — record its underlying value.
      params.push(typeof c === 'object' && c !== null ? (c as object).valueOf() : c);
      return '?';
    })
    .join('');
  return { text, params };
}

interface DbStub {
  execute: ReturnType<typeof vi.fn>;
  calls: ReadonlyArray<{ readonly sql: string; readonly params: unknown[] }>;
}

function makeDb(insertOk = true): DbStub {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (q: unknown) => {
    const obj = q as { sql?: string; params?: unknown[] } | undefined;
    calls.push({ sql: obj?.sql ?? '', params: obj?.params ?? [] });
    if (!insertOk) throw new Error('db_unwired');
    return [] as unknown[];
  });
  return { execute, calls };
}

describe('createFxFeedCron — tickOnce', () => {
  it('inserts both BoT + LBMA values when both upstreams succeed', async () => {
    const db = makeDb();
    const cron = createFxFeedCron({
      db,
      logger: silentLogger,
      enabled: false,
      fetchBotTzsUsd: async () => 2614.5,
      fetchLbmaGoldFix: async () => ({ date: '2026-05-28', am: 2384.4, pm: 2391.1 }),
    });
    const result = await cron.tickOnce();
    expect(result.bot.value).toBe(2614.5);
    expect(result.bot.inserted).toBe(true);
    expect(result.lbma.amValue).toBe(2384.4);
    expect(result.lbma.pmValue).toBe(2391.1);
    expect(result.lbma.inserted).toBe(true);
    expect(result.errors).toEqual([]);
    expect(db.execute).toHaveBeenCalled();
  });

  it('records a degraded tick when BoT is down', async () => {
    const db = makeDb();
    const cron = createFxFeedCron({
      db,
      logger: silentLogger,
      enabled: false,
      fetchBotTzsUsd: async () => null,
      fetchLbmaGoldFix: async () => ({ date: '2026-05-28', am: 2384.4, pm: null }),
    });
    const result = await cron.tickOnce();
    expect(result.bot.value).toBeNull();
    expect(result.bot.inserted).toBe(false);
    expect(result.errors).toContain('bot_unavailable');
    expect(result.lbma.amValue).toBe(2384.4);
    expect(result.lbma.pmValue).toBeNull();
  });

  it('does not throw when DB inserts fail; per-source insertion flag flips to false', async () => {
    const db = makeDb(false);
    const cron = createFxFeedCron({
      db,
      logger: silentLogger,
      enabled: false,
      fetchBotTzsUsd: async () => 2614.5,
      fetchLbmaGoldFix: async () => ({ date: '2026-05-28', am: 2384.4, pm: 2391.1 }),
    });
    const result = await cron.tickOnce();
    expect(result.bot.value).toBe(2614.5);
    // both inserts failed (fx + benchmark) → inserted false
    expect(result.bot.inserted).toBe(false);
    expect(result.lbma.inserted).toBe(false);
  });

  it('upserts external_benchmarks on the 0374 (source, metric_id, value) key so a repeat value refreshes as_of instead of throwing 23505', async () => {
    // Simulate the live constraint: a bare append INSERT of a (source,
    // metric_id, value) we have already seen throws a unique violation.
    // Only the UPSERT form (ON CONFLICT ... DO UPDATE) survives it.
    const seen = new Set<string>();
    const calls: { sql: string }[] = [];
    const execute = vi.fn(async (q: unknown) => {
      const { text, params } = renderSql(q);
      calls.push({ sql: text });
      if (text.includes('external_benchmarks')) {
        const key = JSON.stringify(params);
        const isUpsert = /ON CONFLICT[\s\S]*DO UPDATE[\s\S]*as_of/i.test(text);
        if (seen.has(key) && !isUpsert) {
          const err = new Error(
            'duplicate key value violates unique constraint ' +
              '"external_benchmarks_source_metric_value_uk"',
          ) as Error & { code?: string };
          err.code = '23505';
          throw err;
        }
        seen.add(key);
      }
      return [] as unknown[];
    });
    const db = { execute };

    const cron = createFxFeedCron({
      db,
      logger: silentLogger,
      enabled: false,
      // Same values on every tick → same (source, metric_id, value) key.
      fetchBotTzsUsd: async () => 2614.5,
      fetchLbmaGoldFix: async () => ({ date: '2026-05-28', am: 2384.4, pm: 2391.1 }),
    });

    // First tick seeds the rows.
    const first = await cron.tickOnce();
    expect(first.errors).toEqual([]);
    expect(first.bot.inserted).toBe(true);
    expect(first.lbma.inserted).toBe(true);

    // The benchmark write must carry the ON CONFLICT ... DO UPDATE clause.
    const benchmarkCalls = calls.filter((c) => c.sql.includes('external_benchmarks'));
    expect(benchmarkCalls.length).toBeGreaterThan(0);
    for (const c of benchmarkCalls) {
      expect(c.sql).toMatch(/ON CONFLICT\s*\(\s*source,\s*metric_id,\s*value\s*\)/i);
      expect(c.sql).toMatch(/DO UPDATE[\s\S]*SET as_of\s*=\s*EXCLUDED\.as_of/i);
    }

    // Second tick with the SAME values would throw 23505 under a bare
    // INSERT; with the UPSERT it must complete cleanly and still refresh.
    const second = await cron.tickOnce();
    expect(second.errors).toEqual([]);
    expect(second.bot.inserted).toBe(true);
    expect(second.lbma.inserted).toBe(true);
  });

  it('still appends a distinct benchmark value (preserves the LBMA rolling series)', async () => {
    // Two ticks with DIFFERENT gold fixes → distinct (source, metric_id,
    // value) keys → two rows persist (the 30-row series is not collapsed).
    const persisted = new Set<string>();
    const execute = vi.fn(async (q: unknown) => {
      const { text, params } = renderSql(q);
      if (text.includes('external_benchmarks')) {
        persisted.add(JSON.stringify(params));
      }
      return [] as unknown[];
    });
    const db = { execute };

    let am = 2384.4;
    const cron = createFxFeedCron({
      db,
      logger: silentLogger,
      enabled: false,
      fetchBotTzsUsd: async () => null,
      fetchLbmaGoldFix: async () => ({ date: '2026-05-28', am, pm: null }),
    });

    await cron.tickOnce();
    am = 2390.9; // a new distinct sourced value
    await cron.tickOnce();

    const goldRows = [...persisted].filter((p) => p.includes('gold_am_fix_usd_oz'));
    expect(goldRows).toHaveLength(2);
  });

  it('catches exceptions from custom fetch fns', async () => {
    const db = makeDb();
    const cron = createFxFeedCron({
      db,
      logger: silentLogger,
      enabled: false,
      fetchBotTzsUsd: async () => {
        throw new Error('network down');
      },
      fetchLbmaGoldFix: async () => {
        throw new Error('lbma 500');
      },
    });
    const result = await cron.tickOnce();
    expect(result.bot.value).toBeNull();
    expect(result.lbma.amValue).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining(['network down', 'lbma 500']));
  });
});

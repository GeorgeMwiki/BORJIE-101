/**
 * fx-feed-cron — single-tick orchestration tests.
 */
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createFxFeedCron } from '../fx-feed-cron.js';

const silentLogger = pino({ level: 'silent' });

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

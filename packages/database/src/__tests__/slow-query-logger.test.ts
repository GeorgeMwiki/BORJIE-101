/**
 * Unit tests for withSlowQueryLogging — verifies the proxy wrapping,
 * threshold-based callback firing, and graceful fallbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withSlowQueryLogging,
  type SlowQueryEvent,
} from '../slow-query-logger.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

interface FakePostgresJsClient {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
}

function makeFakePostgresClient(opts: {
  unsafeImpl?: (q: string, p?: unknown[]) => Promise<unknown>;
} = {}): FakePostgresJsClient {
  const unsafeImpl =
    opts.unsafeImpl ?? (async () => [{ id: 1 }, { id: 2 }]);
  // The base callable does nothing meaningful; we only need .unsafe.
  const callable = (async () => undefined) as unknown as FakePostgresJsClient;
  callable.unsafe = unsafeImpl;
  return callable;
}

function makeDbWith(client: FakePostgresJsClient | undefined): DatabaseClient {
  return { $client: client } as unknown as DatabaseClient;
}

describe('withSlowQueryLogging', () => {
  // Type widened from `ReturnType<typeof vi.spyOn>` to bypass a vitest
  // type-drift between MockInstance generic-arg counts (1.x → narrow,
  // newer → wide). The runtime behaviour is unchanged; the spy captures
  // every `logger.warn` call (pino-backed, per CLAUDE.md "no console.* in
  // services").
  let warnSpy: ReturnType<typeof vi.spyOn> | (ReturnType<typeof vi.fn> & { mockRestore(): void });
  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined) as never;
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the original db unchanged when $client is missing', () => {
    const db = makeDbWith(undefined);
    const wrapped = withSlowQueryLogging(db);
    expect(wrapped).toBe(db);
    // A configuration warning should have been emitted at most once.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns the original db when $client is not a postgres-js callable', () => {
    const db = { $client: { not: 'a function' } } as unknown as DatabaseClient;
    const wrapped = withSlowQueryLogging(db);
    expect(wrapped).toBe(db);
  });

  it('does not emit slow-query callback when query is below threshold', async () => {
    const fast = makeFakePostgresClient({
      unsafeImpl: async () => [{ id: 1 }],
    });
    const events: SlowQueryEvent[] = [];
    const wrapped = withSlowQueryLogging(makeDbWith(fast), {
      thresholdMs: 1_000_000, // huge so nothing fires
      onSlowQuery: (e) => events.push(e),
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await $c.unsafe('SELECT 1', []);
    expect(events).toHaveLength(0);
  });

  it('fires onSlowQuery when query exceeds threshold', async () => {
    const slow = makeFakePostgresClient({
      unsafeImpl: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return [{ id: 1 }];
      },
    });
    const events: SlowQueryEvent[] = [];
    const wrapped = withSlowQueryLogging(makeDbWith(slow), {
      thresholdMs: 1, // tiny so 5ms blows past
      onSlowQuery: (e) => events.push(e),
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await $c.unsafe('SELECT * FROM big', []);
    expect(events).toHaveLength(1);
    expect(events[0]?.query).toBe('SELECT * FROM big');
    expect(events[0]?.thresholdMs).toBe(1);
    expect(events[0]?.rowCount).toBe(1);
  });

  it('forwards every query to onQuery when logAllQueries=true', async () => {
    const fake = makeFakePostgresClient({
      unsafeImpl: async () => [{ id: 1 }],
    });
    const seen: SlowQueryEvent[] = [];
    const wrapped = withSlowQueryLogging(makeDbWith(fake), {
      thresholdMs: 1_000_000,
      logAllQueries: true,
      onQuery: (e) => seen.push(e),
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await $c.unsafe('SELECT 1', []);
    await $c.unsafe('SELECT 2', []);
    expect(seen).toHaveLength(2);
  });

  it('still fires onSlowQuery on a thrown query (then rethrows)', async () => {
    const angry = makeFakePostgresClient({
      unsafeImpl: async () => {
        await new Promise((r) => setTimeout(r, 3));
        throw new Error('query exploded');
      },
    });
    const events: SlowQueryEvent[] = [];
    const wrapped = withSlowQueryLogging(makeDbWith(angry), {
      thresholdMs: 1,
      onSlowQuery: (e) => events.push(e),
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await expect($c.unsafe('SELECT err')).rejects.toThrow('query exploded');
    expect(events).toHaveLength(1);
    expect(events[0]?.rowCount).toBeUndefined();
  });

  it('swallows logger faults so the caller never breaks', async () => {
    const fast = makeFakePostgresClient();
    const wrapped = withSlowQueryLogging(makeDbWith(fast), {
      thresholdMs: 1,
      onSlowQuery: () => {
        throw new Error('logger died');
      },
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await new Promise((r) => setTimeout(r, 3));
    // Should resolve cleanly even though the logger callback throws.
    await expect($c.unsafe('SELECT 1', [])).resolves.toBeDefined();
  });

  it('default handler logs via console.warn with structured payload', async () => {
    const slow = makeFakePostgresClient({
      unsafeImpl: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return [{ id: 1 }];
      },
    });
    const wrapped = withSlowQueryLogging(makeDbWith(slow), {
      thresholdMs: 1,
      tag: 'svc',
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await $c.unsafe('SELECT 1', []);
    expect(warnSpy).toHaveBeenCalled();
    const args = warnSpy.mock.calls[0]!;
    expect(String(args[0])).toContain('[slow-query:svc]');
  });

  it('passes empty array as default params', async () => {
    let captured: { q: string; p: unknown[] } | undefined;
    const fake = makeFakePostgresClient({
      unsafeImpl: async (q, p = []) => {
        captured = { q, p };
        return [];
      },
    });
    const wrapped = withSlowQueryLogging(makeDbWith(fake), {
      thresholdMs: 1_000_000,
    });
    const $c = (wrapped as unknown as { $client: FakePostgresJsClient }).$client;
    await $c.unsafe('SELECT * FROM x');
    expect(captured?.q).toBe('SELECT * FROM x');
    expect(captured?.p).toEqual([]);
  });
});

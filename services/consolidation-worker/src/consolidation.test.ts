/**
 * Tests for the consolidation worker.
 *
 * Coverage:
 *   - empty queue → no-op
 *   - batched processing (1 fact per 5 turns)
 *   - per-tenant isolation (group A's success not blocked by group B)
 *   - upsert failure → does NOT mark the failing group; OTHER groups still progress
 *   - consolidator throw → degrades to no-write for the group
 *   - SIGTERM-style clean exit (stop() during a running loop)
 *   - fetch failure → tick returns empty + records error
 *   - mark failure → facts upserted but marking error reported
 *   - default stub consolidator emits 1 fact per 5 turns exactly
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  runConsolidationTick,
  createStubConsolidator,
  createConsolidationLoop,
  type ConsolidationDeps,
  type ConsolidatorPort,
  type ReservoirEntry,
  type ReservoirSource,
  type SemanticSink,
  type WorkerLogger,
} from './consolidation.js';

function makeLogger(): WorkerLogger & { calls: { level: string; obj: unknown; msg?: string }[] } {
  const calls: { level: string; obj: unknown; msg?: string }[] = [];
  return {
    calls,
    info: (obj, msg) => calls.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => calls.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => calls.push({ level: 'error', obj, msg }),
  };
}

function makeEntry(overrides: Partial<ReservoirEntry> = {}): ReservoirEntry {
  return {
    thoughtId: `t_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 'tenant-a',
    userId: 'user-1',
    threadId: 'thread-1',
    summary: 'user asked about lease',
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface MockSource extends ReservoirSource {
  readonly fetchCalls: number;
  readonly markedIds: ReadonlyArray<ReadonlyArray<string>>;
}

function makeSource(
  entries: ReadonlyArray<ReservoirEntry>,
  opts: {
    readonly fetchThrows?: boolean;
    readonly markThrows?: boolean;
  } = {},
): MockSource {
  const state = {
    fetchCalls: 0,
    markedIds: [] as string[][],
  };
  const source: ReservoirSource = {
    async fetchUnconsolidated() {
      state.fetchCalls += 1;
      if (opts.fetchThrows) throw new Error('fetch boom');
      return entries;
    },
    async markConsolidated(ids) {
      if (opts.markThrows) throw new Error('mark boom');
      state.markedIds.push([...ids]);
    },
  };
  Object.defineProperty(source, 'fetchCalls', {
    get: () => state.fetchCalls,
    enumerable: true,
  });
  Object.defineProperty(source, 'markedIds', {
    get: () => state.markedIds,
    enumerable: true,
  });
  return source as MockSource;
}

function makeSink(
  opts: {
    readonly throwOnUserId?: string;
    readonly throwAlways?: boolean;
  } = {},
): SemanticSink & {
  readonly upserts: ReadonlyArray<{ tenantId: string | null; userId: string; key: string }>;
} {
  const upserts: { tenantId: string | null; userId: string; key: string }[] = [];
  const sink: SemanticSink = {
    async upsertFact(args) {
      if (opts.throwAlways) throw new Error('upsert always boom');
      if (opts.throwOnUserId && args.userId === opts.throwOnUserId) {
        throw new Error(`upsert boom for ${args.userId}`);
      }
      upserts.push({ tenantId: args.tenantId, userId: args.userId, key: args.key });
    },
  };
  return Object.assign(sink, { upserts });
}

describe('runConsolidationTick — empty queue', () => {
  it('returns zeros and does not touch sink/consolidator when no entries', async () => {
    const logger = makeLogger();
    const source = makeSource([]);
    const sink = makeSink();
    const consolidator: ConsolidatorPort = {
      consolidate: vi.fn().mockResolvedValue([]),
    };

    const deps: ConsolidationDeps = { source, sink, consolidator, logger };
    const result = await runConsolidationTick(deps);

    expect(result.entriesProcessed).toBe(0);
    expect(result.factsUpserted).toBe(0);
    expect(result.thoughtIdsMarked).toBe(0);
    expect(consolidator.consolidate).not.toHaveBeenCalled();
    expect(sink.upserts).toHaveLength(0);
    expect(source.markedIds).toHaveLength(0);
  });
});

describe('runConsolidationTick — batched processing', () => {
  it('emits 1 fact per 5 turns and marks all consumed reservoir ids', async () => {
    const logger = makeLogger();
    // 10 turns → stub consolidator emits floor(10/5) = 2 facts
    const entries: ReservoirEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        thoughtId: `t${i}`,
        capturedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      }),
    );
    const source = makeSource(entries);
    const sink = makeSink();
    const consolidator = createStubConsolidator();

    const deps: ConsolidationDeps = { source, sink, consolidator, logger };
    const result = await runConsolidationTick(deps);

    expect(result.entriesProcessed).toBe(10);
    expect(result.groupsProcessed).toBe(1);
    expect(result.factsUpserted).toBe(2);
    expect(result.thoughtIdsMarked).toBe(10);
    expect(sink.upserts).toHaveLength(2);
    expect(source.markedIds).toHaveLength(1);
    expect(source.markedIds[0]).toHaveLength(10);
  });

  it('default stub emits ZERO facts when fewer than turnsPerFact entries', async () => {
    const logger = makeLogger();
    const entries: ReservoirEntry[] = Array.from({ length: 4 }, (_, i) =>
      makeEntry({ thoughtId: `t${i}` }),
    );
    const source = makeSource(entries);
    const sink = makeSink();
    const consolidator = createStubConsolidator();

    const deps: ConsolidationDeps = { source, sink, consolidator, logger };
    const result = await runConsolidationTick(deps);

    expect(result.factsUpserted).toBe(0);
    expect(result.thoughtIdsMarked).toBe(0);
    expect(sink.upserts).toHaveLength(0);
    // Group was processed but produced no facts → must NOT mark, so
    // the next tick can retry once more entries arrive.
    expect(source.markedIds).toHaveLength(0);
  });
});

describe('runConsolidationTick — per-tenant isolation', () => {
  it('processes tenant B even when tenant A upserts fail', async () => {
    const logger = makeLogger();
    const entriesA: ReservoirEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `a${i}`, tenantId: 'tenant-a', userId: 'user-a' }),
    );
    const entriesB: ReservoirEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `b${i}`, tenantId: 'tenant-b', userId: 'user-b' }),
    );
    const source = makeSource([...entriesA, ...entriesB]);
    const sink = makeSink({ throwOnUserId: 'user-a' });
    const consolidator = createStubConsolidator();

    const deps: ConsolidationDeps = { source, sink, consolidator, logger };
    const result = await runConsolidationTick(deps);

    expect(result.entriesProcessed).toBe(10);
    expect(result.groupsProcessed).toBe(2);
    expect(result.factsUpserted).toBe(1); // tenant B only
    expect(result.thoughtIdsMarked).toBe(5); // tenant B's ids
    expect(result.errors.length).toBeGreaterThan(0);

    const markedFlat = source.markedIds.flat();
    expect(markedFlat.every((id) => id.startsWith('b'))).toBe(true);
  });
});

describe('runConsolidationTick — error in upsertFact does not lose other tenants', () => {
  it('continues processing remaining groups when one sink call throws', async () => {
    const logger = makeLogger();
    const a = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `a${i}`, tenantId: 'tA', userId: 'uA' }),
    );
    const b = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `b${i}`, tenantId: 'tB', userId: 'uB' }),
    );
    const c = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `c${i}`, tenantId: 'tC', userId: 'uC' }),
    );
    const source = makeSource([...a, ...b, ...c]);
    const sink = makeSink({ throwOnUserId: 'uB' });
    const consolidator = createStubConsolidator();

    const deps: ConsolidationDeps = { source, sink, consolidator, logger };
    const result = await runConsolidationTick(deps);

    expect(result.groupsProcessed).toBe(3);
    expect(result.factsUpserted).toBe(2);
    // Marker called twice (A, C), NOT for B.
    expect(source.markedIds).toHaveLength(2);
    const markedFlat = source.markedIds.flat();
    expect(markedFlat.some((id) => id.startsWith('a'))).toBe(true);
    expect(markedFlat.some((id) => id.startsWith('c'))).toBe(true);
    expect(markedFlat.some((id) => id.startsWith('b'))).toBe(false);
  });
});

describe('runConsolidationTick — consolidator throw degrades to no-write', () => {
  it('does not write or mark when consolidator rejects, logs the error, other groups still run', async () => {
    const logger = makeLogger();
    const a = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `a${i}`, userId: 'uA' }),
    );
    const b = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `b${i}`, userId: 'uB' }),
    );
    const source = makeSource([...a, ...b]);
    const sink = makeSink();

    let calls = 0;
    const consolidator: ConsolidatorPort = {
      async consolidate({ userId, entries }) {
        calls += 1;
        if (userId === 'uA') throw new Error('haiku exploded');
        // Pass-through stub for the well-behaved group.
        return entries.slice(0, 1).map((e) => ({
          key: 'recent-topic',
          value: { summary: e.summary },
          confidence: 0.5,
        }));
      },
    };

    const deps: ConsolidationDeps = { source, sink, consolidator, logger };
    const result = await runConsolidationTick(deps);

    expect(calls).toBe(2);
    expect(result.factsUpserted).toBe(1);
    expect(sink.upserts).toHaveLength(1);
    expect(sink.upserts[0]?.userId).toBe('uB');
    expect(result.errors.some((e) => e.includes('consolidator'))).toBe(true);
  });
});

describe('runConsolidationTick — fetch failure', () => {
  it('returns empty result + error string when source.fetch throws', async () => {
    const logger = makeLogger();
    const source = makeSource([], { fetchThrows: true });
    const sink = makeSink();
    const consolidator = createStubConsolidator();

    const result = await runConsolidationTick({ source, sink, consolidator, logger });
    expect(result.entriesProcessed).toBe(0);
    expect(result.errors[0]).toMatch(/fetch/);
    expect(sink.upserts).toHaveLength(0);
  });
});

describe('runConsolidationTick — markConsolidated failure', () => {
  it('still counts facts upserted, surfaces mark error', async () => {
    const logger = makeLogger();
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ thoughtId: `t${i}` }),
    );
    const source = makeSource(entries, { markThrows: true });
    const sink = makeSink();
    const consolidator = createStubConsolidator();

    const result = await runConsolidationTick({ source, sink, consolidator, logger });
    expect(result.factsUpserted).toBe(1);
    expect(result.thoughtIdsMarked).toBe(0);
    expect(result.errors.some((e) => e.startsWith('mark:'))).toBe(true);
  });
});

describe('createConsolidationLoop — SIGTERM clean exit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('runs an immediate tick on start and clears the interval on stop', async () => {
    const logger = makeLogger();
    const entries = [makeEntry()];
    const source = makeSource(entries);
    const sink = makeSink();
    const consolidator: ConsolidatorPort = {
      consolidate: vi.fn().mockResolvedValue([
        { key: 'recent-topic', value: { summary: 'x' }, confidence: 0.5 },
      ]),
    };

    let scheduled: (() => void) | null = null;
    let cleared = 0;
    const loop = createConsolidationLoop({
      source,
      sink,
      consolidator,
      logger,
      intervalMs: 60_000,
      scheduler: {
        setInterval: (fn) => {
          scheduled = fn;
          return { id: 'fake' };
        },
        clearInterval: () => {
          cleared += 1;
        },
      },
    });

    await loop.start();
    expect(source.fetchCalls).toBe(1); // immediate tick happened
    expect(scheduled).not.toBeNull();

    loop.stop();
    expect(cleared).toBe(1);

    // After stop, scheduled callback must NOT trigger new work even if it
    // happens to fire (e.g. JS macrotask race during shutdown).
    if (scheduled) {
      (scheduled as () => void)();
      await Promise.resolve();
    }
    expect(source.fetchCalls).toBe(1);

    // Idempotent stop.
    loop.stop();
    expect(cleared).toBe(1);
  });

  it('intervalMs is clamped to the safe band', () => {
    const logger = makeLogger();
    const source = makeSource([]);
    const sink = makeSink();
    const consolidator = createStubConsolidator();

    const tooSmall = createConsolidationLoop({
      source,
      sink,
      consolidator,
      logger,
      intervalMs: 1,
    });
    expect(tooSmall.intervalMs).toBeGreaterThanOrEqual(1000);

    const tooLarge = createConsolidationLoop({
      source,
      sink,
      consolidator,
      logger,
      intervalMs: 10 * 24 * 60 * 60 * 1000,
    });
    expect(tooLarge.intervalMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

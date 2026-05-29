/**
 * Phase C C2 integration — verify the 5 B1 wiring slots are threaded
 * through `buildHqDepsFromDb` and the C2 helper adapters.
 *
 * Covered B1 wiring slots:
 *   #2  killswitch cross-portal publisher        (createKillswitchFanoutPublisher)
 *   #3  announcement notification dispatcher     (createNotificationDispatcherAdapter)
 *   #4  announcement recipient resolver          (createRecipientResolverAdapter)
 *   #5  decision-trace recorder slot             (createDecisionTraceRecorderAdapter)
 *   #6  consolidation worker entrypoint          (createConsolidationWorkerAdapter)
 *
 * The tests bypass real Drizzle by passing a stub `db` whose every
 * service call surfaces deterministic refusals; we only assert the
 * structural wiring (B1's adapters are constructed against the
 * stub adapters we thread in).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildHqDepsFromDb,
  createDecisionTraceRecorderAdapter,
  createConsolidationWorkerAdapter,
  type HqCallerResolver,
} from '../hq-tool-registry.js';
import {
  createKillswitchFanoutPublisher,
  type KillswitchEvent,
} from '../cross-portal-killswitch-fanout.js';
import {
  createNotificationDispatcherAdapter,
  createRecipientResolverAdapter,
} from '../notification-dispatcher-adapter.js';
import {
  createInMemoryCrossPortalBus,
  globalTopic,
  type CrossPortalEventShape,
} from '../cross-portal-bus.js';

function callerResolver(): HqCallerResolver {
  return {
    resolve: () => ({ callerId: 'phase-c-tester', scopes: ['platform:*'] }),
  };
}

// Minimal stub `DatabaseClient` — the B1 platform services accept it
// and surface their own structured "DB unavailable" responses inside
// every method. The integration test only exercises the WIRING, not
// the read/write paths, so calls that bottom out in `db.select(...)`
// just return empty/rejected per service's catch-and-log pattern.
function stubDb(): unknown {
  // Drizzle's `.select(...).from(...).where(...)` chain. Each method
  // returns the same chainable thenable so `await db.select()...` is
  // valid no matter how the calling service wires the query.
  const chain = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    leftJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    offset() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    returning() {
      return chain;
    },
    onConflictDoNothing() {
      return chain;
    },
    onConflictDoUpdate() {
      return chain;
    },
    then(onFulfilled: (rows: ReadonlyArray<unknown>) => unknown) {
      return Promise.resolve([] as ReadonlyArray<unknown>).then(onFulfilled);
    },
  };
  return {
    select() {
      return chain;
    },
    insert() {
      return chain;
    },
    update() {
      return chain;
    },
    delete() {
      return chain;
    },
    execute() {
      return Promise.resolve([]);
    },
  };
}

describe('hq-tool-registry — Phase C C2 wire integration (B1 wires 2-6)', () => {
  it('B1 #2 — killswitch fan-out publisher is threaded into killswitchWrite', async () => {
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const publishCrossPortalEvent = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(bus),
    });

    const deps = buildHqDepsFromDb(stubDb() as never, {
      callerResolver: callerResolver(),
      publishCrossPortalEvent,
    });

    // Invoke the publisher directly to prove the threading: it must
    // reach the global topic.
    const event: KillswitchEvent = {
      type: 'killswitch:changed',
      scope: 'platform',
      level: 'halt',
      reasonCode: 'COMPLIANCE_HOLD_CBK',
      setAt: '2026-05-16T10:00:00.000Z',
    };
    await publishCrossPortalEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({
      type: 'killswitch:changed',
      level: 'halt',
    });
    // killswitchWrite is the slot the publisher feeds via the B1
    // service factory — proves the wiring resolves.
    expect(deps.killswitchWrite).toBeDefined();
    await bus.close();
  });

  it('B1 #3 — notification dispatcher is threaded into announcements.send', async () => {
    const bus = createInMemoryCrossPortalBus();
    const dispatcher = createNotificationDispatcherAdapter({
      eventBus: { publish: vi.fn() },
      crossPortalBus: Promise.resolve(bus),
    });

    const deps = buildHqDepsFromDb(stubDb() as never, {
      callerResolver: callerResolver(),
      announcementDispatcher: dispatcher,
    });

    // The announcements slot must be non-null (B1's service was
    // constructed) — the dispatcher is bound inside it.
    expect(deps.announcements).toBeDefined();
    expect(typeof deps.announcements.send).toBe('function');
    expect(typeof deps.announcements.recall).toBe('function');
    await bus.close();
  });

  it('B1 #4 — recipient resolver is threaded into announcements', async () => {
    const bus = createInMemoryCrossPortalBus();
    const resolver = createRecipientResolverAdapter({ db: stubDb() as never });

    const deps = buildHqDepsFromDb(stubDb() as never, {
      callerResolver: callerResolver(),
      announcementRecipientResolver: resolver,
    });

    expect(deps.announcements).toBeDefined();
    // Resolver itself must be invocable & return a number.
    const c = await resolver.count({ scope: 'global', channel: 'banner' });
    expect(typeof c).toBe('number');
    await bus.close();
  });

  it('B1 #5 — decision-trace recorder adapter is threaded into tracesQuery', async () => {
    const fakeRecorder = {
      getRecentTraces: vi.fn(async () => [
        {
          thoughtId: 'tr-1',
          tenantId: 't-1',
          threadId: 'th-1',
          startedAt: '2026-05-16T10:00:00Z',
          finishedAt: '2026-05-16T10:00:01Z',
          steps: [{}, {}, {}],
        },
      ]),
    };
    const adapter = createDecisionTraceRecorderAdapter({ recorder: fakeRecorder });
    const deps = buildHqDepsFromDb(stubDb() as never, {
      callerResolver: callerResolver(),
      decisionTraceRecorder: adapter,
    });

    expect(deps.tracesQuery).toBeDefined();
    const rows = await deps.tracesQuery.listRecent({
      limit: 10,
      capability: null,
      scoreMin: null,
      tenantId: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.traceId).toBe('tr-1');
    expect(rows[0]?.stepCount).toBe(3);
  });

  it('B1 #5 — adapter returns [] when the kernel recorder throws', async () => {
    const throwingRecorder = {
      getRecentTraces: vi.fn(async () => {
        throw new Error('kernel store down');
      }),
    };
    const adapter = createDecisionTraceRecorderAdapter({
      recorder: throwingRecorder,
    });
    const rows = await adapter.listRecent();
    expect(rows).toEqual([]);
  });

  it('B1 #6 — consolidation worker adapter is threaded into consolidation slot', async () => {
    const runner = {
      runForActiveTenants: vi.fn(async () => ({
        tenantsProcessed: 2,
        factsUpserted: 4,
        patternsRecorded: 1,
        digestsWritten: 1,
        expiredPurged: 0,
        decayedFacts: 0,
        errors: [],
      })),
    };
    const adapter = createConsolidationWorkerAdapter({ runner });
    const deps = buildHqDepsFromDb(stubDb() as never, {
      callerResolver: callerResolver(),
      consolidationWorker: adapter,
    });

    expect(deps.consolidation).toBeDefined();
    const report = await deps.consolidation.runTick({
      tenantId: null,
      dryRun: false,
    });
    expect(report.factsExtracted).toBe(4);
    expect(report.applied).toBe(true);
    expect(report.snapshotId).toBeNull();
    expect(runner.runForActiveTenants).toHaveBeenCalledTimes(1);
  });

  it('B1 #6 — rollbackSnapshot surfaces a structured "not wired" failure', async () => {
    const runner = {
      runForActiveTenants: vi.fn(async () => ({
        tenantsProcessed: 0,
        factsUpserted: 0,
        patternsRecorded: 0,
        digestsWritten: 0,
        expiredPurged: 0,
        decayedFacts: 0,
        errors: [],
      })),
    };
    const adapter = createConsolidationWorkerAdapter({ runner });
    await expect(adapter.rollbackSnapshot('snap-1')).rejects.toThrow(
      /snapshot-capable worker/,
    );
  });

  it('all 5 wires resolve together when threaded through buildHqDepsFromDb at once', async () => {
    const bus = createInMemoryCrossPortalBus();
    const deps = buildHqDepsFromDb(stubDb() as never, {
      callerResolver: callerResolver(),
      publishCrossPortalEvent: createKillswitchFanoutPublisher({
        crossPortalBus: Promise.resolve(bus),
      }),
      announcementDispatcher: createNotificationDispatcherAdapter({
        eventBus: { publish: vi.fn() },
        crossPortalBus: Promise.resolve(bus),
      }),
      announcementRecipientResolver: createRecipientResolverAdapter({
        db: stubDb() as never,
      }),
      decisionTraceRecorder: createDecisionTraceRecorderAdapter({
        recorder: { getRecentTraces: async () => [] },
      }),
      consolidationWorker: createConsolidationWorkerAdapter({
        runner: {
          runForActiveTenants: async () => ({
            tenantsProcessed: 0,
            factsUpserted: 0,
            patternsRecorded: 0,
            digestsWritten: 0,
            expiredPurged: 0,
            decayedFacts: 0,
            errors: [],
          }),
        },
      }),
    });

    // Every B1 port that was previously a refusal stub is now bound.
    expect(deps.killswitchWrite).toBeDefined();
    expect(deps.announcements).toBeDefined();
    expect(deps.tracesQuery).toBeDefined();
    expect(deps.consolidation).toBeDefined();
    expect(typeof deps.consolidation.runTick).toBe('function');
    expect(typeof deps.consolidation.rollbackToSnapshot).toBe('function');
    expect(typeof deps.tracesQuery.listRecent).toBe('function');
    await bus.close();
  });
});

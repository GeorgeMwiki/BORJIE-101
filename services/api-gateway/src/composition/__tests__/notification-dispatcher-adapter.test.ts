/**
 * notification-dispatcher-adapter tests — covers the dispatcher bridge
 * (event bus + cross-portal fan-out) and the recipient-resolver
 * (Drizzle count under tenant + global scopes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotificationDispatcherAdapter,
  createRecipientResolverAdapter,
  type EventBusLike,
  type RecipientResolverLike,
} from '../notification-dispatcher-adapter.js';
import {
  createInMemoryCrossPortalBus,
  globalTopic,
  tenantTopic,
  type CrossPortalBus,
  type CrossPortalEventShape,
} from '../cross-portal-bus.js';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function fakeBus(): EventBusLike & {
  readonly events: Array<{ type: string; payload: Record<string, unknown> }>;
} {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  return {
    events,
    publish: (envelope) => {
      events.push({ type: envelope.type, payload: envelope.payload });
    },
  };
}

describe('createNotificationDispatcherAdapter — dispatch', () => {
  it('publishes onto both event bus and cross-portal bus on dispatch', async () => {
    const eventBus = fakeBus();
    const bus = createInMemoryCrossPortalBus();
    const globalReceived: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => globalReceived.push(e));

    const adapter = createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: Promise.resolve(bus),
    });
    const result = await adapter.dispatch({
      announcementId: 'a1',
      scope: 'global',
      channel: 'banner',
      subject: 'subject',
      body: 'body',
      scheduleAt: null,
    });

    expect(result).toEqual({ recipientCount: 0, status: 'sending' });
    expect(eventBus.events).toHaveLength(1);
    expect(eventBus.events[0]?.type).toBe('platform.announcement.dispatched');
    expect(globalReceived).toHaveLength(1);
    expect(globalReceived[0]?.kind).toBe('announcement');
    expect(globalReceived[0]?.payload).toMatchObject({
      announcementId: 'a1',
      scope: 'global',
      channel: 'banner',
      subject: 'subject',
    });
    await bus.close();
  });

  it('routes a tenant-scoped announcement to the tenant topic, NOT the global topic', async () => {
    const eventBus = fakeBus();
    const bus = createInMemoryCrossPortalBus();
    const tenantReceived: CrossPortalEventShape[] = [];
    const globalReceived: CrossPortalEventShape[] = [];
    await bus.subscribe(tenantTopic('t-1'), (e) => tenantReceived.push(e));
    await bus.subscribe(globalTopic(), (e) => globalReceived.push(e));

    const adapter = createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: Promise.resolve(bus),
    });
    await adapter.dispatch({
      announcementId: 'a2',
      scope: 'tenant:t-1',
      channel: 'email',
      subject: 's',
      body: 'b',
      scheduleAt: null,
    });

    expect(tenantReceived).toHaveLength(1);
    expect(globalReceived).toHaveLength(0);
    expect(tenantReceived[0]?.payload).toMatchObject({
      scope: 'tenant:t-1',
      announcementId: 'a2',
    });
    await bus.close();
  });

  it('does not throw when the cross-portal bus rejects on resolution', async () => {
    const eventBus = fakeBus();
    const adapter = createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: Promise.reject(new Error('redis down')),
    });

    await expect(
      adapter.dispatch({
        announcementId: 'a3',
        scope: 'global',
        channel: 'banner',
        subject: 's',
        body: 'b',
        scheduleAt: null,
      }),
    ).resolves.toEqual({ recipientCount: 0, status: 'sending' });
    // Event bus publish still happens.
    expect(eventBus.events).toHaveLength(1);
  });

  it('does not throw when bus.publish rejects mid-flight', async () => {
    const eventBus = fakeBus();
    const publishMock = vi.fn(async () => {
      throw new Error('publish boom');
    });
    const stubBus: CrossPortalBus = {
      publish: publishMock as never,
      subscribe: async () => async () => undefined,
      close: async () => undefined,
    };
    const adapter = createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: Promise.resolve(stubBus),
    });
    await expect(
      adapter.dispatch({
        announcementId: 'a4',
        scope: 'global',
        channel: 'banner',
        subject: 's',
        body: 'b',
        scheduleAt: null,
      }),
    ).resolves.toEqual({ recipientCount: 0, status: 'sending' });
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when event-bus publish itself throws', async () => {
    const bus = createInMemoryCrossPortalBus();
    const throwingBus: EventBusLike = {
      publish: () => {
        throw new Error('event bus boom');
      },
    };
    const adapter = createNotificationDispatcherAdapter({
      eventBus: throwingBus,
      crossPortalBus: Promise.resolve(bus),
    });
    await expect(
      adapter.dispatch({
        announcementId: 'a5',
        scope: 'global',
        channel: 'banner',
        subject: 's',
        body: 'b',
        scheduleAt: null,
      }),
    ).resolves.toEqual({ recipientCount: 0, status: 'sending' });
    await bus.close();
  });
});

describe('createNotificationDispatcherAdapter — retract', () => {
  it('publishes a retraction onto the event bus and the global topic', async () => {
    const eventBus = fakeBus();
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const adapter = createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: Promise.resolve(bus),
    });
    await adapter.retract({ announcementId: 'a1', reason: 'mistake' });

    expect(eventBus.events).toHaveLength(1);
    expect(eventBus.events[0]?.type).toBe('platform.announcement.retracted');
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe('notification');
    expect(received[0]?.payload).toMatchObject({
      type: 'announcement-retracted',
      announcementId: 'a1',
      reason: 'mistake',
    });
    await bus.close();
  });

  it('retract() is fault-tolerant when the bus rejects', async () => {
    const eventBus = fakeBus();
    const adapter = createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: Promise.reject(new Error('redis down')),
    });
    await expect(
      adapter.retract({ announcementId: 'a1', reason: 'r' }),
    ).resolves.toBeUndefined();
    expect(eventBus.events).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Recipient resolver tests
// ─────────────────────────────────────────────────────────────────────

type FakeDbCall = {
  readonly scope: 'tenant' | 'global';
  readonly channel: 'banner' | 'email' | 'both';
};

function fakeDb(rowsByScope: {
  readonly tenant?: number;
  readonly global?: number;
  readonly throwOn?: 'tenant' | 'global';
}): {
  readonly db: unknown;
  readonly calls: ReadonlyArray<FakeDbCall>;
} {
  const calls: FakeDbCall[] = [];

  function makeChain(rows: ReadonlyArray<{ c: number }>): unknown {
    // The adapter calls: db.select(...).from(users).where(...) OR
    // db.select(...).from(users).innerJoin(tenants, ...).where(...).
    // Both chains end in a thenable that resolves to rows.
    const chain = {
      from() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      where(_w: unknown) {
        // Returning a thenable so `await` on the chain resolves to rows.
        return {
          then(onFulfilled: (rows: ReadonlyArray<{ c: number }>) => unknown) {
            return Promise.resolve(rows).then(onFulfilled);
          },
        };
      },
    };
    return chain;
  }

  const db = {
    select(_cols: unknown) {
      // Decide which scope based on whether innerJoin gets called. We
      // can't peek ahead, so we wire two slightly different chain
      // builders: one that records 'global' on innerJoin and one that
      // records 'tenant' on where without join. Simpler: always
      // construct a chain that records the kind at .where().
      let usedJoin = false;
      const baseChain = {
        from() {
          return baseChain;
        },
        innerJoin() {
          usedJoin = true;
          return baseChain;
        },
        where(_w: unknown): unknown {
          const scope: 'tenant' | 'global' = usedJoin ? 'global' : 'tenant';
          calls.push({ scope, channel: 'banner' }); // channel left coarse
          if (rowsByScope.throwOn === scope) {
            return Promise.reject(new Error('db scope error: ' + scope));
          }
          const count =
            scope === 'tenant'
              ? rowsByScope.tenant ?? 0
              : rowsByScope.global ?? 0;
          return Promise.resolve([{ c: count }]);
        },
      };
      return baseChain;
    },
  };
  // Wrap select to return our scope-aware chain
  return { db, calls };
}

describe('createRecipientResolverAdapter', () => {
  it('counts active users for a tenant-scoped announcement', async () => {
    const { db } = fakeDb({ tenant: 17 });
    const resolver: RecipientResolverLike = createRecipientResolverAdapter({
      db: db as never,
    });
    const c = await resolver.count({
      scope: 'tenant:t-1',
      channel: 'banner',
    });
    expect(c).toBe(17);
  });

  it('counts across active tenants for a global announcement', async () => {
    const { db } = fakeDb({ global: 4242 });
    const resolver = createRecipientResolverAdapter({ db: db as never });
    const c = await resolver.count({
      scope: 'global',
      channel: 'email',
    });
    expect(c).toBe(4242);
  });

  it('returns 0 when the DB throws (best-effort contract)', async () => {
    const { db } = fakeDb({ throwOn: 'global' });
    const resolver = createRecipientResolverAdapter({ db: db as never });
    const c = await resolver.count({
      scope: 'global',
      channel: 'banner',
    });
    expect(c).toBe(0);
  });

  it('returns 0 when the tenant DB query throws', async () => {
    const { db } = fakeDb({ throwOn: 'tenant' });
    const resolver = createRecipientResolverAdapter({ db: db as never });
    const c = await resolver.count({
      scope: 'tenant:t-1',
      channel: 'email',
    });
    expect(c).toBe(0);
  });

  it('returns 0 when the tenant scope sanitizes to empty', async () => {
    const { db } = fakeDb({ tenant: 999 });
    const resolver = createRecipientResolverAdapter({ db: db as never });
    // `tenant:` with no id following is a malformed scope. The adapter
    // bails before issuing the query.
    const c = await resolver.count({
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      scope: 'tenant:' as 'tenant:any',
      channel: 'banner',
    });
    expect(c).toBe(0);
  });

  it('returns 0 when DB returns an empty result set', async () => {
    const { db } = fakeDb({});
    const resolver = createRecipientResolverAdapter({ db: db as never });
    const c = await resolver.count({
      scope: 'global',
      channel: 'banner',
    });
    expect(c).toBe(0);
  });

  it('handles each channel without throwing', async () => {
    const { db } = fakeDb({ tenant: 5, global: 50 });
    const resolver = createRecipientResolverAdapter({ db: db as never });
    for (const channel of ['banner', 'email', 'both'] as const) {
      const c1 = await resolver.count({
        scope: 'tenant:t-1',
        channel,
      });
      expect(c1).toBe(5);
      const c2 = await resolver.count({
        scope: 'global',
        channel,
      });
      expect(c2).toBe(50);
    }
  });
});

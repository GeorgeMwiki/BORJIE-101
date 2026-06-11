import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  initCockpitBus,
  publishCockpitEvent,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../index';
import {
  createInMemoryCrossPortalBus,
  createRedisCrossPortalBus,
  type CrossPortalEventShape,
  type RedisPublisherLike,
  type RedisSubscriberLike,
} from '../../../composition/cross-portal-bus';

/** Wait for queued microtasks/promises to settle (Redis subscribe is async). */
const flushAsync = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const TENANT_A = 'tenant-a-uuid';
const TENANT_B = 'tenant-b-uuid';

function makeDecisionEvent(tenantId: string, suffix = ''): CockpitEvent {
  return {
    kind: 'decision.recorded',
    tenantId,
    emittedAt: '2026-05-29T10:00:00Z',
    decisionId: `dec-${suffix}`,
    subject: 'A test decision',
    severity: 'medium',
  };
}

describe('cockpit-events bus', () => {
  beforeEach(() => {
    __resetCockpitBusForTests();
  });

  afterEach(() => {
    __resetCockpitBusForTests();
  });

  it('delivers an event to a single subscriber', () => {
    const handler = vi.fn();
    const unsub = subscribeCockpitEvents(TENANT_A, handler);
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_A, '1'));
    expect(delivered).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    const arg = handler.mock.calls[0]?.[0] as CockpitEvent;
    expect(arg.kind).toBe('decision.recorded');
    expect(arg.tenantId).toBe(TENANT_A);
    unsub();
  });

  it('isolates events between tenants', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    subscribeCockpitEvents(TENANT_A, handlerA);
    subscribeCockpitEvents(TENANT_B, handlerB);
    publishCockpitEvent(makeDecisionEvent(TENANT_A, 'x'));
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('returns zero when no subscriber listens for the tenant', () => {
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_B, 'orphan'));
    expect(delivered).toBe(0);
  });

  it('stops delivering after unsubscribe', () => {
    const handler = vi.fn();
    const unsub = subscribeCockpitEvents(TENANT_A, handler);
    publishCockpitEvent(makeDecisionEvent(TENANT_A, '1'));
    unsub();
    publishCockpitEvent(makeDecisionEvent(TENANT_A, '2'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('broadcasts to multiple subscribers for the same tenant', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    subscribeCockpitEvents(TENANT_A, handlerA);
    subscribeCockpitEvents(TENANT_A, handlerB);
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_A, 'fanout'));
    expect(delivered).toBe(2);
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('in-process fallback: no cross-portal bus wired → local-only, unchanged', () => {
    // initCockpitBus is NOT called (reset clears it). This is today's
    // single-replica behaviour: publish reaches only local listeners.
    const handler = vi.fn();
    const unsub = subscribeCockpitEvents(TENANT_A, handler);
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_A, 'local'));
    expect(delivered).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
  });
});

// ── CAP RSS-05: cross-replica fan-out over the Redis pub/sub of record ──
//
// The cockpit bus module is a singleton per process, so we cannot load
// two copies to model two replicas. Instead we model "replica B" as a
// second subscriber attached directly to the SHARED cross-portal bus —
// exactly what replica B's bridge does internally. Asserting that the
// envelope reaches that second subscriber proves an event published on
// replica A reaches subscribers on replica B.

/**
 * A pair of fake ioredis-shaped clients that loop published messages
 * back into subscribed channels in-process — the minimal stand-in for a
 * real Redis broker so the EXACT Redis-backed bus code path
 * (`createRedisCrossPortalBus`) is exercised under test.
 */
function makeFakeRedisBroker(): {
  client: () => { publisher: RedisPublisherLike; subscriber: RedisSubscriberLike };
} {
  const channelListeners = new Map<
    string,
    Set<(channel: string, message: string) => void>
  >();
  const subscribedChannels = new Set<string>();

  const client = (): {
    publisher: RedisPublisherLike;
    subscriber: RedisSubscriberLike;
  } => {
    const messageHandlers = new Set<
      (channel: string, message: string) => void
    >();
    const subscriber: RedisSubscriberLike = {
      subscribe(channel: string) {
        subscribedChannels.add(channel);
        for (const h of messageHandlers) {
          let set = channelListeners.get(channel);
          if (!set) {
            set = new Set();
            channelListeners.set(channel, set);
          }
          set.add(h);
        }
        return Promise.resolve();
      },
      unsubscribe(channel: string) {
        const set = channelListeners.get(channel);
        if (set) for (const h of messageHandlers) set.delete(h);
        return Promise.resolve();
      },
      on(_event: 'message', listener) {
        messageHandlers.add(listener);
        // Back-fill any channels already subscribed before `on` ran.
        for (const ch of subscribedChannels) {
          let set = channelListeners.get(ch);
          if (!set) {
            set = new Set();
            channelListeners.set(ch, set);
          }
          set.add(listener);
        }
        return subscriber;
      },
      off(_event: 'message', listener) {
        messageHandlers.delete(listener);
        for (const set of channelListeners.values()) set.delete(listener);
        return subscriber;
      },
    };
    const publisher: RedisPublisherLike = {
      publish(channel: string, message: string) {
        const set = channelListeners.get(channel);
        if (set) for (const h of Array.from(set)) h(channel, message);
        return set ? set.size : 0;
      },
    };
    return { publisher, subscriber };
  };

  return { client };
}

describe('cockpit-events bus — cross-replica (RSS-05)', () => {
  beforeEach(() => {
    __resetCockpitBusForTests();
  });
  afterEach(() => {
    __resetCockpitBusForTests();
  });

  it('mocked redis path: published event reaches a subscriber on another replica', async () => {
    const broker = makeFakeRedisBroker();

    // Replica A — the process under test — uses one Redis-backed bus.
    const a = broker.client();
    const busA = createRedisCrossPortalBus({
      publisher: a.publisher,
      subscriber: a.subscriber,
    });
    initCockpitBus(busA);

    // Local SSE client on replica A.
    const localClientA = vi.fn();
    subscribeCockpitEvents(TENANT_A, localClientA);
    await flushAsync(); // let replica-A's bridge subscription open

    // Replica B — a second Redis-backed bus on the SAME broker. Its
    // bridge re-emits onto replica B's own (here: captured) clients.
    const b = broker.client();
    const busB = createRedisCrossPortalBus({
      publisher: b.publisher,
      subscriber: b.subscriber,
    });
    const replicaBReceived: CockpitEvent[] = [];
    await busB.subscribe(
      'borjie:cross-portal:tenant:' + TENANT_A + ':event',
      (envelope: CrossPortalEventShape) => {
        const payload = envelope.payload as Record<string, unknown>;
        if (payload.marker === 'cockpit-event') {
          replicaBReceived.push(payload.event as CockpitEvent);
        }
      },
    );

    // Publish on replica A.
    publishCockpitEvent(makeDecisionEvent(TENANT_A, 'cross'));
    await flushAsync();

    // Replica A's local client gets it synchronously via the local emit.
    expect(localClientA).toHaveBeenCalledTimes(1);
    // Replica B receives it over Redis — the cross-replica guarantee.
    expect(replicaBReceived).toHaveLength(1);
    expect(replicaBReceived[0]?.kind).toBe('decision.recorded');
    expect(replicaBReceived[0]?.tenantId).toBe(TENANT_A);

    await busA.close();
    await busB.close();
  });

  it('echo suppression: replica A does not double-deliver its own publish', async () => {
    const broker = makeFakeRedisBroker();
    const a = broker.client();
    const busA = createRedisCrossPortalBus({
      publisher: a.publisher,
      subscriber: a.subscriber,
    });
    initCockpitBus(busA);

    const localClientA = vi.fn();
    subscribeCockpitEvents(TENANT_A, localClientA);
    await flushAsync();

    publishCockpitEvent(makeDecisionEvent(TENANT_A, 'echo'));
    await flushAsync();

    // Exactly once: the synchronous local emit. The Redis echo of our
    // own publish is dropped by originInstanceId, so no second delivery.
    expect(localClientA).toHaveBeenCalledTimes(1);
    await busA.close();
  });

  it('cross-replica tenant isolation: tenant A publish never reaches tenant B', async () => {
    const broker = makeFakeRedisBroker();
    const a = broker.client();
    const busA = createRedisCrossPortalBus({
      publisher: a.publisher,
      subscriber: a.subscriber,
    });
    initCockpitBus(busA);

    const b = broker.client();
    const busB = createRedisCrossPortalBus({
      publisher: b.publisher,
      subscriber: b.subscriber,
    });
    const tenantBReceived: CockpitEvent[] = [];
    await busB.subscribe(
      'borjie:cross-portal:tenant:' + TENANT_B + ':event',
      (envelope: CrossPortalEventShape) => {
        const payload = envelope.payload as Record<string, unknown>;
        if (payload.marker === 'cockpit-event') {
          tenantBReceived.push(payload.event as CockpitEvent);
        }
      },
    );

    publishCockpitEvent(makeDecisionEvent(TENANT_A, 'iso'));
    await flushAsync();

    expect(tenantBReceived).toHaveLength(0);
    await busA.close();
    await busB.close();
  });

  it('in-memory cross-portal bus wired (REDIS_URL unset analogue) keeps local delivery', async () => {
    // When REDIS_URL is unset the composition root injects the in-memory
    // cross-portal bus. Cross-replica fan-out collapses to a single
    // process, but local SSE clients are still served exactly as today.
    const bus = createInMemoryCrossPortalBus();
    initCockpitBus(bus);

    const handler = vi.fn();
    subscribeCockpitEvents(TENANT_A, handler);
    await flushAsync();
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_A, 'inmem'));
    await flushAsync();

    expect(delivered).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    await bus.close();
  });
});

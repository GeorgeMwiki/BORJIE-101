/**
 * cross-portal-bus tests — tenant-scoped fanout, global fanout,
 * payload-shape validation, no-cross-tenant-leak, and Redis adapter
 * behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createInMemoryCrossPortalBus,
  createRedisCrossPortalBus,
  globalTopic,
  tenantTopic,
  type CrossPortalEventShape,
  type RedisPublisherLike,
  type RedisSubscriberLike,
} from '../cross-portal-bus.js';

const baseEvent = (
  overrides: Partial<CrossPortalEventShape> = {},
): CrossPortalEventShape => ({
  kind: 'announcement',
  payload: { hello: 'world' },
  emittedBy: 'hq-user',
  emittedAt: '2026-05-15T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('cross-portal-bus — topic helpers', () => {
  it('tenantTopic produces a stable, sanitised channel name', () => {
    expect(tenantTopic('abc-123')).toBe(
      'borjie:cross-portal:tenant:abc-123:event',
    );
  });

  it('tenantTopic strips unsafe characters', () => {
    expect(tenantTopic('foo:bar/baz')).toBe(
      'borjie:cross-portal:tenant:foobarbaz:event',
    );
  });

  it('tenantTopic rejects empty', () => {
    expect(() => tenantTopic('')).toThrow();
  });

  it('tenantTopic rejects an id that sanitises to empty', () => {
    expect(() => tenantTopic(':::')).toThrow();
  });

  it('globalTopic is a stable constant', () => {
    expect(globalTopic()).toBe('borjie:cross-portal:global:event');
  });
});

describe('cross-portal-bus — in-memory bus', () => {
  it('tenant-scoped publish reaches only subscribers on that topic', async () => {
    const bus = createInMemoryCrossPortalBus();
    const t1Events: CrossPortalEventShape[] = [];
    const t2Events: CrossPortalEventShape[] = [];
    await bus.subscribe(tenantTopic('t1'), (e) => t1Events.push(e));
    await bus.subscribe(tenantTopic('t2'), (e) => t2Events.push(e));
    await bus.publish(tenantTopic('t1'), baseEvent({ payload: { v: 1 } }));
    expect(t1Events).toHaveLength(1);
    expect(t2Events).toHaveLength(0);
    expect(t1Events[0]?.payload).toEqual({ v: 1 });
    await bus.close();
  });

  it('global publish reaches every global subscriber', async () => {
    const bus = createInMemoryCrossPortalBus();
    const a: CrossPortalEventShape[] = [];
    const b: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => a.push(e));
    await bus.subscribe(globalTopic(), (e) => b.push(e));
    await bus.publish(globalTopic(), baseEvent({ kind: 'notification' }));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    await bus.close();
  });

  it('global publish does NOT leak into tenant subscribers', async () => {
    const bus = createInMemoryCrossPortalBus();
    const tenantEvents: CrossPortalEventShape[] = [];
    await bus.subscribe(tenantTopic('t1'), (e) => tenantEvents.push(e));
    await bus.publish(globalTopic(), baseEvent());
    expect(tenantEvents).toHaveLength(0);
    await bus.close();
  });

  it('unsubscribe stops further deliveries to that handler', async () => {
    const bus = createInMemoryCrossPortalBus();
    const events: CrossPortalEventShape[] = [];
    const off = await bus.subscribe(tenantTopic('t1'), (e) =>
      events.push(e),
    );
    await bus.publish(tenantTopic('t1'), baseEvent());
    await off();
    await bus.publish(tenantTopic('t1'), baseEvent());
    expect(events).toHaveLength(1);
    await bus.close();
  });

  it('publish() after close() throws', async () => {
    const bus = createInMemoryCrossPortalBus();
    await bus.close();
    await expect(bus.publish(globalTopic(), baseEvent())).rejects.toThrow(
      /closed/,
    );
  });

  it('rejects events with invalid kind', async () => {
    const bus = createInMemoryCrossPortalBus();
    await expect(
      bus.publish(globalTopic(), {
        ...baseEvent(),
        // @ts-expect-error invalid kind on purpose
        kind: 'bogus',
      }),
    ).rejects.toThrow(/invalid kind/);
    await bus.close();
  });

  it('rejects events with non-object payload', async () => {
    const bus = createInMemoryCrossPortalBus();
    await expect(
      bus.publish(globalTopic(), {
        ...baseEvent(),
        // @ts-expect-error invalid payload
        payload: [1, 2, 3],
      }),
    ).rejects.toThrow(/plain object/);
    await bus.close();
  });

  it('rejects events with missing emittedBy', async () => {
    const bus = createInMemoryCrossPortalBus();
    await expect(
      bus.publish(globalTopic(), {
        ...baseEvent(),
        emittedBy: '',
      }),
    ).rejects.toThrow(/emittedBy/);
    await bus.close();
  });

  it('serialises payloads so receiver does not share references', async () => {
    const bus = createInMemoryCrossPortalBus();
    let received: CrossPortalEventShape | null = null;
    await bus.subscribe(globalTopic(), (e) => {
      received = e;
    });
    const original = baseEvent({ payload: { mutated: 'no' } });
    await bus.publish(globalTopic(), original);
    expect(received).not.toBeNull();
    expect(received!.payload).toEqual({ mutated: 'no' });
    // Mutating the source after publish must NOT affect the receiver.
    (original.payload as Record<string, unknown>).mutated = 'YES';
    expect(received!.payload).toEqual({ mutated: 'no' });
    await bus.close();
  });

  it('handler throws are isolated (other handlers still fire)', async () => {
    const bus = createInMemoryCrossPortalBus();
    const ok: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), () => {
      throw new Error('boom');
    });
    await bus.subscribe(globalTopic(), (e) => ok.push(e));
    await bus.publish(globalTopic(), baseEvent());
    expect(ok).toHaveLength(1);
    await bus.close();
  });
});

describe('cross-portal-bus — Redis adapter', () => {
  function makeRedisStub() {
    const messageListeners: Array<
      (channel: string, message: string) => void
    > = [];
    const subscribed = new Set<string>();
    const published: Array<{ channel: string; body: string }> = [];

    const publisher: RedisPublisherLike = {
      publish: vi.fn(async (channel, message) => {
        published.push({ channel, body: message });
        for (const l of messageListeners) l(channel, message);
        return 1;
      }),
      quit: vi.fn(async () => undefined),
    };
    const subscriber: RedisSubscriberLike = {
      subscribe: vi.fn(async (ch) => {
        subscribed.add(ch as string);
      }),
      unsubscribe: vi.fn(async (ch) => {
        subscribed.delete(ch as string);
      }),
      on: vi.fn((event, listener) => {
        if (event === 'message') {
          messageListeners.push(
            listener as (channel: string, message: string) => void,
          );
        }
      }) as never,
      off: vi.fn((event, listener) => {
        if (event === 'message') {
          const idx = messageListeners.indexOf(
            listener as (channel: string, message: string) => void,
          );
          if (idx >= 0) messageListeners.splice(idx, 1);
        }
      }) as never,
      quit: vi.fn(async () => undefined),
    };
    return { publisher, subscriber, subscribed, published, messageListeners };
  }

  it('subscribe()/publish() routes through Redis correctly', async () => {
    const r = makeRedisStub();
    const bus = createRedisCrossPortalBus({
      publisher: r.publisher,
      subscriber: r.subscriber,
    });
    const events: CrossPortalEventShape[] = [];
    await bus.subscribe(tenantTopic('t1'), (e) => events.push(e));
    expect(r.subscribed.has(tenantTopic('t1'))).toBe(true);
    await bus.publish(tenantTopic('t1'), baseEvent());
    expect(events).toHaveLength(1);
    await bus.close();
  });

  it('subscribe() calls Redis SUBSCRIBE exactly once per topic', async () => {
    const r = makeRedisStub();
    const bus = createRedisCrossPortalBus({
      publisher: r.publisher,
      subscriber: r.subscriber,
    });
    await bus.subscribe(tenantTopic('t1'), () => undefined);
    await bus.subscribe(tenantTopic('t1'), () => undefined);
    expect((r.subscriber.subscribe as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    await bus.close();
  });

  it('unsubscribing the last handler also unsubscribes from Redis', async () => {
    const r = makeRedisStub();
    const bus = createRedisCrossPortalBus({
      publisher: r.publisher,
      subscriber: r.subscriber,
    });
    const off1 = await bus.subscribe(tenantTopic('t1'), () => undefined);
    const off2 = await bus.subscribe(tenantTopic('t1'), () => undefined);
    await off1();
    expect(r.subscribed.has(tenantTopic('t1'))).toBe(true);
    await off2();
    expect(r.subscribed.has(tenantTopic('t1'))).toBe(false);
    await bus.close();
  });

  it('malformed messages on the wire are dropped (not delivered to handlers)', async () => {
    const r = makeRedisStub();
    const bus = createRedisCrossPortalBus({
      publisher: r.publisher,
      subscriber: r.subscriber,
    });
    const events: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => events.push(e));
    // Simulate a corrupted message arriving from Redis directly.
    for (const listener of r.messageListeners) {
      listener(globalTopic(), 'not-json');
      listener(globalTopic(), JSON.stringify({ kind: 'bogus' }));
    }
    expect(events).toHaveLength(0);
    await bus.close();
  });

  it('close() detaches listener and quits both connections', async () => {
    const r = makeRedisStub();
    const bus = createRedisCrossPortalBus({
      publisher: r.publisher,
      subscriber: r.subscriber,
    });
    await bus.close();
    expect(r.publisher.quit).toHaveBeenCalled();
    expect(r.subscriber.quit).toHaveBeenCalled();
  });

  it('close() is idempotent', async () => {
    const r = makeRedisStub();
    const bus = createRedisCrossPortalBus({
      publisher: r.publisher,
      subscriber: r.subscriber,
    });
    await bus.close();
    await bus.close();
    expect((r.publisher.quit as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});

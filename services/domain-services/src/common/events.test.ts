/**
 * Tests for `InMemoryEventBus` wildcard subscriptions and external
 * forwarders — both introduced in Wave 19 so the composition root
 * can bridge the domain bus onto the observability platform bus.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_EVENTS,
  InMemoryEventBus,
  createEventEnvelope,
  type DomainEvent,
} from './events.js';

interface TestEvent extends DomainEvent {
  readonly eventType: 'TestEvent';
  readonly payload: { readonly foo: string };
}

function makeEvent(foo: string): TestEvent {
  return {
    eventId: 'evt_1',
    eventType: 'TestEvent',
    timestamp: '2026-04-20T00:00:00Z' as unknown as TestEvent['timestamp'],
    tenantId: 'tnt_1' as unknown as TestEvent['tenantId'],
    correlationId: 'cor_1',
    causationId: null,
    metadata: {},
    payload: { foo },
  };
}

describe('InMemoryEventBus wildcard + forwarder', () => {
  it('delivers to exact-match subscribers', async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe<TestEvent>('TestEvent', async (env) => {
      seen.push(env.event.payload.foo);
    });
    await bus.publish(createEventEnvelope(makeEvent('a'), 'agg_1', 'Agg'));
    expect(seen).toEqual(['a']);
  });

  it('delivers to wildcard (*) subscribers in addition to exact-match', async () => {
    const bus = new InMemoryEventBus();
    const direct: string[] = [];
    const all: string[] = [];
    bus.subscribe<TestEvent>('TestEvent', async (env) => {
      direct.push(env.event.payload.foo);
    });
    bus.subscribe(ALL_EVENTS, async (env) => {
      all.push((env.event as TestEvent).payload.foo);
    });
    await bus.publish(createEventEnvelope(makeEvent('b'), 'agg_1', 'Agg'));
    expect(direct).toEqual(['b']);
    expect(all).toEqual(['b']);
  });

  it('forwards every published envelope to registered forwarders', async () => {
    const bus = new InMemoryEventBus();
    const forwarded: string[] = [];
    bus.addForwarder(async (env) => {
      forwarded.push((env.event as TestEvent).payload.foo);
    });
    await bus.publish(createEventEnvelope(makeEvent('c'), 'agg_1', 'Agg'));
    expect(forwarded).toEqual(['c']);
  });

  it('isolates forwarder errors — publisher continues past failures', async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.addForwarder(() => {
      throw new Error('bridge down');
    });
    bus.addForwarder(async (env) => {
      seen.push((env.event as TestEvent).payload.foo);
    });
    await expect(
      bus.publish(createEventEnvelope(makeEvent('d'), 'agg_1', 'Agg')),
    ).resolves.toBeUndefined();
    expect(seen).toEqual(['d']);
  });

  it('supports unsubscribing a forwarder', async () => {
    const bus = new InMemoryEventBus();
    const forwarded: string[] = [];
    const off = bus.addForwarder(async (env) => {
      forwarded.push((env.event as TestEvent).payload.foo);
    });
    await bus.publish(createEventEnvelope(makeEvent('e'), 'agg_1', 'Agg'));
    off();
    await bus.publish(createEventEnvelope(makeEvent('f'), 'agg_2', 'Agg'));
    expect(forwarded).toEqual(['e']);
  });

  it('isolates handler errors — one throwing sub does not block siblings', async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe<TestEvent>('TestEvent', async () => {
      throw new Error('bad handler');
    });
    bus.subscribe<TestEvent>('TestEvent', async (env) => {
      seen.push(env.event.payload.foo);
    });
    await bus.publish(createEventEnvelope(makeEvent('g'), 'agg_1', 'Agg'));
    expect(seen).toEqual(['g']);
  });
});

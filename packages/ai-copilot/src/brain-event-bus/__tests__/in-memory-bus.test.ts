/**
 * In-memory brain event bus — unit tests.
 *
 * Covers:
 *   - publish() → subscribed handler receives the event
 *   - publish() with no subscribers → no-op (no throw)
 *   - publish() with empty tenantId → throws (tenant isolation contract)
 *   - subscribe() returns a working unsubscribe handle
 *   - handler errors don't break other handlers or the publisher
 *   - onHandlerError is invoked when a handler throws
 */
import { describe, it, expect, vi } from 'vitest';

import {
  InMemoryBrainEventBus,
  createInMemoryBrainEventBus,
  type BrainEvent,
} from '../index.js';

function makeEvent(overrides: Partial<BrainEvent> = {}): BrainEvent {
  return {
    type: 'comms.whatsapp.inbound',
    tenantId: 'tenant_1',
    actorId: 'user_sender_1',
    payload: { text: 'hello' },
    acl: {
      userIds: ['user_sender_1', 'user_recipient_1'],
      roleIds: [],
    },
    observedAt: new Date('2026-05-23T10:00:00Z'),
    sourceSystem: 'whatsapp',
    ...overrides,
  };
}

describe('InMemoryBrainEventBus', () => {
  it('delivers a published event to a matching subscriber', async () => {
    const bus = new InMemoryBrainEventBus();
    const handler = vi.fn(async () => undefined);
    bus.subscribe('comms.whatsapp.inbound', handler);

    const event = makeEvent();
    await bus.publish(event);
    // Handlers run on a microtask — flush.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('does not throw when there are no subscribers', async () => {
    const bus = new InMemoryBrainEventBus();
    await expect(bus.publish(makeEvent())).resolves.toBeUndefined();
  });

  it('rejects events with an empty tenantId', async () => {
    const bus = new InMemoryBrainEventBus();
    await expect(bus.publish(makeEvent({ tenantId: '' }))).rejects.toThrow(/tenantId/);
  });

  it('honours unsubscribe', async () => {
    const bus = new InMemoryBrainEventBus();
    const handler = vi.fn(async () => undefined);
    const sub = bus.subscribe('comms.whatsapp.inbound', handler);

    sub.unsubscribe();
    await bus.publish(makeEvent());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates handler failures — other handlers still fire', async () => {
    const onError = vi.fn();
    const bus = new InMemoryBrainEventBus({ onHandlerError: onError });

    const ok = vi.fn(async () => undefined);
    const bad = vi.fn(async () => {
      throw new Error('boom');
    });

    bus.subscribe('comms.whatsapp.inbound', bad);
    bus.subscribe('comms.whatsapp.inbound', ok);

    await bus.publish(makeEvent());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(ok).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]?.message).toBe('boom');
  });

  it('returns from createInMemoryBrainEventBus is independent (no singleton)', () => {
    const a = createInMemoryBrainEventBus();
    const b = createInMemoryBrainEventBus();
    expect(a).not.toBe(b);
  });
});

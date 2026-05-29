/**
 * Cockpit Event Bus — in-process, tenant-scoped pub/sub for the
 * cockpit SSE channel (Roadmap R6).
 *
 * Why in-process and not Postgres LISTEN/NOTIFY?
 *   - Borjie api-gateway runs single-node in MVP; horizontal scale
 *     comes later. An in-process EventEmitter is O(subscribers) per
 *     publish, has zero infrastructure dependencies, and is trivially
 *     testable.
 *   - When we shard, this module is the only seam to swap for a
 *     PG-LISTEN / Redis-pubsub fan-out. The publisher / subscriber
 *     API stays identical; the bus is the only thing that changes.
 *
 * Tenant isolation:
 *   Subscribers register per-tenantId; the bus NEVER cross-broadcasts
 *   between tenants. publish() with the wrong tenant simply finds no
 *   subscribers (it does not throw).
 *
 * Backpressure:
 *   The bus is fire-and-forget — handlers must not block the publisher.
 *   The SSE route handler queues events in its own bounded array and
 *   drops the oldest if the client cannot keep up; the bus itself does
 *   not buffer.
 *
 * Memory safety:
 *   Subscribers MUST call the returned `unsubscribe()` on close or
 *   the bus will retain references indefinitely. The SSE handler
 *   wires this to the request abort signal.
 */

import { EventEmitter } from 'node:events';

import type { CockpitEvent } from './types.js';

/** Singleton EventEmitter — one channel per tenant. */
const emitter = new EventEmitter();

// Lift the default-10-listener cap because each connected cockpit
// counts as one listener; with a few dozen concurrent ones we'd be
// flooded with `MaxListenersExceededWarning`. The bounded per-tenant
// channel still protects us — listeners are removed on disconnect.
emitter.setMaxListeners(0);

function channelFor(tenantId: string): string {
  return `cockpit:${tenantId}`;
}

/**
 * Publish a cockpit event to all current subscribers for the tenant.
 * Returns the number of subscribers the event was delivered to.
 */
export function publishCockpitEvent(event: CockpitEvent): number {
  const channel = channelFor(event.tenantId);
  const listenerCount = emitter.listenerCount(channel);
  if (listenerCount > 0) {
    emitter.emit(channel, event);
  }
  return listenerCount;
}

/**
 * Subscribe to events for a tenant. Returns an unsubscribe handle that
 * MUST be called when the subscriber disconnects.
 */
export function subscribeCockpitEvents(
  tenantId: string,
  handler: (event: CockpitEvent) => void,
): () => void {
  const channel = channelFor(tenantId);
  emitter.on(channel, handler);
  return () => {
    emitter.off(channel, handler);
  };
}

/** Test helper — wipe all subscribers. NEVER call from non-test code. */
export function __resetCockpitBusForTests(): void {
  emitter.removeAllListeners();
}

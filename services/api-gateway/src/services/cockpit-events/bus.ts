/**
 * Cockpit Event Bus — tenant-scoped pub/sub for the cockpit SSE channel
 * (Roadmap R6).
 *
 * ── Two-layer design (CAP RSS-05) ──────────────────────────────────
 *
 * Layer 1 — LOCAL fan-out (always on):
 *   A singleton in-process `EventEmitter`, one channel per tenant. Each
 *   connected cockpit SSE client registers ONE local listener via
 *   `subscribeCockpitEvents`. This is the O(subscribers) push to the SSE
 *   clients attached to THIS process. It has zero infra dependencies and
 *   is trivially testable.
 *
 * Layer 2 — CROSS-REPLICA fan-out (opt-in, gated on REDIS_URL):
 *   With N gateway replicas behind a load balancer, an event published
 *   on replica A is only seen by the local EventEmitter on replica A, so
 *   ~(N-1)/N of the tenant's SSE clients (those connected to other
 *   replicas) miss it. To close that gap we back the bus with the
 *   project's Redis pub/sub of record — `CrossPortalBus`
 *   (`composition/cross-portal-bus.ts`). When (and only when) a
 *   Redis-backed bus is injected via `initCockpitBus(bus)` at boot:
 *     - publish:  the event is ALSO published to the per-tenant Redis
 *                 topic, so every replica receives it.
 *     - subscribe: each replica lazily opens ONE Redis subscription per
 *                 tenant (ref-counted across that tenant's local SSE
 *                 clients) whose handler re-emits onto the local
 *                 EventEmitter — fanning the cross-replica event out to
 *                 this replica's own SSE clients.
 *
 *   GATE: `initCockpitBus` is wired in the composition root from the
 *   same `CrossPortalBus` singleton, which itself picks the Redis
 *   backend ONLY when `REDIS_URL` is set and the in-memory backend
 *   otherwise. So with `REDIS_URL` UNSET the cross-portal bus is
 *   in-memory and nothing changes vs. today — the local EventEmitter
 *   remains the sole path. Not calling `initCockpitBus` at all is also
 *   today's behaviour (single-replica, local-only).
 *
 * Echo suppression:
 *   The publishing replica emits locally AND publishes to Redis. To
 *   avoid delivering the event twice to its own SSE clients, every
 *   Redis envelope is tagged with this process's `originInstanceId`;
 *   the Redis re-emit handler drops envelopes it published itself.
 *
 * Public API stability:
 *   `publishCockpitEvent(event): number` and
 *   `subscribeCockpitEvents(tenantId, handler): () => void` keep their
 *   exact signatures — ~35 call sites depend on them, so the engine is
 *   swapped underneath without route churn.
 *
 * Tenant isolation:
 *   Subscribers register per-tenantId; the bus NEVER cross-broadcasts
 *   between tenants. The Redis topic is composed via `tenantTopic`
 *   (sanitised), so a malformed tenant id can't escape its namespace.
 *
 * Backpressure:
 *   The bus is fire-and-forget — handlers must not block the publisher.
 *   The SSE route handler queues events in its own bounded array and
 *   drops the oldest if the client cannot keep up; the bus itself does
 *   not buffer.
 *
 * Memory safety:
 *   Subscribers MUST call the returned `unsubscribe()` on close or the
 *   bus retains references. The last local unsubscribe for a tenant also
 *   tears down that tenant's Redis subscription (ref-counted).
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import {
  tenantTopic,
  type CrossPortalBus,
  type CrossPortalEventShape,
} from '../../composition/cross-portal-bus.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

import type { CockpitEvent } from './types.js';

/** Singleton EventEmitter — one channel per tenant (local fan-out). */
const emitter = new EventEmitter();

// Lift the default-10-listener cap because each connected cockpit
// counts as one listener; with a few dozen concurrent ones we'd be
// flooded with `MaxListenersExceededWarning`. The bounded per-tenant
// channel still protects us — listeners are removed on disconnect.
emitter.setMaxListeners(0);

const logger = createPinoLikeLogger('cockpit-events-bus');

/**
 * Stable id for THIS process. Stamped onto every Redis envelope so the
 * cross-replica re-emit handler can drop the echo of events it
 * published itself (the local emit already delivered them).
 */
const ORIGIN_INSTANCE_ID = randomUUID();

/** Envelope kind under the cross-portal `state-mutation` family. */
const COCKPIT_ENVELOPE_MARKER = 'cockpit-event' as const;

// ── Cross-replica wiring state (null until initCockpitBus is called) ──

interface CrossReplicaState {
  readonly bus: CrossPortalBus;
  /** One ref-counted Redis subscription per tenant on THIS replica. */
  readonly tenantSubs: Map<
    string,
    { refs: number; unsubscribe: () => Promise<void> }
  >;
}

let crossReplica: CrossReplicaState | null = null;

function channelFor(tenantId: string): string {
  return `cockpit:${tenantId}`;
}

/**
 * Wire the cockpit bus to the cross-portal Redis bus at boot. Idempotent
 * per process; a second call with a different bus replaces the first
 * (used by tests). When the supplied bus is the in-memory cross-portal
 * bus (REDIS_URL unset) cross-replica fan-out is a no-op beyond a single
 * process, preserving today's behaviour.
 *
 * This is the ONLY new wire RSS-05 introduces — the composition root
 * calls it once with the `CrossPortalBus` singleton. Not calling it
 * leaves the local EventEmitter as the sole path.
 */
export function initCockpitBus(bus: CrossPortalBus): void {
  crossReplica = { bus, tenantSubs: new Map() };
}

/**
 * Build the cross-portal envelope for a cockpit event. Wrapped under the
 * existing `state-mutation` kind so we reuse the validated cross-portal
 * shape without extending its union.
 */
function toEnvelope(event: CockpitEvent): CrossPortalEventShape {
  return {
    kind: 'state-mutation',
    payload: {
      marker: COCKPIT_ENVELOPE_MARKER,
      originInstanceId: ORIGIN_INSTANCE_ID,
      event: event as unknown as Record<string, unknown>,
    },
    emittedBy: `cockpit:${ORIGIN_INSTANCE_ID}`,
    emittedAt: event.emittedAt ?? new Date().toISOString(),
  };
}

/**
 * Decode a cross-portal envelope back into a cockpit event. Returns null
 * when the envelope is not a cockpit event, is malformed, or was
 * published by THIS process (echo of our own local emit).
 */
function fromEnvelope(envelope: CrossPortalEventShape): CockpitEvent | null {
  const payload = envelope.payload;
  if (
    !payload ||
    payload.marker !== COCKPIT_ENVELOPE_MARKER ||
    payload.originInstanceId === ORIGIN_INSTANCE_ID
  ) {
    return null;
  }
  const event = payload.event;
  if (!event || typeof event !== 'object') return null;
  return event as unknown as CockpitEvent;
}

/**
 * Lazily open (ref-counted) the per-tenant Redis subscription for THIS
 * replica. The handler re-emits cross-replica events onto the local
 * EventEmitter so they reach this replica's SSE clients. The returned
 * disposer decrements the ref-count and tears the Redis subscription
 * down when the last local subscriber for the tenant leaves.
 */
function acquireCrossReplicaTenantSub(tenantId: string): () => void {
  const state = crossReplica;
  if (!state) return () => {};

  const existing = state.tenantSubs.get(tenantId);
  if (existing) {
    existing.refs += 1;
    return () => releaseCrossReplicaTenantSub(tenantId);
  }

  // Reserve the slot synchronously so concurrent subscribers share it
  // even before the async subscribe resolves.
  const slot: { refs: number; unsubscribe: () => Promise<void> } = {
    refs: 1,
    unsubscribe: async () => {},
  };
  state.tenantSubs.set(tenantId, slot);

  const channel = channelFor(tenantId);
  void state.bus
    .subscribe(tenantTopic(tenantId), (envelope) => {
      const event = fromEnvelope(envelope);
      if (!event || event.tenantId !== tenantId) return;
      // Re-emit locally so THIS replica's SSE clients receive it. Use
      // emit directly (not publishCockpitEvent) to avoid re-publishing
      // back to Redis and forming a loop.
      emitter.emit(channel, event);
    })
    .then((dispose) => {
      // The slot may have been released before subscribe resolved.
      const current = crossReplica?.tenantSubs.get(tenantId);
      if (current === slot && current.refs > 0) {
        slot.unsubscribe = dispose;
      } else {
        void dispose();
      }
    })
    .catch((err: unknown) => {
      logger.error(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'cockpit-bus: cross-replica subscribe failed; local-only for this tenant',
      );
      crossReplica?.tenantSubs.delete(tenantId);
    });

  return () => releaseCrossReplicaTenantSub(tenantId);
}

function releaseCrossReplicaTenantSub(tenantId: string): void {
  const state = crossReplica;
  if (!state) return;
  const slot = state.tenantSubs.get(tenantId);
  if (!slot) return;
  slot.refs -= 1;
  if (slot.refs <= 0) {
    state.tenantSubs.delete(tenantId);
    void slot.unsubscribe().catch((err: unknown) => {
      logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'cockpit-bus: cross-replica unsubscribe failed',
      );
    });
  }
}

/**
 * Process-wide local taps — observers of EVERY locally-published event
 * regardless of tenant (e.g. the org-loop task→commitment closure binder).
 * Registered ONCE at composition time; deliberately NOT bridged across
 * replicas (see the publish-site note on exactly-once cluster semantics).
 */
const processTaps = new Set<(event: CockpitEvent) => void>();

/**
 * Register a process-wide tap on every locally-published cockpit event.
 * Returns an unregister handle. Taps must be fast and non-blocking; faults
 * are contained at the publish site and never break the SSE hot path.
 */
export function tapCockpitEvents(
  tap: (event: CockpitEvent) => void,
): () => void {
  processTaps.add(tap);
  return () => {
    processTaps.delete(tap);
  };
}

/**
 * Publish a cockpit event to all current subscribers for the tenant.
 *
 * - Always emits to the LOCAL EventEmitter (this replica's SSE clients),
 *   synchronously — return value is the local listener count, preserving
 *   the historical contract.
 * - When a cross-portal bus is wired AND it is Redis-backed, the event
 *   is ALSO published to the per-tenant Redis topic so every other
 *   replica's bridge re-emits it to its own SSE clients. The publish is
 *   fire-and-forget (errors logged, never thrown) so the SSE hot path is
 *   never blocked or broken by a Redis hiccup.
 */
export function publishCockpitEvent(event: CockpitEvent): number {
  const channel = channelFor(event.tenantId);
  const listenerCount = emitter.listenerCount(channel);
  if (listenerCount > 0) {
    emitter.emit(channel, event);
  }

  // Process-wide LOCAL taps (org-loop closure binder et al). Local-only is
  // the correct cluster semantics here: the publishing request lands on
  // exactly one replica, so a local tap fires exactly once cluster-wide —
  // unlike the per-tenant Redis fanout, which re-emits on every replica.
  // Tap faults are contained; the SSE hot path is never broken by a tap.
  for (const tap of processTaps) {
    try {
      tap(event);
    } catch (err) {
      logger.error(
        {
          tenantId: event.tenantId,
          kind: event.kind,
          err: err instanceof Error ? err.message : String(err),
        },
        'cockpit-bus: process tap failed; publish unaffected',
      );
    }
  }

  const state = crossReplica;
  if (state) {
    void state.bus
      .publish(tenantTopic(event.tenantId), toEnvelope(event))
      .catch((err: unknown) => {
        logger.error(
          {
            tenantId: event.tenantId,
            kind: event.kind,
            err: err instanceof Error ? err.message : String(err),
          },
          'cockpit-bus: cross-replica publish failed; local clients still served',
        );
      });
  }

  return listenerCount;
}

/**
 * Subscribe to events for a tenant. Returns an unsubscribe handle that
 * MUST be called when the subscriber disconnects.
 *
 * Registering the first local subscriber for a tenant also opens this
 * replica's (ref-counted) Redis subscription so cross-replica events
 * start flowing to this client; the last unsubscribe tears it down.
 */
export function subscribeCockpitEvents(
  tenantId: string,
  handler: (event: CockpitEvent) => void,
): () => void {
  const channel = channelFor(tenantId);
  emitter.on(channel, handler);
  const releaseCrossReplica = acquireCrossReplicaTenantSub(tenantId);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    emitter.off(channel, handler);
    releaseCrossReplica();
  };
}

/**
 * Test helper — wipe all subscribers AND reset cross-replica wiring.
 * NEVER call from non-test code.
 */
export function __resetCockpitBusForTests(): void {
  emitter.removeAllListeners();
  processTaps.clear();
  crossReplica = null;
}

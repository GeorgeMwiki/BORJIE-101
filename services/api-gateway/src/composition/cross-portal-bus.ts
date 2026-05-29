/**
 * cross-portal-bus — Redis pubsub fan-out for the brain.
 *
 * Central Command Phase A gap #8 closure (see
 * `.planning/research/central-command/2025-bn-internal-gap-audit.md`
 * §7): today SSE flows brain → ONE caller. HQ cannot push a real-time
 * notice that simultaneously reaches owner-portal and customer-app
 * through the brain. This bus puts a per-tenant Redis channel between
 * the brain and the SSE fan-out router.
 *
 * Two channel families:
 *
 *   borjie:cross-portal:tenant:${tenantId}:event
 *      Per-tenant. Subscribers receive ONLY their tenant's events.
 *      Used for tenant-scoped announcements, state mutations, and
 *      wake-trigger fanouts.
 *
 *   borjie:cross-portal:global:event
 *      Platform-wide. Every authenticated user receives. Used for
 *      maintenance-window banners, HQ-tier announcements, system-
 *      degraded notices.
 *
 * Payload shape — every event is validated against
 * {@link CrossPortalEventShape} before publish. Receivers can rely
 * on:
 *
 *   {
 *     kind:       'announcement' | 'notification' | 'state-mutation' | 'wake-trigger',
 *     payload:    Record<string, unknown>,
 *     emittedBy:  string  (HQ operator id or 'system'),
 *     emittedAt:  ISO timestamp,
 *   }
 *
 * Tenant isolation: the `publish(topic, ...)` API accepts an opaque
 * topic string. Callers compose the topic via
 * {@link tenantTopic}/{@link globalTopic} — there is no API that lets
 * a caller publish to "tenant X" using "tenant Y"'s id, so cross-
 * tenant leakage is structurally impossible.
 *
 * Backends:
 *   - REDIS_URL set  → ioredis pub/sub (separate publisher and
 *     subscriber connections, per ioredis convention)
 *   - REDIS_URL unset → in-memory bus (dev / tests)
 *
 * The bus is intentionally generic. Phase B may swap in NATS / Kafka
 * by replacing only the factory; the API stays the same.
 */

import { createPinoLikeLogger } from '../utils/pino-shim.js';

/**
 * Strict payload shape. The bus validates before publish — invalid
 * payloads throw synchronously so a buggy producer cannot poison
 * subscribers. Receivers also re-validate (defense-in-depth).
 */
export interface CrossPortalEventShape {
  readonly kind:
    | 'announcement'
    | 'notification'
    | 'state-mutation'
    | 'wake-trigger';
  readonly payload: Record<string, unknown>;
  readonly emittedBy: string;
  readonly emittedAt: string;
}

const ALLOWED_KINDS: ReadonlyArray<CrossPortalEventShape['kind']> = [
  'announcement',
  'notification',
  'state-mutation',
  'wake-trigger',
];

/**
 * Builds the per-tenant topic. Strict input — never trust caller
 * tenant ids without sanitisation; we strip everything that isn't
 * `[a-zA-Z0-9_-]` before building the channel name so a malformed
 * tenant id can't escape the namespace.
 */
export function tenantTopic(tenantId: string): string {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantTopic: tenantId required');
  }
  const safe = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) {
    throw new Error('tenantTopic: tenantId reduced to empty after sanitisation');
  }
  return `borjie:cross-portal:tenant:${safe}:event`;
}

export function globalTopic(): string {
  return 'borjie:cross-portal:global:event';
}

export interface CrossPortalBus {
  publish(topic: string, event: CrossPortalEventShape): Promise<void>;
  /**
   * Subscribe to a topic. Returns an unsubscribe function that detaches
   * the handler from the bus (and the ioredis subscriber connection
   * when no other handlers remain on the topic).
   */
  subscribe(
    topic: string,
    handler: (event: CrossPortalEventShape) => void,
  ): Promise<() => Promise<void>>;
  /** Tear down all connections. Idempotent. */
  close(): Promise<void>;
}

export interface CrossPortalBusLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Minimal ioredis-shaped publisher port — lets tests inject a stub
 * without depending on the ioredis package surface.
 */
export interface RedisPublisherLike {
  publish(channel: string, message: string): Promise<number> | number;
  quit?(): Promise<unknown> | void;
  disconnect?(): void;
}

/**
 * Minimal ioredis-shaped subscriber port. ioredis emits `'message'`
 * for plain channels.
 */
export interface RedisSubscriberLike {
  subscribe(channel: string): Promise<unknown> | unknown;
  unsubscribe(channel: string): Promise<unknown> | unknown;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  off?(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  quit?(): Promise<unknown> | void;
  disconnect?(): void;
}

export interface RedisCrossPortalBusDeps {
  readonly publisher: RedisPublisherLike;
  readonly subscriber: RedisSubscriberLike;
  readonly logger?: CrossPortalBusLogger;
}

function defaultLogger(): CrossPortalBusLogger {
  return createPinoLikeLogger('cross-portal-bus');
}

/**
 * Validate an event payload before publish. Throws on malformed input
 * so a buggy publisher can't poison the channel.
 */
function assertValidEvent(event: unknown): asserts event is CrossPortalEventShape {
  if (!event || typeof event !== 'object') {
    throw new Error('cross-portal-bus: event must be an object');
  }
  const e = event as Record<string, unknown>;
  if (!ALLOWED_KINDS.includes(e.kind as CrossPortalEventShape['kind'])) {
    throw new Error(
      `cross-portal-bus: invalid kind '${String(e.kind)}'; must be one of ${ALLOWED_KINDS.join(', ')}`,
    );
  }
  if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) {
    throw new Error('cross-portal-bus: payload must be a plain object');
  }
  if (typeof e.emittedBy !== 'string' || !e.emittedBy) {
    throw new Error('cross-portal-bus: emittedBy required (non-empty string)');
  }
  if (typeof e.emittedAt !== 'string' || !e.emittedAt) {
    throw new Error('cross-portal-bus: emittedAt required (ISO string)');
  }
}

/**
 * Try to coerce a Redis-delivered message back into an event. Returns
 * null on any parse failure — the subscriber logs and skips. This is
 * the receive-side counterpart to assertValidEvent.
 */
function safeParseEvent(raw: string): CrossPortalEventShape | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    assertValidEvent(parsed);
    return parsed;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────
// Redis-backed bus
// ───────────────────────────────────────────────────────────────────

export function createRedisCrossPortalBus(
  deps: RedisCrossPortalBusDeps,
): CrossPortalBus {
  const logger = deps.logger ?? defaultLogger();
  const handlers = new Map<
    string,
    Set<(event: CrossPortalEventShape) => void>
  >();
  let closed = false;

  const onMessage = (channel: string, message: string): void => {
    const set = handlers.get(channel);
    if (!set || set.size === 0) return;
    const event = safeParseEvent(message);
    if (!event) {
      logger.warn(
        { channel, messagePreview: message.slice(0, 200) },
        'cross-portal-bus: rejected malformed inbound message',
      );
      return;
    }
    for (const h of Array.from(set)) {
      try {
        h(event);
      } catch (err) {
        logger.warn(
          { channel, err: err instanceof Error ? err.message : String(err) },
          'cross-portal-bus: handler threw',
        );
      }
    }
  };

  deps.subscriber.on('message', onMessage);

  return {
    async publish(topic, event) {
      if (closed) throw new Error('cross-portal-bus: closed');
      assertValidEvent(event);
      const body = JSON.stringify(event);
      await Promise.resolve(deps.publisher.publish(topic, body));
    },
    async subscribe(topic, handler) {
      if (closed) throw new Error('cross-portal-bus: closed');
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
        await Promise.resolve(deps.subscriber.subscribe(topic));
      }
      set.add(handler);
      return async () => {
        const live = handlers.get(topic);
        if (!live) return;
        live.delete(handler);
        if (live.size === 0) {
          handlers.delete(topic);
          try {
            await Promise.resolve(deps.subscriber.unsubscribe(topic));
          } catch (err) {
            logger.warn(
              {
                topic,
                err: err instanceof Error ? err.message : String(err),
              },
              'cross-portal-bus: unsubscribe failed',
            );
          }
        }
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        if (deps.subscriber.off) {
          deps.subscriber.off('message', onMessage);
        }
      } catch {
        // best-effort
      }
      try {
        if (deps.subscriber.quit) {
          await Promise.resolve(deps.subscriber.quit());
        } else if (deps.subscriber.disconnect) {
          deps.subscriber.disconnect();
        }
      } catch {
        // best-effort
      }
      try {
        if (deps.publisher.quit) {
          await Promise.resolve(deps.publisher.quit());
        } else if (deps.publisher.disconnect) {
          deps.publisher.disconnect();
        }
      } catch {
        // best-effort
      }
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// In-memory bus (dev / tests)
// ───────────────────────────────────────────────────────────────────

/**
 * In-memory bus used when REDIS_URL is unset. Same API surface as the
 * Redis-backed bus so callers stay identical across environments.
 */
export function createInMemoryCrossPortalBus(): CrossPortalBus {
  const handlers = new Map<
    string,
    Set<(event: CrossPortalEventShape) => void>
  >();
  let closed = false;

  return {
    async publish(topic, event) {
      if (closed) throw new Error('cross-portal-bus: closed');
      assertValidEvent(event);
      const set = handlers.get(topic);
      if (!set) return;
      // Serialize-deserialize so tests can pin "no shared references"
      // between publisher and subscriber.
      const body = JSON.parse(JSON.stringify(event)) as CrossPortalEventShape;
      for (const h of Array.from(set)) {
        try {
          h(body);
        } catch {
          // mirror redis-bus swallow
        }
      }
    },
    async subscribe(topic, handler) {
      if (closed) throw new Error('cross-portal-bus: closed');
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
      }
      set.add(handler);
      return async () => {
        const live = handlers.get(topic);
        if (!live) return;
        live.delete(handler);
        if (live.size === 0) {
          handlers.delete(topic);
        }
      };
    },
    async close() {
      closed = true;
      handlers.clear();
    },
  };
}

// ───────────────────────────────────────────────────────────────────
// Factory — picks Redis when REDIS_URL is set, otherwise in-memory.
// ───────────────────────────────────────────────────────────────────

export interface CrossPortalBusFactoryDeps {
  /** When set, the factory lazily imports ioredis and wires two
   *  connections (one publisher, one subscriber). When unset, the
   *  factory returns an in-memory bus. */
  readonly redisUrl?: string | null;
  readonly logger?: CrossPortalBusLogger;
}

/**
 * Build the bus per environment. Lazy-imports ioredis to avoid a
 * hard runtime dep when the gateway is run with REDIS_URL unset.
 */
export async function createCrossPortalBus(
  deps: CrossPortalBusFactoryDeps,
): Promise<CrossPortalBus> {
  const logger = deps.logger ?? defaultLogger();
  const url = deps.redisUrl?.trim();
  if (!url) {
    logger.info(
      {},
      'cross-portal-bus: REDIS_URL unset — using in-memory bus (dev mode)',
    );
    return createInMemoryCrossPortalBus();
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ioredis = await import('ioredis');
    const RedisCtor =
      (ioredis as unknown as { default?: new (url: string) => unknown })
        .default ??
      (ioredis as unknown as { Redis?: new (url: string) => unknown })
        .Redis ??
      (ioredis as unknown as new (url: string) => unknown);
    const publisher = new (RedisCtor as new (url: string) => RedisPublisherLike)(url);
    const subscriber = new (RedisCtor as new (url: string) => RedisSubscriberLike)(url);
    return createRedisCrossPortalBus({ publisher, subscriber, logger });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'cross-portal-bus: ioredis import/connect failed — falling back to in-memory bus',
    );
    return createInMemoryCrossPortalBus();
  }
}

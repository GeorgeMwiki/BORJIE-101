/**
 * Cross-pod fan-out transport for in-app notifications.
 *
 * Round-3 audit H7 left cross-pod delivery as a follow-up: a WebSocket
 * is pinned to the pod that accepted it, so a notification created on
 * pod A was only ever pushed to clients connected to pod A. A user whose
 * browser happened to land on pod B saw nothing in real time until they
 * refreshed (and re-read the row from the durable store).
 *
 * This module closes that gap with a minimal pub/sub port. The in-app
 * service publishes every freshly-created notification to a per-tenant
 * channel; EVERY pod subscribes to that channel and re-pushes the
 * envelope to ITS OWN locally-connected clients. Origin-pod double
 * delivery is prevented by stamping each envelope with the publishing
 * pod's id and ignoring self-published envelopes on receipt.
 *
 * The port is intentionally tiny — `publish` + `subscribe` over opaque
 * string messages. It is injected (optional) via the service options:
 *   * no port injected (the default, e.g. when `REDIS_URL` is unset)
 *     → behaviour is EXACTLY the legacy single-pod path, no regression;
 *   * a port injected → cross-pod fan-out turns on.
 *
 * Two implementations live here:
 *   * `InMemoryNotificationPubSub` — a process-local bus. Used by tests
 *     to wire two service instances together, and usable as a stand-in
 *     in single-process integration suites.
 *   * `createRedisPubSub(redisUrl)` — adapts the already-present
 *     `ioredis` dependency. ioredis puts a connection into "subscriber
 *     mode" once `subscribe` is called (it can then no longer issue
 *     normal commands), so the factory keeps a DEDICATED subscriber
 *     connection separate from the publisher connection.
 */

import { Redis } from 'ioredis';
import { createLogger } from '../logger.js';

const logger = createLogger('notification-pubsub');

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * Minimal publish/subscribe contract. Messages are opaque strings (the
 * in-app service serialises a `NotificationEnvelope` to JSON). Both
 * methods are async so the Redis adapter can await its network round
 * trips; the in-memory adapter resolves immediately but keeps the same
 * shape so callers never branch on adapter identity.
 */
export interface NotificationPubSub {
  /** Publish `message` to `channel`. Fan-out is best-effort. */
  publish(channel: string, message: string): Promise<void>;
  /**
   * Register `handler` for every message delivered on `channel`. May be
   * called once per channel per process. The handler MUST NOT throw —
   * the adapter logs and swallows handler errors so one bad message
   * cannot tear down the subscriber connection.
   */
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * The wire shape published to the per-tenant channel. `originPodId` is
 * the id of the pod that created the notification; receiving pods drop
 * envelopes whose `originPodId` matches their own id, because the origin
 * pod already pushed to its local clients synchronously on `create`.
 */
export interface NotificationEnvelope<TPayload> {
  readonly originPodId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly notification: TPayload;
}

/** Channel name for a tenant's in-app fan-out. */
export function inAppChannel(tenantId: string): string {
  return `borjie:inapp:${tenantId}`;
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests + single-process integration)
// ---------------------------------------------------------------------------

/**
 * Process-local pub/sub bus. A single instance shared between multiple
 * service instances emulates the cross-pod wire: a publish from one
 * instance is delivered to handlers registered by the others (and by
 * itself — the origin-pod guard lives in the consuming service, not
 * here, mirroring how a real broker echoes the publisher's own message).
 */
export class InMemoryNotificationPubSub implements NotificationPubSub {
  private readonly handlers = new Map<string, Array<(message: string) => void>>();

  async publish(channel: string, message: string): Promise<void> {
    const list = this.handlers.get(channel);
    if (!list || list.length === 0) return;
    // Snapshot so a handler that (un)subscribes mid-dispatch cannot
    // mutate the list we are iterating.
    for (const handler of [...list]) {
      try {
        handler(message);
      } catch (error) {
        logger.warn('in-memory pubsub handler threw', { channel, error: String(error) });
      }
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    const list = this.handlers.get(channel);
    if (list) {
      this.handlers.set(channel, [...list, handler]);
      return;
    }
    this.handlers.set(channel, [handler]);
  }
}

// ---------------------------------------------------------------------------
// Redis implementation (production wiring point)
// ---------------------------------------------------------------------------

/**
 * Adapts `ioredis` to the `NotificationPubSub` port.
 *
 * ioredis flips a connection into subscriber mode on the first
 * `subscribe`, after which it rejects ordinary commands. We therefore
 * keep two connections: `pub` for `PUBLISH`, and `sub` (a clone) bound
 * exclusively to channel subscriptions. A single `message` listener
 * routes by channel to the per-channel handler list.
 */
export class RedisNotificationPubSub implements NotificationPubSub {
  private readonly channelHandlers = new Map<string, Array<(message: string) => void>>();
  private messageListenerBound = false;

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis
  ) {}

  private ensureMessageListener(): void {
    if (this.messageListenerBound) return;
    this.messageListenerBound = true;
    this.sub.on('message', (channel: string, message: string) => {
      const list = this.channelHandlers.get(channel);
      if (!list) return;
      for (const handler of [...list]) {
        try {
          handler(message);
        } catch (error) {
          logger.warn('redis pubsub handler threw', { channel, error: String(error) });
        }
      }
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.pub.publish(channel, message);
    } catch (error) {
      // Fan-out is best-effort: the durable store already holds the row,
      // so a publish failure degrades to "not real-time on other pods"
      // rather than data loss. Surface it for ops without throwing.
      logger.error('failed to publish notification envelope', {
        channel,
        error: String(error),
      });
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    this.ensureMessageListener();
    const existing = this.channelHandlers.get(channel);
    if (existing) {
      this.channelHandlers.set(channel, [...existing, handler]);
      return;
    }
    this.channelHandlers.set(channel, [handler]);
    await this.sub.subscribe(channel);
  }
}

/**
 * Build a Redis-backed `NotificationPubSub` from a connection URL.
 *
 * Returns a disposable so the composition root can close both
 * connections on shutdown. The subscriber is a `duplicate()` of the
 * publisher so it inherits the same connection options without sharing
 * the (now subscriber-locked) socket.
 */
export interface DisposableNotificationPubSub {
  readonly pubsub: NotificationPubSub;
  close(): Promise<void>;
}

export function createRedisPubSub(redisUrl: string): DisposableNotificationPubSub {
  const pub = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  const sub = pub.duplicate();
  pub.on('error', (err: unknown) => {
    logger.error('pubsub publisher connection error', { error: String(err) });
  });
  sub.on('error', (err: unknown) => {
    logger.error('pubsub subscriber connection error', { error: String(err) });
  });
  return {
    pubsub: new RedisNotificationPubSub(pub, sub),
    async close(): Promise<void> {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}

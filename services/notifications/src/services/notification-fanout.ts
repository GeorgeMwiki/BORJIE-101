/**
 * Cross-pod fan-out coordinator for the in-app notification service.
 *
 * Extracted from `in-app-notification.service.ts` to keep that file
 * under the 800-line ceiling and to isolate the pub/sub wiring behind a
 * single, separately-testable seam. The coordinator owns:
 *   * publishing a created-notification envelope to a tenant's channel;
 *   * subscribing THIS pod (lazily, once per tenant) to that channel;
 *   * routing received envelopes back to the pod's local WS clients,
 *     while dropping envelopes the pod itself published (origin guard).
 *
 * It is deliberately ignorant of storage and of the service's public
 * API — it is handed the two collaborators it needs (`pushLocal` and a
 * `logger`) plus the optional `pubsub` port and the stable `podId`.
 * When `pubsub` is `undefined` every method is a no-op, which is what
 * preserves the legacy single-pod behaviour when `REDIS_URL` is unset.
 */

import type { Logger } from '../logger.js';
import type {
  NotificationPubSub,
  NotificationEnvelope,
} from './notification-pubsub.js';
import { inAppChannel } from './notification-pubsub.js';

export interface FanoutCoordinatorDeps<TPayload> {
  /** Optional transport. Absent → every method below is a no-op. */
  readonly pubsub: NotificationPubSub | undefined;
  /** Stable per-instance pod id used to suppress origin re-delivery. */
  readonly podId: string;
  readonly logger: Logger;
  /**
   * Push a payload to WS clients owned by THIS pod. Called for envelopes
   * that arrived from OTHER pods (the origin pod pushes synchronously on
   * create, so its own echoed envelope is skipped).
   */
  readonly pushLocal: (
    tenantId: string,
    userId: string,
    notification: TPayload
  ) => void;
}

export interface FanoutCoordinator<TPayload> {
  /** Publish a created-notification envelope to the tenant's channel. */
  publishEnvelope(
    tenantId: string,
    userId: string,
    notification: TPayload
  ): Promise<void>;
  /** Subscribe this pod to a tenant's channel exactly once (deduped). */
  ensureSubscribed(tenantId: string): Promise<void>;
  /** Readiness flag + boot log. No-op without a port. Idempotent. */
  start(): Promise<void>;
}

export function createFanoutCoordinator<TPayload>(
  deps: FanoutCoordinatorDeps<TPayload>
): FanoutCoordinator<TPayload> {
  const { pubsub, podId, logger, pushLocal } = deps;
  // Per-tenant channels this pod has already subscribed to. A pod only
  // needs envelopes for tenants whose WS clients it hosts (or for which
  // it just created a row), so we subscribe lazily and exactly once per
  // tenant. In-flight subscribe promises are cached to dedupe races.
  const channelSubscriptions = new Map<string, Promise<void>>();
  let started = false;

  function onEnvelope(raw: string): void {
    let envelope: NotificationEnvelope<TPayload>;
    try {
      envelope = JSON.parse(raw) as NotificationEnvelope<TPayload>;
    } catch (error) {
      logger.warn('Dropped malformed cross-pod envelope', { error: String(error) });
      return;
    }
    if (envelope.originPodId === podId) return; // self — already pushed locally
    pushLocal(envelope.tenantId, envelope.userId, envelope.notification);
  }

  async function publishEnvelope(
    tenantId: string,
    userId: string,
    notification: TPayload
  ): Promise<void> {
    if (!pubsub) return;
    const envelope: NotificationEnvelope<TPayload> = {
      originPodId: podId,
      tenantId,
      userId,
      notification,
    };
    try {
      await pubsub.publish(inAppChannel(tenantId), JSON.stringify(envelope));
    } catch (error) {
      logger.warn('Failed to publish cross-pod notification envelope', {
        tenantId,
        error: String(error),
      });
    }
  }

  async function ensureSubscribed(tenantId: string): Promise<void> {
    if (!pubsub) return;
    const channel = inAppChannel(tenantId);
    const inflight = channelSubscriptions.get(channel);
    if (inflight) return inflight;
    const promise = pubsub.subscribe(channel, onEnvelope).catch((error: unknown) => {
      channelSubscriptions.delete(channel);
      logger.warn('Failed to subscribe to tenant fan-out channel', {
        tenantId,
        error: String(error),
      });
    });
    channelSubscriptions.set(channel, promise);
    return promise;
  }

  async function start(): Promise<void> {
    if (!pubsub || started) return;
    started = true;
    logger.info('Cross-pod notification fan-out enabled', { podId });
  }

  return { publishEnvelope, ensureSubscribed, start };
}

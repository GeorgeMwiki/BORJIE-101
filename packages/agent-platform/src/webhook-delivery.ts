/**
 * Signed outbound webhook delivery.
 *
 * Coordinates with the Wave-10 webhook retry/DLQ in `services/webhooks`.
 * This package owns the wire format (HMAC signing, retry schedule) but
 * delegates persistence (pending deliveries, DLQ fanout) via the
 * `WebhookStore` port.
 *
 * Wire format:
 *   POST <subscription.url>
 *   Content-Type: application/json
 *   X-Webhook-Id: <uuid>
 *   X-Webhook-Signature: sha256=<hex hmac of body>
 *   X-Webhook-Timestamp: <ISO>
 *   X-Correlation-Id: <id>
 *   User-Agent: BORJIE-Webhook/1.0
 */

import { assertUrlSafe } from '@borjie/enterprise-hardening';
import { hmacSha256Hex } from './agent-auth.js';
import { correlationHeaders } from './correlation-id.js';
import type { WebhookDelivery, WebhookSubscription } from './types.js';

// ============================================================================
// Fetch port (injected for testability)
// ============================================================================

export type FetchLike = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly status: number; readonly ok: boolean }>;

// ============================================================================
// Store port
// ============================================================================

export interface WebhookStore {
  recordPending(delivery: WebhookDelivery): Promise<void>;
  updateDelivery(
    id: string,
    patch: Partial<WebhookDelivery>,
  ): Promise<void>;
  incrementSubscriptionFailure(
    subscriptionId: string,
    newCount: number,
    pause: boolean,
  ): Promise<void>;
  markSubscriptionDelivered(
    subscriptionId: string,
    iso: string,
  ): Promise<void>;
}

// ============================================================================
// Delivery
// ============================================================================

export interface DeliverEventPayload {
  readonly eventType: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface DeliverDeps {
  readonly fetch: FetchLike;
  readonly store: WebhookStore;
  readonly now?: () => number;
  readonly retryDelaysMs?: ReadonlyArray<number>;
  readonly maxConsecutiveFailures?: number;
  readonly timeoutMs?: number;
  /**
   * Injectable DNS lookup used by `assertUrlSafe` — tests inject a stub
   * to verify EC2-metadata / RFC1918 hostnames are rejected. Defaults to
   * `node:dns/promises#lookup` (i.e. real resolution).
   */
  readonly dnsLookup?: (
    host: string,
  ) => Promise<ReadonlyArray<{ readonly address: string; readonly family: number }>>;
}

const DEFAULT_RETRY_DELAYS_MS: ReadonlyArray<number> = Object.freeze([
  1_000,
  5_000,
  25_000,
]);
const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function deliverToSubscription(
  deps: DeliverDeps,
  subscription: WebhookSubscription,
  event: DeliverEventPayload,
): Promise<WebhookDelivery> {
  // SSRF pre-flight — centralised in @borjie/enterprise-hardening so
  // any policy change (e.g. new internal range, new scheme block) lands
  // in one place. Includes the DNS-resolved-IP gate added in A2b-3, so a
  // subscription URL whose A-record points to 169.254.169.254 or
  // 127.0.0.1 is rejected before the fetch fires.
  await assertUrlSafe(subscription.url, {
    ...(deps.dnsLookup ? { dnsLookup: deps.dnsLookup } : {}),
  });
  const now = (deps.now ?? Date.now)();
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxFailures = deps.maxConsecutiveFailures ?? DEFAULT_MAX_FAILURES;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const deliveryId = crypto.randomUUID();
  const timestamp = new Date(now).toISOString();

  const bodyObj = {
    id: deliveryId,
    eventType: event.eventType,
    eventId: event.eventId,
    timestamp,
    correlationId: event.correlationId,
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    data: event.data,
  };
  const body = JSON.stringify(bodyObj);
  // HIGH-10 (audit .audit/post-pr90-api-mcp-bug-sweep.md): the previous
  // signature was `hmac(secret, body)` only — `X-Webhook-Timestamp` was
  // emitted alongside but NOT in the signed payload. A subscriber that
  // doesn't separately enforce a max-age on `X-Webhook-Timestamp` would
  // accept any captured signed body indefinitely. Sign
  // `${timestamp}.${body}` so the timestamp is bound to the signature;
  // subscribers MUST still verify both signature + timestamp freshness.
  const signedPayload = `${timestamp}.${body}`;
  const signature = await hmacSha256Hex(subscription.secretHash, signedPayload);

  const baseHeaders: Record<string, string> = {
    ...correlationHeaders(event.correlationId),
    'Content-Type': 'application/json',
    'X-Webhook-Id': deliveryId,
    // v2 signature format: timestamp + body, separated by `.`.
    // Document this for subscribers in OPENAPI / webhook docs.
    'X-Webhook-Signature': `sha256=${signature}`,
    'X-Webhook-Signature-Version': 'v2',
    'X-Webhook-Timestamp': timestamp,
    'User-Agent': 'BORJIE-Webhook/1.0',
  };

  const initial: WebhookDelivery = Object.freeze({
    id: deliveryId,
    subscriptionId: subscription.id,
    eventType: event.eventType,
    eventId: event.eventId,
    payload: Object.freeze({ ...bodyObj }),
    status: 'pending' as const,
    attempts: 0,
    createdAt: timestamp,
  });
  await deps.store.recordPending(initial);

  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelays[attempt - 1]));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await deps.fetch(subscription.url, {
        method: 'POST',
        headers: baseHeaders,
        body,
        signal: controller.signal,
      });
      lastStatus = res.status;

      if (res.ok) {
        await deps.store.updateDelivery(deliveryId, {
          status: 'delivered',
          attempts: attempt + 1,
          lastAttemptAt: new Date(Date.now()).toISOString(),
          responseStatus: res.status,
        });
        await deps.store.markSubscriptionDelivered(
          subscription.id,
          new Date(Date.now()).toISOString(),
        );
        return {
          ...initial,
          status: 'delivered',
          attempts: attempt + 1,
          lastAttemptAt: new Date(Date.now()).toISOString(),
          responseStatus: res.status,
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    const nextStatus = attempt < retryDelays.length ? 'retrying' : 'failed';
    const patch: Record<string, unknown> = {
      status: nextStatus,
      attempts: attempt + 1,
      lastAttemptAt: new Date(Date.now()).toISOString(),
    };
    if (lastStatus !== undefined) patch.responseStatus = lastStatus;
    if (lastError !== undefined) patch.errorMessage = lastError;
    await deps.store.updateDelivery(
      deliveryId,
      patch as Partial<WebhookDelivery>,
    );
  }

  const newFailureCount = subscription.failureCount + 1;
  const shouldPause = newFailureCount >= maxFailures;
  await deps.store.incrementSubscriptionFailure(
    subscription.id,
    newFailureCount,
    shouldPause,
  );

  const failed: WebhookDelivery = Object.freeze({
    ...initial,
    status: 'failed' as const,
    attempts: retryDelays.length + 1,
    lastAttemptAt: new Date(Date.now()).toISOString(),
    ...(lastStatus !== undefined ? { responseStatus: lastStatus } : {}),
    ...(lastError !== undefined ? { errorMessage: lastError } : {}),
  });
  return failed;
}

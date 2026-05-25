/**
 * Outbound webhook retry worker.
 *
 * Responsibility: consume `WebhookDeliveryQueued` events, POST to the
 * tenant's webhook URL with an HMAC signature, retry on 5xx / network
 * errors with exponential backoff, then move permanently failed deliveries
 * to the `webhook_dead_letters` table.
 *
 * Attempt schedule (5 total): 1s, 3s, 9s, 27s, 81s — 3^n seconds for
 * n = 0..4. Jitter is intentionally OFF so tests are deterministic; the
 * scheduler that dispatches attempts may add jitter if desired.
 *
 * Lifecycle: created as a plain module (no global state) so multiple
 * instances can be spun up in tests. Runtime wiring lives in
 * `services/api-gateway/src/index.ts`.
 *
 * Dependencies are injected via `WebhookRetryWorkerDeps` so the worker is
 * reusable against either the real Drizzle DB or an in-memory test double.
 */

import { createHmac } from 'node:crypto';
import type pino from 'pino';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const MAX_ATTEMPTS = 5 as const;

/** Backoff delays in seconds — 3^n for n = 0..4. */
export const BACKOFF_SECONDS: readonly number[] = [1, 3, 9, 27, 81];

export interface WebhookDeliveryQueued {
  /** Stable ID identifying this delivery across attempts. */
  deliveryId: string;
  tenantId: string;
  targetUrl: string;
  eventType: string;
  /** JSON-serialisable event payload. Hashed + signed before transmission. */
  payload: Record<string, unknown>;
  /** Per-tenant HMAC secret. Falls back to `WEBHOOK_DEFAULT_HMAC_SECRET`. */
  hmacSecret?: string;
}

export interface WebhookAttemptRecord {
  id: string;
  deliveryId: string;
  tenantId: string;
  targetUrl: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptNumber: number;
  status: 'pending' | 'succeeded' | 'failed' | 'abandoned';
  statusCode?: number;
  errorMessage?: string;
  scheduledFor: Date;
  attemptedAt?: Date;
}

export interface WebhookDeadLetterRecord {
  id: string;
  deliveryId: string;
  tenantId: string;
  targetUrl: string;
  eventType: string;
  payload: Record<string, unknown>;
  totalAttempts: number;
  lastStatusCode?: number;
  lastError?: string;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
}

/** Repository abstraction — a real Drizzle impl or a test double both satisfy this. */
export interface WebhookDeliveryRepository {
  recordAttempt(record: WebhookAttemptRecord): Promise<void>;
  moveToDeadLetters(record: WebhookDeadLetterRecord): Promise<void>;
  listDeadLetters(filter: {
    tenantId?: string;
    limit?: number;
    offset?: number;
  }): Promise<WebhookDeadLetterRecord[]>;
  /**
   * Fetches a dead-letter by primary key, scoped to the given tenant so the
   * call cannot leak rows across tenants even if the caller forgets the
   * post-fetch ownership check. Returns null when the row doesn't exist OR
   * when it belongs to a different tenant — both cases look like 404 from
   * the caller's perspective. `tenantId` is optional only for legacy
   * super-admin cross-tenant tooling; prefer passing it always.
   */
  getDeadLetter(
    id: string,
    tenantId?: string
  ): Promise<WebhookDeadLetterRecord | null>;
  /**
   * Marks a dead-letter as replayed. Tenant-scoped — the UPDATE only
   * matches a row whose `tenant_id` equals the supplied value, so a
   * compromised/forged id can never flip a row for a different tenant.
   */
  markDeadLetterReplayed(
    id: string,
    replayedBy: string,
    replayDeliveryId: string,
    tenantId?: string
  ): Promise<void>;
}

export interface WebhookRetryWorkerDeps {
  repository: WebhookDeliveryRepository;
  fetchFn?: typeof fetch;
  logger: pino.Logger;
  /** Millisecond clock — swap for tests. Default `Date.now`. */
  now?: () => number;
  /** Seconds-from-now the scheduler should use. Default `BACKOFF_SECONDS`. */
  backoffSecondsForAttempt?: (attemptNumber: number) => number;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Compute the HMAC-SHA256 signature of `timestamp + "." + body`.
 *
 * The double-field approach prevents replay: a valid signature ties the
 * payload to the exact moment it was sent. Receivers should reject
 * timestamps that drift more than a few minutes from the current clock.
 *
 * Header layout (for receivers):
 *   X-Borjie-Signature: t=<unix_seconds>,v1=<hex>
 */
export function computeWebhookSignature(
  body: string,
  timestamp: number,
  secret: string
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function buildSignatureHeader(signature: string, timestamp: number): string {
  return `t=${timestamp},v1=${signature}`;
}

// ---------------------------------------------------------------------------
// Attempt logic (pure — easy to unit test)
// ---------------------------------------------------------------------------

/**
 * Decide the outcome of a single attempt from the HTTP response / thrown
 * error. 2xx = success, 5xx / network = retryable, 4xx = give-up-now (the
 * payload is malformed, retrying will not help).
 */
export interface AttemptOutcome {
  kind: 'success' | 'retryable' | 'permanent';
  statusCode?: number;
  errorMessage?: string;
}

export function classifyHttpResult(args: {
  statusCode?: number;
  error?: unknown;
}): AttemptOutcome {
  if (args.error) {
    return {
      kind: 'retryable',
      errorMessage:
        args.error instanceof Error ? args.error.message : String(args.error),
    };
  }
  const s = args.statusCode ?? 0;
  if (s >= 200 && s < 300) return { kind: 'success', statusCode: s };
  if (s >= 500) return { kind: 'retryable', statusCode: s };
  // 4xx — treat as permanent; retrying the same body will keep failing.
  return {
    kind: 'permanent',
    statusCode: s,
    errorMessage: `non-retryable status ${s}`,
  };
}

/** Seconds from BACKOFF_SECONDS for a 1-indexed attempt number. */
export function backoffSecondsForAttempt(attemptNumber: number): number {
  const idx = Math.max(0, Math.min(BACKOFF_SECONDS.length - 1, attemptNumber - 1));
  return BACKOFF_SECONDS[idx];
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface WebhookRetryWorker {
  /**
   * Process a single `WebhookDeliveryQueued` event end-to-end: walk the full
   * retry ladder if necessary, write an attempt record after every HTTP
   * call, and push to the DLQ on final failure.
   *
   * Returns the final outcome so the caller can instrument dashboards.
   */
  processDelivery(event: WebhookDeliveryQueued): Promise<{
    status: 'delivered' | 'dead_lettered';
    attempts: number;
    lastStatusCode?: number;
  }>;
}

export function createWebhookRetryWorker(
  deps: WebhookRetryWorkerDeps
): WebhookRetryWorker {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('webhook-retry-worker: fetch is not available in this runtime');
  }
  const now = deps.now ?? Date.now;
  const backoff = deps.backoffSecondsForAttempt ?? backoffSecondsForAttempt;

  async function attempt(
    event: WebhookDeliveryQueued,
    attemptNumber: number
  ): Promise<AttemptOutcome> {
    const secret =
      event.hmacSecret ??
      process.env.WEBHOOK_DEFAULT_HMAC_SECRET ??
      '';
    if (!secret) {
      // Defensive — surface as permanent so the DLQ still captures it.
      return {
        kind: 'permanent',
        errorMessage: 'no HMAC secret configured',
      };
    }
    const body = JSON.stringify(event.payload);
    const ts = Math.floor(now() / 1000);
    const signature = computeWebhookSignature(body, ts, secret);

    let response: Response | undefined;
    let thrown: unknown;
    try {
      response = await fetchFn(event.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Borjie-Event': event.eventType,
          'X-Borjie-Delivery': event.deliveryId,
          'X-Borjie-Signature': buildSignatureHeader(signature, ts),
        },
        body,
      });
    } catch (err) {
      thrown = err;
    }

    const outcome = classifyHttpResult({
      statusCode: response?.status,
      error: thrown,
    });

    // Persist attempt record — don't let a recording failure crash the loop;
    // the worker logs + continues.
    try {
      await deps.repository.recordAttempt({
        id: `${event.deliveryId}-${attemptNumber}`,
        deliveryId: event.deliveryId,
        tenantId: event.tenantId,
        targetUrl: event.targetUrl,
        eventType: event.eventType,
        payload: event.payload,
        attemptNumber,
        status:
          outcome.kind === 'success'
            ? 'succeeded'
            : outcome.kind === 'permanent'
              ? 'failed'
              : 'failed',
        statusCode: outcome.statusCode,
        errorMessage: outcome.errorMessage,
        scheduledFor: new Date(now()),
        attemptedAt: new Date(now()),
      });
    } catch (err) {
      deps.logger.error(
        { err: err instanceof Error ? err.message : String(err), deliveryId: event.deliveryId },
        'webhook-retry: failed to record attempt'
      );
    }

    return outcome;
  }

  async function processDelivery(
    event: WebhookDeliveryQueued
  ): Promise<{ status: 'delivered' | 'dead_lettered'; attempts: number; lastStatusCode?: number }> {
    if (!event.targetUrl || !/^https?:\/\//.test(event.targetUrl)) {
      throw new Error(
        `webhook-retry: invalid targetUrl "${event.targetUrl}" for delivery ${event.deliveryId}`
      );
    }

    const firstAttemptAt = new Date(now());
    let lastOutcome: AttemptOutcome | undefined;

    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      lastOutcome = await attempt(event, n);
      if (lastOutcome.kind === 'success') {
        deps.logger.info(
          { deliveryId: event.deliveryId, attempt: n },
          'webhook-retry: delivered'
        );
        return {
          status: 'delivered',
          attempts: n,
          lastStatusCode: lastOutcome.statusCode,
        };
      }
      if (lastOutcome.kind === 'permanent') {
        break; // don't retry 4xx
      }
      if (n < MAX_ATTEMPTS) {
        const waitS = backoff(n);
        deps.logger.warn(
          {
            deliveryId: event.deliveryId,
            attempt: n,
            waitSeconds: waitS,
            status: lastOutcome.statusCode,
            err: lastOutcome.errorMessage,
          },
          'webhook-retry: retrying'
        );
        await sleep(waitS * 1000);
      }
    }

    // Ran out of attempts — push to DLQ.
    await deps.repository.moveToDeadLetters({
      id: `${event.deliveryId}-dlq`,
      deliveryId: event.deliveryId,
      tenantId: event.tenantId,
      targetUrl: event.targetUrl,
      eventType: event.eventType,
      payload: event.payload,
      totalAttempts: MAX_ATTEMPTS,
      lastStatusCode: lastOutcome?.statusCode,
      lastError: lastOutcome?.errorMessage,
      firstAttemptAt,
      lastAttemptAt: new Date(now()),
    });
    deps.logger.error(
      {
        deliveryId: event.deliveryId,
        lastStatusCode: lastOutcome?.statusCode,
        err: lastOutcome?.errorMessage,
      },
      'webhook-retry: dead-lettered'
    );
    return {
      status: 'dead_lettered',
      attempts: MAX_ATTEMPTS,
      lastStatusCode: lastOutcome?.statusCode,
    };
  }

  return { processDelivery };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported for tests (non-public).
export const __internal = {
  sleep,
};

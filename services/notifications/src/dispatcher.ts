/**
 * Notification Dispatcher — SCAFFOLDED 8 + NEW 21
 *
 * The single entry point every caller (event-subscribers, workers, API
 * routes) should go through to actually deliver a notification. Concerns
 * centralized here:
 *
 *   1. Preference re-check at dispatch time (not just at enqueue time —
 *      the user may have toggled opt-out between enqueue and send).
 *   2. Provider selection via the `providerRegistry`.
 *   3. 3-attempt retry with exponential backoff.
 *   4. Dead-letter queue handoff on terminal failure.
 *   5. Emit `NotificationDeliveryFailed` event for downstream alerting.
 *
 * This module is additive — existing `queue/producer.ts` and
 * `services/notification.service.ts` are untouched. New callers should
 * prefer `enqueueNotification` from here; legacy callers keep working.
 */

import { preferencesService } from './preferences/service.js';
import { providerRegistry } from './providers/index.js';
import type {
  NotificationChannel,
  NotificationTemplateId,
  SendResult,
  TenantId,
} from './types/index.js';
import type { INotificationProvider, SendParams } from './providers/provider.interface.js';
import { createLogger } from './logger.js';

const logger = createLogger('notification-dispatcher');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPriority = 'emergency' | 'high' | 'normal' | 'low';

export interface EnqueueNotificationInput {
  tenantId: TenantId;
  userId?: string;
  channel: NotificationChannel;
  templateId: NotificationTemplateId;
  /** Pre-rendered recipient address (phone, email, push token, WhatsApp number). */
  recipient: string;
  subject?: string;
  body: string;
  title?: string;
  data?: Record<string, string>;
  priority?: NotificationPriority;
  correlationId?: string;
  idempotencyKey?: string;
  /** Override max retries (default 3). */
  maxAttempts?: number;
  /** Override backoff base in ms (default 1000). */
  backoffBaseMs?: number;
}

export interface DispatchResult {
  accepted: boolean;
  /** Present when `accepted === true`. */
  externalId?: string;
  /** Present when suppressed by preferences — never a retryable failure. */
  suppressedReason?: 'channel_disabled' | 'template_disabled' | 'quiet_hours';
  /** Present when ALL retries have been exhausted and the send was dead-lettered. */
  deadLettered?: boolean;
  attempts: number;
  lastError?: string;
}

export interface DeadLetterRecord extends EnqueueNotificationInput {
  attempts: number;
  lastError: string;
  deadLetteredAt: Date;
}

export interface DispatcherDeps {
  /** Optional: override the provider registry (for tests). */
  providers?: Record<NotificationChannel, INotificationProvider[]>;
  /** Optional: override the preference gate (for tests). */
  preferences?: typeof preferencesService;
  /** Optional: bus for emitting `NotificationDeliveryFailed`. */
  eventBus?: {
    publish(
      eventType: string,
      payload: Record<string, unknown>,
      metadata?: Record<string, unknown>
    ): Promise<void> | void;
  };
  /** Optional: dead-letter sink. Default is in-memory. */
  deadLetterSink?: {
    push(record: DeadLetterRecord): Promise<void> | void;
  };
  /** Optional: sleep hook (for deterministic tests). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Round-3 audit H5 — idempotency store. When `input.idempotencyKey`
   * is set, the dispatcher consults this store before dispatching and
   * records the result on completion. Pass `null` to disable.
   */
  idempotencyStore?: DispatchIdempotencyStore | null;
}

// ---------------------------------------------------------------------------
// In-memory DLQ default
// ---------------------------------------------------------------------------

const inMemoryDeadLetterQueue: DeadLetterRecord[] = [];

export const deadLetterQueueInspector = {
  all(): readonly DeadLetterRecord[] {
    return inMemoryDeadLetterQueue.slice();
  },
  clear(): void {
    inMemoryDeadLetterQueue.length = 0;
  },
};

const defaultDeadLetterSink: Required<DispatcherDeps>['deadLetterSink'] = {
  push(record) {
    inMemoryDeadLetterQueue.push(record);
  },
};

// Round-3 audit H5 fix — idempotency-key store. Default is in-memory
// (single-pod). Multi-pod deployments must inject a Redis-backed store
// to avoid duplicate dispatch when retries land on different pods.
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface DispatchIdempotencyStore {
  /** Records `key`. Returns the prior result if seen, else null. */
  recordOrLoad(
    key: string,
    result: DispatchResult,
    ttlMs?: number,
  ): Promise<DispatchResult | null> | DispatchResult | null;
}

function createInMemoryIdempotencyStore(): DispatchIdempotencyStore {
  const seen = new Map<string, { result: DispatchResult; expiresAt: number }>();
  function evict(now: number): void {
    for (const [k, v] of seen) {
      if (v.expiresAt <= now) seen.delete(k);
    }
  }
  return {
    recordOrLoad(key, result, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS) {
      const now = Date.now();
      evict(now);
      const existing = seen.get(key);
      if (existing && existing.expiresAt > now) return existing.result;
      seen.set(key, { result, expiresAt: now + ttlMs });
      return null;
    },
  };
}

const defaultIdempotencyStore = createInMemoryIdempotencyStore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Round-3 audit H2 fix — refuse to fall back to `providers[0]` when no
 * provider matches the tenant. The previous behaviour silently routed
 * tenant-B's SMS through tenant-A's Twilio account → tenant-A billed
 * for tenant-B's traffic, and the cross-tenant credential leak.
 *
 * Returns `null` if no provider is configured for the tenant — the
 * caller dead-letters with a typed `NO_TENANT_PROVIDER` reason.
 */
function selectProvider(
  providers: INotificationProvider[] | undefined,
  tenantId: TenantId
): INotificationProvider | null {
  if (!providers || providers.length === 0) return null;
  return providers.find((p) => p.isConfigured(tenantId)) ?? null;
}

/**
 * Round-3 audit H4 fix — exponential backoff WITH ±25% jitter so a
 * provider outage doesn't produce a thundering herd of retries at
 * fixed intervals.
 */
function computeBackoffMs(attempt: number, base: number): number {
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = exp * 0.25 * (Math.random() * 2 - 1); // ±25%
  return Math.max(0, Math.round(exp + jitter));
}

/**
 * Round-3 audit H3 fix — classify provider errors so we don't retry
 * non-retryable ones (e.g. Twilio's "InvalidPhoneNumber" 400). Errors
 * that carry a `code`/`status` matching the non-retryable list are
 * not retried; everything else falls through to the existing retry
 * loop.
 */
const NON_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  // Twilio
  '21211', // Invalid 'To' Phone Number
  '21212', // Invalid 'From' Phone Number
  '21214', // 'To' phone number cannot be reached
  '21610', // Recipient unsubscribed
  '21617', // Concatenated message body exceeds the 1600 character limit
  // Africa's Talking
  'InvalidPhoneNumber',
  'InvalidRecipient',
  // Generic
  'INVALID_RECIPIENT',
  'OPTED_OUT',
  'BLOCKED',
]);

function isNonRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof e.code === 'string' && NON_RETRYABLE_ERROR_CODES.has(e.code)) return true;
  if (typeof e.code === 'number' && NON_RETRYABLE_ERROR_CODES.has(String(e.code))) return true;
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
    return true;
  }
  if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 408 && e.statusCode !== 429) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function enqueueNotification(
  input: EnqueueNotificationInput,
  deps: DispatcherDeps = {}
): Promise<DispatchResult> {
  const providers = deps.providers ?? providerRegistry;
  const prefs = deps.preferences ?? preferencesService;
  const sleep = deps.sleep ?? defaultSleep;
  const deadLetterSink = deps.deadLetterSink ?? defaultDeadLetterSink;
  const idempotencyStore =
    deps.idempotencyStore === undefined
      ? defaultIdempotencyStore
      : deps.idempotencyStore;
  const maxAttempts = input.maxAttempts ?? 3;
  const backoffBaseMs = input.backoffBaseMs ?? 1000;

  // ---- 0. Idempotency check (H5) ----
  // Round-3 audit H5 fix — the dispatcher accepted `idempotencyKey`
  // in its input schema but NEVER consulted it. We now scope the key
  // by tenant so two tenants supplying the same key don't collide.
  const idempotencyScopedKey = input.idempotencyKey
    ? `${input.tenantId}:${input.channel}:${input.idempotencyKey}`
    : null;
  if (idempotencyScopedKey && idempotencyStore) {
    const placeholder: DispatchResult = {
      accepted: false,
      attempts: 0,
      lastError: '__inflight__',
    };
    const prior = await Promise.resolve(
      idempotencyStore.recordOrLoad(idempotencyScopedKey, placeholder)
    );
    if (prior && prior.lastError !== '__inflight__') {
      return prior;
    }
  }

  // ---- 1. Preference re-check ----
  // Round-3 audit H1 — anonymous notifications (no userId) bypass
  // the preference check. For tenant-wide system announcements that
  // is intentional; for per-user notifications the caller MUST pass
  // `userId` or the user's opt-outs will be ignored. This is now
  // surfaced via a warning so misuse is observable in logs.
  if (!input.userId && input.templateId && !input.idempotencyKey?.startsWith('announcement:')) {
    logger.warn(`[dispatcher] enqueueNotification called without userId for templateId=${String(input.templateId)} — ` +
        `preference checks SKIPPED. If this is a per-user notification, ALWAYS pass userId.`);
  }
  if (input.userId) {
    // Round-3 audit H6 — `checkAllowed` is now async because the
    // backing preferences store may be Redis. Await the gate before
    // any provider dispatch.
    const gate = await prefs.checkAllowed({
      userId: input.userId,
      tenantId: input.tenantId,
      channel: input.channel,
      templateId: input.templateId,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    if (!gate.allowed) {
      const result: DispatchResult = {
        accepted: false,
        attempts: 0,
        ...(gate.reason !== undefined ? { suppressedReason: gate.reason } : {}),
      };
      if (idempotencyScopedKey && idempotencyStore) {
        await Promise.resolve(
          idempotencyStore.recordOrLoad(idempotencyScopedKey, result)
        );
      }
      return result;
    }
  }

  // ---- 2. Provider selection ----
  // Round-3 audit H2 fix — never fall back to `providers[0]`. A
  // tenant with no provider configured DLQ'd with an explicit reason
  // instead of silently routing through another tenant's account.
  const provider = selectProvider(providers[input.channel], input.tenantId);
  if (!provider) {
    const reason = `No provider configured for tenant '${input.tenantId}' on channel '${input.channel}'`;
    await handleDeadLetter(input, 1, reason, deadLetterSink, deps.eventBus);
    const result: DispatchResult = {
      accepted: false,
      deadLettered: true,
      attempts: 1,
      lastError: reason,
    };
    if (idempotencyScopedKey && idempotencyStore) {
      await Promise.resolve(
        idempotencyStore.recordOrLoad(idempotencyScopedKey, result)
      );
    }
    return result;
  }

  // ---- 3. Attempt loop with exponential backoff + jitter ----
  const sendParams: SendParams = {
    tenantId: input.tenantId,
    to: input.recipient,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    body: input.body,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
  };

  let lastError = 'unknown error';
  let attempts = 0;
  let nonRetryable = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    try {
      const result: SendResult = await provider.send(sendParams);
      if (result.success) {
        const success: DispatchResult = {
          accepted: true,
          ...(result.externalId !== undefined ? { externalId: result.externalId } : {}),
          attempts,
        };
        if (idempotencyScopedKey && idempotencyStore) {
          await Promise.resolve(
            idempotencyStore.recordOrLoad(idempotencyScopedKey, success)
          );
        }
        return success;
      }
      lastError = result.error ?? 'provider returned success=false';
      // Provider-level non-retryable signal via `result.errorCode`.
      const sr = result as SendResult & { errorCode?: string | number };
      if (sr.errorCode !== undefined && isNonRetryable({ code: sr.errorCode })) {
        nonRetryable = true;
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Round-3 audit H3 fix — bail out on non-retryable errors
      // instead of burning the retry budget.
      if (isNonRetryable(err)) {
        nonRetryable = true;
        break;
      }
    }

    if (attempt < maxAttempts) {
      await sleep(computeBackoffMs(attempt, backoffBaseMs));
    }
  }

  // ---- 4. DLQ + event emission ----
  await handleDeadLetter(
    input,
    attempts,
    nonRetryable ? `non-retryable: ${lastError}` : lastError,
    deadLetterSink,
    deps.eventBus
  );

  const failure: DispatchResult = {
    accepted: false,
    deadLettered: true,
    attempts,
    lastError,
  };
  if (idempotencyScopedKey && idempotencyStore) {
    await Promise.resolve(
      idempotencyStore.recordOrLoad(idempotencyScopedKey, failure)
    );
  }
  return failure;
}

async function handleDeadLetter(
  input: EnqueueNotificationInput,
  attempts: number,
  lastError: string,
  sink: Required<DispatcherDeps>['deadLetterSink'],
  eventBus?: DispatcherDeps['eventBus']
): Promise<void> {
  const record: DeadLetterRecord = {
    ...input,
    attempts,
    lastError,
    deadLetteredAt: new Date(),
  };
  try {
    await sink.push(record);
  } catch (err) {
    // DLQ write failure is a hard infra issue — log via console (intentional
    // fallback-of-last-resort since structured logger isn't injected here).
    logger.error('notifications.dispatcher: DLQ sink failed', { error: err });
  }

  if (eventBus) {
    try {
      await eventBus.publish(
        'NotificationDeliveryFailed',
        {
          tenantId: input.tenantId,
          userId: input.userId,
          channel: input.channel,
          templateId: input.templateId,
          recipient: input.recipient,
          attempts,
          lastError,
        },
        {
          tenantId: input.tenantId,
          correlationId: input.correlationId,
        }
      );
    } catch (err) {
      logger.error('notifications.dispatcher: eventBus.publish failed', { error: err });
    }
  }
}

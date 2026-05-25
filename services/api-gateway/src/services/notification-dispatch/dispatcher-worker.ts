/**
 * Notification dispatch worker.
 *
 * Drains rows from `notification_dispatch_log` where
 * `delivery_status = 'pending'` (and optionally `next_retry_at <= now`),
 * routes them to the matching channel provider (email / sms / whatsapp),
 * and updates each row to `sent` (with `provider_message_id`) on success
 * or `failed` (with retry-friendly fields) on failure.
 *
 * Design notes
 * ------------
 *
 *   - The worker NEVER imports a concrete provider; it depends on
 *     `EmailProvider` / `SmsProvider` ports. This keeps the worker
 *     trivially testable and lets composition swap stubs for real
 *     rails without touching dispatch logic.
 *
 *   - Tenant isolation: every poll-batch query filters on `tenant_id`
 *     when `tenantId` is supplied. Composition wires one worker per
 *     tenant in the multi-tenant runtime; the worker itself does not
 *     enforce platform-wide queries. (For platform-level drains, callers
 *     pass `tenantId: undefined` and the operator is responsible for
 *     understanding the cross-tenant scope.)
 *
 *   - Idempotency: dispatch rows already carry a unique
 *     `(tenant_id, idempotency_key)` index. We claim a row by an
 *     atomic `UPDATE ... WHERE delivery_status='pending' RETURNING id`,
 *     so two workers cannot send the same row twice.
 *
 *   - Templates are referenced by `template_key`. The worker does NOT
 *     render templates — it forwards `templateKey + payload + locale`
 *     to the provider, which is responsible for template resolution.
 *
 *   - Boot-time degraded warning: if either provider reports
 *     `configured = false`, we log ONE structured warning per worker
 *     boot — not per row — so logs do not flood when a provider is
 *     intentionally stubbed (e.g. dev environments).
 */
import { sql } from 'drizzle-orm';
import type { EmailProvider, EmailProviderResult } from './email-provider';
import type { SmsProvider, SmsProviderResult } from './sms-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbExecutor = { execute(q: unknown): Promise<unknown> };

type Logger = {
  warn(meta: Record<string, unknown>, msg: string): void;
  info?(meta: Record<string, unknown>, msg: string): void;
};

export type DispatcherDeps = {
  readonly db: DbExecutor;
  readonly logger: Logger;
  readonly emailProvider: EmailProvider;
  readonly smsProvider: SmsProvider;
  /** Override clock for deterministic tests. */
  readonly now?: () => Date;
};

export type RunOnceInput = {
  readonly tenantId?: string;
  readonly batchSize?: number;
};

export type RunOnceResult = {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped_unknown_channel: number;
};

export type RunForeverInput = {
  readonly tenantId?: string;
  readonly batchSize?: number;
  /** Milliseconds between polls when the last batch was empty. */
  readonly idleSleepMs?: number;
  /** Caller-controlled abort signal. */
  readonly signal: AbortSignal;
};

export type Dispatcher = {
  runOnce(input?: RunOnceInput): Promise<RunOnceResult>;
  runForever(input: RunForeverInput): Promise<void>;
};

type PendingRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly channel: string;
  readonly recipientAddress: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
  readonly attemptCount: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_IDLE_SLEEP_MS = 1_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s; doubles per attempt
const KNOWN_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function rowToPending(raw: Record<string, unknown>): PendingRow | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : null;
  const channel = typeof raw.channel === 'string' ? raw.channel : null;
  const recipientAddress =
    typeof raw.recipient_address === 'string' ? raw.recipient_address : null;
  const templateKey =
    typeof raw.template_key === 'string' ? raw.template_key : null;
  if (!id || !tenantId || !channel || !recipientAddress || !templateKey) {
    return null;
  }
  const locale = typeof raw.locale === 'string' ? raw.locale : 'en';
  const payload =
    raw.payload && typeof raw.payload === 'object'
      ? (raw.payload as Record<string, unknown>)
      : {};
  const idempotencyKey =
    typeof raw.idempotency_key === 'string' ? raw.idempotency_key : null;
  const attemptCountRaw = raw.attempt_count;
  const attemptCount =
    typeof attemptCountRaw === 'number'
      ? attemptCountRaw
      : typeof attemptCountRaw === 'string'
        ? Number.parseInt(attemptCountRaw, 10) || 0
        : 0;

  return {
    id,
    tenantId,
    channel,
    recipientAddress,
    templateKey,
    locale,
    payload,
    idempotencyKey,
    attemptCount,
  };
}

function computeNextRetryAt(now: Date, attempt: number): Date {
  const delayMs = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  return new Date(now.getTime() + delayMs);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function createNotificationDispatcher(deps: DispatcherDeps): Dispatcher {
  const exec = deps.db.execute.bind(deps.db);
  const now = deps.now ?? (() => new Date());
  let bootWarningEmitted = false;

  function emitBootDegradedWarningOnce(): void {
    if (bootWarningEmitted) return;
    const reasons: string[] = [];
    if (!deps.emailProvider.configured) reasons.push('email_not_configured');
    if (!deps.smsProvider.configured) reasons.push('sms_not_configured');
    if (reasons.length > 0) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          degraded_reason: reasons.join(','),
          email_provider: deps.emailProvider.name,
          sms_provider: deps.smsProvider.name,
        },
        'notification-dispatch: starting with stub provider(s)',
      );
    }
    bootWarningEmitted = true;
  }

  async function claimPendingBatch(
    tenantId: string | undefined,
    batchSize: number,
  ): Promise<readonly PendingRow[]> {
    // Atomic claim: flip rows from `pending` to `sending` and return
    // them. Two competing workers cannot both claim the same row.
    const nowTs = now();
    try {
      const res = await exec(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'sending',
            last_attempt_at = ${nowTs},
            updated_at = ${nowTs}
        WHERE id IN (
          SELECT id
          FROM notification_dispatch_log
          WHERE delivery_status = 'pending'
            AND (${tenantId ?? null}::text IS NULL OR tenant_id = ${tenantId ?? null}::text)
            AND (next_retry_at IS NULL OR next_retry_at <= ${nowTs})
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, tenant_id, channel, recipient_address,
                  template_key, locale, payload, idempotency_key,
                  attempt_count
      `);
      const rows = asRows(res);
      const claimed: PendingRow[] = [];
      for (const r of rows) {
        const p = rowToPending(r);
        if (p) claimed.push(p);
      }
      return claimed;
    } catch (err) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          degraded_reason: 'claim_query_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'notification-dispatch: failed to claim pending batch',
      );
      return [];
    }
  }

  async function markSent(
    row: PendingRow,
    result: Extract<EmailProviderResult | SmsProviderResult, { status: 'sent' }>,
  ): Promise<void> {
    const nowTs = now();
    try {
      await exec(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'sent',
            provider = ${result.provider},
            provider_message_id = ${result.providerRef},
            attempt_count = attempt_count + 1,
            last_attempt_at = ${nowTs},
            delivery_reported_at = ${nowTs},
            next_retry_at = NULL,
            updated_at = ${nowTs}
        WHERE id = ${row.id}
          AND tenant_id = ${row.tenantId}
      `);
    } catch (err) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          dispatch_id: row.id,
          tenant_id: row.tenantId,
          degraded_reason: 'mark_sent_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'notification-dispatch: failed to mark dispatch row as sent',
      );
    }
  }

  async function markFailed(
    row: PendingRow,
    failure: Extract<
      EmailProviderResult | SmsProviderResult,
      { status: 'failed' }
    >,
  ): Promise<void> {
    const nowTs = now();
    const nextAttempt = row.attemptCount + 1;
    const isTerminal = !failure.retryable || nextAttempt >= MAX_ATTEMPTS;
    const nextStatus = isTerminal ? 'failed' : 'pending';
    const nextRetryAt = isTerminal ? null : computeNextRetryAt(nowTs, nextAttempt);
    try {
      await exec(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = ${nextStatus},
            provider = ${failure.provider},
            provider_error_code = ${failure.errorCode},
            provider_error_message = ${failure.errorMessage},
            attempt_count = ${nextAttempt},
            last_attempt_at = ${nowTs},
            next_retry_at = ${nextRetryAt},
            dead_lettered_at = ${isTerminal ? nowTs : null},
            dead_letter_reason = ${isTerminal ? failure.errorCode : null},
            updated_at = ${nowTs}
        WHERE id = ${row.id}
          AND tenant_id = ${row.tenantId}
      `);
    } catch (err) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          dispatch_id: row.id,
          tenant_id: row.tenantId,
          degraded_reason: 'mark_failed_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'notification-dispatch: failed to mark dispatch row as failed',
      );
    }
  }

  async function markUnknownChannel(row: PendingRow): Promise<void> {
    const nowTs = now();
    try {
      await exec(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'failed',
            provider_error_code = 'unknown_channel',
            provider_error_message = ${`Unsupported channel: ${row.channel}`},
            attempt_count = attempt_count + 1,
            last_attempt_at = ${nowTs},
            next_retry_at = NULL,
            dead_lettered_at = ${nowTs},
            dead_letter_reason = 'unknown_channel',
            updated_at = ${nowTs}
        WHERE id = ${row.id}
          AND tenant_id = ${row.tenantId}
      `);
    } catch (err) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          dispatch_id: row.id,
          tenant_id: row.tenantId,
          degraded_reason: 'mark_unknown_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'notification-dispatch: failed to mark dispatch row as unknown-channel',
      );
    }
  }

  async function dispatchOne(row: PendingRow): Promise<{
    sent: boolean;
    failed: boolean;
    skipped: boolean;
  }> {
    if (!KNOWN_CHANNELS.has(row.channel)) {
      await markUnknownChannel(row);
      return { sent: false, failed: false, skipped: true };
    }

    try {
      if (row.channel === 'email') {
        const result = await deps.emailProvider.send({
          tenantId: row.tenantId,
          recipientAddress: row.recipientAddress,
          templateKey: row.templateKey,
          locale: row.locale,
          payload: row.payload,
          idempotencyKey: row.idempotencyKey,
        });
        if (result.status === 'sent') {
          await markSent(row, result);
          return { sent: true, failed: false, skipped: false };
        }
        await markFailed(row, result);
        return { sent: false, failed: true, skipped: false };
      }

      // sms or whatsapp
      const channel = row.channel as 'sms' | 'whatsapp';
      const result = await deps.smsProvider.send({
        tenantId: row.tenantId,
        recipientAddress: row.recipientAddress,
        templateKey: row.templateKey,
        locale: row.locale,
        payload: row.payload,
        idempotencyKey: row.idempotencyKey,
        channel,
      });
      if (result.status === 'sent') {
        await markSent(row, result);
        return { sent: true, failed: false, skipped: false };
      }
      await markFailed(row, result);
      return { sent: false, failed: true, skipped: false };
    } catch (err) {
      // Provider threw — treat as a retryable failure.
      const errorMessage = err instanceof Error ? err.message : String(err);
      await markFailed(row, {
        status: 'failed',
        errorCode: 'provider_threw',
        errorMessage,
        retryable: true,
        provider:
          row.channel === 'email'
            ? deps.emailProvider.name
            : deps.smsProvider.name,
      });
      return { sent: false, failed: true, skipped: false };
    }
  }

  async function runOnce(input: RunOnceInput = {}): Promise<RunOnceResult> {
    emitBootDegradedWarningOnce();
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const rows = await claimPendingBatch(input.tenantId, batchSize);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
      const r = await dispatchOne(row);
      if (r.sent) sent += 1;
      if (r.failed) failed += 1;
      if (r.skipped) skipped += 1;
    }
    return {
      claimed: rows.length,
      sent,
      failed,
      skipped_unknown_channel: skipped,
    };
  }

  async function runForever(input: RunForeverInput): Promise<void> {
    emitBootDegradedWarningOnce();
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const idleSleepMs = input.idleSleepMs ?? DEFAULT_IDLE_SLEEP_MS;

    while (!input.signal.aborted) {
      const result = await runOnce({
        ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
        batchSize,
      });
      if (result.claimed === 0) {
        await sleepCancellable(idleSleepMs, input.signal);
      }
    }
  }

  return { runOnce, runForever };
}

function sleepCancellable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

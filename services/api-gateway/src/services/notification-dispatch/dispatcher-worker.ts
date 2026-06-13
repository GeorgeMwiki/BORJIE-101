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
import { withServiceRoleContext } from '@borjie/database';
import type { EmailProvider, EmailProviderResult } from './email-provider';
import type { SmsProvider, SmsProviderResult } from './sms-provider';
import type { PushProvider, PushProviderResult } from './push-providers/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbExecutor = { execute(q: unknown): Promise<unknown> };

/** Per-recipient preference-gate decision (see DispatcherDeps.shouldDeliver). */
export type DeliveryDisposition = 'deliver' | 'suppress' | 'defer';

type Logger = {
  warn(meta: Record<string, unknown>, msg: string): void;
  info?(meta: Record<string, unknown>, msg: string): void;
};

export type DispatcherDeps = {
  readonly db: DbExecutor;
  readonly logger: Logger;
  readonly emailProvider: EmailProvider;
  readonly smsProvider: SmsProvider;
  /** Optional push rail (the `app_push` channel). When absent, app_push rows
   *  fail non-retryably with `push_not_configured` (so they dead-letter rather
   *  than spin). Resolve via resolvePushProviderFromEnv() in composition. */
  readonly pushProvider?: PushProvider;
  /**
   * Optional per-recipient preference gate. When provided AND the row carries
   * a userId, the dispatcher consults it before sending and acts on the
   * disposition: `'suppress'` → terminal (reason `suppressed_by_preference`,
   * for a channel/template the owner toggled OFF); `'defer'` → re-queued for
   * later WITHOUT consuming an attempt (the owner is in their quiet-hours
   * window and the notification is deferrable — urgent safety alerts return
   * `'deliver'` so they are never delayed); `'deliver'` → send now. Decoupled
   * from the preferences table — composition injects a
   * notification_preferences-backed implementation. MUST fail-open (return
   * `'deliver'`) on its own errors so a prefs read failure never drops a
   * notification.
   */
  readonly shouldDeliver?: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly channel: string;
    readonly templateKey: string;
  }) => Promise<DeliveryDisposition>;
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
  readonly userId: string | null;
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
const KNOWN_CHANNELS = new Set(['email', 'sms', 'whatsapp', 'app_push']);
// A row stranded in `sending` longer than this (process crashed between the
// pending→sending claim and markSent/markFailed) is reclaimed by a later poll.
const STALE_SENDING_MS = 5 * 60_000; // 5 minutes
// A row deferred for the recipient's quiet-hours is re-queued this far out and
// re-evaluated until the window passes (no attempt consumed meanwhile).
const QUIET_HOURS_DEFER_MS = 30 * 60_000; // 30 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

/**
 * Surface the ROOT cause of a DB error. Drizzle wraps postgres-js errors as
 * `DrizzleQueryError` whose `.message` is just "Failed query: <sql>" — the real
 * postgres error (code/detail) sits on `.cause`. Logging only `.message` hid
 * the root cause; this walks the cause chain so claim/mark failures are
 * diagnosable in prod.
 */
function describeDbError(err: unknown): {
  err: string;
  cause?: string;
  code?: string;
} {
  const e = err as {
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string };
  };
  const cause = e?.cause?.message;
  const code = e?.cause?.code ?? e?.code;
  return {
    err: e?.message ? String(e.message).slice(0, 200) : String(err),
    ...(cause ? { cause: String(cause).slice(0, 200) } : {}),
    ...(code ? { code: String(code) } : {}),
  };
}

function rowToPending(raw: Record<string, unknown>): PendingRow | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : null;
  const userId = typeof raw.user_id === 'string' ? raw.user_id : null;
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
    userId,
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

// The db param type withServiceRoleContext expects (deriving it avoids the
// TS2709 namespace clash on the `DatabaseClient` name under NodeNext).
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

export function createNotificationDispatcher(deps: DispatcherDeps): Dispatcher {
  // notification_dispatch_log has FORCE ROW LEVEL SECURITY + a service-role
  // bypass policy (migration 0348). Every drain statement MUST run with
  // `app.is_service_role='true'` bound or BOTH RLS policies evaluate false and
  // the claim matches ZERO rows in production — silently draining nothing while
  // pending rows pile up. So we wrap each statement in a service-role context
  // when the db supports transactions (the real Drizzle client). Unit tests
  // inject a transaction-less mock and fall through to a direct execute.
  function runStmt(q: unknown): Promise<unknown> {
    const dbAny = deps.db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(
        deps.db as unknown as ServiceRoleDb,
        (tx) => (tx as unknown as DbExecutor).execute(q),
      );
    }
    return deps.db.execute(q);
  }
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
    // Atomic claim: flip rows from `pending` (or stale `sending`) to
    // `sending` and return them. Two competing workers cannot both claim the
    // same row (FOR UPDATE SKIP LOCKED). Rows stranded in `sending` past
    // STALE_SENDING_MS (a crash between claim and mark) are reclaimed and their
    // attempt_count bumped so they still honour MAX_ATTEMPTS rather than
    // re-sending forever.
    const nowTs = now();
    const staleBefore = new Date(nowTs.getTime() - STALE_SENDING_MS);
    try {
      const res = await runStmt(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'sending',
            attempt_count = attempt_count
              + CASE WHEN delivery_status = 'sending' THEN 1 ELSE 0 END,
            last_attempt_at = ${nowTs.toISOString()},
            updated_at = ${nowTs.toISOString()}
        WHERE id IN (
          SELECT id
          FROM notification_dispatch_log
          WHERE (
                  delivery_status = 'pending'
                  OR (delivery_status = 'sending' AND last_attempt_at < ${staleBefore.toISOString()})
                )
            AND (${tenantId ?? null}::text IS NULL OR tenant_id = ${tenantId ?? null}::text)
            AND (next_retry_at IS NULL OR next_retry_at <= ${nowTs.toISOString()})
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, tenant_id, user_id, channel, recipient_address,
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
          ...describeDbError(err),
        },
        'notification-dispatch: failed to claim pending batch',
      );
      return [];
    }
  }

  async function markSent(
    row: PendingRow,
    result: Extract<
      EmailProviderResult | SmsProviderResult | PushProviderResult,
      { status: 'sent' }
    >,
  ): Promise<void> {
    const nowTs = now();
    try {
      await runStmt(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'sent',
            provider = ${result.provider},
            provider_message_id = ${result.providerRef},
            attempt_count = attempt_count + 1,
            last_attempt_at = ${nowTs.toISOString()},
            delivery_reported_at = ${nowTs.toISOString()},
            next_retry_at = NULL,
            updated_at = ${nowTs.toISOString()}
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
      EmailProviderResult | SmsProviderResult | PushProviderResult,
      { status: 'failed' }
    >,
  ): Promise<void> {
    const nowTs = now();
    const nextAttempt = row.attemptCount + 1;
    const isTerminal = !failure.retryable || nextAttempt >= MAX_ATTEMPTS;
    const nextStatus = isTerminal ? 'failed' : 'pending';
    const nextRetryAt = isTerminal ? null : computeNextRetryAt(nowTs, nextAttempt);
    try {
      await runStmt(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = ${nextStatus},
            provider = ${failure.provider},
            provider_error_code = ${failure.errorCode},
            provider_error_message = ${failure.errorMessage},
            attempt_count = ${nextAttempt},
            last_attempt_at = ${nowTs.toISOString()},
            next_retry_at = ${nextRetryAt ? nextRetryAt.toISOString() : null},
            dead_lettered_at = ${isTerminal ? nowTs.toISOString() : null},
            dead_letter_reason = ${isTerminal ? failure.errorCode : null},
            updated_at = ${nowTs.toISOString()}
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
      await runStmt(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'failed',
            provider_error_code = 'unknown_channel',
            provider_error_message = ${`Unsupported channel: ${row.channel}`},
            attempt_count = attempt_count + 1,
            last_attempt_at = ${nowTs.toISOString()},
            next_retry_at = NULL,
            dead_lettered_at = ${nowTs.toISOString()},
            dead_letter_reason = 'unknown_channel',
            updated_at = ${nowTs.toISOString()}
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

  async function markSuppressed(row: PendingRow): Promise<void> {
    const nowTs = now();
    try {
      await runStmt(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'failed',
            provider = 'none',
            provider_error_code = 'suppressed_by_preference',
            provider_error_message = ${`recipient opted out of ${row.channel}`},
            attempt_count = attempt_count + 1,
            last_attempt_at = ${nowTs.toISOString()},
            next_retry_at = NULL,
            dead_lettered_at = ${nowTs.toISOString()},
            dead_letter_reason = 'suppressed_by_preference',
            updated_at = ${nowTs.toISOString()}
        WHERE id = ${row.id}
          AND tenant_id = ${row.tenantId}
      `);
    } catch (err) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          dispatch_id: row.id,
          tenant_id: row.tenantId,
          degraded_reason: 'mark_suppressed_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'notification-dispatch: failed to mark dispatch row as suppressed',
      );
    }
  }

  async function markDeferred(row: PendingRow): Promise<void> {
    const nowTs = now();
    const retryAt = new Date(nowTs.getTime() + QUIET_HOURS_DEFER_MS);
    try {
      // Re-queue (pending) for re-evaluation after the quiet window — NO
      // attempt consumed, so quiet-hours never erodes the retry budget.
      await runStmt(sql`
        UPDATE notification_dispatch_log
        SET delivery_status = 'pending',
            next_retry_at = ${retryAt.toISOString()},
            updated_at = ${nowTs.toISOString()}
        WHERE id = ${row.id}
          AND tenant_id = ${row.tenantId}
      `);
    } catch (err) {
      deps.logger.warn(
        {
          worker: 'notification-dispatch',
          dispatch_id: row.id,
          tenant_id: row.tenantId,
          degraded_reason: 'mark_deferred_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'notification-dispatch: failed to defer dispatch row for quiet-hours',
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

    // A row reclaimed by the stale-`sending` reaper past MAX_ATTEMPTS (a send
    // that crashes the process mid-dispatch every time) is dead-lettered rather
    // than retried forever — terminal failure bounds the loop.
    if (row.attemptCount >= MAX_ATTEMPTS) {
      await markFailed(row, {
        status: 'failed',
        provider: 'none',
        errorCode: 'max_attempts_exceeded',
        errorMessage: `exceeded ${MAX_ATTEMPTS} delivery attempts`,
        retryable: false,
      });
      return { sent: false, failed: true, skipped: false };
    }

    // Per-recipient preference gate: a channel/template the owner toggled OFF
    // is suppressed; a deferrable notification inside the owner's quiet-hours
    // window is re-queued for later. Fail-open (deliver) on any gate error so
    // a prefs read failure never silently drops a notification.
    if (deps.shouldDeliver && row.userId) {
      let disposition: DeliveryDisposition = 'deliver';
      try {
        disposition = await deps.shouldDeliver({
          tenantId: row.tenantId,
          userId: row.userId,
          channel: row.channel,
          templateKey: row.templateKey,
        });
      } catch {
        disposition = 'deliver';
      }
      if (disposition === 'suppress') {
        await markSuppressed(row);
        return { sent: false, failed: false, skipped: false };
      }
      if (disposition === 'defer') {
        await markDeferred(row);
        return { sent: false, failed: false, skipped: false };
      }
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

      if (row.channel === 'app_push') {
        if (!deps.pushProvider) {
          // No push rail wired — non-retryable so the row dead-letters
          // instead of spinning forever waiting for a provider.
          await markFailed(row, {
            status: 'failed',
            provider: 'none',
            errorCode: 'push_not_configured',
            errorMessage: 'no push provider configured',
            retryable: false,
          });
          return { sent: false, failed: true, skipped: false };
        }
        // The push TOKEN rides recipient_address (the producer resolves a
        // user's device_push_tokens into one row per token, like email/sms).
        const result = await deps.pushProvider.send({
          tenantId: row.tenantId,
          pushToken: row.recipientAddress,
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
            : row.channel === 'app_push'
              ? (deps.pushProvider?.name ?? 'push')
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

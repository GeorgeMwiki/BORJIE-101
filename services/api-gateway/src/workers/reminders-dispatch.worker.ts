/**
 * Reminders Dispatch Worker — Wave OWNER-OS.
 *
 * Polls the `reminders` table every 30s for rows where
 * `trigger_at <= now() AND status = 'scheduled'`, atomically claims each
 * row (flips to 'sending' via UPDATE ... RETURNING under SKIP LOCKED),
 * dispatches via the matching channel adapter, then flips status to
 * 'sent' (with dispatched_at) or 'failed' (with dispatch_error).
 *
 * Channels:
 *   - email  → `EmailProvider` (SendGrid / SES / SMTP via existing env
 *              composition in services/api-gateway/src/services/
 *              notification-dispatch/email-providers/composite.ts).
 *   - sms    → `SmsProvider`   (africastalking via env composition).
 *   - slack  → posts JSON to the per-tenant SLACK_WEBHOOK_URL env var.
 *              If no webhook is set the row lands in 'failed' with a
 *              clear error so the operator can wire it later.
 *
 * Idempotency: the `reminders.idempotency_key` column is UNIQUE per
 * tenant. A worker restart between claim + dispatch could (in theory)
 * double-fire the same row, so the dispatcher checks
 * `dispatched_at IS NULL` inside the WHERE clause of the final UPDATE.
 * The UNIQUE constraint also blocks new INSERTs with the same key.
 *
 * Lifecycle:
 *   - `start()` arms an interval (default 30s — tunable via env).
 *   - `tickOnce()` exposed for tests.
 *   - `stop()` clears the timer.
 *
 * Failure containment:
 *   - No DB → no-op + warn once on boot.
 *   - Per-row failures isolated; loop continues.
 *   - All errors logged via Pino (no raw console statements in services).
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withServiceRoleContext } from '@borjie/database';

import { publishCockpitEvent } from '../services/cockpit-events';
import {
  type EmailProvider,
  type SmsProvider,
} from '../services/notification-dispatch';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';
import {
  DEFAULT_TIMEZONE,
  QUIET_RECHECK_MS,
  asRows,
  isWithinQuietHours,
} from './reminders-quiet-hours';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH = 25;

// No-reminder-slips sweep: a delivered-but-unacknowledged reminder is re-fired
// up to DEFAULT_MAX_NUDGES times (counter tracked on the row payload), then
// escalated. OFF unless `reRemindAfterMs` is wired in composition.
const DEFAULT_MAX_NUDGES = 2;
const ESCALATION_SWEEP_BATCH = 25;
/** Reserved payload key holding the bounded nudge counter. */
const NUDGE_COUNT_KEY = '__reminderNudges';

// Retry policy — mirrors the notification-dispatch worker so both delivery
// paths back off identically. A RETRYABLE failure re-queues the row (status
// back to 'scheduled', trigger_at = now + backoff) and bumps attempt_count;
// the existing `trigger_at <= now()` claim doubles as the retry schedule.
// Attempt 5 (or any non-retryable failure) is terminal → 'failed'.
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s; doubles per attempt: 30s,60s,120s,240s

/** Exponential backoff: BASE * 2^(attempt-1) from `from`. Pure. */
function computeNextRetryAt(from: Date, attempt: number): Date {
  const delayMs = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  return new Date(from.getTime() + delayMs);
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

// withServiceRoleContext's db param type (derived to dodge the TS2709 clash).
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

interface PendingReminder {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly body: string;
  readonly channel: 'email' | 'sms' | 'slack' | 'whatsapp';
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  /** Delivery attempts so far (0 on a fresh row). Drives the retry cap. */
  readonly attemptCount: number;
}

export interface RemindersDispatchOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly emailProvider: EmailProvider;
  readonly smsProvider: SmsProvider;
  /** Optional Slack webhook URL resolver. Returning null leaves the row
   *  in 'failed' with `slack_webhook_not_configured`. */
  readonly slackWebhookForTenant?: (tenantId: string) => string | null;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  /** Resolver from owner_id → email address. Required for email channel
   *  to land. The owner-identity resolver wires this in production from
   *  `owner_contact_prefs` then falls back to `users.email`. */
  readonly emailForOwner?: (tenantId: string, ownerId: string) => Promise<string | null>;
  /** Resolver from owner_id → E.164 phone for SMS. */
  readonly phoneForOwner?: (tenantId: string, ownerId: string) => Promise<string | null>;
  /** Resolver from owner_id → Slack handle (e.g. @mwikila). Optional —
   *  when present the Slack channel can DM the owner directly instead
   *  of posting to the tenant-wide webhook. */
  readonly slackHandleForOwner?: (tenantId: string, ownerId: string) => Promise<string | null>;
  /**
   * Quiet-hours window in 24h LOCAL time (the owner's tz). When set, an SMS
   * reminder whose owner-local time falls inside `[startHour, endHour)` is
   * deferred (re-queued, no attempt consumed) instead of buzzing the phone.
   * Wired from QUIET_HOURS_START / QUIET_HOURS_END. Omit to disable.
   */
  readonly quietHours?: { readonly startHour: number; readonly endHour: number };
  /** Resolver from owner_id → IANA time zone (owner_contact_prefs.timezone).
   *  Falls back to Africa/Dar_es_Salaam when absent. Drives quiet-hours. */
  readonly timezoneForOwner?: (tenantId: string, ownerId: string) => Promise<string | null>;
  /**
   * No-reminder-slips guarantee. A reminder delivered (status 'sent') but
   * never acknowledged by the owner is RE-FIRED after this window — a second
   * nudge — up to `maxNudges` times, after which it ESCALATES (a cockpit pulse
   * the owner cannot miss). Defaults keep the loop conservative; set to 0 /
   * omit `reRemindAfterMs` to disable the sweep entirely.
   */
  readonly reRemindAfterMs?: number;
  /** Max re-remind nudges before escalation. Default 2. Bounded + small. */
  readonly maxNudges?: number;
}

export interface RemindersDispatchHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<DispatchTickResult>;
}

export interface DispatchTickResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  /** Rows that hit a retryable failure and were re-queued with backoff
   *  (not yet delivered, not terminally failed). */
  readonly retried: number;
  /** SMS rows deferred because the owner is in quiet hours (re-queued for
   *  later, no delivery attempt made, no retry attempt consumed). */
  readonly deferred: number;
  /** 'sent'-but-unacknowledged rows re-fired as a second nudge this tick
   *  (the no-reminder-slips sweep). */
  readonly reRemindNudged: number;
  /** 'sent'-but-unacknowledged rows that hit the nudge cap and escalated
   *  to a cockpit alert pulse this tick. */
  readonly escalated: number;
}

function rowToReminder(r: Record<string, unknown>): PendingReminder | null {
  const id = typeof r.id === 'string' ? r.id : null;
  const tenantId = typeof r.tenant_id === 'string' ? r.tenant_id : null;
  const ownerId = typeof r.owner_id === 'string' ? r.owner_id : null;
  const title = typeof r.title === 'string' ? r.title : null;
  const body = typeof r.body === 'string' ? r.body : null;
  const channelRaw = typeof r.channel === 'string' ? r.channel : null;
  const idempotencyKey = typeof r.idempotency_key === 'string' ? r.idempotency_key : null;
  if (!id || !tenantId || !ownerId || !title || !body || !channelRaw || !idempotencyKey) {
    return null;
  }
  if (
    channelRaw !== 'email' &&
    channelRaw !== 'sms' &&
    channelRaw !== 'slack' &&
    channelRaw !== 'whatsapp'
  ) {
    return null;
  }
  // Strip html/bodyHtml so owner free-text can't reach the email renderer's
  // verbatim-HTML path (defense-in-depth vs self-injected HTML in email).
  const payload =
    r.payload && typeof r.payload === 'object'
      ? Object.fromEntries(
          Object.entries(r.payload as Record<string, unknown>).filter(
            ([k]) => k !== 'html' && k !== 'bodyHtml',
          ),
        )
      : {};
  const attemptCountRaw = r.attempt_count;
  const attemptCount =
    typeof attemptCountRaw === 'number'
      ? attemptCountRaw
      : typeof attemptCountRaw === 'string'
        ? Number.parseInt(attemptCountRaw, 10) || 0
        : 0;
  return {
    id,
    tenantId,
    ownerId,
    title,
    body,
    channel: channelRaw,
    payload,
    idempotencyKey,
    attemptCount,
  };
}

export function createRemindersDispatchWorker(
  options: RemindersDispatchOptions,
): RemindersDispatchHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let bootWarned = false;

  // `reminders` has FORCE RLS + a service-role bypass (migration 0354); this
  // worker drains CROSS-TENANT over the shared pool, so every statement must
  // bind `app.is_service_role='true'` or the claim matches ZERO rows (loop
  // goes dark). Wrap when transactional; the unit-test mock executes directly.
  function runStmt(q: unknown): Promise<unknown> {
    const dbAny = options.db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(
        options.db as unknown as ServiceRoleDb,
        (tx) => (tx as unknown as DbLike).execute(q),
      );
    }
    return options.db.execute(q);
  }

  function warnBootOnce(): void {
    if (bootWarned) return;
    bootWarned = true;
    if (!options.emailProvider.configured) {
      options.logger.warn({ worker: 'reminders-dispatch' }, 'reminders-dispatch: email provider not configured (rows will fail until wired)');
    }
    if (!options.smsProvider.configured) {
      options.logger.warn({ worker: 'reminders-dispatch' }, 'reminders-dispatch: sms provider not configured (rows will fail until wired)');
    }
  }

  async function claim(): Promise<readonly PendingReminder[]> {
    const ts = now();
    try {
      // Atomic claim: flip ready rows from 'scheduled' to 'sending' so a
      // second worker / restart cannot grab the same row. We return the
      // full row so the dispatcher has everything it needs.
      const res = await runStmt(sql`
        UPDATE reminders
           SET status = 'sending'
         WHERE id IN (
           SELECT id FROM reminders
            WHERE status = 'scheduled'
              AND trigger_at <= ${ts}
            ORDER BY trigger_at ASC
            LIMIT ${DEFAULT_BATCH}
            FOR UPDATE SKIP LOCKED
         )
         RETURNING id, tenant_id, owner_id, title, body, channel, payload, idempotency_key, attempt_count
      `);
      const out: PendingReminder[] = [];
      for (const row of asRows(res)) {
        const r = rowToReminder(row);
        if (r) out.push(r);
      }
      return out;
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: claim failed',
      );
      return [];
    }
  }

  async function markSent(r: PendingReminder): Promise<void> {
    try {
      await runStmt(sql`
        UPDATE reminders
           SET status = 'sent',
               dispatched_at = ${now()},
               dispatch_error = NULL
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
           AND dispatched_at IS NULL
      `);
      // R6 — cockpit SSE notify. Emit only AFTER the DB row flipped to
      // 'sent' so the toast cannot show before the channel acks. The cockpit
      // event's `channel` field is a display hint typed to the original three
      // rails; WhatsApp is a phone rail like SMS, so it maps to 'sms' for the
      // toast (the row itself records the true 'whatsapp' channel).
      publishCockpitEvent({
        kind: 'reminder.fired',
        tenantId: r.tenantId,
        emittedAt: now().toISOString(),
        reminderId: r.id,
        title: r.title,
        channel: r.channel === 'whatsapp' ? 'sms' : r.channel,
      });
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: markSent failed',
      );
    }
  }

  async function markFailed(r: PendingReminder, errorMessage: string): Promise<void> {
    try {
      await runStmt(sql`
        UPDATE reminders
           SET status = 'failed',
               dispatched_at = ${now()},
               dispatch_error = ${errorMessage.slice(0, 4000)}
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
      `);
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: markFailed failed',
      );
    }
  }

  // Re-queue a row after a RETRYABLE failure: status back to 'scheduled' with
  // trigger_at pushed out by the backoff so the existing claim re-picks it
  // when due. dispatched_at stays NULL (not delivered yet); the same
  // idempotency_key is reused so the provider de-dupes if a prior attempt
  // actually landed before the error (e.g. a post-send timeout).
  async function markRetry(
    r: PendingReminder,
    nextAttempt: number,
    errorMessage: string,
  ): Promise<void> {
    const retryAt = computeNextRetryAt(now(), nextAttempt);
    try {
      await runStmt(sql`
        UPDATE reminders
           SET status = 'scheduled',
               trigger_at = ${retryAt},
               attempt_count = ${nextAttempt},
               dispatch_error = ${errorMessage.slice(0, 4000)}
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
      `);
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: markRetry failed',
      );
    }
  }

  // Decide between retry and terminal failure. A retryable error re-queues
  // with backoff until the attempt cap; anything else (non-retryable, or the
  // cap reached) lands terminally in 'failed'.
  async function handleFailure(
    r: PendingReminder,
    retryable: boolean,
    errorMessage: string,
  ): Promise<'retried' | 'failed'> {
    const nextAttempt = r.attemptCount + 1;
    if (retryable && nextAttempt < MAX_ATTEMPTS) {
      await markRetry(r, nextAttempt, errorMessage);
      return 'retried';
    }
    await markFailed(r, errorMessage);
    return 'failed';
  }

  // Defer an SMS that lands in the owner's quiet hours: re-queue for a later
  // re-check WITHOUT marking it failed and WITHOUT consuming a retry attempt
  // (a deferral is not a failure). It will deliver once outside the window.
  async function markDeferred(r: PendingReminder, until: Date): Promise<void> {
    try {
      await runStmt(sql`
        UPDATE reminders
           SET status = 'scheduled',
               trigger_at = ${until}
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
      `);
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: markDeferred failed',
      );
    }
  }

  // Quiet-hours gate for the SMS channel. Returns true (and re-queues the row)
  // when the owner's local time is inside the configured window.
  async function deferredForQuietHours(r: PendingReminder): Promise<boolean> {
    if (!options.quietHours) return false;
    const tz =
      (options.timezoneForOwner
        ? await options.timezoneForOwner(r.tenantId, r.ownerId).catch(() => null)
        : null) ?? DEFAULT_TIMEZONE;
    if (
      !isWithinQuietHours(
        now(),
        tz,
        options.quietHours.startHour,
        options.quietHours.endHour,
      )
    ) {
      return false;
    }
    await markDeferred(r, new Date(now().getTime() + QUIET_RECHECK_MS));
    return true;
  }

  async function dispatchOne(
    r: PendingReminder,
  ): Promise<{ outcome: 'sent' | 'failed' | 'retried' | 'deferred' }> {
    if (r.channel === 'email') {
      // Owner-identity resolver (preferred) → owner_contact_prefs →
      // users.email. The legacy BORJIE_OWNER_FALLBACK_EMAIL is retained
      // only as a final escape hatch for local-dev environments that
      // have not yet seeded the prefs table.
      const addr = options.emailForOwner
        ? (await options.emailForOwner(r.tenantId, r.ownerId).catch(() => null)) ??
          (process.env.BORJIE_OWNER_FALLBACK_EMAIL?.trim() ?? null)
        : process.env.BORJIE_OWNER_FALLBACK_EMAIL?.trim() ?? null;
      if (!addr) {
        // No address on file — retrying cannot fix this. Terminal.
        await markFailed(r, 'no_email_address_for_owner');
        return { outcome: 'failed' };
      }
      try {
        const result = await options.emailProvider.send({
          tenantId: r.tenantId,
          recipientAddress: addr,
          templateKey: 'owner.reminder.generic',
          locale: 'en',
          payload: { title: r.title, body: r.body, ...r.payload },
          idempotencyKey: r.idempotencyKey,
        });
        if (result.status === 'sent') {
          await markSent(r);
          return { outcome: 'sent' };
        }
        // Provider-reported failure — honour its retryable classification.
        return {
          outcome: await handleFailure(
            r,
            result.retryable,
            `${result.errorCode}: ${result.errorMessage}`,
          ),
        };
      } catch (err) {
        // A thrown error is a transport fault (network / timeout) — retryable.
        return {
          outcome: await handleFailure(
            r,
            true,
            err instanceof Error ? err.message : String(err),
          ),
        };
      }
    }

    // SMS + WhatsApp share the SMS provider seam: both resolve the owner's
    // E.164 phone and dispatch via `options.smsProvider`, differing ONLY in
    // the `channel` flag the Twilio adapter routes on (whatsapp: prefix vs
    // bare number). Both buzz the owner's phone, so quiet-hours gates both.
    if (r.channel === 'sms' || r.channel === 'whatsapp') {
      // Quiet-hours: defer rather than buzz the owner's phone at night.
      if (await deferredForQuietHours(r)) {
        return { outcome: 'deferred' };
      }
      const phone = options.phoneForOwner
        ? await options.phoneForOwner(r.tenantId, r.ownerId).catch(() => null)
        : null;
      if (!phone) {
        // No phone on file — terminal, retrying cannot help.
        await markFailed(r, 'no_phone_number_for_owner');
        return { outcome: 'failed' };
      }
      try {
        const result = await options.smsProvider.send({
          tenantId: r.tenantId,
          recipientAddress: phone,
          templateKey: 'owner.reminder.generic',
          locale: 'en',
          payload: { title: r.title, body: r.body, ...r.payload },
          idempotencyKey: r.idempotencyKey,
          channel: r.channel,
        });
        if (result.status === 'sent') {
          await markSent(r);
          return { outcome: 'sent' };
        }
        return {
          outcome: await handleFailure(
            r,
            result.retryable,
            `${result.errorCode}: ${result.errorMessage}`,
          ),
        };
      } catch (err) {
        return {
          outcome: await handleFailure(
            r,
            true,
            err instanceof Error ? err.message : String(err),
          ),
        };
      }
    }

    // slack
    const webhook =
      options.slackWebhookForTenant?.(r.tenantId) ??
      process.env.SLACK_WEBHOOK_URL?.trim() ??
      null;
    if (!webhook) {
      // No webhook configured — terminal until an operator wires one.
      await markFailed(r, 'slack_webhook_not_configured');
      return { outcome: 'failed' };
    }
    // Per-owner Slack handle resolved from owner_contact_prefs. When
    // present we prepend a mention so the owner is paged directly in
    // the tenant-wide channel.
    const slackHandle = options.slackHandleForOwner
      ? await options.slackHandleForOwner(r.tenantId, r.ownerId).catch(() => null)
      : null;
    const slackMention = slackHandle
      ? `<${slackHandle.startsWith('@') ? slackHandle : `@${slackHandle}`}> `
      : '';
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${slackMention}*${r.title}*\n${r.body}`,
          username: 'Mr. Mwikila (Borjie)',
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 5xx / 429 are transient (Slack throttling or outage) → retry;
        // 4xx (bad webhook, payload) are terminal.
        const retryable = res.status >= 500 || res.status === 429;
        return {
          outcome: await handleFailure(
            r,
            retryable,
            `slack_${res.status}: ${text.slice(0, 200)}`,
          ),
        };
      }
      await markSent(r);
      return { outcome: 'sent' };
    } catch (err) {
      return {
        outcome: await handleFailure(
          r,
          true,
          err instanceof Error ? err.message : String(err),
        ),
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // No-reminder-slips sweep: re-remind + escalate.
  //
  // A reminder that was DELIVERED ('sent') but never ACKNOWLEDGED by the
  // owner (POST /:id/acknowledge moves it to terminal 'acknowledged') is a
  // potential slip. After `reRemindAfterMs` we re-fire it (a second nudge)
  // by flipping it back to 'scheduled' with trigger_at = now() so the normal
  // claim re-delivers it. The bounded nudge counter lives on the row's
  // payload (`__reminderNudges`) so no schema change is needed. Once the
  // counter reaches `maxNudges` the row instead ESCALATES: an
  // 'incident.escalated' cockpit pulse the owner cannot miss, and the row is
  // marked 'acknowledged' so it leaves the sweep (escalation IS the terminal
  // resolution — Mr. Mwikila has now surfaced it loudly). Bounded + idempotent.
  // ───────────────────────────────────────────────────────────────────

  /** Read the bounded nudge counter off a payload jsonb. Pure. */
  function nudgeCountOf(payload: Record<string, unknown>): number {
    const raw = payload[NUDGE_COUNT_KEY];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    return 0;
  }

  // Claim 'sent'-but-unacknowledged rows whose dispatched_at is older than the
  // window. Flips them to 'sending' under SKIP LOCKED so a second worker /
  // restart cannot double-sweep, mirroring the delivery claim.
  async function claimUnacknowledged(
    olderThan: Date,
  ): Promise<readonly PendingReminder[]> {
    try {
      const res = await runStmt(sql`
        UPDATE reminders
           SET status = 'sending'
         WHERE id IN (
           SELECT id FROM reminders
            WHERE status = 'sent'
              AND dispatched_at IS NOT NULL
              AND dispatched_at <= ${olderThan}
            ORDER BY dispatched_at ASC
            LIMIT ${ESCALATION_SWEEP_BATCH}
            FOR UPDATE SKIP LOCKED
         )
         RETURNING id, tenant_id, owner_id, title, body, channel, payload, idempotency_key, attempt_count
      `);
      const out: PendingReminder[] = [];
      for (const row of asRows(res)) {
        const r = rowToReminder(row);
        if (r) out.push(r);
      }
      return out;
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: unacknowledged claim failed',
      );
      return [];
    }
  }

  // Re-fire an unacknowledged row: bump the nudge counter on its payload and
  // re-queue it for immediate re-delivery (status 'scheduled', trigger_at now).
  // dispatched_at is cleared so the next markSent records a fresh delivery and
  // the row is eligible for a future sweep window.
  async function reRemind(r: PendingReminder, nextNudge: number): Promise<void> {
    const nextPayload = { ...r.payload, [NUDGE_COUNT_KEY]: nextNudge };
    try {
      await runStmt(sql`
        UPDATE reminders
           SET status = 'scheduled',
               trigger_at = ${now()},
               dispatched_at = NULL,
               payload = ${JSON.stringify(nextPayload)}::jsonb
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
      `);
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: reRemind failed',
      );
    }
  }

  // Escalate an unacknowledged row that has exhausted its nudges: emit a
  // cockpit alert pulse and land the row in the terminal 'acknowledged' state
  // (the escalation is now the resolution — it has been surfaced loudly).
  async function escalateUnacknowledged(r: PendingReminder): Promise<void> {
    try {
      await runStmt(sql`
        UPDATE reminders
           SET status = 'acknowledged'
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
      `);
      publishCockpitEvent({
        kind: 'incident.escalated',
        tenantId: r.tenantId,
        emittedAt: now().toISOString(),
        incidentId: r.id,
        fromLevel: 'reminder',
        toLevel: 'escalated',
        escalatedBy: 'reminders-dispatch',
      });
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: escalate failed',
      );
    }
  }

  // One pass of the no-reminder-slips sweep. Returns the per-tick counts.
  async function sweepUnacknowledged(): Promise<{
    readonly nudged: number;
    readonly escalated: number;
  }> {
    if (!options.reRemindAfterMs || options.reRemindAfterMs <= 0) {
      return { nudged: 0, escalated: 0 };
    }
    const maxNudges = options.maxNudges ?? DEFAULT_MAX_NUDGES;
    const olderThan = new Date(now().getTime() - options.reRemindAfterMs);
    const rows = await claimUnacknowledged(olderThan);
    let nudged = 0;
    let escalated = 0;
    for (const r of rows) {
      const count = nudgeCountOf(r.payload);
      if (count < maxNudges) {
        await reRemind(r, count + 1);
        nudged += 1;
      } else {
        await escalateUnacknowledged(r);
        escalated += 1;
      }
    }
    return { nudged, escalated };
  }

  async function tickOnce(): Promise<DispatchTickResult> {
    warnBootOnce();
    try {
      const claimed = await claim();
      let sent = 0;
      let failed = 0;
      let retried = 0;
      let deferred = 0;
      for (const r of claimed) {
        const { outcome } = await dispatchOne(r);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'retried') retried += 1;
        else if (outcome === 'deferred') deferred += 1;
        else failed += 1;
      }
      const { nudged: reRemindNudged, escalated } = await sweepUnacknowledged();
      if (claimed.length > 0 || reRemindNudged > 0 || escalated > 0) {
        options.logger.info(
          {
            worker: 'reminders-dispatch',
            claimed: claimed.length,
            sent,
            failed,
            retried,
            deferred,
            reRemindNudged,
            escalated,
          },
          'reminders-dispatch: tick done',
        );
      }
      // G6 — heartbeat on the success path.
      workerHeartbeat('reminders-dispatch');
      return {
        claimed: claimed.length,
        sent,
        failed,
        retried,
        deferred,
        reRemindNudged,
        escalated,
      };
    } catch (err) {
      workerHeartbeatFailure('reminders-dispatch', err);
      throw err;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info({ worker: 'reminders-dispatch' }, 'reminders-dispatch: disabled by config');
      return;
    }
    if (timer) return;
    // G6 — register before the first tick.
    registerWorker({ name: 'reminders-dispatch', intervalMs });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          { worker: 'reminders-dispatch', err: err instanceof Error ? err.message : String(err) },
          'reminders-dispatch: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info(
      { worker: 'reminders-dispatch', intervalMs },
      'reminders-dispatch: started',
    );
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}

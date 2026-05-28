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

import {
  type EmailProvider,
  type SmsProvider,
} from '../services/notification-dispatch';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH = 25;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface PendingReminder {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly body: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
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
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
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
  if (channelRaw !== 'email' && channelRaw !== 'sms' && channelRaw !== 'slack') {
    return null;
  }
  const payload =
    r.payload && typeof r.payload === 'object'
      ? (r.payload as Record<string, unknown>)
      : {};
  return { id, tenantId, ownerId, title, body, channel: channelRaw, payload, idempotencyKey };
}

export function createRemindersDispatchWorker(
  options: RemindersDispatchOptions,
): RemindersDispatchHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let bootWarned = false;

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
      const res = await options.db.execute(sql`
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
         RETURNING id, tenant_id, owner_id, title, body, channel, payload, idempotency_key
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
      await options.db.execute(sql`
        UPDATE reminders
           SET status = 'sent',
               dispatched_at = ${now()},
               dispatch_error = NULL
         WHERE id = ${r.id}
           AND tenant_id = ${r.tenantId}
           AND dispatched_at IS NULL
      `);
    } catch (err) {
      options.logger.warn(
        { worker: 'reminders-dispatch', reminderId: r.id, err: err instanceof Error ? err.message : String(err) },
        'reminders-dispatch: markSent failed',
      );
    }
  }

  async function markFailed(r: PendingReminder, errorMessage: string): Promise<void> {
    try {
      await options.db.execute(sql`
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

  async function dispatchOne(r: PendingReminder): Promise<{ sent: boolean }> {
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
        await markFailed(r, 'no_email_address_for_owner');
        return { sent: false };
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
          return { sent: true };
        }
        await markFailed(r, `${result.errorCode}: ${result.errorMessage}`);
        return { sent: false };
      } catch (err) {
        await markFailed(r, err instanceof Error ? err.message : String(err));
        return { sent: false };
      }
    }

    if (r.channel === 'sms') {
      const phone = options.phoneForOwner
        ? await options.phoneForOwner(r.tenantId, r.ownerId).catch(() => null)
        : null;
      if (!phone) {
        await markFailed(r, 'no_phone_number_for_owner');
        return { sent: false };
      }
      try {
        const result = await options.smsProvider.send({
          tenantId: r.tenantId,
          recipientAddress: phone,
          templateKey: 'owner.reminder.generic',
          locale: 'en',
          payload: { title: r.title, body: r.body, ...r.payload },
          idempotencyKey: r.idempotencyKey,
          channel: 'sms',
        });
        if (result.status === 'sent') {
          await markSent(r);
          return { sent: true };
        }
        await markFailed(r, `${result.errorCode}: ${result.errorMessage}`);
        return { sent: false };
      } catch (err) {
        await markFailed(r, err instanceof Error ? err.message : String(err));
        return { sent: false };
      }
    }

    // slack
    const webhook =
      options.slackWebhookForTenant?.(r.tenantId) ??
      process.env.SLACK_WEBHOOK_URL?.trim() ??
      null;
    if (!webhook) {
      await markFailed(r, 'slack_webhook_not_configured');
      return { sent: false };
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
        await markFailed(r, `slack_${res.status}: ${text.slice(0, 200)}`);
        return { sent: false };
      }
      await markSent(r);
      return { sent: true };
    } catch (err) {
      await markFailed(r, err instanceof Error ? err.message : String(err));
      return { sent: false };
    }
  }

  async function tickOnce(): Promise<DispatchTickResult> {
    warnBootOnce();
    const claimed = await claim();
    let sent = 0;
    let failed = 0;
    for (const r of claimed) {
      const res = await dispatchOne(r);
      if (res.sent) sent += 1;
      else failed += 1;
    }
    if (claimed.length > 0) {
      options.logger.info(
        { worker: 'reminders-dispatch', claimed: claimed.length, sent, failed },
        'reminders-dispatch: tick done',
      );
    }
    return { claimed: claimed.length, sent, failed };
  }

  function start(): void {
    if (!enabled) {
      options.logger.info({ worker: 'reminders-dispatch' }, 'reminders-dispatch: disabled by config');
      return;
    }
    if (timer) return;
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

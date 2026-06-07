/**
 * Announcement Fan-out Worker — broadcast email/SMS delivery for operator
 * ANNOUNCEMENTS.
 *
 * Closes the gap documented in the header of
 * `services/api-gateway/src/composition/notification-dispatcher-adapter.ts`:
 * the dispatcher adapter publishes announcements onto the cross-portal bus
 * (SSE / in-app banner) but EXPLICITLY does NOT insert the per-recipient
 * `notification_dispatch_log` rows that actually trigger email/SMS. That
 * per-recipient expansion was deferred to "a future broadcast-fanout worker".
 * This is that worker.
 *
 * Pipeline per tick:
 *   1. CLAIM — atomically stamp `platform_announcements.fanned_out_at = now()`
 *      for due announcements whose `channel` includes email/SMS and that are
 *      not yet fanned out (`fanned_out_at IS NULL`). The UPDATE ... RETURNING
 *      under SKIP LOCKED guarantees a second tick / replica cannot re-expand
 *      the same announcement row.
 *   2. RESOLVE — for each claimed announcement, resolve the eligible
 *      recipients (active tenant users carrying a usable address) via the
 *      injected `resolveRecipients` port. `scope='global'` fans across every
 *      active tenant; `scope='tenant:<id>'` is scoped to that tenant.
 *   3. ENQUEUE — INSERT one `pending` `notification_dispatch_log` row per
 *      (recipient, channel) with `ON CONFLICT (tenant_id, idempotency_key) DO
 *      NOTHING`. The idempotency key is
 *      `announcement::<announcementId>::<userId>::<channel>`. The existing
 *      `dispatcher-worker.ts` drains those rows (retry + backoff + DLQ).
 *
 * This worker ONLY enqueues. It never sends — delivery is owned by
 * `services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts`.
 *
 * Channel mapping (announcement channel → dispatch-log channels):
 *   - `email` → one `email` row per recipient with a usable email.
 *   - `both`  → `email` AND (when the recipient has a phone) `sms`. A
 *               recipient whose `owner_contact_prefs.preferredChannel = 'sms'`
 *               still gets both rows under `both`; preference only decides the
 *               SINGLE channel when the announcement itself is channel-agnostic
 *               — which announcements never are (they are 'email' or 'both').
 *   - `banner` → NOT claimed (SSE/in-app only; nothing to email/SMS).
 *
 * Idempotency:
 *   - Per-announcement: `fanned_out_at` claim marker (migration 0304).
 *   - Per-row: UNIQUE (tenant_id, idempotency_key) on notification_dispatch_log
 *     + ON CONFLICT DO NOTHING. Belt-and-braces: even a crash between claim and
 *     the inserts cannot double-enqueue a (recipient, channel).
 *
 * Lifecycle (mirrors reminders-dispatch.worker.ts):
 *   - `start()` arms an interval (default 60s — tunable via env at the wiring
 *     site). `tickOnce()` is exposed for tests. `stop()` clears the timer.
 *   - Disabled transparently when no DB is wired (the composition root passes a
 *     no-op handle).
 *
 * Failure containment:
 *   - Per-announcement failures are isolated; the loop continues.
 *   - All errors logged via Pino (no raw console statements in services).
 *   - Heartbeat via the worker-heartbeat helper (G6 deep-health probe).
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH = 25;
const WORKER_NAME = 'announcement-fanout';

/** Channels a dispatch-log row can carry (the dispatcher-worker handles these). */
type DispatchChannel = 'email' | 'sms';

/** Minimal DB port — accepts a Drizzle client or a postgres.js sql tag. */
interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/** Announcement scope: `global` (all active tenants) or `tenant:<id>`. */
type AnnouncementScope = 'global' | `tenant:${string}`;

/** Announcement channels stored on `platform_announcements`. */
type AnnouncementChannel = 'banner' | 'email' | 'both';

/** A recipient eligible for a broadcast, resolved by the injected port. */
export interface BroadcastRecipient {
  /** Owning tenant of the recipient (the dispatch-log row's tenant_id). */
  readonly tenantId: string;
  /** User id — half of the per-recipient idempotency key. */
  readonly userId: string;
  /** Usable email address, or null when the user has none. */
  readonly email: string | null;
  /** E.164 phone, or null when the user has none. */
  readonly phone: string | null;
  /** Preferred dispatch channel from owner_contact_prefs; 'email' default. */
  readonly preferredChannel: DispatchChannel;
  /** Dispatch + render locale ('en' default). */
  readonly locale: string;
}

/**
 * Resolves the eligible recipients for an announcement scope. Composition
 * wires a Drizzle-backed resolver (active users + owner_contact_prefs); tests
 * inject a constant. MUST NOT throw — return [] on failure so one bad scope
 * cannot wedge the tick.
 */
export interface RecipientResolverPort {
  resolve(args: {
    readonly scope: AnnouncementScope;
  }): Promise<readonly BroadcastRecipient[]>;
}

export interface AnnouncementFanoutOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly resolveRecipients: RecipientResolverPort;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface AnnouncementFanoutHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<FanoutTickResult>;
}

export interface FanoutTickResult {
  /** Announcements claimed for fan-out this tick. */
  readonly claimed: number;
  /** Distinct (recipient, channel) dispatch-log rows enqueued. */
  readonly enqueued: number;
  /** Announcements claimed but with zero eligible recipients. */
  readonly skippedNoRecipients: number;
}

/** A claimed announcement row, after validation. */
interface ClaimedAnnouncement {
  readonly id: string;
  readonly scope: AnnouncementScope;
  readonly channel: AnnouncementChannel;
  readonly subject: string;
  readonly body: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const scopeSchema = z
  .string()
  .refine(
    (s): s is AnnouncementScope => s === 'global' || s.startsWith('tenant:'),
    { message: 'scope must be "global" or "tenant:<id>"' },
  );

const announcementRowSchema = z.object({
  id: z.string().min(1),
  scope: scopeSchema,
  // Only email/both reach here (the claim query filters), but validate anyway.
  channel: z.enum(['email', 'both']),
  subject: z.string(),
  body: z.string(),
});

const recipientSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().trim().min(1).nullable(),
  phone: z.string().trim().min(1).nullable(),
  preferredChannel: z.enum(['email', 'sms']),
  locale: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

/**
 * Per-recipient idempotency key. Shape:
 *   `announcement::<announcementId>::<userId>::<channel>`
 * Keyed by user (not address) so an address change never re-sends, and per
 * channel so `both` enqueues an email AND an sms row without colliding.
 */
export function buildIdempotencyKey(
  announcementId: string,
  userId: string,
  channel: DispatchChannel,
): string {
  return `announcement::${announcementId}::${userId}::${channel}`;
}

/**
 * Decide which dispatch channels a recipient should receive for a given
 * announcement channel. `email` → ['email'] when an email exists. `both` →
 * email (if email) + sms (if phone). A recipient with no usable address for
 * any required channel yields []. Pure.
 */
export function channelsForRecipient(
  announcementChannel: AnnouncementChannel,
  recipient: BroadcastRecipient,
): readonly DispatchChannel[] {
  const out: DispatchChannel[] = [];
  const wantsEmail = announcementChannel === 'email' || announcementChannel === 'both';
  const wantsSms = announcementChannel === 'both';
  if (wantsEmail && recipient.email) out.push('email');
  if (wantsSms && recipient.phone) out.push('sms');
  return out;
}

/** Resolve the recipient address for a dispatch channel. */
function addressFor(
  recipient: BroadcastRecipient,
  channel: DispatchChannel,
): string | null {
  return channel === 'email' ? recipient.email : recipient.phone;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAnnouncementFanoutWorker(
  options: AnnouncementFanoutOptions,
): AnnouncementFanoutHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // ---- claim ---------------------------------------------------------------

  async function claim(): Promise<readonly ClaimedAnnouncement[]> {
    const ts = now();
    try {
      // Atomic claim: stamp fanned_out_at so a second worker / restart cannot
      // re-expand the same announcement. Only email/both, due, not-yet-fanned.
      const res = await options.db.execute(sql`
        UPDATE platform_announcements
           SET fanned_out_at = ${ts}
         WHERE id IN (
           SELECT id FROM platform_announcements
            WHERE fanned_out_at IS NULL
              AND channel IN ('email', 'both')
              AND status IN ('queued', 'sending', 'sent')
              AND scheduled_for <= ${ts}
            ORDER BY scheduled_for ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
         )
         RETURNING id, scope, channel, subject, body
      `);
      return toClaimedAnnouncements(asRows(res));
    } catch (err) {
      options.logger.warn(
        { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
        'announcement-fanout: claim failed',
      );
      return [];
    }
  }

  function toClaimedAnnouncements(
    rows: readonly Record<string, unknown>[],
  ): readonly ClaimedAnnouncement[] {
    const out: ClaimedAnnouncement[] = [];
    for (const row of rows) {
      const parsed = announcementRowSchema.safeParse({
        id: row.id,
        scope: row.scope,
        channel: row.channel,
        subject: row.subject,
        body: row.body,
      });
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  // ---- enqueue -------------------------------------------------------------

  async function enqueueRow(args: {
    readonly announcement: ClaimedAnnouncement;
    readonly recipient: BroadcastRecipient;
    readonly channel: DispatchChannel;
    readonly address: string;
  }): Promise<boolean> {
    const { announcement, recipient, channel, address } = args;
    const id = `ndl_${randomUUID()}`;
    const idempotencyKey = buildIdempotencyKey(
      announcement.id,
      recipient.userId,
      channel,
    );
    const payload = JSON.stringify({
      announcementId: announcement.id,
      scope: announcement.scope,
      subject: announcement.subject,
      body: announcement.body,
    });
    try {
      await options.db.execute(sql`
        INSERT INTO notification_dispatch_log (
          id, tenant_id, user_id, channel, recipient_address,
          template_key, locale, payload, correlation_id, idempotency_key,
          attempt_count, delivery_status, created_at, updated_at
        ) VALUES (
          ${id}, ${recipient.tenantId}, ${recipient.userId}, ${channel}, ${address},
          ${'platform.announcement.broadcast'}, ${recipient.locale}, ${payload}::jsonb,
          ${`announcement-${announcement.id}`}, ${idempotencyKey},
          0, 'pending', NOW(), NOW()
        )
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      `);
      return true;
    } catch (err) {
      options.logger.warn(
        {
          worker: WORKER_NAME,
          announcementId: announcement.id,
          tenantId: recipient.tenantId,
          channel,
          err: err instanceof Error ? err.message : String(err),
        },
        'announcement-fanout: enqueue failed',
      );
      return false;
    }
  }

  // ---- per-announcement fan-out --------------------------------------------

  async function fanOutOne(
    announcement: ClaimedAnnouncement,
  ): Promise<{ enqueued: number; hadRecipients: boolean }> {
    const recipients = await resolveRecipientsSafe(announcement.scope);
    if (recipients.length === 0) {
      return { enqueued: 0, hadRecipients: false };
    }
    let enqueued = 0;
    for (const recipient of recipients) {
      const channels = channelsForRecipient(announcement.channel, recipient);
      for (const channel of channels) {
        const address = addressFor(recipient, channel);
        if (!address) continue;
        const ok = await enqueueRow({ announcement, recipient, channel, address });
        if (ok) enqueued += 1;
      }
    }
    return { enqueued, hadRecipients: true };
  }

  async function resolveRecipientsSafe(
    scope: AnnouncementScope,
  ): Promise<readonly BroadcastRecipient[]> {
    try {
      const raw = await options.resolveRecipients.resolve({ scope });
      const valid: BroadcastRecipient[] = [];
      for (const r of raw) {
        const parsed = recipientSchema.safeParse(r);
        // Drop recipients with no usable address at all — nothing to enqueue.
        if (parsed.success && (parsed.data.email || parsed.data.phone)) {
          valid.push(parsed.data);
        }
      }
      return valid;
    } catch (err) {
      options.logger.warn(
        { worker: WORKER_NAME, scope, err: err instanceof Error ? err.message : String(err) },
        'announcement-fanout: recipient resolution failed',
      );
      return [];
    }
  }

  // ---- tick ----------------------------------------------------------------

  async function tickOnce(): Promise<FanoutTickResult> {
    try {
      const claimed = await claim();
      let enqueued = 0;
      let skippedNoRecipients = 0;
      for (const announcement of claimed) {
        const result = await fanOutOne(announcement);
        enqueued += result.enqueued;
        if (!result.hadRecipients) skippedNoRecipients += 1;
      }
      if (claimed.length > 0) {
        options.logger.info(
          { worker: WORKER_NAME, claimed: claimed.length, enqueued, skippedNoRecipients },
          'announcement-fanout: tick done',
        );
      }
      workerHeartbeat(WORKER_NAME);
      return { claimed: claimed.length, enqueued, skippedNoRecipients };
    } catch (err) {
      workerHeartbeatFailure(WORKER_NAME, err);
      throw err;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info({ worker: WORKER_NAME }, 'announcement-fanout: disabled by config');
      return;
    }
    if (timer) return;
    registerWorker({ name: WORKER_NAME, intervalMs });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
          'announcement-fanout: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info({ worker: WORKER_NAME, intervalMs }, 'announcement-fanout: started');
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}

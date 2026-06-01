/**
 * Calendar Sync Worker — Wave CALENDAR-SYNC.
 *
 * Sibling of the reminders-dispatch worker, but for the `calendar` channel.
 * Polls the `reminders` table for rows where `channel = 'calendar'` whose
 * `trigger_at <= now()` and upserts a native calendar EVENT in the owner's
 * linked Google / Microsoft calendar — idempotently on the reminder id, so a
 * retry patches the same event instead of creating a duplicate.
 *
 * Why a SEPARATE worker (not the reminders-dispatch worker)?
 * ----------------------------------------------------------
 * The reminders-dispatch worker only knows email / SMS / Slack — its
 * `rowToReminder` drops any other channel. It also has no calendar dependency.
 * Keeping calendar in its own worker means the orchestrator mounts it via
 * `createCalendarWiring()` WITHOUT editing the dispatch worker or index.ts
 * money/notification wiring. To stay robust regardless of mount order, this
 * worker also RECOVERS calendar rows the dispatch worker may have flipped to
 * `'sending'` before discarding them (it claims status IN ('scheduled',
 * 'sending') for channel='calendar').
 *
 * Lifecycle mirrors reminders-dispatch: start()/stop()/tickOnce(), 60s default
 * interval, per-row failure isolation, Pino only (no console).
 *
 * Idempotency: the calendar provider upserts on a deterministic id derived from
 * the reminder id, so re-dispatch never duplicates. The final UPDATE also gates
 * on `dispatched_at IS NULL` so a double-claim cannot double-mark.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { CalendarDelivery } from '../services/notification-dispatch/calendar-providers';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH = 25;
/** Default event duration when a reminder carries no explicit end. */
const DEFAULT_EVENT_MINUTES = 30;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface PendingCalendarItem {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly body: string;
  readonly triggerAt: string;
  readonly payload: Record<string, unknown>;
}

export interface CalendarSyncOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly delivery: CalendarDelivery;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface CalendarSyncHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<CalendarSyncTickResult>;
}

export interface CalendarSyncTickResult {
  readonly claimed: number;
  readonly synced: number;
  readonly skipped: number;
  readonly failed: number;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

function rowToItem(r: Record<string, unknown>): PendingCalendarItem | null {
  const id = typeof r.id === 'string' ? r.id : null;
  const tenantId = typeof r.tenant_id === 'string' ? r.tenant_id : null;
  const ownerId = typeof r.owner_id === 'string' ? r.owner_id : null;
  const title = typeof r.title === 'string' ? r.title : null;
  const body = typeof r.body === 'string' ? r.body : '';
  const triggerAt = toIso(r.trigger_at);
  if (!id || !tenantId || !ownerId || !title || !triggerAt) {
    return null;
  }
  const payload =
    r.payload && typeof r.payload === 'object'
      ? (r.payload as Record<string, unknown>)
      : {};
  return { id, tenantId, ownerId, title, body, triggerAt, payload };
}

export function createCalendarSyncWorker(
  options: CalendarSyncOptions,
): CalendarSyncHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function claim(): Promise<readonly PendingCalendarItem[]> {
    const ts = now();
    try {
      // Atomic claim: flip ready calendar rows to 'sending'. Recover any rows
      // the email dispatch worker left in 'sending' (it discards calendar rows
      // after claiming them) by including that status for channel='calendar'.
      const res = await options.db.execute(sql`
        UPDATE reminders
           SET status = 'sending'
         WHERE id IN (
           SELECT id FROM reminders
            WHERE channel = 'calendar'
              AND status IN ('scheduled', 'sending')
              AND trigger_at <= ${ts}
            ORDER BY trigger_at ASC
            LIMIT ${DEFAULT_BATCH}
            FOR UPDATE SKIP LOCKED
         )
         RETURNING id, tenant_id, owner_id, title, body, trigger_at, payload
      `);
      const out: PendingCalendarItem[] = [];
      for (const row of asRows(res)) {
        const item = rowToItem(row);
        if (item) out.push(item);
      }
      return out;
    } catch (err) {
      options.logger.warn(
        {
          worker: 'calendar-sync',
          err: err instanceof Error ? err.message : String(err),
        },
        'calendar-sync: claim failed',
      );
      return [];
    }
  }

  async function markSent(item: PendingCalendarItem): Promise<void> {
    try {
      await options.db.execute(sql`
        UPDATE reminders
           SET status = 'sent',
               dispatched_at = ${now()},
               dispatch_error = NULL
         WHERE id = ${item.id}
           AND tenant_id = ${item.tenantId}
           AND dispatched_at IS NULL
      `);
    } catch (err) {
      options.logger.warn(
        {
          worker: 'calendar-sync',
          reminderId: item.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'calendar-sync: markSent failed',
      );
    }
  }

  async function markFailed(
    item: PendingCalendarItem,
    errorMessage: string,
  ): Promise<void> {
    try {
      await options.db.execute(sql`
        UPDATE reminders
           SET status = 'failed',
               dispatched_at = ${now()},
               dispatch_error = ${errorMessage.slice(0, 4000)}
         WHERE id = ${item.id}
           AND tenant_id = ${item.tenantId}
      `);
    } catch (err) {
      options.logger.warn(
        {
          worker: 'calendar-sync',
          reminderId: item.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'calendar-sync: markFailed failed',
      );
    }
  }

  /**
   * Re-queue a calendar row to 'scheduled' (NOT 'failed') when delivery failed
   * RETRYABLY — e.g. a transient provider 5xx or a token refresh hiccup. This
   * lets the next tick try again instead of stranding the row.
   */
  async function requeue(item: PendingCalendarItem): Promise<void> {
    try {
      await options.db.execute(sql`
        UPDATE reminders
           SET status = 'scheduled'
         WHERE id = ${item.id}
           AND tenant_id = ${item.tenantId}
           AND dispatched_at IS NULL
      `);
    } catch (err) {
      options.logger.warn(
        {
          worker: 'calendar-sync',
          reminderId: item.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'calendar-sync: requeue failed',
      );
    }
  }

  async function bindTenant(tenantId: string): Promise<void> {
    // Bind the RLS GUC for the connection-store reads/writes this delivery
    // triggers. Session-scoped (false) like the request middleware; the worker
    // re-binds before every row so there is no stale-context window.
    await options.db.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`,
    );
  }

  function endIsoFor(item: PendingCalendarItem): string {
    const explicit =
      typeof item.payload.endAt === 'string' ? item.payload.endAt : null;
    if (explicit && Number.isFinite(Date.parse(explicit))) {
      return new Date(Date.parse(explicit)).toISOString();
    }
    const start = Date.parse(item.triggerAt);
    return new Date(start + DEFAULT_EVENT_MINUTES * 60 * 1000).toISOString();
  }

  function timeZoneFor(item: PendingCalendarItem): string | undefined {
    return typeof item.payload.timeZone === 'string'
      ? item.payload.timeZone
      : undefined;
  }

  async function syncOne(
    item: PendingCalendarItem,
  ): Promise<'synced' | 'skipped' | 'failed'> {
    try {
      await bindTenant(item.tenantId);
    } catch (err) {
      await markFailed(
        item,
        `rls_bind_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }

    const tz = timeZoneFor(item);
    const outcome = await options.delivery.deliver(item.tenantId, item.ownerId, {
      sourceId: item.id,
      summary: item.title,
      description: item.body,
      startIso: item.triggerAt,
      endIso: endIsoFor(item),
      ...(tz ? { timeZone: tz } : {}),
    });

    if (outcome.status === 'delivered') {
      await markSent(item);
      return 'synced';
    }
    if (outcome.status === 'no_connection') {
      // The owner has not linked a calendar — terminal for this row. Mark
      // failed with a clear, actionable code (NOT retryable).
      await markFailed(item, 'no_calendar_connection_for_owner');
      return 'skipped';
    }
    // failed
    if (outcome.retryable) {
      await requeue(item);
    } else {
      await markFailed(item, `${outcome.errorCode}: ${outcome.errorMessage}`);
    }
    return 'failed';
  }

  async function tickOnce(): Promise<CalendarSyncTickResult> {
    try {
      const claimed = await claim();
      let synced = 0;
      let skipped = 0;
      let failed = 0;
      for (const item of claimed) {
        const result = await syncOne(item);
        if (result === 'synced') synced += 1;
        else if (result === 'skipped') skipped += 1;
        else failed += 1;
      }
      if (claimed.length > 0) {
        options.logger.info(
          { worker: 'calendar-sync', claimed: claimed.length, synced, skipped, failed },
          'calendar-sync: tick done',
        );
      }
      workerHeartbeat('calendar-sync');
      return { claimed: claimed.length, synced, skipped, failed };
    } catch (err) {
      workerHeartbeatFailure('calendar-sync', err);
      throw err;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info(
        { worker: 'calendar-sync' },
        'calendar-sync: disabled by config',
      );
      return;
    }
    if (timer) return;
    registerWorker({ name: 'calendar-sync', intervalMs });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          {
            worker: 'calendar-sync',
            err: err instanceof Error ? err.message : String(err),
          },
          'calendar-sync: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info(
      { worker: 'calendar-sync', intervalMs },
      'calendar-sync: started',
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

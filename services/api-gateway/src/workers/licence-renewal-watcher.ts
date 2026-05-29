/**
 * Licence renewal watcher — issue #194 chain C-B.
 *
 * Companion to `ica-cert-expiry-cron.ts` but specific to mining
 * `licences` (PL / PML / ML / SML / DEALER / BROKER / PROCESSING /
 * SMELTING / REFINING). Ticks every 6h; for every licence whose
 * `expiry_date` falls inside the 90-day horizon AND `status='active'`,
 * the watcher:
 *
 *   1. Computes the days-until-expiry.
 *   2. If the value crosses a reminder threshold from
 *      `RENEWAL_REMINDER_OFFSETS_DAYS = [90, 60, 30, 14, 7, 1]` and
 *      no `licence_events.kind='renewal_due'` row for that licence is
 *      still open, it inserts one with `status='open'` so the owner
 *      cockpit pulses + Mr. Mwikila can offer to start a draft.
 *   3. Emits `licence.renewal_status_changed` for every reminder
 *      threshold crossed (so the cockpit shows the urgency change).
 *
 * Failure containment:
 *   - DB unwired → no-op + warn once.
 *   - Per-licence errors isolated.
 *   - Pino only — no console.log.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';
import { publishCockpitEvent } from '../services/cockpit-events/bus';
import { RENEWAL_REMINDER_OFFSETS_DAYS } from '../services/regulator/licence-renewal-service';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = SIX_HOURS_MS;
const SCAN_HORIZON_DAYS = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface LicenceRenewalWatcherOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface LicenceRenewalWatcherHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<TickResult>;
}

export interface TickResult {
  readonly scanned: number;
  readonly remindersOpened: number;
  readonly dedupSkipped: number;
  readonly failed: number;
}

interface ExpiringLicence {
  readonly id: string;
  readonly tenantId: string;
  readonly number: string;
  readonly kind: string;
  readonly expiryDate: Date;
}

function rowsOf(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function parseExpiringLicence(
  row: Record<string, unknown>,
): ExpiringLicence | null {
  const id = typeof row.id === 'string' ? row.id : null;
  const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null;
  const number = typeof row.number === 'string' ? row.number : null;
  const kind = typeof row.kind === 'string' ? row.kind : null;
  if (!id || !tenantId || !number || !kind) return null;
  const rawExpiry = row.expiry_date;
  const expiryDate =
    rawExpiry instanceof Date
      ? rawExpiry
      : typeof rawExpiry === 'string'
        ? new Date(rawExpiry)
        : null;
  if (!expiryDate || Number.isNaN(expiryDate.getTime())) return null;
  return { id, tenantId, number, kind, expiryDate };
}

function daysBetween(future: Date, now: Date): number {
  return Math.ceil((future.getTime() - now.getTime()) / ONE_DAY_MS);
}

function crossedThreshold(days: number): number | null {
  // Pick the SMALLEST band that still contains the days-remaining
  // value — that's the most useful rung to emit because the more
  // urgent (smaller) rungs always supersede the larger ones.
  if (days <= 0) return RENEWAL_REMINDER_OFFSETS_DAYS[0] ?? null;
  let best: number | null = null;
  for (const offset of RENEWAL_REMINDER_OFFSETS_DAYS) {
    if (days <= offset) {
      if (best == null || offset < best) best = offset;
    }
  }
  return best;
}

async function fetchExpiringLicences(
  db: DbLike,
  now: Date,
  logger: Logger,
): Promise<readonly ExpiringLicence[]> {
  const horizon = new Date(now.getTime() + SCAN_HORIZON_DAYS * ONE_DAY_MS);
  try {
    const res = await db.execute(
      sql`
        SELECT id, tenant_id, "number", kind, expiry_date
          FROM licences
         WHERE status = 'active'
           AND expiry_date IS NOT NULL
           AND expiry_date <= ${horizon.toISOString()}::timestamptz
           AND expiry_date >  ${now.toISOString()}::timestamptz
         ORDER BY expiry_date ASC
         LIMIT 500
      `,
    );
    const out: ExpiringLicence[] = [];
    for (const r of rowsOf(res)) {
      const parsed = parseExpiringLicence(r);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch (err) {
    logger.warn(
      {
        worker: 'licence-renewal-watcher',
        err: err instanceof Error ? err.message : String(err),
      },
      'licence-renewal-watcher: fetchExpiringLicences failed',
    );
    return [];
  }
}

async function openReminderEvent(
  db: DbLike,
  args: {
    readonly licence: ExpiringLicence;
    readonly daysBefore: number;
    readonly now: Date;
    readonly logger: Logger;
  },
): Promise<'opened' | 'dedup' | 'failed'> {
  const { licence, daysBefore, now, logger } = args;
  const eventId = `le_${randomUUID()}`;
  // Idempotency: at most one OPEN renewal_due event per (tenant, licence,
  // daysBefore). We encode `daysBefore` into payload->>'reminderOffset'
  // and dedup with NOT EXISTS.
  try {
    const claim = await db.execute(
      sql`
        INSERT INTO licence_events
          (id, tenant_id, licence_id, kind, summary, due_date, status,
           payload, evidence_ids, created_at)
        SELECT
          ${eventId},
          ${licence.tenantId},
          ${licence.id},
          'renewal_due',
          ${`Auto-opened: ${daysBefore}d reminder for ${licence.number}`},
          ${licence.expiryDate.toISOString().slice(0, 10)}::date,
          'open',
          ${JSON.stringify({ reminderOffset: daysBefore, source: 'licence-renewal-watcher' })}::jsonb,
          ARRAY[]::text[],
          ${now.toISOString()}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM licence_events
           WHERE tenant_id  = ${licence.tenantId}
             AND licence_id = ${licence.id}
             AND kind = 'renewal_due'
             AND status IN ('open', 'in_progress')
             AND (payload->>'reminderOffset')::int = ${daysBefore}
        )
        RETURNING id
      `,
    );
    const opened = rowsOf(claim).length > 0;
    if (!opened) return 'dedup';

    publishCockpitEvent({
      kind: 'licence.renewal_status_changed',
      tenantId: licence.tenantId,
      emittedAt: now.toISOString(),
      licenceId: licence.id,
      licenceEventId: eventId,
      fromStatus: 'active',
      toStatus: 'reminder',
      daysUntilExpiry: daysBefore,
    });

    return 'opened';
  } catch (err) {
    logger.warn(
      {
        worker: 'licence-renewal-watcher',
        licenceId: licence.id,
        daysBefore,
        err: err instanceof Error ? err.message : String(err),
      },
      'licence-renewal-watcher: openReminderEvent failed',
    );
    return 'failed';
  }
}

export function startLicenceRenewalWatcher(
  options: LicenceRenewalWatcherOptions,
): LicenceRenewalWatcherHandle {
  const {
    db,
    logger,
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
  } = options;
  const now = options.now ?? (() => new Date());

  let timer: NodeJS.Timeout | null = null;

  const tickOnce = async (): Promise<TickResult> => {
    if (!enabled) {
      return { scanned: 0, remindersOpened: 0, dedupSkipped: 0, failed: 0 };
    }
    const tNow = now();
    const licences = await fetchExpiringLicences(db, tNow, logger);
    let opened = 0;
    let dedup = 0;
    let failed = 0;
    for (const licence of licences) {
      const days = daysBetween(licence.expiryDate, tNow);
      const threshold = crossedThreshold(days);
      if (threshold == null) continue;
      const outcome = await openReminderEvent(db, {
        licence,
        daysBefore: threshold,
        now: tNow,
        logger,
      });
      if (outcome === 'opened') opened += 1;
      else if (outcome === 'dedup') dedup += 1;
      else failed += 1;
    }
    if (failed > 0) {
      workerHeartbeatFailure(
        'licence-renewal-watcher',
        new Error(`${failed} licence reminder insertions failed`),
      );
    } else {
      workerHeartbeat('licence-renewal-watcher');
    }
    return {
      scanned: licences.length,
      remindersOpened: opened,
      dedupSkipped: dedup,
      failed,
    };
  };

  registerWorker({ name: 'licence-renewal-watcher', intervalMs });

  return {
    start(): void {
      if (timer || !enabled) return;
      // Fire one tick on boot so reminders surface fast in dev.
      void tickOnce().catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'licence-renewal-watcher: initial tick failed',
        );
      });
      timer = setInterval(() => {
        void tickOnce().catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'licence-renewal-watcher: scheduled tick failed',
          );
        });
      }, intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}

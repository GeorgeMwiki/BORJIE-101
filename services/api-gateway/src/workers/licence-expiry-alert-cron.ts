/**
 * Licence Expiry Alert Cron — mining-domain detection leg (Slice A3).
 *
 * Daily multi-tenant scanner. Finds mining `licences` whose `expiry_date`
 * lands inside one of the configured warning windows (60, 30, 7, 1 days from
 * now) and ENQUEUES one `pending` row into `notification_dispatch_log` per
 * (licence, window). The healthy dispatcher worker
 * (services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts)
 * then drains those rows to the real channel provider — this cron is the
 * DETECTION input it was previously starved of.
 *
 * Why this exists: the prior BossNyumba `lease-expiry-alert-cron` scanned
 * `leases` + `customers`, both excised in the mining hard-fork, so the start
 * site was hard-wired to a no-op and owners got ZERO proactive expiry alerts.
 * This worker is modeled on that cron (windowing + idempotency_key dedupe +
 * the shared 14-column INSERT shape) but scans the mining `licences` table.
 *
 * Design notes:
 *   - `notification_dispatch_log.idempotency_key` is the dedupe ledger. The
 *     key shape is deterministic — `buildIdempotencyKey`. The table's UNIQUE
 *     INDEX (tenant_id, idempotency_key) guarantees we never double-enqueue a
 *     (licence, window) alert even across restarts / two pods racing a tick.
 *     INSERT uses ON CONFLICT (tenant_id, idempotency_key) DO NOTHING.
 *   - Channel = `email` (safe default per Slice A3). Recipient resolved from
 *     the licence holder (`users.email`), falling back to the tenant's
 *     `primary_email` so an alert is never silently dropped.
 *   - Every DB statement runs inside `withServiceRoleContext` (CLAUDE.md hard
 *     rule): `notification_dispatch_log` has FORCE RLS, so without the bound
 *     `app.is_service_role` GUC the INSERT/SELECT would match ZERO rows. We
 *     re-attach `tenantId` on every log row so downstream RLS reads are clean.
 *   - Lifecycle mirrors `lease-expiry-alert-cron.ts` — `start()` schedules a
 *     daily tick, `stop()` clears the timer. Both are idempotent.
 *
 * Env knobs:
 *   - LICENCE_EXPIRY_ALERT_INTERVAL_MS    override the 24h cadence (tests)
 *   - LICENCE_EXPIRY_ALERT_DISABLED=true  inert in this process (k8s CronJob
 *                                         takes over instead)
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { withServiceRoleContext } from '@borjie/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Expiry windows (in days) at which an alert fires. */
export const DEFAULT_LICENCE_EXPIRY_WINDOWS_DAYS = [60, 30, 7, 1] as const;
export type LicenceExpiryWindowDays =
  | (typeof DEFAULT_LICENCE_EXPIRY_WINDOWS_DAYS)[number]
  | number;

/** Channel for licence-expiry alerts — email is the safe default (Slice A3). */
export const LICENCE_EXPIRY_CHANNEL = 'email' as const;

/** Template the dispatcher renders for licence-expiry alerts. */
export const LICENCE_EXPIRY_TEMPLATE_KEY = 'licence.expiry_warning' as const;

/** A mining licence that's eligible for an expiry-window alert. */
export interface ExpiringLicenceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly kind: string;
  readonly number: string;
  readonly mineral: string;
  readonly status: string;
  readonly expiryDate: Date;
  readonly holderUserId: string | null;
  /** Resolved owner recipient — holder email, falling back to tenant email. */
  readonly recipientEmail: string | null;
  readonly windowDays: number;
}

/** DB execute shim — accepts either a Drizzle client or a postgres.js sql tag. */
export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * The db the cron binds. Must satisfy BOTH the lightweight `execute` shim used
 * by the scan/insert helpers AND the `withServiceRoleContext` signature.
 */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

export interface LicenceExpiryAlertCronOptions {
  readonly db: ServiceRoleDb;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly windowsDays?: readonly number[];
  /** Used in tests to make tick() deterministic. */
  readonly now?: () => Date;
}

export interface LicenceExpiryAlertCronHandle {
  start(): void;
  stop(): void;
  /** Drive a single tick synchronously — exposed for tests + ops. */
  tickOnce(): Promise<LicenceTickResult>;
}

export interface LicenceTickResult {
  readonly scanned: number;
  readonly enqueued: number;
  readonly skippedAlreadySent: number;
  readonly failed: number;
  readonly byWindow: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Stable idempotency key for a (licence, window, expiry) alert.
 *
 *   key = `licence-expiry::${licenceId}::${window}d::${YYYY-MM-DD}`
 *
 * The expiry date is part of the key so a single expiry fires each window
 * exactly once, BUT a RENEWAL — same licence id with a NEW expiry_date — mints
 * a fresh key and correctly re-alerts on the next cycle (without it, a renewed
 * licence's expiry alerts would be silently suppressed forever — a missed
 * compliance alert). ON CONFLICT (tenant_id, idempotency_key) still dedupes a
 * given (licence, window, expiry) across restarts / racing pods.
 */
export function buildIdempotencyKey(
  licenceId: string,
  windowDays: number,
  expiryDate: Date,
): string {
  const day = expiryDate.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `licence-expiry::${licenceId}::${windowDays}d::${day}`;
}

/**
 * Match an `expiryDate` against the configured windows. A licence matches a
 * window if the calendar-day diff (now → expiryDate) rounds to that window
 * exactly. We bucket by 00:00 UTC, so the function is deterministic
 * regardless of when within the tick day the cron actually runs.
 *
 * Returns the matching window (in days) or `null` if no match.
 */
export function classifyExpiryWindow(
  expiryDate: Date,
  now: Date,
  windows: readonly number[],
): number | null {
  const startOfDay = (d: Date): number =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const ms = startOfDay(expiryDate) - startOfDay(now);
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return windows.includes(days) ? days : null;
}

// ---------------------------------------------------------------------------
// Scan query — returns licences whose expiry_date falls within MAX(windows)
// days. We over-scan and filter in JS so the same row can match different
// windows across multiple cron runs (e.g. a licence at 60d today is at 30d in
// 30 days — both alerts must fire). The recipient is resolved in-query via a
// LEFT JOIN to the holder user, falling back to the tenant's primary email.
// ---------------------------------------------------------------------------

interface RawLicenceRow {
  readonly id: unknown;
  readonly tenant_id: unknown;
  readonly company_id: unknown;
  readonly kind: unknown;
  readonly number: unknown;
  readonly mineral: unknown;
  readonly status: unknown;
  readonly expiry_date: unknown;
  readonly holder_user_id: unknown;
  readonly holder_email: unknown;
  readonly tenant_email: unknown;
}

function toRows<T>(res: unknown): readonly T[] {
  return Array.isArray(res)
    ? (res as T[])
    : (((res as { rows?: T[] }).rows ?? []) as T[]);
}

export async function fetchExpiringLicences(
  db: DbLike,
  now: Date,
  windowsDays: readonly number[],
): Promise<readonly ExpiringLicenceRow[]> {
  const maxWindow = Math.max(...windowsDays);
  // +1 day of slack so a licence whose expiry lands exactly on the upper
  // boundary is still picked up by the query.
  const upperBound = new Date(now.getTime() + (maxWindow + 1) * 24 * 60 * 60 * 1000);
  // Lower bound: include licences that just crossed (so a 1-day window can
  // still fire on the morning of expiry day).
  const lowerBound = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  const res = await db.execute(sql`
    SELECT
      l.id,
      l.tenant_id,
      l.company_id,
      l.kind,
      l.number,
      l.mineral,
      l.status,
      l.expiry_date,
      l.holder_user_id,
      u.email AS holder_email,
      t.primary_email AS tenant_email
    FROM licences l
    LEFT JOIN users u
      ON u.id = l.holder_user_id AND u.tenant_id = l.tenant_id
    LEFT JOIN tenants t
      ON t.id = l.tenant_id
    WHERE l.expiry_date IS NOT NULL
      AND l.status IN ('active', 'pending')
      AND l.expiry_date BETWEEN ${lowerBound.toISOString()} AND ${upperBound.toISOString()}
    ORDER BY l.expiry_date ASC
    LIMIT 5000
  `);

  const rows = toRows<RawLicenceRow>(res);

  // Filter to exact-window matches; rows that don't classify drop out.
  const matched: ExpiringLicenceRow[] = [];
  for (const r of rows) {
    const expiryDate = new Date(String(r.expiry_date));
    const window = classifyExpiryWindow(expiryDate, now, windowsDays);
    if (window === null) continue;
    const holderEmail = r.holder_email ? String(r.holder_email) : null;
    const tenantEmail = r.tenant_email ? String(r.tenant_email) : null;
    matched.push({
      id: String(r.id),
      tenantId: String(r.tenant_id),
      companyId: String(r.company_id),
      kind: String(r.kind),
      number: String(r.number),
      mineral: String(r.mineral),
      status: String(r.status),
      expiryDate,
      holderUserId: r.holder_user_id ? String(r.holder_user_id) : null,
      recipientEmail: holderEmail ?? tenantEmail,
      windowDays: window,
    });
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Already-sent guard — the unique index on (tenant_id, idempotency_key) does
// the heavy lifting; the INSERT's ON CONFLICT is authoritative, but we still
// pre-check so the tick result reports skips honestly.
// ---------------------------------------------------------------------------

export async function isAlreadySent(
  db: DbLike,
  tenantId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM notification_dispatch_log
     WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}
     LIMIT 1
  `);
  return toRows<unknown>(res).length > 0;
}

/**
 * Enqueue a pending dispatch-log row so the dispatcher worker can drain it.
 * Shares the canonical 14-column INSERT + ON CONFLICT (tenant_id,
 * idempotency_key) DO NOTHING contract documented on the schema.
 */
export async function insertPendingDispatch(
  db: DbLike,
  args: {
    readonly idempotencyKey: string;
    readonly licence: ExpiringLicenceRow;
    readonly recipientAddress: string;
  },
): Promise<void> {
  const id = `ndl_${randomUUID()}`;
  const { licence } = args;
  await db.execute(sql`
    INSERT INTO notification_dispatch_log (
      id, tenant_id, user_id, channel, recipient_address,
      template_key, locale, payload, correlation_id, idempotency_key,
      attempt_count, delivery_status, created_at, updated_at
    ) VALUES (
      ${id}, ${licence.tenantId}, ${licence.holderUserId}, ${LICENCE_EXPIRY_CHANNEL}, ${args.recipientAddress},
      ${LICENCE_EXPIRY_TEMPLATE_KEY}, ${'en'},
      ${JSON.stringify({
        licenceId: licence.id,
        companyId: licence.companyId,
        licenceKind: licence.kind,
        licenceNumber: licence.number,
        mineral: licence.mineral,
        status: licence.status,
        windowDays: licence.windowDays,
        expiryDate: licence.expiryDate.toISOString(),
      })}::jsonb,
      ${`licence-expiry-${licence.id}`}, ${args.idempotencyKey},
      0, 'pending', NOW(), NOW()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  `);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function emptyResult(): LicenceTickResult {
  return {
    scanned: 0,
    enqueued: 0,
    skippedAlreadySent: 0,
    failed: 0,
    byWindow: {},
  };
}

export function createLicenceExpiryAlertCron(
  options: LicenceExpiryAlertCronOptions,
): LicenceExpiryAlertCronHandle {
  const envIntervalMs = Number(process.env.LICENCE_EXPIRY_ALERT_INTERVAL_MS);
  const intervalMs = Math.max(
    1_000,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0
        ? envIntervalMs
        : ONE_DAY_MS),
  );
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.LICENCE_EXPIRY_ALERT_DISABLED !== 'true');

  const windowsDays = options.windowsDays ?? DEFAULT_LICENCE_EXPIRY_WINDOWS_DAYS;
  const nowFn = options.now ?? (() => new Date());

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function processLicence(
    db: DbLike,
    licence: ExpiringLicenceRow,
    counts: {
      enqueued: number;
      skippedAlreadySent: number;
      failed: number;
      byWindow: Record<number, number>;
    },
  ): Promise<void> {
    const window = licence.windowDays;
    const idempotencyKey = buildIdempotencyKey(licence.id, window, licence.expiryDate);
    const sent = await isAlreadySent(db, licence.tenantId, idempotencyKey);
    if (sent) {
      counts.skippedAlreadySent += 1;
      return;
    }
    if (!licence.recipientEmail) {
      options.logger.warn(
        { tenantId: licence.tenantId, licenceId: licence.id, window },
        'licence-expiry-cron: no recipient email resolved for licence',
      );
      counts.failed += 1;
      return;
    }
    await insertPendingDispatch(db, {
      idempotencyKey,
      licence,
      recipientAddress: licence.recipientEmail,
    });
    counts.enqueued += 1;
    counts.byWindow[window] = (counts.byWindow[window] ?? 0) + 1;
  }

  async function tick(): Promise<LicenceTickResult> {
    if (running) return emptyResult(); // skip overlapping ticks
    running = true;
    const started = Date.now();
    const counts = {
      enqueued: 0,
      skippedAlreadySent: 0,
      failed: 0,
      byWindow: {} as Record<number, number>,
    };
    let scanned = 0;
    try {
      // Every read + write runs inside the service-role GUC so the FORCE-RLS
      // notification_dispatch_log + cross-tenant licences scan match rows.
      await withServiceRoleContext(options.db, async (tx) => {
        const db = tx as unknown as DbLike;
        const now = nowFn();
        const candidates = await fetchExpiringLicences(db, now, windowsDays);
        scanned = candidates.length;
        for (const licence of candidates) {
          try {
            await processLicence(db, licence, counts);
          } catch (err) {
            options.logger.error(
              {
                tenantId: licence.tenantId,
                licenceId: licence.id,
                window: licence.windowDays,
                err: err instanceof Error ? err.message : String(err),
              },
              'licence-expiry-cron: licence alert failed',
            );
            counts.failed += 1;
          }
        }
      });
    } catch (err) {
      options.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'licence-expiry-cron: tick failed',
      );
    } finally {
      running = false;
    }
    const result: LicenceTickResult = {
      scanned,
      enqueued: counts.enqueued,
      skippedAlreadySent: counts.skippedAlreadySent,
      failed: counts.failed,
      byWindow: counts.byWindow,
    };
    options.logger.info(
      { durationMs: Date.now() - started, ...result },
      'licence-expiry-cron: tick complete',
    );
    return result;
  }

  return {
    start() {
      if (!enabled) {
        options.logger.info('licence-expiry-cron: disabled by env');
        return;
      }
      if (timer) {
        options.logger.warn(
          'licence-expiry-cron: already running, ignoring duplicate start',
        );
        return;
      }
      options.logger.info(
        { intervalMs, windowsDays },
        'licence-expiry-cron started',
      );
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      // Kick once immediately so a fresh process starts converged.
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        options.logger.info('licence-expiry-cron stopped');
      }
    },
    async tickOnce() {
      return tick();
    },
  };
}

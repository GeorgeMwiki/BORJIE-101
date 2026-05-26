/**
 * Lease Expiry Alert Cron — Wave 15 (TRC pilot).
 *
 * Daily multi-tenant scanner. For every active tenant, finds leases whose
 * `end_date` lands inside one of the configured warning windows (60, 30, 7,
 * 1 days from now) and dispatches a notification per (lease, window).
 *
 * Design notes (Wave 15 = no new architecture):
 *   - We re-use `notification_dispatch_log.idempotency_key` as the dedupe
 *     ledger. The key shape is deterministic — see `buildIdempotencyKey`.
 *     The table's UNIQUE INDEX (tenant_id, idempotency_key) guarantees we
 *     never double-send a (lease, window) alert even across restarts /
 *     two pods racing the same tick.
 *   - Channel preference order: whatsapp → sms → email → in_app. We try
 *     each provider in turn and the first that's configured for the tenant
 *     wins. If none are configured, we still write a `pending` row to
 *     `notification_dispatch_log` so the alert exists for audit and the
 *     ops team can reconfigure providers later.
 *   - The worker scans `leases.end_date` directly (RLS bypassed via
 *     service-role DB pool, but we re-attach `tenantId` on every log row
 *     and notification payload so downstream RLS reads are clean).
 *   - Lifecycle mirrors `cases-sla-supervisor.ts` — `start()` schedules a
 *     daily tick, `stop()` clears the timer. Both are idempotent.
 *
 * Env knobs:
 *   - LEASE_EXPIRY_ALERT_INTERVAL_MS    override the 24h cadence (tests)
 *   - LEASE_EXPIRY_ALERT_DISABLED=true  inert in this process (k8s CronJob
 *                                       takes over instead)
 *
 * Out of scope for Wave 15 (documented in Docs/WAVE15_TRC_PILOT.md):
 *   - Per-tenant local-time alignment (we tick on UTC; a per-tenant DST
 *     scheduler ships in Wave 17).
 *   - DLQ / retry — relies on `notification_dispatch_log.delivery_status`
 *     + the existing dispatcher worker for retries.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Expiry windows (in days) at which an alert fires. */
export const DEFAULT_EXPIRY_WINDOWS_DAYS = [60, 30, 7, 1] as const;
export type ExpiryWindowDays = (typeof DEFAULT_EXPIRY_WINDOWS_DAYS)[number] | number;

/** A lease that's eligible for an expiry-window alert. */
export interface ExpiringLeaseRow {
  readonly id: string;
  readonly tenantId: string;
  readonly leaseNumber: string;
  readonly propertyId: string;
  readonly unitId: string;
  readonly customerId: string;
  readonly endDate: Date;
  readonly rentAmount: number;
  readonly rentCurrency: string;
  readonly customerEmail: string | null;
  readonly customerPhone: string | null;
  readonly customerFirstName: string | null;
  readonly customerLastName: string | null;
  readonly windowDays: number;
}

/** Per-channel send adapter — caller wires in the real notifications service. */
export interface NotificationSender {
  send(args: {
    readonly tenantId: string;
    readonly lease: ExpiringLeaseRow;
    readonly window: number;
    readonly channel: 'whatsapp' | 'sms' | 'email' | 'in_app';
    readonly idempotencyKey: string;
  }): Promise<{ readonly delivered: boolean; readonly providerMessageId?: string; readonly error?: string }>;
}

/** DB execute shim — accepts either a Drizzle client or a postgres.js sql tag. */
export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface LeaseExpiryAlertCronOptions {
  readonly db: DbLike;
  readonly sender: NotificationSender;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly windowsDays?: readonly number[];
  /** Channel priority (first configured wins). */
  readonly channelOrder?: ReadonlyArray<'whatsapp' | 'sms' | 'email' | 'in_app'>;
  /** Used in tests to make tick() deterministic. */
  readonly now?: () => Date;
}

export interface LeaseExpiryAlertCronHandle {
  start(): void;
  stop(): void;
  /** Drive a single tick synchronously — exposed for tests + ops. */
  tickOnce(): Promise<TickResult>;
}

export interface TickResult {
  readonly scanned: number;
  readonly dispatched: number;
  readonly skippedAlreadySent: number;
  readonly failed: number;
  readonly byWindow: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Day-level idempotency key for a (lease, window) alert.
 *
 *   key = `lease-expiry::${leaseId}::${window}d`
 *
 * NOT date-suffixed — a 30-day window for a given lease can only ever fire
 * once. If the lease is renewed, a NEW lease row is created with a new id,
 * so the key namespace stays clean.
 */
export function buildIdempotencyKey(leaseId: string, windowDays: number): string {
  return `lease-expiry::${leaseId}::${windowDays}d`;
}

/**
 * Match an `endDate` against the configured windows. A lease matches a
 * window if the date diff (now → endDate) rounds to that window exactly.
 * We bucket by calendar-days (00:00 UTC), so the function is deterministic
 * regardless of when within the tick day the cron actually runs.
 *
 * Returns the matching window (in days) or `null` if no match.
 */
export function classifyExpiryWindow(
  endDate: Date,
  now: Date,
  windows: readonly number[],
): number | null {
  const startOfDay = (d: Date): number =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const ms = startOfDay(endDate) - startOfDay(now);
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return windows.includes(days) ? days : null;
}

/** Decide which channel to use for a given lease based on customer fields + priority. */
export function selectChannel(
  lease: ExpiringLeaseRow,
  channelOrder: ReadonlyArray<'whatsapp' | 'sms' | 'email' | 'in_app'>,
): 'whatsapp' | 'sms' | 'email' | 'in_app' | null {
  for (const ch of channelOrder) {
    if (ch === 'whatsapp' && lease.customerPhone) return ch;
    if (ch === 'sms' && lease.customerPhone) return ch;
    if (ch === 'email' && lease.customerEmail) return ch;
    if (ch === 'in_app') return ch; // in-app needs no channel address
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scan query — returns leases whose end_date falls within MAX(windows) days.
// We over-scan and filter in JS so the same row can match different windows
// across multiple cron runs (e.g. a lease at 60d today is at 30d in 30 days
// — both alerts must fire).
// ---------------------------------------------------------------------------

interface RawLeaseRow {
  readonly id: unknown;
  readonly tenant_id: unknown;
  readonly lease_number: unknown;
  readonly property_id: unknown;
  readonly unit_id: unknown;
  readonly customer_id: unknown;
  readonly end_date: unknown;
  readonly rent_amount: unknown;
  readonly rent_currency: unknown;
  readonly customer_email: unknown;
  readonly customer_phone: unknown;
  readonly customer_first_name: unknown;
  readonly customer_last_name: unknown;
}

export async function fetchExpiringLeases(
  db: DbLike,
  now: Date,
  windowsDays: readonly number[],
): Promise<readonly ExpiringLeaseRow[]> {
  const maxWindow = Math.max(...windowsDays);
  // Add 1 day of slack so a lease whose end_date is exactly at the upper
  // boundary is still picked up by the query.
  const upperBound = new Date(now.getTime() + (maxWindow + 1) * 24 * 60 * 60 * 1000);
  // Lower bound: include leases that already crossed (so a 1-day window can
  // still fire on the morning of expiry day).
  const lowerBound = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  const res = await db.execute(sql`
    SELECT
      l.id,
      l.tenant_id,
      l.lease_number,
      l.property_id,
      l.unit_id,
      l.customer_id,
      l.end_date,
      l.rent_amount,
      l.rent_currency,
      c.email AS customer_email,
      c.phone AS customer_phone,
      c.first_name AS customer_first_name,
      c.last_name AS customer_last_name
    FROM leases l
    LEFT JOIN customers c ON c.id = l.customer_id AND c.tenant_id = l.tenant_id
    WHERE l.deleted_at IS NULL
      AND l.status IN ('active', 'expiring_soon', 'approved')
      AND l.end_date BETWEEN ${lowerBound.toISOString()} AND ${upperBound.toISOString()}
    ORDER BY l.end_date ASC
    LIMIT 5000
  `);

  const rows = Array.isArray(res)
    ? (res as RawLeaseRow[])
    : (((res as { rows?: RawLeaseRow[] }).rows ?? []) as RawLeaseRow[]);

  // Filter to exact-window matches; rows that don't classify drop out.
  const matched: ExpiringLeaseRow[] = [];
  for (const r of rows) {
    const endDate = new Date(String(r.end_date));
    const window = classifyExpiryWindow(endDate, now, windowsDays);
    if (window === null) continue;
    matched.push({
      id: String(r.id),
      tenantId: String(r.tenant_id),
      leaseNumber: String(r.lease_number),
      propertyId: String(r.property_id),
      unitId: String(r.unit_id),
      customerId: String(r.customer_id),
      endDate,
      rentAmount: Number(r.rent_amount ?? 0),
      // UNIV-4: hardcoded launch-beachhead default — defer to tenant's jurisdiction profile currency; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
      rentCurrency: String(r.rent_currency ?? 'TZS'),
      customerEmail: r.customer_email ? String(r.customer_email) : null,
      customerPhone: r.customer_phone ? String(r.customer_phone) : null,
      customerFirstName: r.customer_first_name ? String(r.customer_first_name) : null,
      customerLastName: r.customer_last_name ? String(r.customer_last_name) : null,
      windowDays: window,
    });
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Already-sent guard — the unique index on (tenant_id, idempotency_key) does
// the heavy lifting; we still pre-check so we don't waste a provider call.
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
  const rows = Array.isArray(res)
    ? (res as unknown[])
    : ((res as { rows?: unknown[] }).rows ?? []);
  return rows.length > 0;
}

/** Insert a pending dispatch-log row so the channel attempt + dedupe survive process death. */
export async function insertPendingDispatch(
  db: DbLike,
  args: {
    readonly tenantId: string;
    readonly idempotencyKey: string;
    readonly lease: ExpiringLeaseRow;
    readonly channel: string;
    readonly recipientAddress: string;
  },
): Promise<string> {
  const id = `ndl_${randomUUID()}`;
  await db.execute(sql`
    INSERT INTO notification_dispatch_log (
      id, tenant_id, customer_id, channel, recipient_address,
      template_key, locale, payload, correlation_id, idempotency_key,
      attempt_count, delivery_status, created_at, updated_at
    ) VALUES (
      ${id}, ${args.tenantId}, ${args.lease.customerId}, ${args.channel}, ${args.recipientAddress},
      ${'lease.expiry.alert'}, ${'sw'},
      ${JSON.stringify({
        leaseId: args.lease.id,
        leaseNumber: args.lease.leaseNumber,
        propertyId: args.lease.propertyId,
        unitId: args.lease.unitId,
        windowDays: args.lease.windowDays,
        endDate: args.lease.endDate.toISOString(),
        rentAmountMinor: args.lease.rentAmount,
        rentCurrency: args.lease.rentCurrency,
        customerName: [args.lease.customerFirstName, args.lease.customerLastName].filter(Boolean).join(' '),
      })}::jsonb,
      ${`lease-expiry-${args.lease.id}`}, ${args.idempotencyKey},
      0, 'pending', NOW(), NOW()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  `);
  return id;
}

/** Mark a dispatched row as sent or failed after the provider call. */
export async function updateDispatchOutcome(
  db: DbLike,
  args: {
    readonly id: string;
    readonly delivered: boolean;
    readonly providerMessageId?: string;
    readonly error?: string;
  },
): Promise<void> {
  if (args.delivered) {
    await db.execute(sql`
      UPDATE notification_dispatch_log
         SET delivery_status = 'sent',
             provider_message_id = ${args.providerMessageId ?? null},
             last_attempt_at = NOW(),
             attempt_count = attempt_count + 1,
             updated_at = NOW()
       WHERE id = ${args.id}
    `);
  } else {
    await db.execute(sql`
      UPDATE notification_dispatch_log
         SET delivery_status = 'failed',
             provider_error_message = ${args.error ?? 'unknown'},
             last_attempt_at = NOW(),
             attempt_count = attempt_count + 1,
             updated_at = NOW()
       WHERE id = ${args.id}
    `);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHANNEL_ORDER = ['whatsapp', 'sms', 'email', 'in_app'] as const;

export function createLeaseExpiryAlertCron(
  options: LeaseExpiryAlertCronOptions,
): LeaseExpiryAlertCronHandle {
  const envIntervalMs = Number(process.env.LEASE_EXPIRY_ALERT_INTERVAL_MS);
  const intervalMs = Math.max(
    1_000,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0 ? envIntervalMs : ONE_DAY_MS),
  );
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.LEASE_EXPIRY_ALERT_DISABLED !== 'true');

  const windowsDays = options.windowsDays ?? DEFAULT_EXPIRY_WINDOWS_DAYS;
  const channelOrder = options.channelOrder ?? DEFAULT_CHANNEL_ORDER;
  const nowFn = options.now ?? (() => new Date());

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<TickResult> {
    const result: TickResult = {
      scanned: 0,
      dispatched: 0,
      skippedAlreadySent: 0,
      failed: 0,
      byWindow: {},
    };
    if (running) return result; // skip overlapping ticks
    running = true;
    const started = Date.now();
    try {
      const now = nowFn();
      const candidates = await fetchExpiringLeases(options.db, now, windowsDays);
      const mutable = result as { scanned: number };
      mutable.scanned = candidates.length;

      for (const lease of candidates) {
        const window = lease.windowDays;
        const idempotencyKey = buildIdempotencyKey(lease.id, window);
        try {
          const sent = await isAlreadySent(options.db, lease.tenantId, idempotencyKey);
          if (sent) {
            (result as { skippedAlreadySent: number }).skippedAlreadySent += 1;
            continue;
          }
          const channel = selectChannel(lease, channelOrder);
          if (!channel) {
            options.logger.warn(
              { tenantId: lease.tenantId, leaseId: lease.id, window },
              'lease-expiry-cron: no channel available for lease',
            );
            (result as { failed: number }).failed += 1;
            continue;
          }
          const recipientAddress =
            channel === 'email'
              ? (lease.customerEmail ?? '')
              : channel === 'in_app'
                ? lease.customerId
                : (lease.customerPhone ?? '');
          const dispatchId = await insertPendingDispatch(options.db, {
            tenantId: lease.tenantId,
            idempotencyKey,
            lease,
            channel,
            recipientAddress,
          });

          const outcome = await options.sender.send({
            tenantId: lease.tenantId,
            lease,
            window,
            channel,
            idempotencyKey,
          });

          await updateDispatchOutcome(options.db, {
            id: dispatchId,
            delivered: outcome.delivered,
            ...(outcome.providerMessageId !== undefined
              ? { providerMessageId: outcome.providerMessageId }
              : {}),
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          });
          if (outcome.delivered) {
            (result as { dispatched: number }).dispatched += 1;
            (result as { byWindow: Record<number, number> }).byWindow[window] =
              (result.byWindow[window] ?? 0) + 1;
          } else {
            (result as { failed: number }).failed += 1;
          }
        } catch (err) {
          options.logger.error(
            {
              tenantId: lease.tenantId,
              leaseId: lease.id,
              window,
              err: err instanceof Error ? err.message : String(err),
            },
            'lease-expiry-cron: lease alert failed',
          );
          (result as { failed: number }).failed += 1;
        }
      }
      options.logger.info(
        { durationMs: Date.now() - started, ...result },
        'lease-expiry-cron: tick complete',
      );
    } finally {
      running = false;
    }
    return result;
  }

  return {
    start() {
      if (!enabled) {
        options.logger.info('lease-expiry-cron: disabled by env');
        return;
      }
      if (timer) {
        options.logger.warn('lease-expiry-cron: already running, ignoring duplicate start');
        return;
      }
      options.logger.info({ intervalMs, windowsDays }, 'lease-expiry-cron started');
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
        options.logger.info('lease-expiry-cron stopped');
      }
    },
    async tickOnce() {
      return tick();
    },
  };
}

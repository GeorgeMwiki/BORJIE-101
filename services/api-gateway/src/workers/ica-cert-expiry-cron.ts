/**
 * ICA / mining-certification expiry reminder cron — Wave WORKFORCE-CERT-EXPIRY.
 *
 * Ticks every 6 hours. For every certification in
 * `workforce_certifications` whose `expires_at <= now() + 30d` and
 * `status='active'`, the cron auto-creates reminders at the 30d, 14d,
 * and 3d marks. Each reminder is keyed by
 * `(tenant_id, cert_id, days_before)` in `workforce_cert_expiry_reminders`
 * so the cron stays idempotent across restarts and inside the same
 * tick.
 *
 * Failure containment:
 *   - DB unwired → no-op + warn once on boot.
 *   - Per-cert errors isolated (one bad row cannot poison the batch).
 *   - All errors logged via Pino — NO console.log in services.
 *
 * Wired in `services/api-gateway/src/index.ts` alongside
 * `dailyBriefCron`.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = SIX_HOURS_MS;
const REMINDER_OFFSETS_DAYS = [30, 14, 3] as const;
const SCAN_HORIZON_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface IcaCertExpiryCronOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface IcaCertExpiryCronHandle {
  start(): void;
  stop(): void;
  /** Run one tick. Exposed for tests and the manual-trigger endpoint. */
  tickOnce(): Promise<TickResult>;
}

export interface TickResult {
  readonly scanned: number;
  readonly remindersCreated: number;
  readonly dedupSkipped: number;
  readonly failed: number;
}

interface ExpiringCert {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly certCode: string;
  readonly certName: string;
  readonly expiresAt: Date;
  readonly issuer: string;
}

function rowsOf(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function parseExpiringCert(
  row: Record<string, unknown>,
): ExpiringCert | null {
  const id = typeof row.id === 'string' ? row.id : null;
  const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null;
  const userId = typeof row.user_id === 'string' ? row.user_id : null;
  const certCode = typeof row.cert_code === 'string' ? row.cert_code : null;
  const certName = typeof row.cert_name === 'string' ? row.cert_name : null;
  const issuer = typeof row.issuer === 'string' ? row.issuer : null;
  if (!id || !tenantId || !userId || !certCode || !certName || !issuer) {
    return null;
  }
  const rawExpiry = row.expires_at;
  const expiresAt =
    rawExpiry instanceof Date
      ? rawExpiry
      : typeof rawExpiry === 'string'
        ? new Date(rawExpiry)
        : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return null;
  return { id, tenantId, userId, certCode, certName, expiresAt, issuer };
}

async function fetchExpiringCerts(
  db: DbLike,
  now: Date,
  logger: Logger,
): Promise<readonly ExpiringCert[]> {
  const horizon = new Date(now.getTime() + SCAN_HORIZON_DAYS * ONE_DAY_MS);
  try {
    const res = await db.execute(
      sql`
        SELECT id, tenant_id, user_id, cert_code, cert_name, issuer, expires_at
          FROM workforce_certifications
         WHERE status = 'active'
           AND expires_at <= ${horizon.toISOString()}::timestamptz
           AND expires_at >  ${now.toISOString()}::timestamptz
         ORDER BY expires_at ASC
         LIMIT 500
      `,
    );
    const out: ExpiringCert[] = [];
    for (const r of rowsOf(res)) {
      const parsed = parseExpiringCert(r);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch (err) {
    logger.warn(
      {
        worker: 'ica-cert-expiry-cron',
        err: err instanceof Error ? err.message : String(err),
      },
      'ica-cert-expiry-cron: fetchExpiringCerts failed',
    );
    return [];
  }
}

function daysBetween(future: Date, now: Date): number {
  return Math.ceil((future.getTime() - now.getTime()) / ONE_DAY_MS);
}

function buildReminderTitle(
  cert: ExpiringCert,
  daysBefore: number,
  language: 'sw' | 'en',
): string {
  if (language === 'sw') {
    return `Cheti ${cert.certCode} kinaisha (${daysBefore} siku)`;
  }
  return `Cert ${cert.certCode} expiring (${daysBefore}d)`;
}

function buildReminderBody(
  cert: ExpiringCert,
  daysBefore: number,
  language: 'sw' | 'en',
): string {
  const expiryIso = cert.expiresAt.toISOString().slice(0, 10);
  if (language === 'sw') {
    return [
      `Cheti cha mfanyakazi kinakaribia kuisha:`,
      ``,
      `- Kanuni: ${cert.certCode}`,
      `- Jina: ${cert.certName}`,
      `- Mtoaji: ${cert.issuer}`,
      `- Mfanyakazi: ${cert.userId}`,
      `- Tarehe ya kumalizika: ${expiryIso}`,
      `- Siku zilizobaki: ${daysBefore}`,
      ``,
      `Tafadhali anzisha mchakato wa upyaji wa cheti.`,
    ].join('\n');
  }
  return [
    `An active workforce certification is approaching expiry:`,
    ``,
    `- Code: ${cert.certCode}`,
    `- Name: ${cert.certName}`,
    `- Issuer: ${cert.issuer}`,
    `- Holder: ${cert.userId}`,
    `- Expires: ${expiryIso}`,
    `- Days remaining: ${daysBefore}`,
    ``,
    `Please initiate renewal so the holder stays compliant.`,
  ].join('\n');
}

async function createReminderForCert(
  db: DbLike,
  args: {
    readonly cert: ExpiringCert;
    readonly daysBefore: number;
    readonly now: Date;
    readonly logger: Logger;
  },
): Promise<'created' | 'dedup' | 'failed'> {
  const { cert, daysBefore, now, logger } = args;
  // 1. Try to claim the (tenant_id, cert_id, days_before) slot. The
  //    UNIQUE constraint makes this race-safe.
  const reminderId = randomUUID();
  const dedupId = randomUUID();
  const triggerAt = new Date(cert.expiresAt.getTime() - daysBefore * ONE_DAY_MS);
  const title = buildReminderTitle(cert, daysBefore, 'sw');
  const body = buildReminderBody(cert, daysBefore, 'sw');
  const idempotencyKey = `cert-expiry:${cert.tenantId}:${cert.id}:${daysBefore}`;

  try {
    // 1.a Insert the dedup row. ON CONFLICT DO NOTHING returns 0 rows
    //     when the slot is already claimed.
    const claim = await db.execute(
      sql`
        INSERT INTO workforce_cert_expiry_reminders
          (id, tenant_id, cert_id, days_before, reminder_id, created_at)
        VALUES (
          ${dedupId}::uuid,
          ${cert.tenantId},
          ${cert.id}::uuid,
          ${daysBefore},
          ${reminderId}::uuid,
          ${now.toISOString()}::timestamptz
        )
        ON CONFLICT (tenant_id, cert_id, days_before) DO NOTHING
        RETURNING id::text
      `,
    );
    const claimed = rowsOf(claim).length > 0;
    if (!claimed) return 'dedup';

    // 1.b Insert the reminders row that the dispatcher polls.
    await db.execute(
      sql`
        INSERT INTO reminders
          (id, tenant_id, owner_id, title, body, trigger_at, channel,
           status, payload, idempotency_key, created_at)
        VALUES (
          ${reminderId}::uuid,
          ${cert.tenantId},
          ${cert.userId},
          ${title},
          ${body},
          ${triggerAt.toISOString()}::timestamptz,
          'email',
          'scheduled',
          ${JSON.stringify({
            source: 'ica-cert-expiry-cron',
            certId: cert.id,
            certCode: cert.certCode,
            daysBefore,
            issuer: cert.issuer,
          })}::jsonb,
          ${idempotencyKey},
          ${now.toISOString()}::timestamptz
        )
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      `,
    );
    return 'created';
  } catch (err) {
    logger.warn(
      {
        worker: 'ica-cert-expiry-cron',
        tenantId: cert.tenantId,
        certId: cert.id,
        daysBefore,
        err: err instanceof Error ? err.message : String(err),
      },
      'ica-cert-expiry-cron: createReminderForCert failed',
    );
    return 'failed';
  }
}

export function createIcaCertExpiryCron(
  options: IcaCertExpiryCronOptions,
): IcaCertExpiryCronHandle {
  const envIntervalMs = Number(process.env.BORJIE_ICA_CERT_CRON_INTERVAL_MS);
  const intervalMs = Math.max(
    60_000,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0
        ? envIntervalMs
        : DEFAULT_INTERVAL_MS),
  );
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.BORJIE_ICA_CERT_CRON_DISABLED !== 'true');
  const now = options.now ?? (() => new Date());

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tickOnce(): Promise<TickResult> {
    const counters: { scanned: number; remindersCreated: number; dedupSkipped: number; failed: number } = {
      scanned: 0,
      remindersCreated: 0,
      dedupSkipped: 0,
      failed: 0,
    };
    if (running) return counters;
    running = true;
    const started = Date.now();
    try {
      const ts = now();
      const expiring = await fetchExpiringCerts(options.db, ts, options.logger);
      counters.scanned = expiring.length;
      for (const cert of expiring) {
        for (const daysBefore of REMINDER_OFFSETS_DAYS) {
          const daysLeft = daysBetween(cert.expiresAt, ts);
          // Skip offsets that are already in the past (or coincident
          // with now) — the dispatcher will not run a backdated row.
          if (daysLeft < daysBefore) continue;
          const result = await createReminderForCert(options.db, {
            cert,
            daysBefore,
            now: ts,
            logger: options.logger,
          });
          if (result === 'created') counters.remindersCreated += 1;
          else if (result === 'dedup') counters.dedupSkipped += 1;
          else counters.failed += 1;
        }
      }
      if (counters.scanned > 0) {
        options.logger.info(
          {
            worker: 'ica-cert-expiry-cron',
            durationMs: Date.now() - started,
            ...counters,
          },
          'ica-cert-expiry-cron: tick complete',
        );
      }
    } finally {
      running = false;
    }
    return counters;
  }

  return {
    start(): void {
      if (!enabled) {
        options.logger.info(
          { worker: 'ica-cert-expiry-cron' },
          'ica-cert-expiry-cron: disabled by config',
        );
        return;
      }
      if (timer) return;
      timer = setInterval(() => {
        tickOnce().catch((err) => {
          options.logger.error(
            {
              worker: 'ica-cert-expiry-cron',
              err: err instanceof Error ? err.message : String(err),
            },
            'ica-cert-expiry-cron: tick threw',
          );
        });
      }, intervalMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      options.logger.info(
        { worker: 'ica-cert-expiry-cron', intervalMs },
        'ica-cert-expiry-cron: started',
      );
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

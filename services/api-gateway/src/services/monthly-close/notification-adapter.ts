/**
 * Real `NotificationPort` adapter — Drizzle-backed
 * `notification_dispatch_log` writer.
 *
 * The `notification_dispatch_log` table already exists (migration in
 * `messaging.schema.ts`). The platform's `MessagingService` covers
 * inbound conversation messages, not transactional outbound dispatches
 * — but this table is exactly the canonical sink for transactional
 * sends (SMS / email / WhatsApp).
 *
 * Pragmatic minimum:
 *   - Insert a `pending` row per (owner, statement) pair using the
 *     orchestrator's run-derived idempotency key (tenantId+ownerId+
 *     statementId). The unique idempotency index guarantees re-runs
 *     of the same period do not create duplicates.
 *   - We do NOT actually send the email — that is the dedicated
 *     dispatcher worker's job (it picks up `pending` rows and calls
 *     the email provider). This keeps the orchestrator decoupled
 *     from any specific provider integration.
 *
 * Tenant-scoped on every query.
 */

import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';

type NotificationPort = {
  sendStatementEmail(input: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly statementId: string;
  }): Promise<{ readonly dispatchId: string }>;
};

type Logger = {
  warn(meta: Record<string, unknown>, msg: string): void;
};

type DbExecutor = { execute(q: unknown): Promise<unknown> };

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

export function createDrizzleNotificationAdapter(
  db: unknown,
  logger: Logger,
): NotificationPort {
  const exec = (db as DbExecutor).execute.bind(db as DbExecutor);

  return {
    async sendStatementEmail(input) {
      const { tenantId, ownerId, statementId } = input;
      const idempotencyKey = `monthly_close_stmt_${tenantId}_${ownerId}_${statementId}`;
      const dispatchId = `disp_${randomUUID()}`;

      // Best-effort lookup of the owner's email. We treat owners as
      // platform users (`properties.owner_id` → `users.id`); the
      // dispatcher worker will fall back to alternative addresses
      // (e.g. customer record) if the email is null at send time.
      let recipientAddress = '';
      try {
        const res = await exec(sql`
          SELECT email
          FROM users
          WHERE id = ${ownerId}
          LIMIT 1
        `);
        const row = asRows(res)[0] ?? {};
        if (typeof row.email === 'string') {
          recipientAddress = row.email;
        }
      } catch {
        recipientAddress = '';
      }

      try {
        // Idempotent insert. The unique idempotency index
        // `notification_dispatch_log_idempotency_idx` on
        // (tenantId, idempotencyKey) makes ON CONFLICT DO NOTHING
        // safe — re-runs return the same logical dispatchId via
        // the lookup below.
        await exec(sql`
          INSERT INTO notification_dispatch_log (
            id, tenant_id, user_id, channel, recipient_address,
            template_key, locale, payload,
            correlation_id, idempotency_key, attempt_count,
            delivery_status, created_at, updated_at
          )
          VALUES (
            ${dispatchId}, ${tenantId}, ${ownerId},
            'email',
            ${recipientAddress || `owner:${ownerId}`},
            'monthly_close.owner_statement_ready',
            'en',
            ${JSON.stringify({
              statementId,
              ownerId,
            })}::jsonb,
            ${statementId}, ${idempotencyKey}, 0,
            'pending', NOW(), NOW()
          )
          ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        `);

        // Look up the row that "won" the conflict — that's the
        // canonical dispatchId the orchestrator gets back.
        const lookup = await exec(sql`
          SELECT id
          FROM notification_dispatch_log
          WHERE tenant_id = ${tenantId}
            AND idempotency_key = ${idempotencyKey}
          LIMIT 1
        `);
        const row = asRows(lookup)[0] ?? {};
        const finalDispatchId =
          typeof row.id === 'string' && row.id.length > 0 ? row.id : dispatchId;

        return { dispatchId: finalDispatchId };
      } catch (err) {
        logger.warn(
          {
            port: 'notifications',
            tenantId,
            ownerId,
            statementId,
            degraded_reason: 'dispatch_log_write_failed',
            err: err instanceof Error ? err.message : String(err),
          },
          'monthly-close: notification dispatch write failed — returning degraded id',
        );
        return { dispatchId: `degraded_${dispatchId}` };
      }
    },
  };
}

/**
 * Action-executor domain audit — a hash-chained, append-only entry for a
 * confirm-required domain mutation (create_site / add_employee).
 *
 * The chat-actions route already appends an `auto_authorized` audit row
 * (`appendAutoAuthorizedAudit`) recording the AUTHORIZATION decision. This
 * helper additionally records the EXECUTION as a domain-trail entry on
 * `ai_audit_chain` — the same hash-chained, append-only mechanism the
 * mining routes use (`mining/tasks.hono.ts`, `field/workforce.hono.ts`)
 * when they mutate a domain row. Keeping the executor self-auditing means
 * a site/employee created from chat is indistinguishable from a
 * form-created one in the domain audit trail.
 *
 * Chain invariant (matches the mining routes exactly):
 *   - sequence_id = max(sequence_id) + 1 for the tenant (monotonic).
 *   - prev_hash   = previous entry's this_hash ('' for the first row).
 *   - this_hash   = SHA-256(prev_hash || canonical(payload)).
 * Rows are INSERT-only; we NEVER mutate an existing entry (append-only).
 *
 * RLS: the connection already has `app.current_tenant_id` bound by the
 * `/confirm-action` databaseMiddleware, and every statement also
 * predicates on the bound `tenantId` (belt-and-braces per CLAUDE.md).
 *
 * Best-effort: a failed audit append is logged + swallowed by the caller
 * so a missing audit sink never voids a completed, already-authorized
 * side effect.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { ExecContext } from './types.js';

export interface ExecAuditPayload {
  /** Dotted domain action, e.g. `mining.site.create`. */
  readonly action: string;
  /** The domain row id this audit attests to (site id / employee id). */
  readonly turnId: string;
  /** Small, non-sensitive detail object describing the mutation. */
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Append one hash-chained `ai_audit_chain` row for a domain mutation.
 * Returns the new chain-row id, or null when the append soft-failed (the
 * caller logs + continues — the action itself already passed the gate).
 */
export async function appendExecAudit(
  ctx: ExecContext,
  payload: ExecAuditPayload,
): Promise<string | null> {
  try {
    const id = randomUUID();
    const canonical = JSON.stringify({
      tenantId: ctx.tenantId,
      turnId: payload.turnId,
      action: payload.action,
      userId: ctx.userId,
      details: payload.details,
    });

    const headResult: unknown = await ctx.db.execute(sql`
      SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
             (SELECT this_hash FROM ai_audit_chain
               WHERE tenant_id = ${ctx.tenantId}
               ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
       WHERE tenant_id = ${ctx.tenantId}
    `);
    const rows =
      (headResult as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
      (headResult as ReadonlyArray<Record<string, unknown>>);
    const head = rows[0] ?? {};
    const sequenceId = Number(head.max_seq ?? 0) + 1;
    const prevHash =
      typeof head.last_hash === 'string' && head.last_hash.length > 0
        ? head.last_hash
        : '';
    const thisHash = createHash('sha256')
      .update(prevHash + canonical)
      .digest('hex');

    await ctx.db.execute(sql`
      INSERT INTO ai_audit_chain (
        id, tenant_id, sequence_id, turn_id, action,
        prev_hash, this_hash, payload, created_at
      ) VALUES (
        ${id},
        ${ctx.tenantId},
        ${sequenceId},
        ${payload.turnId},
        ${payload.action},
        ${prevHash},
        ${thisHash},
        ${JSON.stringify({ userId: ctx.userId, details: payload.details })}::jsonb,
        ${new Date().toISOString()}
      )
    `);
    return id;
  } catch (err) {
    ctx.logger.warn?.(
      {
        wiring: 'action-executor-audit',
        action: payload.action,
        tenantId: ctx.tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
      'action-executor: domain audit append failed (soft)',
    );
    return null;
  }
}

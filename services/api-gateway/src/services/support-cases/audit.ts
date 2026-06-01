/**
 * Support-case domain audit — a hash-chained, append-only `ai_audit_chain`
 * entry for each support-case lifecycle event.
 *
 * Mirrors the chain invariant the action-executor audit + the mining routes use
 * EXACTLY (so a support case opened/updated/resolved/escalated by Mr. Mwikila is
 * indistinguishable from any other domain trail entry):
 *   - sequence_id = max(sequence_id) + 1 for the tenant (monotonic).
 *   - prev_hash   = previous entry's this_hash ('' for the first row).
 *   - this_hash   = SHA-256(prev_hash || canonical(payload)).
 * Rows are INSERT-only; we NEVER mutate an existing entry (append-only — the
 * CLAUDE.md "AI audit chain is hash-chained, append-only" hard rule).
 *
 * The `action` namespaces the four support lifecycle kinds:
 *   md_diagnosed_issue | md_updated_case | md_resolved_case | md_escalated
 * (recorded as `support.case.<kind>`), each carrying the case id + a small,
 * non-sensitive detail bag (root cause / status / evidence count). Evidence ids
 * are recorded in the payload so the immutable trail proves the diagnosis.
 *
 * RLS: the connection already has `app.current_tenant_id` bound by the caller;
 * every statement also predicates on the bound `tenantId` (belt-and-braces).
 *
 * Best-effort: a failed audit append is logged + swallowed by the caller so a
 * missing audit sink never voids a completed case write.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

/** The four support-case audit action kinds. */
export type SupportAuditKind =
  | 'md_diagnosed_issue'
  | 'md_updated_case'
  | 'md_resolved_case'
  | 'md_escalated';

/** Minimal Pino-shaped logger (structural subset). */
export interface SupportAuditLogger {
  readonly warn?: (meta: object, msg: string) => void;
}

/** A Drizzle-ish client exposing `.execute(sql\`…\`)`. */
export interface SupportAuditDb {
  execute(query: unknown): Promise<unknown>;
}

export interface SupportAuditPayload {
  readonly kind: SupportAuditKind;
  /** The support_cases row id this audit attests to. */
  readonly caseId: string;
  /** Small, non-sensitive detail object describing the lifecycle event. */
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AppendSupportAuditArgs {
  readonly db: SupportAuditDb;
  readonly tenantId: string;
  readonly userId: string;
  readonly payload: SupportAuditPayload;
  readonly logger?: SupportAuditLogger;
}

/** Coerce a raw db.execute result into a rows array (pg vs array shim). */
function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  const rows =
    (result as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (result as ReadonlyArray<Record<string, unknown>>);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Append one hash-chained `ai_audit_chain` row for a support-case event.
 * Returns the new chain-row id, or null when the append soft-failed (the caller
 * logs + continues — the case write itself already succeeded).
 */
export async function appendSupportAudit(
  args: AppendSupportAuditArgs,
): Promise<string | null> {
  const { db, tenantId, userId, payload } = args;
  try {
    const id = randomUUID();
    const action = `support.case.${payload.kind}`;
    const canonical = JSON.stringify({
      tenantId,
      caseId: payload.caseId,
      action,
      userId,
      details: payload.details,
    });

    const headResult: unknown = await db.execute(sql`
      SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
             (SELECT this_hash FROM ai_audit_chain
               WHERE tenant_id = ${tenantId}
               ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
       WHERE tenant_id = ${tenantId}
    `);
    const head = rowsOf(headResult)[0] ?? {};
    const sequenceId = Number(head.max_seq ?? 0) + 1;
    const prevHash =
      typeof head.last_hash === 'string' && head.last_hash.length > 0
        ? head.last_hash
        : '';
    const thisHash = createHash('sha256')
      .update(prevHash + canonical)
      .digest('hex');

    await db.execute(sql`
      INSERT INTO ai_audit_chain (
        id, tenant_id, sequence_id, turn_id, action,
        prev_hash, this_hash, payload, created_at
      ) VALUES (
        ${id},
        ${tenantId},
        ${sequenceId},
        ${payload.caseId},
        ${action},
        ${prevHash},
        ${thisHash},
        ${JSON.stringify({ userId, details: payload.details })}::jsonb,
        ${new Date().toISOString()}
      )
    `);
    return id;
  } catch (err) {
    args.logger?.warn?.(
      {
        wiring: 'support-case-audit',
        kind: payload.kind,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
      'support-case: domain audit append failed (soft)',
    );
    return null;
  }
}

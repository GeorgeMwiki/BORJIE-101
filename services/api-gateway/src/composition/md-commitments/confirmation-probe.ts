/**
 * ConfirmationProbe — the CLOSE-THE-LOOP positive-proof checker for the MD
 * DEFERRAL / FOLLOW-THROUGH reconcile sweep (K3).
 *
 * The reconcile engine NEVER marks a commitment `done` by forgetting or by
 * optimism — it closes a commitment ONLY when this probe returns a positive
 * proof. Without a probe wired, nothing auto-closes (the sweep re-opens an
 * acked-but-unconfirmed item past its deadline instead). This module supplies
 * the real durable-evidence probe the composition root injects.
 *
 * GENERATIVE, never per-commitment: the probe routes by `commitment.kind`
 * (a domain verb, NOT a per-row id) onto the durable evidence table that
 * records that kind's positive completion, and joins on the commitment's own
 * `evidenceIds` (the durable entity ids the commitment was born from):
 *
 *   TASK class   (kind starts `task`)  → a `mining_tasks` row whose id is one of
 *                                        the commitment's evidence ids and whose
 *                                        status = 'done'. Proof: 'task_completed'.
 *   ACTION class (any other kind)      → a `mwikila_actions_inbox` row whose id is
 *                                        an evidence id and whose status is a
 *                                        positive terminal ('executed' | 'committed').
 *                                        Proof: 'action_executed'. Failing that, an
 *                                        `audit_events` row whose `action` equals the
 *                                        commitment kind with outcome 'SUCCESS'.
 *                                        Proof: 'audit_event'.
 *
 * Returns the proof kind string (the engine stamps it as `confirmationKind`) or
 * null when no positive completion exists yet — honest closure, no self-grade.
 *
 * RLS: the reconcile sweep runs OUT OF BAND (no request middleware binds the
 * tenant GUC). The evidence tables (`mining_tasks`, `mwikila_actions_inbox`,
 * `audit_events`) all carry a pure `current_setting('app.current_tenant_id')`
 * tenant-isolation policy with NO service-role bypass, so each read is wrapped in
 * `withTenantContext(db, commitment.tenantId, ...)` — binding the commitment's
 * OWN tenant id so the policy passes AND cross-tenant reads stay structurally
 * impossible. Every read is ALSO explicitly tenant-scoped in SQL (defence in
 * depth). FAIL-SAFE: a probe fault returns null (never throws) so a degraded
 * read never closes a commitment AND never breaks the tick. No `console.*`
 * (Pino shim only).
 */

import { sql } from 'drizzle-orm';

import type { MdCommitment } from '@borjie/database/repositories';
import { withTenantContext } from '@borjie/database';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import type { ConfirmationProbe } from './reconcile-engine.js';

/** Narrow execute-capable seam (mirrors the sweep's other db ports). */
interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

/** The `withTenantContext` tx is a full DatabaseClient; only `.execute` is used. */
type TenantBoundDb = Parameters<typeof withTenantContext>[0];

/** A positive-completion proof kind the engine stamps as `confirmationKind`. */
type ProofKind = 'task_completed' | 'action_executed' | 'audit_event';

/** UUID shape — only uuid evidence ids can join a row-id column. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Positive terminal statuses on the autonomous-MD actions inbox (0129). */
const ACTION_DONE_STATUSES = ['executed', 'committed'] as const;

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(rows) ? rows : [];
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classify a commitment's evidence-table family from its `kind`. Generic prefix
 * match on the domain verb — a `task`/`task.fulfil`/`task_complete` commitment is
 * proven by a completed task row; everything else is an ACTION proven by an
 * executed inbox action or a SUCCESS audit event. NEVER a per-commitment switch.
 */
function evidenceFamilyOf(kind: string): 'task' | 'action' {
  const k = kind.trim().toLowerCase();
  return k === 'task' || k.startsWith('task.') || k.startsWith('task_')
    ? 'task'
    : 'action';
}

/** The evidence ids usable as a row-id join (uuid-shaped, de-duplicated). */
function uuidEvidenceIds(c: MdCommitment): ReadonlyArray<string> {
  return [...new Set(c.evidenceIds.filter((id) => UUID_RE.test(id)))];
}

/**
 * Build the durable-evidence `ConfirmationProbe` the composition root injects
 * into `createReconcileEngine`. `db` is the gateway's transaction-capable client
 * (real client in prod; a `{ execute }` stub in tests — `withTenantContext`'s
 * test-double affordance runs the read directly against the stub).
 */
export function createDurableConfirmationProbe(deps: {
  readonly db: TenantBoundDb & DbExecLike;
  readonly logger: PinoLikeLogger;
}): ConfirmationProbe {
  const { db, logger } = deps;

  async function taskProof(c: MdCommitment): Promise<ProofKind | null> {
    const ids = uuidEvidenceIds(c);
    if (ids.length === 0) return null;
    const rows = rowsOf(
      await withTenantContext(db, c.tenantId, (tx) =>
        (tx as unknown as DbExecLike).execute(sql`
          SELECT 1
            FROM mining_tasks
           WHERE tenant_id = ${c.tenantId}::uuid
             AND id IN (${sql.join(
               ids.map((id) => sql`${id}::uuid`),
               sql`, `,
             )})
             AND status = 'done'
           LIMIT 1
        `),
      ),
    );
    return rows.length > 0 ? 'task_completed' : null;
  }

  async function actionProof(c: MdCommitment): Promise<ProofKind | null> {
    return withTenantContext(db, c.tenantId, async (tx) => {
      const exec = tx as unknown as DbExecLike;
      const ids = uuidEvidenceIds(c);

      // 1) An executed/committed autonomous-MD action joined by evidence id.
      if (ids.length > 0) {
        const actionRows = rowsOf(
          await exec.execute(sql`
            SELECT 1
              FROM mwikila_actions_inbox
             WHERE tenant_id = ${c.tenantId}
               AND id IN (${sql.join(
                 ids.map((id) => sql`${id}::uuid`),
                 sql`, `,
               )})
               AND status IN (${sql.join(
                 ACTION_DONE_STATUSES.map((s) => sql`${s}`),
                 sql`, `,
               )})
             LIMIT 1
          `),
        );
        if (actionRows.length > 0) return 'action_executed';
      }

      // 2) A successful audit_events row for this commitment's domain verb.
      const auditRows = rowsOf(
        await exec.execute(sql`
          SELECT 1
            FROM audit_events
           WHERE tenant_id = ${c.tenantId}
             AND action = ${c.kind}
             AND outcome = 'SUCCESS'
           LIMIT 1
        `),
      );
      return auditRows.length > 0 ? 'audit_event' : null;
    });
  }

  return {
    async proofFor(c: MdCommitment): Promise<string | null> {
      try {
        return evidenceFamilyOf(c.kind) === 'task'
          ? await taskProof(c)
          : await actionProof(c);
      } catch (err) {
        // FAIL-SAFE — a degraded read never closes a commitment, never throws.
        logger.warn(
          { tenantId: c.tenantId, commitmentId: c.id, err: errMsg(err) },
          'md-commitments: confirmation-probe read failed (no proof)',
        );
        return null;
      }
    },
  };
}

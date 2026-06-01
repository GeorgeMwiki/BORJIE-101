/**
 * Payment-diagnosis inspector — Mr. Mwikila's first-line technical support.
 *
 * READ-ONLY. Given { tenantId, userId, sinceMs }, this service root-causes the
 * user's payment issue by querying the ALREADY-POPULATED diagnosis signals —
 * `payment_intents` (status + failure_reason: the M-Pesa ResultCode
 * classification), `webhook_dead_letters` (a confirmation that ran out of
 * retries), `journal_idempotency` (whether the ledger actually posted), and
 * `audit_events` (category=PAYMENT, outcome FAILURE/ERROR/DENIED) — plus an
 * optional gateway-degraded signal from GET /api/v1/healthz/dependencies.
 *
 * It returns a typed {@link Diagnosis} that the support-case service turns into
 * a persistent `support_cases` row, and that the MD reads back to the user.
 *
 * HARD RULES honoured (CLAUDE.md):
 *   - READ-ONLY money path: this file issues ONLY SELECTs. It NEVER writes a
 *     ledger / payment / journal row. Any actual fix routes through the
 *     existing gated action-executor verbs (LedgerService owns the money path).
 *   - EVIDENCE-REQUIRED: a {@link Diagnosis} is returned ONLY when at least one
 *     evidence id (a payment_intent id / dead-letter id / audit_event id) backs
 *     it. `runDiagnosis` returns `null` (no diagnosis) when it cannot find any
 *     proof — it NEVER fabricates an empty-evidence diagnosis. The Auditor
 *     agent rejects empty-evidence responses.
 *   - RLS + GUC: every query runs on a connection whose
 *     `app.current_tenant_id` GUC is already bound by the caller's middleware,
 *     AND each statement additionally predicates on the bound `tenantId` +
 *     `userId` (belt-and-braces, per CLAUDE.md). No tenant comes from a body.
 *     NOTE: `payment_intents` and `journal_idempotency` carry live FORCE RLS;
 *     `webhook_dead_letters` and `audit_events` did NOT (the DLQ existed only in
 *     archived 0031; the live 0163 creates a different `webhook_events` table,
 *     and `audit_events` had no live RLS migration) — 0167 adds existence-guarded
 *     FORCE RLS + a tenant-isolation policy to BOTH so the DB enforces isolation
 *     on every inspector signal, not just the app predicate above.
 *   - No `console.log`; the caller threads a Pino-shaped logger.
 *   - No hard-coded TZS: amounts are never interpolated into the EN/SW copy;
 *     when shown they are rendered via `formatCurrency` from the intent's own
 *     `currency` column at the surface.
 */

import { sql } from 'drizzle-orm';

import {
  DIAGNOSIS_CATALOGUE,
  type Diagnosis,
  type DiagnosisClassification,
  type PaymentRootCause,
} from './types.js';

/** Default look-back window for a diagnosis: 7 days. */
export const DEFAULT_DIAGNOSIS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The gateway probe status the caller may supply (GET /healthz/dependencies). */
export type GatewayStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** Minimal Pino-shaped logger (structural subset). */
export interface InspectorLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

/** A Drizzle-ish client exposing `.execute(sql\`…\`)`. */
export interface InspectorDb {
  execute(query: unknown): Promise<unknown>;
}

export interface InspectPaymentArgs {
  readonly db: InspectorDb;
  readonly tenantId: string;
  readonly userId: string;
  /** Look-back window in ms. Defaults to {@link DEFAULT_DIAGNOSIS_WINDOW_MS}. */
  readonly sinceMs?: number;
  /**
   * Optional gateway health from GET /healthz/dependencies. When `degraded` or
   * `down` AND the user's latest intent is unsettled, the inspector classifies
   * `gateway_degraded`. The caller (who can reach the probe) supplies it; the
   * inspector stays a pure DB function otherwise.
   */
  readonly gatewayStatus?: GatewayStatus;
  readonly logger?: InspectorLogger;
}

/** Coerce a raw db.execute result into a rows array (pg vs array shim). */
function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  const rows =
    (result as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (result as ReadonlyArray<Record<string, unknown>>);
  return Array.isArray(rows) ? rows : [];
}

/** The shape we read off the most-recent payment_intent for this user. */
interface LatestIntent {
  readonly id: string;
  readonly status: string;
  readonly failureReason: string | null;
}

/**
 * Map an M-Pesa-style `failure_reason` slug (see payments-ledger
 * providers/mpesa/result-codes.ts — `insufficient-balance`,
 * `cancelled-by-user`, `timeout-no-response`, …) to a user-vs-system root
 * cause. Substring matching is robust to the `mpesa-failure-<code>:<desc>`
 * fallback slug. Returns `null` when the reason is absent / unrecognised so the
 * caller can fall through to the structural signals.
 */
function classifyFailureReason(reason: string | null): PaymentRootCause | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes('insufficient')) return 'insufficient_balance';
  if (r.includes('cancel') || r.includes('declined')) return 'user_cancelled';
  if (r.includes('timeout') || r.includes('cannot be reached')) {
    return 'user_cancelled';
  }
  if (r.includes('invalid-initiator-or-pin') || r.includes('pin')) {
    return 'user_cancelled';
  }
  return null;
}

/** Build a {@link Diagnosis} from a classification + the proof it rests on. */
function toDiagnosis(
  c: DiagnosisClassification,
  title: string,
  evidenceIds: ReadonlyArray<string>,
): Diagnosis {
  return {
    rootCause: c.rootCause,
    title,
    humanExplanationEn: c.humanExplanationEn,
    humanExplanationSw: c.humanExplanationSw,
    evidenceIds,
    severity: c.severity,
    suggestedResolution: c.suggestedResolution,
  };
}

/** SELECT the user's most-recent payment intent in the window. */
async function fetchLatestIntent(
  db: InspectorDb,
  tenantId: string,
  userId: string,
  sinceIso: string,
): Promise<LatestIntent | null> {
  // `payment_intents` keys the customer via `customer_id` and also stamps the
  // acting user in `created_by`; we accept EITHER so a payment a user initiated
  // is found regardless of which column carries their id. RLS already clips to
  // the tenant; we predicate on tenant_id too (belt-and-braces).
  const result = await db.execute(sql`
    SELECT id, status, failure_reason
      FROM payment_intents
     WHERE tenant_id = ${tenantId}
       AND (customer_id = ${userId} OR created_by = ${userId})
       AND created_at >= ${sinceIso}
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.status ?? '').toUpperCase(),
    failureReason:
      row.failure_reason === null || row.failure_reason === undefined
        ? null
        : String(row.failure_reason),
  };
}

/** Is there a dead-lettered webhook for this tenant in the window? */
async function fetchDeadLetterId(
  db: InspectorDb,
  tenantId: string,
  sinceIso: string,
): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT id
      FROM webhook_dead_letters
     WHERE tenant_id = ${tenantId}
       AND created_at >= ${sinceIso}
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const row = rowsOf(result)[0];
  return row ? String(row.id) : null;
}

/**
 * Did the ledger actually post for this intent? A `journal_idempotency` row
 * whose key references the intent id means the money path completed. Absence
 * (for a SUCCEEDED/PROCESSING intent) points at a ledger-post failure.
 */
async function ledgerPostedForIntent(
  db: InspectorDb,
  tenantId: string,
  intentId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
      FROM journal_idempotency
     WHERE tenant_id = ${tenantId}
       AND idempotency_key LIKE ${'%' + intentId + '%'}
     LIMIT 1
  `);
  return rowsOf(result).length > 0;
}

/** The most-recent failed/denied PAYMENT audit_event id for this user. */
async function fetchFailedPaymentAuditId(
  db: InspectorDb,
  tenantId: string,
  userId: string,
  sinceMsEpoch: number,
): Promise<string | null> {
  // audit_events stamps the acting user in `actor_id`; outcome is one of
  // FAILURE/ERROR/DENIED for a problem. timestamp_ms is the indexed epoch ms.
  const result = await db.execute(sql`
    SELECT id
      FROM audit_events
     WHERE tenant_id = ${tenantId}
       AND actor_id = ${userId}
       AND category = 'PAYMENT'
       AND outcome IN ('FAILURE','ERROR','DENIED')
       AND timestamp_ms >= ${sinceMsEpoch}
     ORDER BY timestamp_ms DESC
     LIMIT 1
  `);
  const row = rowsOf(result)[0];
  return row ? String(row.id) : null;
}

/**
 * Root-cause the user's payment issue. Returns a typed {@link Diagnosis} with
 * NON-EMPTY evidence, or `null` when there is no payment activity / no proof to
 * support a diagnosis (evidence-required — the inspector never fabricates one).
 *
 * Classification ladder (first match wins):
 *   1. latest intent FAILED/CANCELLED with a user-side failure_reason
 *      (insufficient / cancelled / timeout / PIN) → guide_user.
 *   2. latest intent FAILED with no user-side reason, but a dead-lettered
 *      webhook exists → webhook_dead_lettered (escalate).
 *   3. latest intent SUCCEEDED/PROCESSING but the ledger did NOT post →
 *      ledger_post_failed (escalate) — money in, accounting broken.
 *   4. latest intent PENDING/PROCESSING + gateway degraded/down →
 *      gateway_degraded (guide + watch).
 *   5. latest intent PENDING/PROCESSING (confirmation still arriving) →
 *      webhook_retry_pending (auto_safe_fix / reassure).
 *   6. latest intent SUCCEEDED + ledger posted → payment_succeeded (reassure).
 *   7. a FAILED intent we could not otherwise classify, but a PAYMENT audit
 *      failure backs it → unclassified_failure (escalate).
 */
export async function runDiagnosis(
  args: InspectPaymentArgs,
): Promise<Diagnosis | null> {
  const { db, tenantId, userId } = args;
  const sinceMs = args.sinceMs ?? DEFAULT_DIAGNOSIS_WINDOW_MS;
  const sinceEpoch = Date.now() - sinceMs;
  const sinceIso = new Date(sinceEpoch).toISOString();

  let latest: LatestIntent | null = null;
  let deadLetterId: string | null = null;
  let auditFailureId: string | null = null;
  try {
    latest = await fetchLatestIntent(db, tenantId, userId, sinceIso);
    deadLetterId = await fetchDeadLetterId(db, tenantId, sinceIso);
    auditFailureId = await fetchFailedPaymentAuditId(
      db,
      tenantId,
      userId,
      sinceEpoch,
    );
  } catch (err) {
    args.logger?.error?.(
      {
        wiring: 'support-diagnosis-inspector',
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
      'payment-inspector: signal query failed',
    );
    // A read failure is not a diagnosis; let the caller fall through.
    return null;
  }

  // No intent at all → there may still be an audit-only failure trail. If even
  // that is absent, there is no payment activity to diagnose (no evidence).
  if (!latest) {
    if (auditFailureId) {
      return toDiagnosis(
        DIAGNOSIS_CATALOGUE.unclassified_failure,
        'Payment problem on your account',
        [auditFailureId],
      );
    }
    return null;
  }

  const status = latest.status;
  const isFailed = status === 'FAILED' || status === 'CANCELLED';
  const isPending =
    status === 'PENDING' ||
    status === 'PROCESSING' ||
    status === 'REQUIRES_ACTION';
  const isSucceeded = status === 'SUCCEEDED';

  // The latest intent id is always proof of the activity being diagnosed.
  const evidence = (extra?: string | null): string[] =>
    extra ? [latest!.id, extra] : [latest!.id];

  // 1) User-side failure (insufficient / cancelled / timeout / PIN).
  if (isFailed) {
    const userCause = classifyFailureReason(latest.failureReason);
    if (userCause) {
      const title =
        userCause === 'insufficient_balance'
          ? 'Payment declined: not enough balance'
          : 'Payment not completed';
      return toDiagnosis(
        DIAGNOSIS_CATALOGUE[userCause],
        title,
        evidence(auditFailureId),
      );
    }
    // 2) Failed with no user-side reason, but a dead-lettered confirmation.
    if (deadLetterId) {
      return toDiagnosis(
        DIAGNOSIS_CATALOGUE.webhook_dead_lettered,
        'Payment confirmation needs manual reconciliation',
        evidence(deadLetterId),
      );
    }
    // 7) A failure we cannot classify — escalate, backed by the intent (+audit).
    return toDiagnosis(
      DIAGNOSIS_CATALOGUE.unclassified_failure,
      'Payment failed — investigating',
      evidence(auditFailureId),
    );
  }

  // 3) Money in but ledger did not post → systematic, escalate.
  if (isSucceeded || isPending) {
    let posted = false;
    try {
      posted = await ledgerPostedForIntent(db, tenantId, latest.id);
    } catch (err) {
      args.logger?.warn?.(
        {
          wiring: 'support-diagnosis-inspector',
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        },
        'payment-inspector: ledger-post probe failed (treating as not-posted)',
      );
      posted = false;
    }

    if (isSucceeded && !posted) {
      return toDiagnosis(
        DIAGNOSIS_CATALOGUE.ledger_post_failed,
        'Payment received but not recorded — escalated',
        evidence(deadLetterId),
      );
    }

    if (isSucceeded && posted) {
      // 6) Fully healthy — reassure (still evidence-backed by the intent).
      return toDiagnosis(
        DIAGNOSIS_CATALOGUE.payment_succeeded,
        'Your payment went through',
        evidence(null),
      );
    }

    // Pending/processing branch.
    if (isPending) {
      // 4) Gateway degraded/down → guide + watch.
      if (args.gatewayStatus === 'degraded' || args.gatewayStatus === 'down') {
        return toDiagnosis(
          DIAGNOSIS_CATALOGUE.gateway_degraded,
          'Payments are slow right now',
          evidence(deadLetterId),
        );
      }
      // A dead-letter alongside a still-pending intent → escalate.
      if (deadLetterId) {
        return toDiagnosis(
          DIAGNOSIS_CATALOGUE.webhook_dead_lettered,
          'Payment confirmation needs manual reconciliation',
          evidence(deadLetterId),
        );
      }
      // 5) Confirmation still arriving → reassure / auto-safe.
      return toDiagnosis(
        DIAGNOSIS_CATALOGUE.webhook_retry_pending,
        'Waiting on your payment confirmation',
        evidence(null),
      );
    }
  }

  // Fallback: an intent in some other state but a PAYMENT audit failure backs a
  // real problem → unclassified (escalate). Otherwise no diagnosis.
  if (auditFailureId) {
    return toDiagnosis(
      DIAGNOSIS_CATALOGUE.unclassified_failure,
      'Payment problem on your account',
      evidence(auditFailureId),
    );
  }
  return null;
}

/**
 * Assert a diagnosis carries proof. The support-case service calls this before
 * persisting a case so a no-evidence diagnosis can NEVER be stored (the Auditor
 * invariant by construction). Throws when `evidenceIds` is empty.
 */
export function assertEvidence(diagnosis: Diagnosis): Diagnosis {
  if (!diagnosis.evidenceIds || diagnosis.evidenceIds.length === 0) {
    throw new Error('diagnosis_missing_evidence');
  }
  return diagnosis;
}

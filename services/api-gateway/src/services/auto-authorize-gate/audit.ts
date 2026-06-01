/**
 * Audit-append for the `auto_authorized` path.
 *
 * When the gate (`./index.ts`) authorizes an action we append ONE row to
 * the hash-chained, append-only AI audit trail BEFORE the SSE frame
 * leaves the gateway. This reuses the exact production mechanism the
 * gateway already uses for conversation audit: the Drizzle-backed
 * `AuditSink` over the ai-copilot `AuditTrailRecorder` (SHA-256 +
 * HMAC chain, `audit_trail_entries`, migration 0111).
 *
 * Append-only invariant: we go through `recorder.record(...)` which only
 * ever INSERTs (idempotent on id). We NEVER mutate an existing row.
 *
 * The recorder is memoised per-process keyed on the db handle so we do
 * not rebuild the chain plumbing on every turn. A null db (degraded /
 * test boot) yields a null recorder and the caller skips the append.
 */

import { createDrizzleAuditSinkAndReader } from '../../composition/audit-sink-drizzle-adapter.js';

type SinkBundle = ReturnType<typeof createDrizzleAuditSinkAndReader>;

let cachedDb: unknown = null;
let cachedSink: SinkBundle['sink'] | null = null;

/** Memoised sink — rebuilt only when the db handle identity changes. */
function getSink(
  db: unknown,
  logger?: { warn?: (meta: object, msg: string) => void },
): SinkBundle['sink'] | null {
  if (!db) return null;
  if (cachedSink && cachedDb === db) return cachedSink;
  const bundle = createDrizzleAuditSinkAndReader({
    db,
    ...(logger ? { logger } : {}),
  });
  cachedDb = db;
  cachedSink = bundle.sink;
  return cachedSink;
}

export interface AppendAutoAuthorizedAuditArgs {
  readonly db: unknown;
  readonly tenantId: string;
  readonly userId: string;
  readonly action: string;
  readonly rationale: string;
  /** Free-form action payload the model proposed (stored as evidence). */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Winning provider model id, for the AI-evidence column. */
  readonly modelVersion?: string | null;
  readonly logger: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
    readonly error?: (meta: object, msg: string) => void;
  };
}

/**
 * Append a single `ai_execution` audit row recording the auto-authorized
 * action. Returns the new row's id + sequence on success, or null when
 * the append could not be made (no db, or a soft failure that must not
 * break the live SSE stream).
 *
 * This is NOT a kill-switch — a failed audit append is logged + swallowed
 * so the owner's turn still completes; the authorization itself already
 * passed the policy + inviolable gates upstream.
 */
export async function appendAutoAuthorizedAudit(
  args: AppendAutoAuthorizedAuditArgs,
): Promise<{ readonly id: string; readonly sequenceId: number } | null> {
  const sink = getSink(args.db, args.logger);
  if (!sink) return null;
  try {
    const recorded = await sink.record({
      tenantId: args.tenantId,
      actor: {
        // The action was auto-executed by the AI without a human button
        // press — maps to the audit-trail `ai_execution` actor kind.
        kind: 'ai_execution',
        id: args.userId,
      },
      actionKind: `auto_authorized.${args.action}`,
      // Auto-authorized teaching actions are reminders / non-money /
      // calendar items by construction (money + regulator surfaces are
      // denied upstream by the HIGH-risk prefix gate) — `other`.
      actionCategory: 'other',
      decision: 'executed',
      ai: {
        ...(args.modelVersion ? { modelVersion: args.modelVersion } : {}),
        attachments: {
          autoAuthorized: {
            action: args.action,
            rationale: args.rationale,
            payload: args.payload,
            authorizedBy: 'policy-gate+inviolable',
          },
        },
      },
    });
    args.logger.info?.(
      {
        wiring: 'auto-authorized-audit',
        action: args.action,
        auditId: recorded.id,
        sequenceId: recorded.sequenceId,
      },
      'auto_authorized: appended audit row',
    );
    return recorded;
  } catch (err) {
    // Soft-fail: never break the SSE stream over an audit write. Logged
    // so operators see the gap.
    args.logger.error?.(
      {
        wiring: 'auto-authorized-audit',
        action: args.action,
        error: err instanceof Error ? err.message : String(err),
      },
      'auto_authorized: audit append failed',
    );
    return null;
  }
}

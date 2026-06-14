/**
 * module-spawning/approval.ts — the four-eye ApprovalPort + the
 * apply-time `FourEyeApprovalView` fetch.
 *
 * Uses the EXISTING four-eye infrastructure (`sovereign_approvals`,
 * migration's ApprovalStore table) — it does NOT invent a new approval
 * table. A module-spawn approval is a `sovereign_approvals` row whose
 * `tool_name` is one of `MODULE_SPAWN_TOOL_NAMES`, bound in its JSONB
 * `payload` to `{ tenantId, moduleId, specId, specSqlHash }`.
 *
 * Two read paths:
 *   - `resolveApproval({tenantId, moduleId, specId})` — the orchestrator's
 *     coarse pre-check: is there ANY approved module-spawn approval bound
 *     to this (module, spec)? Returns `{ approvalId }` or null.
 *   - `fetchApprovalView({tenantId, moduleId})` — the executor's deep
 *     re-check input: the structural record the pure `assertApplyApproved`
 *     guard re-derives separation-of-duties + spec-hash binding over.
 *
 * Reads run under `withServiceRoleContext` (the orchestrator/executor has
 * no request GUC) AND carry an explicit `tenant_id = $tenant` predicate.
 *
 * Immutable, no mutation of inputs. Pino-shape logger only.
 */

import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';
import {
  MODULE_SPAWN_TOOL_NAMES,
  type FourEyeApprovalView,
} from '@borjie/module-orchestrator';
import type { ApprovalPort } from '@borjie/module-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { errMsg, rowsOf, type DatabaseClient } from './shared.js';

interface SovereignApprovalRow {
  readonly action_id: string;
  readonly tenant_id: string | null;
  readonly proposer_user_id: string;
  readonly tool_name: string;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly status: string;
  readonly signatures: unknown;
  /** The REAL one-shot column (migration 0324). */
  readonly executed: unknown;
}

const TOOL_NAME_LIST = [...MODULE_SPAWN_TOOL_NAMES];

/**
 * `ARRAY['a','b']::text[]` fragment for the `tool_name = ANY(...)` predicate.
 * A bare `ANY(${TOOL_NAME_LIST})` makes drizzle spread the JS array into the
 * invalid record constructor `ANY(($1, $2))`; the ARRAY form binds each
 * element as its own param.
 */
const TOOL_NAME_LIST_SQL = sql`ARRAY[${sql.join(
  TOOL_NAME_LIST.map((name) => sql`${name}`),
  sql`, `,
)}]::text[]`;

/** Build the ApprovalPort the orchestrator's apply pre-check consumes. */
export function createApprovalPort(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): ApprovalPort {
  return {
    async resolveApproval(args) {
      try {
        const rows = await fetchApprovedRows(db, args.tenantId, args.moduleId);
        const match = rows.find(
          (r) =>
            readPayloadString(r.payload, 'specId') === args.specId &&
            r.status === 'approved',
        );
        return match ? { approvalId: match.action_id } : null;
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, moduleId: args.moduleId, err: errMsg(err) },
          'module-spawning: resolveApproval failed',
        );
        return null;
      }
    },
  };
}

/**
 * Fetch the structural four-eye view the executor re-checks via
 * `assertApplyApproved`. Returns the FIRST module-spawn approval bound to
 * this (tenant, module) — or null. The pure guard then re-derives the
 * full invariant (status, proposer != approver, spec-hash binding, not
 * executed) so this fetch is intentionally permissive: it locates the
 * candidate; the guard decides.
 */
export async function fetchApprovalView(
  db: DatabaseClient,
  tenantId: string,
  moduleId: string,
  logger: PinoLikeLogger,
): Promise<FourEyeApprovalView | null> {
  try {
    const rows = await fetchApprovedRows(db, tenantId, moduleId);
    const row = rows[0];
    return row ? toView(row) : null;
  } catch (err) {
    logger.error(
      { tenantId, moduleId, err: errMsg(err) },
      'module-spawning: fetchApprovalView failed',
    );
    return null;
  }
}

async function fetchApprovedRows(
  db: DatabaseClient,
  tenantId: string,
  moduleId: string,
): Promise<ReadonlyArray<SovereignApprovalRow>> {
  return await withServiceRoleContext(db, async (tx) => {
    const result = await tx.execute(
      sql`
        SELECT action_id, tenant_id, proposer_user_id, tool_name,
               payload, status, signatures, executed
        FROM sovereign_approvals
        WHERE tenant_id = ${tenantId}
          AND tool_name = ANY(${TOOL_NAME_LIST_SQL})
          AND payload->>'moduleId' = ${moduleId}
          AND expires_at > now()
        ORDER BY proposed_at DESC
      `,
    );
    return rowsOf<SovereignApprovalRow>(result);
  });
}

function toView(row: SovereignApprovalRow): FourEyeApprovalView {
  const payload = (row.payload ?? {}) as Readonly<Record<string, unknown>>;
  return {
    action: {
      id: row.action_id,
      proposerUserId: row.proposer_user_id,
      toolName: row.tool_name,
      tenantId: row.tenant_id,
      payload,
    },
    status: row.status,
    signatures: readSignatures(row.signatures),
    // The REAL one-shot flag (migration 0324). The apply executor flips this
    // `sovereign_approvals.executed` column to `true` via an atomic
    // compare-and-set INSIDE the apply transaction; the four-eye gate refuses
    // any approval whose `executed` is already `true`. Postgres returns a
    // native boolean; some drivers surface it as the string `'t'`/`'true'`,
    // so we coerce defensively.
    executed: coerceExecuted(row.executed),
  };
}

/**
 * Coerce the driver-returned `executed` value to a strict boolean. A real
 * Postgres boolean arrives as `true`; some serialisations surface `'t'` or
 * `'true'`. Anything else (null/undefined/`'f'`) is "not yet executed".
 */
function coerceExecuted(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === 'string') {
    const v = raw.toLowerCase();
    return v === 't' || v === 'true';
  }
  return false;
}

function readSignatures(
  raw: unknown,
): ReadonlyArray<{ readonly approverUserId: string; readonly verdict: 'approve' | 'reject' }> {
  if (!Array.isArray(raw)) return [];
  const out: { approverUserId: string; verdict: 'approve' | 'reject' }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.approverUserId !== 'string') continue;
    if (o.verdict !== 'approve' && o.verdict !== 'reject') continue;
    out.push({ approverUserId: o.approverUserId, verdict: o.verdict });
  }
  return out;
}

function readPayloadString(
  payload: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const v = readOwn(payload ?? {}, key);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Own-property-only read — never walks the prototype chain, so a
 * `__proto__`/`constructor`-shaped payload key cannot resolve to an
 * inherited member. The `key` is always an internal string literal at
 * every call site.
 */
function readOwn(
  obj: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? // eslint-disable-next-line security/detect-object-injection
      obj[key]
    : undefined;
}

/**
 * estate / bulk_mark_for_renewal_prep — flag many leases at once for
 * upcoming renewal preparation.
 *
 * This is the FIRST bulk action wired through the dispatcher. Bulk actions
 * are HIGH-risk by definition (a single approve flips N rows) so the
 * `hitl_required` flag on the routing rule MUST be true regardless of
 * confidence. The dispatcher enforces this — see the
 * `bulk_op_always_requires_hitl` test in the dispatch-router package.
 *
 * Triggered by:
 *   - kernel turn  : "flag all leases expiring in the next 90 days for
 *                    renewal prep" (intent=propose_action with cohort
 *                    filter shape recognised by the brain)
 *   - admin script : ops can fire this directly via the proposals API
 *
 * Writes `flagged_for_renewal_prep = true` and a flag-timestamp to each
 * lease row. The implementation uses bulk update via the store port; if
 * the lease table column does not yet exist, the handler stubs and warns.
 */

import { z } from 'zod';
import { logger } from '../../../logger.js';

// ─── Payload schema ───────────────────────────────────────────────────────

export const BulkMarkForRenewalPrepPayloadSchema = z.object({
  /**
   * Explicit lease ids to flag. Must be ≥1 — empty arrays are rejected so
   * a misfire doesn't no-op silently.
   */
  lease_ids: z.array(z.string().min(1)).min(1).max(500),
  /** Human-readable reason; persisted with each flag so audit is rich. */
  reason: z.string().min(3),
  /** Optional window so the renewal officer knows the urgency. */
  prep_window_days: z.number().int().min(7).max(180).default(60),
  source: z.object({
    capture_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type BulkMarkForRenewalPrepPayload = z.infer<
  typeof BulkMarkForRenewalPrepPayloadSchema
>;

export interface BulkMarkForRenewalPrepResult {
  readonly updated_count: number;
  readonly skipped_count: number;
  readonly audit_chain_id: string;
  /** Per-lease outcome — for the manager review UI. */
  readonly per_lease: ReadonlyArray<{
    readonly lease_id: string;
    readonly status: 'flagged' | 'skipped';
    readonly reason?: string;
  }>;
  readonly persisted: boolean;
}

// ─── Ports ────────────────────────────────────────────────────────────────

export interface LeaseStorePort {
  /**
   * Set `flagged_for_renewal_prep = true` on each lease that exists. Skips
   * leases not found and reports them in the return value.
   *
   * Returns `null` when the table column does not exist; the handler then
   * degrades gracefully and emits a TODO warning.
   */
  bulkMarkForRenewalPrep(args: {
    readonly tenantId: string;
    readonly leaseIds: ReadonlyArray<string>;
    readonly reason: string;
    readonly prepWindowDays: number;
  }): Promise<{
    readonly updated: ReadonlyArray<string>;
    readonly skipped: ReadonlyArray<{
      readonly leaseId: string;
      readonly reason: string;
    }>;
  } | null>;
}

export interface AuditChainPort {
  append(args: {
    readonly tenantId: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface BulkMarkForRenewalPrepDeps {
  readonly leases: LeaseStorePort;
  readonly auditChain: AuditChainPort;
  readonly logger?: {
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface BulkMarkForRenewalPrepContext {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly sourceAuditChainId: string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function bulkMarkForRenewalPrepHandler(
  payload: BulkMarkForRenewalPrepPayload,
  ctx: BulkMarkForRenewalPrepContext,
  deps: BulkMarkForRenewalPrepDeps,
): Promise<BulkMarkForRenewalPrepResult> {
  const parsed = BulkMarkForRenewalPrepPayloadSchema.parse(payload);

  const outcome = await deps.leases.bulkMarkForRenewalPrep({
    tenantId: ctx.tenantId,
    leaseIds: parsed.lease_ids,
    reason: parsed.reason,
    prepWindowDays: parsed.prep_window_days,
  });

  let updated: ReadonlyArray<string>;
  let skipped: ReadonlyArray<{ readonly leaseId: string; readonly reason: string }>;
  let persisted: boolean;

  if (outcome === null) {
    // Column or table missing — treat as stub.
    updated = parsed.lease_ids;
    skipped = [];
    persisted = false;
    const warn = deps.logger?.warn;
    if (warn) {
      warn(
        {
          proposal_id: ctx.proposalId,
          lease_count: parsed.lease_ids.length,
        },
        'TODO: write to lease.flagged_for_renewal_prep when migration lands',
      );
    } else {
      logger.warn('TODO: write to lease.flagged_for_renewal_prep when migration lands', {
          proposal_id: ctx.proposalId,
          lease_count: parsed.lease_ids.length,
        });
    }
  } else {
    updated = outcome.updated;
    skipped = outcome.skipped;
    persisted = true;
  }

  // Per-lease outcome merge for the manager UI.
  const updatedSet = new Set(updated);
  const skippedMap = new Map<string, string>();
  for (const s of skipped) skippedMap.set(s.leaseId, s.reason);
  const perLease = parsed.lease_ids.map((leaseId) => {
    if (updatedSet.has(leaseId)) {
      return { lease_id: leaseId, status: 'flagged' as const };
    }
    return {
      lease_id: leaseId,
      status: 'skipped' as const,
      reason: skippedMap.get(leaseId) ?? 'not_found',
    };
  });

  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    action: 'estate.bulk_mark_for_renewal_prep',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      requested: parsed.lease_ids.length,
      updated: updated.length,
      skipped: skipped.length,
      reason: parsed.reason,
      prep_window_days: parsed.prep_window_days,
      persisted,
    },
  });

  return Object.freeze({
    updated_count: updated.length,
    skipped_count: skipped.length,
    audit_chain_id: audit.id,
    per_lease: perLease,
    persisted,
  });
}

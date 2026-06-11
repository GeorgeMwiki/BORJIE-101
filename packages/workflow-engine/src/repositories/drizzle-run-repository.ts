/**
 * Drizzle-backed `WorkflowRunRepository`.
 *
 * Persists the run aggregate to `workflow_runs` (migration 0307) so
 * /workflow runs + the four-eyes approval queue survive an api-gateway
 * restart. Every query runs inside an RLS tenant-context transaction:
 *
 *   - Tenant-scoped reads/writes (insert / update / list*) bind
 *     `app.current_tenant_id` via `withTenantContext` so the
 *     `workflow_runs_tenant_isolation` policy filters automatically.
 *   - `findById` has no tenant argument (a run id is globally unique;
 *     the engine + router verify `run.tenantId` downstream — see
 *     packages/workflow-engine/src/runs/engine.ts loadOrThrow). It runs
 *     under `withServiceRoleContext` so the cross-tenant lookup by id is
 *     allowed by the `workflow_runs_service_role_bypass` policy.
 *
 * The proposed-change / review-decision / approval-decision sub-objects
 * are stored as jsonb projections (see row-mappers).
 */

import { eq, and } from 'drizzle-orm';
import {
  workflowRuns,
  withTenantContext,
  withServiceRoleContext,
  type DatabaseClient,
  type NewWorkflowRunRow,
} from '@borjie/database';
import type {
  WorkflowRun,
  WorkflowRunRepository,
} from '../types.js';
import {
  approvalDecisionToJson,
  proposedChangeToJson,
  reviewDecisionToJson,
  rowToRun,
} from './row-mappers.js';

/** Build the column values for an insert/update from a domain run. */
function toValues(run: WorkflowRun): NewWorkflowRunRow {
  return {
    id: run.id,
    tenantId: run.tenantId,
    definitionId: run.definitionId,
    kind: run.kind,
    scope: run.scope,
    scopeRef: run.scopeRef,
    initiatedByUserId: run.initiatedByUserId,
    assignedReviewerUserId: run.assignedReviewerUserId,
    assignedApproverUserId: run.assignedApproverUserId,
    state: run.state,
    input: { ...run.input },
    proposedChange: proposedChangeToJson(run.proposedChange),
    reviewDecision: reviewDecisionToJson(run.reviewDecision),
    approvalDecision: approvalDecisionToJson(run.approvalDecision),
    rejectionReason: run.rejectionReason,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    committedAt: run.committedAt,
  };
}

export function createDrizzleRunRepository(
  db: DatabaseClient | null,
): WorkflowRunRepository {
  if (!db) {
    throw new Error(
      'createDrizzleRunRepository requires a DatabaseClient (got null)',
    );
  }
  return {
    async insert(run) {
      await withTenantContext(db, run.tenantId, async (tx) => {
        await tx.insert(workflowRuns).values(toValues(run));
      });
    },

    async update(run) {
      const matched = await withTenantContext(
        db,
        run.tenantId,
        async (tx) => {
          // Identity columns must not be rewritten on update.
          const { id: _id, tenantId: _tenantId, createdAt: _createdAt, ...values } =
            toValues(run);
          return tx
            .update(workflowRuns)
            .set(values)
            .where(
              and(
                eq(workflowRuns.id, run.id),
                eq(workflowRuns.tenantId, run.tenantId),
              ),
            )
            .returning({ id: workflowRuns.id });
        },
      );
      // Mirror the in-memory repo's contract: updating a run that does not
      // exist (or is not visible to this tenant) is an error, not a silent
      // no-op — the engine relies on this to surface lost runs.
      if ((matched as unknown[]).length === 0) {
        throw new Error(`run_not_found:${run.id}`);
      }
    },

    async findById(id) {
      const rows = await withServiceRoleContext(db, async (tx) => {
        return tx
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, id))
          .limit(1);
      });
      const row = (rows as Record<string, unknown>[])[0];
      return row ? rowToRun(row) : null;
    },

    async listForUser(tenantId, userId) {
      const rows = await withTenantContext(db, tenantId, async (tx) => {
        return tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.tenantId, tenantId),
              eq(workflowRuns.initiatedByUserId, userId),
            ),
          );
      });
      return Object.freeze(
        (rows as Record<string, unknown>[]).map(rowToRun),
      );
    },

    async listReviewQueue(tenantId) {
      const rows = await withTenantContext(db, tenantId, async (tx) => {
        return tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.tenantId, tenantId),
              eq(workflowRuns.state, 'in_review'),
            ),
          );
      });
      return Object.freeze(
        (rows as Record<string, unknown>[]).map(rowToRun),
      );
    },

    async listApprovalQueue(tenantId) {
      const rows = await withTenantContext(db, tenantId, async (tx) => {
        return tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.tenantId, tenantId),
              eq(workflowRuns.state, 'in_approval'),
            ),
          );
      });
      return Object.freeze(
        (rows as Record<string, unknown>[]).map(rowToRun),
      );
    },

    async list(tenantId) {
      const rows = await withTenantContext(db, tenantId, async (tx) => {
        return tx
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.tenantId, tenantId));
      });
      return Object.freeze(
        (rows as Record<string, unknown>[]).map(rowToRun),
      );
    },
  };
}

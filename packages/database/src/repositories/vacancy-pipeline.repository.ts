/**
 * Postgres VacancyPipelineRunRepository — Drizzle adapter for the
 * `VacancyPipelineRunRepository` port defined in
 * @borjie/ai-copilot/src/orchestrators/vacancy-to-lease/types.ts.
 *
 * The kernel-side / orchestrator-side type is duck-typed locally so
 * @borjie/database does not have to depend on @borjie/ai-
 * copilot. The shape is identical and a TypeScript compatibility
 * test in ai-copilot will catch any drift.
 */

import { and, eq } from 'drizzle-orm';
import { vacancyPipelineRuns } from '../schemas/vacancy-pipeline.schema.js';
import type { DatabaseClient } from '../client.js';

// ---------------------------------------------------------------------------
// Duck-typed shapes — keep in sync with the canonical types in ai-copilot.
// ---------------------------------------------------------------------------

export type VacancyPipelineState =
  | 'idle' | 'listed' | 'receiving_inquiries' | 'screening_applicant'
  | 'offer_extended' | 'offer_signed' | 'move_in_scheduled' | 'lease_active'
  | 'awaiting_approval' | 'rejected' | 'withdrew' | 'expired' | 'cancelled';

export interface VacancyPipelineEvent {
  readonly type: string;
  readonly at: string;
  readonly actor: string;
  readonly reason?: string;
  readonly payload?: Record<string, unknown>;
}

export interface VacancyPipelineRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly state: VacancyPipelineState;
  readonly listingId: string | null;
  readonly applicantCustomerId: string | null;
  readonly negotiationId: string | null;
  readonly leaseId: string | null;
  readonly creditRatingScore: number | null;
  readonly history: readonly VacancyPipelineEvent[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly cancelledReason: string | null;
  readonly approvalReason: string | null;
}

export interface VacancyPipelineRunRepository {
  create(run: VacancyPipelineRun): Promise<VacancyPipelineRun>;
  findById(tenantId: string, runId: string): Promise<VacancyPipelineRun | null>;
  listByUnit(tenantId: string, unitId: string): Promise<readonly VacancyPipelineRun[]>;
  update(
    tenantId: string,
    runId: string,
    patch: Partial<Omit<VacancyPipelineRun, 'runId' | 'tenantId' | 'startedAt'>>,
  ): Promise<VacancyPipelineRun>;
}

export function createPgVacancyPipelineRunRepository(
  db: DatabaseClient,
): VacancyPipelineRunRepository {
  return {
    async create(run) {
      const row = mapToRow(run);
      await db.insert(vacancyPipelineRuns).values(row as never).onConflictDoNothing();
      return run;
    },

    async findById(tenantId, runId) {
      const rows = await db
        .select()
        .from(vacancyPipelineRuns)
        .where(
          and(
            eq(vacancyPipelineRuns.tenantId, tenantId),
            eq(vacancyPipelineRuns.runId, runId),
          ),
        )
        .limit(1);
      const r = rows[0];
      return r ? rowToRun(r) : null;
    },

    async listByUnit(tenantId, unitId) {
      const rows = await db
        .select()
        .from(vacancyPipelineRuns)
        .where(
          and(
            eq(vacancyPipelineRuns.tenantId, tenantId),
            eq(vacancyPipelineRuns.unitId, unitId),
          ),
        );
      return rows.map(rowToRun);
    },

    async update(tenantId, runId, patch) {
      const updates: Record<string, unknown> = {};
      if ('state' in patch && patch.state) updates.state = patch.state;
      if ('listingId' in patch) updates.listingId = patch.listingId ?? null;
      if ('applicantCustomerId' in patch)
        updates.applicantCustomerId = patch.applicantCustomerId ?? null;
      if ('negotiationId' in patch) updates.negotiationId = patch.negotiationId ?? null;
      if ('leaseId' in patch) updates.leaseId = patch.leaseId ?? null;
      if ('creditRatingScore' in patch)
        updates.creditRatingScore = patch.creditRatingScore ?? null;
      if ('history' in patch && patch.history)
        updates.historyJson = patch.history.map((e) => ({ ...e }));
      if ('endedAt' in patch)
        updates.endedAt = patch.endedAt ? new Date(patch.endedAt) : null;
      if ('cancelledReason' in patch) updates.cancelledReason = patch.cancelledReason ?? null;
      if ('approvalReason' in patch) updates.approvalReason = patch.approvalReason ?? null;
      updates.updatedAt = new Date();

      await db
        .update(vacancyPipelineRuns)
        .set(updates as never)
        .where(
          and(
            eq(vacancyPipelineRuns.tenantId, tenantId),
            eq(vacancyPipelineRuns.runId, runId),
          ),
        );

      const after = await this.findById(tenantId, runId);
      if (!after) throw new Error(`vacancy pipeline run ${runId} disappeared mid-update`);
      return after;
    },
  };
}

function mapToRow(run: VacancyPipelineRun): Record<string, unknown> {
  return {
    runId: run.runId,
    tenantId: run.tenantId,
    unitId: run.unitId,
    state: run.state,
    listingId: run.listingId,
    applicantCustomerId: run.applicantCustomerId,
    negotiationId: run.negotiationId,
    leaseId: run.leaseId,
    creditRatingScore: run.creditRatingScore,
    historyJson: run.history.map((e) => ({ ...e })),
    startedAt: new Date(run.startedAt),
    updatedAt: new Date(run.updatedAt),
    endedAt: run.endedAt ? new Date(run.endedAt) : null,
    cancelledReason: run.cancelledReason,
    approvalReason: run.approvalReason,
  };
}

function rowToRun(r: typeof vacancyPipelineRuns.$inferSelect): VacancyPipelineRun {
  const history: ReadonlyArray<VacancyPipelineEvent> = Array.isArray(r.historyJson)
    ? (r.historyJson as ReadonlyArray<VacancyPipelineEvent>)
    : [];
  return {
    runId: r.runId,
    tenantId: r.tenantId,
    unitId: r.unitId,
    state: r.state as VacancyPipelineState,
    listingId: r.listingId ?? null,
    applicantCustomerId: r.applicantCustomerId ?? null,
    negotiationId: r.negotiationId ?? null,
    leaseId: r.leaseId ?? null,
    creditRatingScore: r.creditRatingScore ?? null,
    history,
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    endedAt: r.endedAt ? (r.endedAt instanceof Date ? r.endedAt.toISOString() : String(r.endedAt)) : null,
    cancelledReason: r.cancelledReason ?? null,
    approvalReason: r.approvalReason ?? null,
  };
}

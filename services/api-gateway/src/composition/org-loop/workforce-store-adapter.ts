/**
 * workforce-store-adapter.ts — the Drizzle/raw-SQL `WorkforceStore` over the
 * LIVE substrate (extracted from workforce-deps-wiring.ts to keep files <800).
 *
 * CONTRACT SURPRISE (adapted + noted)
 * -----------------------------------
 * The orchestrator package ships its OWN tables (work_assignments /
 * work_followups …, migrations 0241-0250) + its OWN Employee shape
 * (personEntityId / defaultChannel). NONE of those tables were migrated into
 * this repo, and the live `employees` table has a different shape. This store
 * maps onto the REAL substrate the spine already closes against:
 *   - getEmployee      → live `employees` table → orchestrator Employee view.
 *   - insertAssignment → `mining_tasks` row — the EXACT table the workforce-
 *                        mobile inbox lists AND the /:id/complete loop closes.
 *   - insertFollowup   → honest-degrade (no work_followups table): the slot is
 *                        logged structurally, never thrown.
 * Every other method is a fail-safe honest-degrade stub (empty/null + a log)
 * so a non-assign entrypoint never silently fabricates a row.
 */

import { sql } from 'drizzle-orm';
import {
  EmployeeSchema,
  WorkAssignmentSchema,
  type Employee,
  type WorkAssignment,
  type WorkCheckIn,
  type WorkFollowup,
  type WorkforceStore,
} from '@borjie/workforce-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import {
  asNullableString,
  asString,
  errMsg,
  rowsOf,
  withCtx,
  type DatabaseClient,
  type DbExecLike,
} from './workforce-db-helpers.js';

/** The live `employees` row columns this store reads (workforce.schema.ts). */
function rowToEmployee(row: Record<string, unknown>): Employee {
  const userId = asNullableString(row.user_id);
  const status: 'active' | 'on_leave' | 'terminated' =
    row.status === 'on_leave' || row.status === 'terminated'
      ? row.status
      : 'active';
  // EmployeeSchema.parse normalises into the exact orchestrator Employee shape
  // (and satisfies exactOptionalPropertyTypes without hand-widening). The
  // orchestrator's Employee keys off `personEntityId`; the live table models
  // the portal identity as `user_id` — map it through so the kickoff push
  // targets the worker's real user account (mining_tasks +
  // notification_dispatch_log both key off user_id). app_push (defaultChannel
  // 'mobile') is the spine's deliver rail.
  return EmployeeSchema.parse({
    id: asString(row.id),
    tenantId: asString(row.tenant_id),
    personEntityId: userId ?? asString(row.id),
    status,
    defaultChannel: 'mobile',
  });
}

/**
 * Build the production `WorkforceStore`. Only the three methods `assignTask`
 * exercises (getEmployee / insertAssignment / insertFollowup) touch real
 * infra; the rest honest-degrade (empty/null + a one-time log) so a
 * non-assign entrypoint never silently fabricates a row.
 */
export function createWorkforceStore(args: {
  readonly db: DatabaseClient;
  readonly logger: PinoLikeLogger;
}): WorkforceStore {
  const { db, logger } = args;

  const degrade = (method: string): void => {
    logger.warn(
      { method, organ: 'workforce-store' },
      'workforce-store: method not backed by a live table — honest-degrade (returns empty/null; never fabricates a row)',
    );
  };

  return {
    async getEmployee(tenantId, id) {
      if (!tenantId || !id) return null;
      try {
        return await withCtx(db, async (tx) => {
          const res = await (tx as unknown as DbExecLike).execute(sql`
            SELECT id, tenant_id, user_id, status
            FROM employees
            WHERE tenant_id = ${tenantId} AND id = ${id}
            LIMIT 1
          `);
          const row = rowsOf(res)[0];
          return row ? rowToEmployee(row) : null;
        });
      } catch (err) {
        logger.warn(
          { tenantId, employeeId: id, err: errMsg(err) },
          'workforce-store: getEmployee read failed (honest-degrade → null)',
        );
        return null;
      }
    },

    async insertAssignment(row: WorkAssignment) {
      // Persist into `mining_tasks` — the live substrate the workforce-mobile
      // inbox lists AND the POST /:id/complete loop closes against. The
      // orchestrator's assignedEmployeeId resolves to the worker's user id
      // (rowToEmployee.personEntityId) so the assignee surfaces on the inbox.
      const assigneeUserId = row.assignedEmployeeId;
      const priority =
        row.priority === 'urgent' || row.priority === 'high'
          ? row.priority
          : row.priority === 'low'
            ? 'low'
            : 'normal';
      try {
        await withCtx(db, async (tx) => {
          await (tx as unknown as DbExecLike).execute(sql`
            INSERT INTO mining_tasks (
              id, tenant_id, assigned_to_user_id, assigned_by_user_id,
              title_sw, title_en, description_sw, description_en,
              priority, status, due_at, hash_chain_id, kind, created_at
            ) VALUES (
              ${row.id}, ${row.tenantId}, ${assigneeUserId}, ${row.assignedByUserId},
              ${row.title}, ${row.title}, ${row.description}, ${row.description},
              ${priority}, 'pending',
              ${row.dueAt ? new Date(row.dueAt).toISOString() : null},
              ${row.auditChainId ?? null}, 'standard', NOW()
            )
            ON CONFLICT (id) DO NOTHING
          `);
        });
      } catch (err) {
        // assignTask awaits this write; a failure here is load-bearing. Log
        // it richly and rethrow so the caller surfaces the genuine fault.
        logger.error(
          { tenantId: row.tenantId, assignmentId: row.id, err: errMsg(err) },
          'workforce-store: insertAssignment into mining_tasks failed',
        );
        throw new Error(
          `workforce-store: insertAssignment failed — ${errMsg(err)}`,
        );
      }
      return row;
    },

    async getAssignment(tenantId, id) {
      if (!tenantId || !id) return null;
      try {
        return await withCtx(db, async (tx) => {
          const res = await (tx as unknown as DbExecLike).execute(sql`
            SELECT id, tenant_id, assigned_to_user_id, assigned_by_user_id,
                   title_sw, description_sw, priority, status, due_at,
                   hash_chain_id, completed_at, created_at
            FROM mining_tasks
            WHERE tenant_id = ${tenantId} AND id = ${id}
            LIMIT 1
          `);
          const row = rowsOf(res)[0];
          if (!row) return null;
          return mapMiningTaskRowToAssignment(row);
        });
      } catch (err) {
        logger.warn(
          { tenantId, assignmentId: id, err: errMsg(err) },
          'workforce-store: getAssignment read failed (honest-degrade → null)',
        );
        return null;
      }
    },

    async insertFollowup(row: WorkFollowup) {
      // No `work_followups` table exists in this repo (orchestrator migration
      // 0243 was never applied). Honest-degrade: log the scheduled slot
      // structurally so it is observable; never throw into assignTask's loop.
      // The durable spine writes are the mining_tasks assignment + the kickoff
      // push; followup persistence lands when the table ships.
      logger.info(
        {
          tenantId: row.tenantId,
          assignmentId: row.assignmentId,
          cadenceKind: row.cadenceKind,
          scheduledAt: row.scheduledAt,
          organ: 'workforce-store',
        },
        'workforce-store: followup scheduled (honest-degrade — no work_followups table yet; slot logged, not persisted)',
      );
      return row;
    },

    // ── Honest-degrade stubs for the non-assign entrypoints ──────────────
    async insertEmployee(row: Employee) {
      degrade('insertEmployee');
      return row;
    },
    async listEmployeesForManager() {
      degrade('listEmployeesForManager');
      return [];
    },
    async updateAssignment(row: WorkAssignment) {
      degrade('updateAssignment');
      return row;
    },
    async listOverdueAssignments() {
      degrade('listOverdueAssignments');
      return [];
    },
    async listBlockedAssignments() {
      degrade('listBlockedAssignments');
      return [];
    },
    async listAssignmentsForEmployee() {
      degrade('listAssignmentsForEmployee');
      return [];
    },
    async updateFollowup(row: WorkFollowup) {
      degrade('updateFollowup');
      return row;
    },
    async listDueFollowups() {
      degrade('listDueFollowups');
      return [];
    },
    async listFollowupsForAssignment() {
      degrade('listFollowupsForAssignment');
      return [];
    },
    async insertCheckIn(row: WorkCheckIn) {
      degrade('insertCheckIn');
      return row;
    },
    async updateCheckIn(row: WorkCheckIn) {
      degrade('updateCheckIn');
      return row;
    },
    async listCheckInsForAssignment() {
      degrade('listCheckInsForAssignment');
      return [];
    },
    async listCheckInsForEmployee() {
      degrade('listCheckInsForEmployee');
      return [];
    },
    async insertSignal(row) {
      degrade('insertSignal');
      return row;
    },
    async listSignalsForEmployee() {
      degrade('listSignalsForEmployee');
      return [];
    },
    async insertAdvisoryBrief(row) {
      degrade('insertAdvisoryBrief');
      return row;
    },
    async latestAdvisoryBrief() {
      degrade('latestAdvisoryBrief');
      return null;
    },
    async upsertSkillAssessment(row) {
      degrade('upsertSkillAssessment');
      return row;
    },
    async listSkillsForEmployee() {
      degrade('listSkillsForEmployee');
      return [];
    },
    async insertCoachingPrompt(row) {
      degrade('insertCoachingPrompt');
      return row;
    },
    async updateCoachingPrompt(row) {
      degrade('updateCoachingPrompt');
      return row;
    },
    async listPendingCoachingPrompts() {
      degrade('listPendingCoachingPrompts');
      return [];
    },
    async upsertKpi(row) {
      degrade('upsertKpi');
      return row;
    },
    async getKpiForDay() {
      degrade('getKpiForDay');
      return null;
    },
  };
}

/** Map a `mining_tasks` row back to the orchestrator's WorkAssignment view. */
function mapMiningTaskRowToAssignment(
  row: Record<string, unknown>,
): WorkAssignment {
  const status =
    row.status === 'in_progress'
      ? 'in_progress'
      : row.status === 'done'
        ? 'completed'
        : row.status === 'blocked'
          ? 'blocked'
          : row.status === 'cancelled'
            ? 'cancelled'
            : 'pending';
  const priority: 'low' | 'medium' | 'high' | 'urgent' =
    row.priority === 'urgent' || row.priority === 'high'
      ? row.priority
      : row.priority === 'low'
        ? 'low'
        : 'medium';
  // Parse through WorkAssignmentSchema so the mapped view matches the exact
  // orchestrator shape (and satisfies exactOptionalPropertyTypes).
  return WorkAssignmentSchema.parse({
    id: asString(row.id),
    tenantId: asString(row.tenant_id),
    missionId: null,
    title: asString(row.title_sw),
    description: asString(row.description_sw) || asString(row.title_sw),
    assignedEmployeeId: asString(row.assigned_to_user_id),
    assignedByUserId: asString(row.assigned_by_user_id),
    priority,
    dueAt:
      row.due_at instanceof Date
        ? row.due_at.toISOString()
        : asNullableString(row.due_at),
    estimatedEffortHours: null,
    status,
    riskTier: 'LOW',
    hitlRequired: false,
    assetRefs: [],
    createdByPersonaId: null,
    auditChainId: asNullableString(row.hash_chain_id),
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : asNullableString(row.completed_at),
  });
}

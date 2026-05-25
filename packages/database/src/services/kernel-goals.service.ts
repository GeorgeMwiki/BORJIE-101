/**
 * Kernel goals — Drizzle-backed GoalsPort.
 *
 * Adapts the `kernel_goals` table (migration 0123) to the kernel's
 * `GoalsPort` shape. Step decomposition rides as a JSON array on the
 * `steps` column; `updateStepStatus` rewrites the array immutably and
 * keeps `steps_total / steps_done` in sync.
 *
 * Hard DB failures degrade gracefully:
 *   - open      : logs + rethrows so the caller can surface the error
 *   - list      : returns [] on error
 *   - get       : returns null on error
 *   - update*   : logs + swallows (the executor records its own audit
 *                 trail, so a write failure doesn't lose the decision
 *                 history; it only loses the step-state mirror)
 *   - setStatus : logs + swallows
 */
import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { kernelGoals } from '../schemas/kernel-goals.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type GoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'abandoned'
  | 'stalled';

export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

export type GoalStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export interface GoalStep {
  readonly id: string;
  readonly seq: number;
  readonly description: string;
  readonly toolName: string | null;
  readonly toolPayload: Record<string, unknown> | null;
  readonly status: GoalStepStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly outcome: string | null;
  readonly errorMessage: string | null;
}

export interface GoalMetrics {
  readonly stepsTotal: number;
  readonly stepsDone: number;
}

export interface Goal {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly title: string;
  readonly description: string;
  readonly status: GoalStatus;
  readonly priority: GoalPriority;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly steps: ReadonlyArray<GoalStep>;
  readonly metrics: GoalMetrics;
}

export interface GoalStepDraft {
  readonly seq: number;
  readonly description: string;
  readonly toolName: string | null;
  readonly toolPayload: Record<string, unknown> | null;
}

export interface GoalOpenArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly title: string;
  readonly description: string;
  readonly status: GoalStatus;
  readonly priority: GoalPriority;
  readonly steps: ReadonlyArray<GoalStepDraft>;
}

export interface GoalListArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly status?: GoalStatus;
  readonly limit?: number;
}

export interface GoalUpdateStepArgs {
  readonly goalId: string;
  readonly stepId: string;
  readonly status: GoalStepStatus;
  readonly outcome?: string;
  readonly errorMessage?: string;
}

/**
 * Per-(tenant, user) summary row used by the wake-loop's stall-detection
 * sweep. `goalCount` is the number of `active` goals the user owns; the
 * wake-loop currently does not read it but operators / dashboards do.
 *
 * Mirrors the structural shape the wake-loop's `KernelGoalsRepoLike`
 * port (services/api-gateway/.../wake-loop-cron.ts) expects — that port
 * only requires `tenantId` and `userId` so the extra `goalCount` field
 * is purely additive.
 */
export interface StallScanTarget {
  readonly tenantId: string;
  readonly userId: string;
  readonly goalCount: number;
}

export interface KernelGoalsService {
  open(args: GoalOpenArgs): Promise<{ id: string }>;
  list(args: GoalListArgs): Promise<ReadonlyArray<Goal>>;
  get(id: string): Promise<Goal | null>;
  updateStepStatus(args: GoalUpdateStepArgs): Promise<void>;
  setStatus(id: string, status: GoalStatus): Promise<void>;
  /**
   * Aggregate `status='active'` goals grouped by (tenant_id, user_id)
   * so the wake-loop can sweep one user at a time without doing a
   * full-table scan. Returns at most {@link MAX_STALL_SCAN_GROUPS}
   * groups per call.
   *
   * When `tenantId` is provided the scan is bounded to that tenant —
   * matches how the wake-loop calls in: one tenant per outer loop tick.
   * Omit `tenantId` for cross-tenant ops sweeps.
   *
   * Hard failures degrade to an empty array so the wake-loop's outer
   * try/catch never collapses on a transient DB hiccup.
   */
  listStallScanTargets(
    tenantId?: string,
  ): Promise<ReadonlyArray<StallScanTarget>>;
  /**
   * Mark a goal as stalled. Sets `status = 'stalled'`,
   * `stall_reason = reason`, `stalled_at = NOW()`, and bumps
   * `updated_at`. No-op when the goal id does not exist (Drizzle's
   * UPDATE returns silently). Errors are logged + swallowed so the
   * wake-loop never crashes on a per-goal failure.
   */
  markStalled(goalId: string, reason: string): Promise<void>;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const MAX_STALL_SCAN_GROUPS = 500;
const MAX_STALL_REASON_LEN = 500;

export function createKernelGoalsService(
  db: DatabaseClient,
): KernelGoalsService {
  return {
    async open(args) {
      const id = randomUUID();
      const now = new Date();
      const steps: ReadonlyArray<GoalStep> = args.steps.map((draft) => ({
        id: randomUUID(),
        seq: draft.seq,
        description: draft.description,
        toolName: draft.toolName,
        toolPayload: draft.toolPayload,
        status: 'pending' as GoalStepStatus,
        startedAt: null,
        endedAt: null,
        outcome: null,
        errorMessage: null,
      }));
      try {
        await db.insert(kernelGoals).values({
          id,
          tenantId: args.tenantId,
          userId: args.userId,
          threadId: args.threadId,
          title: args.title,
          description: args.description,
          status: args.status,
          priority: args.priority,
          createdAt: now,
          updatedAt: now,
          steps: steps as unknown as Record<string, unknown>[],
          stepsTotal: steps.length,
          stepsDone: 0,
        } as never);
      } catch (error) {
        logger.error('kernel-goals.open failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('kernel-goals.open failed');
      }
      return { id };
    },

    async list(args) {
      try {
        if (!args.tenantId || !args.userId) return [];
        const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT);
        const conditions = args.status
          ? and(
              eq(kernelGoals.tenantId, args.tenantId),
              eq(kernelGoals.userId, args.userId),
              eq(kernelGoals.status, args.status),
            )
          : and(
              eq(kernelGoals.tenantId, args.tenantId),
              eq(kernelGoals.userId, args.userId),
            );
        const rows = (await db
          .select()
          .from(kernelGoals)
          .where(conditions)
          .orderBy(desc(kernelGoals.createdAt))
          .limit(limit)) as ReadonlyArray<GoalRow>;
        return (rows ?? []).map(rowToGoal);
      } catch (error) {
        logger.error('kernel-goals.list failed', { error: error });
        return [];
      }
    },

    async get(id) {
      try {
        if (!id) return null;
        const rows = (await db
          .select()
          .from(kernelGoals)
          .where(eq(kernelGoals.id, id))
          .limit(1)) as ReadonlyArray<GoalRow>;
        const row = rows?.[0];
        if (!row) return null;
        return rowToGoal(row);
      } catch (error) {
        logger.error('kernel-goals.get failed', { error: error });
        return null;
      }
    },

    async updateStepStatus(args) {
      try {
        const existing = await this.get(args.goalId);
        if (!existing) return;
        const now = new Date();
        const nowIso = now.toISOString();
        const nextSteps: ReadonlyArray<GoalStep> = existing.steps.map((s) => {
          if (s.id !== args.stepId) return s;
          const startedAt =
            args.status === 'running' && !s.startedAt ? nowIso : s.startedAt;
          const endedAt =
            args.status === 'done' ||
            args.status === 'failed' ||
            args.status === 'skipped'
              ? nowIso
              : s.endedAt;
          return {
            ...s,
            status: args.status,
            startedAt,
            endedAt,
            outcome: args.outcome ?? s.outcome,
            errorMessage: args.errorMessage ?? s.errorMessage,
          };
        });
        const stepsDone = nextSteps.filter((s) => s.status === 'done').length;
        await db
          .update(kernelGoals)
          .set({
            steps: nextSteps as unknown as Record<string, unknown>[],
            stepsDone,
            updatedAt: now,
          } as never)
          .where(eq(kernelGoals.id, args.goalId));
      } catch (error) {
        logger.error('kernel-goals.updateStepStatus failed', { error: error });
      }
    },

    async setStatus(id, status) {
      try {
        const now = new Date();
        const set: Record<string, unknown> = {
          status,
          updatedAt: now,
        };
        if (status === 'completed') set.completedAt = now;
        await db
          .update(kernelGoals)
          .set(set as never)
          .where(eq(kernelGoals.id, id));
      } catch (error) {
        logger.error('kernel-goals.setStatus failed', { error: error });
      }
    },

    async listStallScanTargets(tenantId) {
      try {
        if (tenantId !== undefined && !tenantId) return [];
        // `status = 'active'` is the only valid state for stall-scan
        // candidates — paused / blocked / completed / abandoned goals
        // have already absorbed their own status transition. Group-by
        // gives the wake-loop one row per (tenant, user) so it can run
        // the stall detector once per user instead of once per goal.
        const filter = tenantId
          ? and(
              eq(kernelGoals.status, 'active'),
              eq(kernelGoals.tenantId, tenantId),
            )
          : eq(kernelGoals.status, 'active');
        const rows = (await db
          .select({
            tenantId: kernelGoals.tenantId,
            userId: kernelGoals.userId,
            goalCount: sql<number>`COUNT(*)::int`,
          })
          .from(kernelGoals)
          .where(filter)
          .groupBy(kernelGoals.tenantId, kernelGoals.userId)
          .limit(MAX_STALL_SCAN_GROUPS)) as ReadonlyArray<{
          tenantId: string;
          userId: string;
          goalCount: number | string | null;
        }>;
        return (rows ?? [])
          .filter((r) => r && typeof r.tenantId === 'string' && typeof r.userId === 'string')
          .map((r) => ({
            tenantId: r.tenantId,
            userId: r.userId,
            goalCount:
              typeof r.goalCount === 'number'
                ? r.goalCount
                : typeof r.goalCount === 'string'
                  ? Number.parseInt(r.goalCount, 10) || 0
                  : 0,
          }));
      } catch (error) {
        logger.error('kernel-goals.listStallScanTargets failed', { error: error });
        return [];
      }
    },

    async markStalled(goalId, reason) {
      try {
        if (!goalId) return;
        const now = new Date();
        const safeReason = (reason ?? '').slice(0, MAX_STALL_REASON_LEN);
        await db
          .update(kernelGoals)
          .set({
            status: 'stalled',
            stallReason: safeReason,
            stalledAt: now,
            updatedAt: now,
          } as never)
          .where(eq(kernelGoals.id, goalId));
      } catch (error) {
        logger.error('kernel-goals.markStalled failed', { error: error });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface GoalRow {
  id: string;
  tenantId: string;
  userId: string;
  threadId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
  steps: unknown;
  stepsTotal: number | null;
  stepsDone: number | null;
}

function rowToGoal(row: GoalRow): Goal {
  const steps = parseSteps(row.steps);
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    threadId: row.threadId,
    title: row.title,
    description: row.description ?? '',
    status: (row.status as GoalStatus) ?? 'active',
    priority: (row.priority as GoalPriority) ?? 'medium',
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    steps,
    metrics: {
      stepsTotal: row.stepsTotal ?? steps.length,
      stepsDone:
        row.stepsDone ??
        steps.filter((s) => s.status === 'done').length,
    },
  };
}

function parseSteps(raw: unknown): ReadonlyArray<GoalStep> {
  if (!Array.isArray(raw)) return [];
  const out: GoalStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const seq = typeof obj.seq === 'number' ? obj.seq : 0;
    const description =
      typeof obj.description === 'string' ? obj.description : '';
    const toolName =
      typeof obj.toolName === 'string'
        ? obj.toolName
        : obj.toolName === null
          ? null
          : null;
    const toolPayload =
      obj.toolPayload && typeof obj.toolPayload === 'object'
        ? (obj.toolPayload as Record<string, unknown>)
        : null;
    const status = (typeof obj.status === 'string'
      ? obj.status
      : 'pending') as GoalStepStatus;
    const startedAt =
      typeof obj.startedAt === 'string' ? obj.startedAt : null;
    const endedAt =
      typeof obj.endedAt === 'string' ? obj.endedAt : null;
    const outcome = typeof obj.outcome === 'string' ? obj.outcome : null;
    const errorMessage =
      typeof obj.errorMessage === 'string' ? obj.errorMessage : null;
    if (!id) continue;
    out.push({
      id,
      seq,
      description,
      toolName,
      toolPayload,
      status,
      startedAt,
      endedAt,
      outcome,
      errorMessage,
    });
  }
  return out;
}

function toIso(input: Date | string): string {
  if (input instanceof Date) return input.toISOString();
  return String(input);
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIST_LIMIT);
}

export { kernelGoals };

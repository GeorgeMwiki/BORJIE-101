/**
 * Monthly close runs — Drizzle-backed adapter for the
 * `monthly_close_runs` and `monthly_close_run_steps` tables (migration
 * 0099, Wave 28 PhA2).
 *
 * Adapts to the orchestrator's `RunStorePort` shape
 * (`@borjie/ai-copilot/orchestrators/monthly-close`). The port is
 * duck-typed so this service does not compile-time-depend on ai-copilot.
 *
 * Idempotency:
 *   - createRun is a plain insert; the (tenantId, period_year, period_month)
 *     unique index in the schema rejects duplicates with a Postgres
 *     unique-violation. The orchestrator catches that and resumes the
 *     existing run via findRunByPeriod.
 *   - recordStep relies on the unique (run_id, step_name) index so
 *     re-entry after crash or awaiting_approval is safe; duplicates
 *     are surfaced to the orchestrator which calls findStep first.
 *
 * Hard DB failures bubble up — the orchestrator's caller decides
 * whether to retry. listRuns degrades to [] on error so dashboards
 * never crash.
 */

import { randomUUID } from 'crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import {

  monthlyCloseRuns,
  monthlyCloseRunSteps,
} from '../schemas/monthly-close-runs.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

export type RunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

export type Decision =
  | 'executed'
  | 'auto_approved'
  | 'awaiting_approval'
  | 'approved'
  | 'skipped'
  | 'failed';

export type Trigger = 'cron' | 'manual' | 'resume';

export interface StepRecordShape {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly stepName: string;
  readonly stepIndex: number;
  readonly decision: Decision;
  readonly actor: string;
  readonly policyRule: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly resultJson: Record<string, unknown>;
  readonly errorMessage: string | null;
}

export interface RunStateShape {
  readonly id: string;
  readonly tenantId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: RunStatus;
  readonly trigger: Trigger;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly triggeredBy: string;
  readonly reconciledPayments: number;
  readonly statementsGenerated: number;
  readonly kraMriTotalMinor: number;
  readonly disbursementTotalMinor: number;
  readonly currency: string | null;
  readonly summary: Record<string, unknown>;
  readonly lastError: string | null;
  readonly steps: ReadonlyArray<StepRecordShape>;
}

export interface CreateRunArgs {
  readonly tenantId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly trigger: Trigger;
  readonly triggeredBy: string;
}

export interface RecordStepArgs {
  readonly runId: string;
  readonly tenantId: string;
  readonly stepName: string;
  readonly stepIndex: number;
  readonly decision: Decision;
  readonly actor: string;
  readonly policyRule: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly resultJson: Record<string, unknown>;
  readonly errorMessage: string | null;
}

export type RunPatch = Partial<{
  status: RunStatus;
  completedAt: string | null;
  reconciledPayments: number;
  statementsGenerated: number;
  kraMriTotalMinor: number;
  disbursementTotalMinor: number;
  currency: string | null;
  summary: Record<string, unknown>;
  lastError: string | null;
}>;

export interface MonthlyCloseRunsService {
  createRun(input: CreateRunArgs): Promise<RunStateShape>;
  findRunByPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<RunStateShape | null>;
  findRunById(runId: string, tenantId: string): Promise<RunStateShape | null>;
  listRuns(
    tenantId: string,
    limit?: number,
  ): Promise<ReadonlyArray<RunStateShape>>;
  updateRun(
    runId: string,
    tenantId: string,
    patch: RunPatch,
  ): Promise<RunStateShape>;
  recordStep(input: RecordStepArgs): Promise<StepRecordShape>;
  findStep(runId: string, stepName: string): Promise<StepRecordShape | null>;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function createMonthlyCloseRunsService(
  db: DatabaseClient,
): MonthlyCloseRunsService {
  async function loadStepsFor(
    runId: string,
  ): Promise<ReadonlyArray<StepRecordShape>> {
    try {
      const rows = (await db
        .select()
        .from(monthlyCloseRunSteps)
        .where(eq(monthlyCloseRunSteps.runId, runId))
        .orderBy(asc(monthlyCloseRunSteps.stepIndex))) as ReadonlyArray<StepRowDb>;
      return rows.map(rowToStep);
    } catch (error) {
      logger.error('monthly-close-runs.loadStepsFor failed', { error: error });
      return [];
    }
  }

  async function loadRunByMatcher(
    matcher: ReturnType<typeof eq>,
  ): Promise<RunStateShape | null> {
    const rows = (await db
      .select()
      .from(monthlyCloseRuns)
      .where(matcher)
      .limit(1)) as ReadonlyArray<RunRowDb>;
    const row = rows?.[0];
    if (!row) return null;
    const steps = await loadStepsFor(row.id);
    return rowToRun(row, steps);
  }

  return {
    async createRun(input) {
      if (
        !input.tenantId ||
        !Number.isInteger(input.periodYear) ||
        !Number.isInteger(input.periodMonth)
      ) {
        throw new Error(
          'monthly-close-runs.createRun requires tenantId, periodYear, periodMonth',
        );
      }
      const id = randomUUID();
      const now = new Date();
      try {
        await db.insert(monthlyCloseRuns).values({
          id,
          tenantId: input.tenantId,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          status: 'running',
          trigger: input.trigger,
          startedAt: now,
          triggeredBy: input.triggeredBy,
          reconciledPayments: 0,
          statementsGenerated: 0,
          kraMriTotalMinor: 0,
          disbursementTotalMinor: 0,
          summaryJson: {},
          createdAt: now,
          updatedAt: now,
        } as never);
        const created = await this.findRunById(id, input.tenantId);
        if (!created) {
          throw new Error('createRun: row not found after insert');
        }
        return created;
      } catch (error) {
        logger.error('monthly-close-runs.createRun failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('monthly-close-runs.createRun failed');
      }
    },

    async findRunByPeriod(tenantId, periodYear, periodMonth) {
      try {
        if (!tenantId) return null;
        return loadRunByMatcher(
          and(
            eq(monthlyCloseRuns.tenantId, tenantId),
            eq(monthlyCloseRuns.periodYear, periodYear),
            eq(monthlyCloseRuns.periodMonth, periodMonth),
          ) as ReturnType<typeof eq>,
        );
      } catch (error) {
        logger.error('monthly-close-runs.findRunByPeriod failed', { error: error });
        return null;
      }
    },

    async findRunById(runId, tenantId) {
      try {
        if (!runId || !tenantId) return null;
        return loadRunByMatcher(
          and(
            eq(monthlyCloseRuns.id, runId),
            eq(monthlyCloseRuns.tenantId, tenantId),
          ) as ReturnType<typeof eq>,
        );
      } catch (error) {
        logger.error('monthly-close-runs.findRunById failed', { error: error });
        return null;
      }
    },

    async listRuns(tenantId, limit) {
      try {
        if (!tenantId) return [];
        const cap = clampLimit(limit, DEFAULT_LIMIT);
        const rows = (await db
          .select()
          .from(monthlyCloseRuns)
          .where(eq(monthlyCloseRuns.tenantId, tenantId))
          .orderBy(desc(monthlyCloseRuns.startedAt))
          .limit(cap)) as ReadonlyArray<RunRowDb>;
        const out: RunStateShape[] = [];
        for (const row of rows) {
          out.push(rowToRun(row, []));
        }
        return out;
      } catch (error) {
        logger.error('monthly-close-runs.listRuns failed', { error: error });
        return [];
      }
    },

    async updateRun(runId, tenantId, patch) {
      if (!runId || !tenantId) {
        throw new Error('monthly-close-runs.updateRun requires runId, tenantId');
      }
      const setClause: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.status !== undefined) setClause.status = patch.status;
      if (patch.completedAt !== undefined) {
        setClause.completedAt = patch.completedAt
          ? new Date(patch.completedAt)
          : null;
      }
      if (patch.reconciledPayments !== undefined) {
        setClause.reconciledPayments = patch.reconciledPayments;
      }
      if (patch.statementsGenerated !== undefined) {
        setClause.statementsGenerated = patch.statementsGenerated;
      }
      if (patch.kraMriTotalMinor !== undefined) {
        setClause.kraMriTotalMinor = patch.kraMriTotalMinor;
      }
      if (patch.disbursementTotalMinor !== undefined) {
        setClause.disbursementTotalMinor = patch.disbursementTotalMinor;
      }
      if (patch.currency !== undefined) setClause.currency = patch.currency;
      if (patch.summary !== undefined) setClause.summaryJson = patch.summary;
      if (patch.lastError !== undefined) setClause.lastError = patch.lastError;

      try {
        await db
          .update(monthlyCloseRuns)
          .set(setClause as never)
          .where(
            and(
              eq(monthlyCloseRuns.id, runId),
              eq(monthlyCloseRuns.tenantId, tenantId),
            ),
          );
        const updated = await this.findRunById(runId, tenantId);
        if (!updated) {
          throw new Error('updateRun: row not found after update');
        }
        return updated;
      } catch (error) {
        logger.error('monthly-close-runs.updateRun failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('monthly-close-runs.updateRun failed');
      }
    },

    async recordStep(input) {
      if (!input.runId || !input.tenantId || !input.stepName) {
        throw new Error(
          'monthly-close-runs.recordStep requires runId, tenantId, stepName',
        );
      }
      const id = randomUUID();
      try {
        await db.insert(monthlyCloseRunSteps).values({
          id,
          runId: input.runId,
          tenantId: input.tenantId,
          stepName: input.stepName,
          stepIndex: input.stepIndex,
          decision: input.decision,
          actor: input.actor,
          policyRule: input.policyRule,
          startedAt: new Date(input.startedAt),
          completedAt: input.completedAt ? new Date(input.completedAt) : null,
          durationMs: input.durationMs,
          resultJson: input.resultJson,
          errorMessage: input.errorMessage,
          createdAt: new Date(),
        } as never);
        return {
          id,
          runId: input.runId,
          tenantId: input.tenantId,
          stepName: input.stepName,
          stepIndex: input.stepIndex,
          decision: input.decision,
          actor: input.actor,
          policyRule: input.policyRule,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          durationMs: input.durationMs,
          resultJson: input.resultJson,
          errorMessage: input.errorMessage,
        };
      } catch (error) {
        logger.error('monthly-close-runs.recordStep failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('monthly-close-runs.recordStep failed');
      }
    },

    async findStep(runId, stepName) {
      try {
        if (!runId || !stepName) return null;
        const rows = (await db
          .select()
          .from(monthlyCloseRunSteps)
          .where(
            and(
              eq(monthlyCloseRunSteps.runId, runId),
              eq(monthlyCloseRunSteps.stepName, stepName),
            ),
          )
          .limit(1)) as ReadonlyArray<StepRowDb>;
        const row = rows?.[0];
        return row ? rowToStep(row) : null;
      } catch (error) {
        logger.error('monthly-close-runs.findStep failed', { error: error });
        return null;
      }
    },
  };
}

interface RunRowDb {
  id: string;
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  periodStart: Date | string;
  periodEnd: Date | string;
  status: string;
  trigger: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  triggeredBy: string;
  reconciledPayments: number | null;
  statementsGenerated: number | null;
  kraMriTotalMinor: number | string | null;
  disbursementTotalMinor: number | string | null;
  currency: string | null;
  summaryJson: unknown;
  lastError: string | null;
}

interface StepRowDb {
  id: string;
  runId: string;
  tenantId: string;
  stepName: string;
  stepIndex: number;
  decision: string;
  actor: string;
  policyRule: string | null;
  startedAt: Date | string;
  completedAt: Date | string | null;
  durationMs: number | null;
  resultJson: unknown;
  errorMessage: string | null;
}

function rowToRun(
  row: RunRowDb,
  steps: ReadonlyArray<StepRecordShape>,
): RunStateShape {
  return {
    id: row.id,
    tenantId: row.tenantId,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    periodStart: toIso(row.periodStart),
    periodEnd: toIso(row.periodEnd),
    status: parseRunStatus(row.status),
    trigger: parseTrigger(row.trigger),
    startedAt: toIso(row.startedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    triggeredBy: row.triggeredBy,
    reconciledPayments: row.reconciledPayments ?? 0,
    statementsGenerated: row.statementsGenerated ?? 0,
    kraMriTotalMinor: Number(row.kraMriTotalMinor ?? 0),
    disbursementTotalMinor: Number(row.disbursementTotalMinor ?? 0),
    currency: row.currency,
    summary:
      row.summaryJson && typeof row.summaryJson === 'object'
        ? (row.summaryJson as Record<string, unknown>)
        : {},
    lastError: row.lastError,
    steps,
  };
}

function rowToStep(row: StepRowDb): StepRecordShape {
  return {
    id: row.id,
    runId: row.runId,
    tenantId: row.tenantId,
    stepName: row.stepName,
    stepIndex: row.stepIndex,
    decision: parseDecision(row.decision),
    actor: row.actor,
    policyRule: row.policyRule,
    startedAt: toIso(row.startedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    durationMs: row.durationMs,
    resultJson:
      row.resultJson && typeof row.resultJson === 'object'
        ? (row.resultJson as Record<string, unknown>)
        : {},
    errorMessage: row.errorMessage,
  };
}

function parseRunStatus(value: string): RunStatus {
  if (
    value === 'running' ||
    value === 'awaiting_approval' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped'
  ) {
    return value;
  }
  return 'running';
}

function parseTrigger(value: string): Trigger {
  if (value === 'cron' || value === 'manual' || value === 'resume') {
    return value;
  }
  return 'cron';
}

function parseDecision(value: string): Decision {
  if (
    value === 'executed' ||
    value === 'auto_approved' ||
    value === 'awaiting_approval' ||
    value === 'approved' ||
    value === 'skipped' ||
    value === 'failed'
  ) {
    return value;
  }
  return 'executed';
}

function toIso(input: Date | string): string {
  return input instanceof Date ? input.toISOString() : String(input);
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIMIT);
}

export { monthlyCloseRuns, monthlyCloseRunSteps };

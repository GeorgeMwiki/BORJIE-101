/**
 * Agency run checkpoints — Drizzle-backed durable state for the
 * agency executor (Central Command Phase A gap #7).
 *
 * One row per (run_id, step_index). The durable runner uses this
 * service to:
 *
 *   1. `recordPending(args)`     — INSERT a `pending` row before invoke
 *   2. `recordRunning(id)`       — UPDATE to `running` immediately
 *      before invoke; bumps `attempt_count` on retries
 *   3. `recordSuccess(id, out)`  — UPDATE to `success`
 *   4. `recordFailure(id, msg)`  — UPDATE to `failure`
 *   5. `recordPaused(id, msg)`   — UPDATE to `paused` (retries exhausted)
 *   6. `listForRun(runId)`       — replay-ordered list (resume helper)
 *   7. `listStuckRunning(args)`  — recovery sweep
 *
 * Hard DB failures degrade gracefully:
 *   - record*    : logs + RE-THROWS (durable contract — caller must
 *                  know the checkpoint write failed; durable-runner
 *                  treats this as a transient error and retries)
 *   - list*      : returns [] on error
 *
 * NOTE: the contract intentionally differs from kernel-goals's
 * "swallow + log" pattern. A goal-state-mirror failure is recoverable
 * (the audit sink is the source of truth there). A CHECKPOINT failure
 * means the durable contract is broken — the caller cannot proceed as
 * if the checkpoint wrote.
 */
import { randomUUID } from 'crypto';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import {

  agencyRunCheckpoints,
  type AgencyCheckpointState,
} from '../schemas/agency-run-checkpoints.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

export type { AgencyCheckpointState };

export interface AgencyCheckpointRow {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly goalId: string;
  readonly stepIndex: number;
  readonly stepName: string;
  readonly state: AgencyCheckpointState;
  readonly attemptCount: number;
  readonly inputPayload: Record<string, unknown>;
  readonly outputPayload: Record<string, unknown> | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface RecordPendingArgs {
  readonly tenantId: string;
  readonly runId: string;
  readonly goalId: string;
  readonly stepIndex: number;
  readonly stepName: string;
  readonly inputPayload: Record<string, unknown>;
}

export interface ListStuckRunningArgs {
  /** Rows in `running` whose `started_at` is older than this date are
   *  considered crashed/stuck. */
  readonly olderThan: Date;
  /** Cap the result set so a runaway scan can't blow up memory. */
  readonly limit?: number;
}

export interface AgencyRunCheckpointsService {
  recordPending(args: RecordPendingArgs): Promise<{ id: string }>;
  recordRunning(id: string): Promise<void>;
  recordSuccess(
    id: string,
    output: Record<string, unknown> | null,
  ): Promise<void>;
  recordFailure(id: string, errorMessage: string): Promise<void>;
  recordPaused(id: string, errorMessage: string): Promise<void>;
  listForRun(runId: string): Promise<ReadonlyArray<AgencyCheckpointRow>>;
  listStuckRunning(
    args: ListStuckRunningArgs,
  ): Promise<ReadonlyArray<AgencyCheckpointRow>>;
  /** Test/operator helper — find a single checkpoint by primary key. */
  getById(id: string): Promise<AgencyCheckpointRow | null>;
}

const DEFAULT_STUCK_LIMIT = 100;
const MAX_STUCK_LIMIT = 500;
const MAX_ERROR_LEN = 2000;

export function createAgencyRunCheckpointsService(
  db: DatabaseClient,
): AgencyRunCheckpointsService {
  return {
    async recordPending(args) {
      const id = randomUUID();
      try {
        await db
          .insert(agencyRunCheckpoints)
          .values({
            id,
            tenantId: args.tenantId,
            runId: args.runId,
            goalId: args.goalId,
            stepIndex: args.stepIndex,
            stepName: args.stepName,
            state: 'pending',
            attemptCount: 0,
            inputPayload: args.inputPayload as never,
            startedAt: new Date(),
          } as never);
      } catch (error) {
        logger.error('agency-run-checkpoints.recordPending failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('agency-run-checkpoints.recordPending failed');
      }
      return { id };
    },

    async recordRunning(id) {
      try {
        // Bump attempt_count atomically — the SQL fragment ensures
        // concurrent retries can't lose updates if two recovery sweeps
        // race for the same row.
        await db
          .update(agencyRunCheckpoints)
          .set({
            state: 'running',
            attemptCount: sql`${agencyRunCheckpoints.attemptCount} + 1`,
          } as never)
          .where(eq(agencyRunCheckpoints.id, id));
      } catch (error) {
        logger.error('agency-run-checkpoints.recordRunning failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('agency-run-checkpoints.recordRunning failed');
      }
    },

    async recordSuccess(id, output) {
      try {
        await db
          .update(agencyRunCheckpoints)
          .set({
            state: 'success',
            outputPayload: (output ?? {}) as never,
            completedAt: new Date(),
            errorMessage: null,
          } as never)
          .where(eq(agencyRunCheckpoints.id, id));
      } catch (error) {
        logger.error('agency-run-checkpoints.recordSuccess failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('agency-run-checkpoints.recordSuccess failed');
      }
    },

    async recordFailure(id, errorMessage) {
      try {
        await db
          .update(agencyRunCheckpoints)
          .set({
            state: 'failure',
            errorMessage: truncate(errorMessage),
            completedAt: new Date(),
          } as never)
          .where(eq(agencyRunCheckpoints.id, id));
      } catch (error) {
        logger.error('agency-run-checkpoints.recordFailure failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('agency-run-checkpoints.recordFailure failed');
      }
    },

    async recordPaused(id, errorMessage) {
      try {
        await db
          .update(agencyRunCheckpoints)
          .set({
            state: 'paused',
            errorMessage: truncate(errorMessage),
            completedAt: new Date(),
          } as never)
          .where(eq(agencyRunCheckpoints.id, id));
      } catch (error) {
        logger.error('agency-run-checkpoints.recordPaused failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('agency-run-checkpoints.recordPaused failed');
      }
    },

    async listForRun(runId) {
      try {
        if (!runId) return [];
        const rows = (await db
          .select()
          .from(agencyRunCheckpoints)
          .where(eq(agencyRunCheckpoints.runId, runId))
          .orderBy(asc(agencyRunCheckpoints.stepIndex))) as ReadonlyArray<unknown>;
        return rows.map(rowToCheckpoint);
      } catch (error) {
        logger.error('agency-run-checkpoints.listForRun failed', { error: error });
        return [];
      }
    },

    async listStuckRunning(args) {
      try {
        const limit = clampLimit(args.limit, DEFAULT_STUCK_LIMIT);
        const rows = (await db
          .select()
          .from(agencyRunCheckpoints)
          .where(
            and(
              eq(agencyRunCheckpoints.state, 'running'),
              lt(agencyRunCheckpoints.startedAt, args.olderThan),
            ),
          )
          .orderBy(asc(agencyRunCheckpoints.startedAt))
          .limit(limit)) as ReadonlyArray<unknown>;
        return rows.map(rowToCheckpoint);
      } catch (error) {
        logger.error('agency-run-checkpoints.listStuckRunning failed', { error: error });
        return [];
      }
    },

    async getById(id) {
      try {
        if (!id) return null;
        const rows = (await db
          .select()
          .from(agencyRunCheckpoints)
          .where(eq(agencyRunCheckpoints.id, id))
          .limit(1)) as ReadonlyArray<unknown>;
        const row = rows[0];
        return row ? rowToCheckpoint(row) : null;
      } catch (error) {
        logger.error('agency-run-checkpoints.getById failed', { error: error });
        return null;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  tenantId: string;
  runId: string;
  goalId: string;
  stepIndex: number;
  stepName: string;
  state: string;
  attemptCount: number;
  inputPayload: unknown;
  outputPayload: unknown;
  errorMessage: string | null;
  startedAt: Date | string;
  completedAt: Date | string | null;
}

function rowToCheckpoint(raw: unknown): AgencyCheckpointRow {
  const row = raw as RawRow;
  return {
    id: row.id,
    tenantId: row.tenantId,
    runId: row.runId,
    goalId: row.goalId,
    stepIndex: typeof row.stepIndex === 'number' ? row.stepIndex : 0,
    stepName: row.stepName,
    state: (row.state as AgencyCheckpointState) ?? 'pending',
    attemptCount:
      typeof row.attemptCount === 'number' ? row.attemptCount : 0,
    inputPayload:
      row.inputPayload && typeof row.inputPayload === 'object'
        ? (row.inputPayload as Record<string, unknown>)
        : {},
    outputPayload:
      row.outputPayload && typeof row.outputPayload === 'object'
        ? (row.outputPayload as Record<string, unknown>)
        : null,
    errorMessage: row.errorMessage ?? null,
    startedAt: toIso(row.startedAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
  };
}

function toIso(input: Date | string): string {
  if (input instanceof Date) return input.toISOString();
  return String(input);
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_STUCK_LIMIT);
}

function truncate(message: string): string {
  if (!message) return '';
  return message.length > MAX_ERROR_LEN
    ? message.slice(0, MAX_ERROR_LEN)
    : message;
}

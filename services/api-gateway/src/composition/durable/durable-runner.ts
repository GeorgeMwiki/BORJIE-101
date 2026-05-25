/**
 * durable-runner — wraps the agency executor with retry + checkpointing
 * + crash-recovery semantics. Central Command Phase A gap #7.
 *
 * Today's pain (see `.planning/research/central-command/2025-bn-internal-
 * gap-audit.md` §6): `agency/executor/executor.ts` walks linearly and
 * bails on the first failure. A process crash mid-tool leaves goals in
 * `running` with no recovery hint. There is no per-step retry, no
 * exponential backoff, no operator-resumable goal state.
 *
 * What this module adds (without a third-party orchestrator):
 *
 *   1. Per-step CHECKPOINTING — every step gets a row in
 *      `agency_run_checkpoints` BEFORE the executor invokes the tool.
 *   2. RETRY with exponential backoff — up to `maxAttempts` (default
 *      3) on transient failure. Backoff: 200ms → 400ms → 800ms.
 *   3. PAUSED state on exhaustion — `failure` after the last attempt
 *      becomes `paused` so an operator can resume.
 *   4. CRASH-RECOVERY — `recoverStuckRuns()` scans for `running`
 *      checkpoints older than `recoveryStalenessMs` (default 5min)
 *      and resumes those runs from the last `success`.
 *   5. OTel spans — every transition emits a child span
 *      `agency.step.{stepIndex}.{state}` so operators can grep traces
 *      for retries.
 *
 * Architectural notes:
 *
 *   - The runner DELEGATES the actual tool invocation to the existing
 *     executor (`createExecutor` from @borjie/central-intelligence).
 *     This module is a PURE wrapper — it does not duplicate
 *     audit-sink / four-eye / sovereign-ledger logic. Those still run
 *     inside the executor.
 *   - Step granularity = the executor's step granularity. The runner
 *     CHECKPOINTS the executor's outcome, not its internal kernel
 *     pipeline events.
 *   - The runner is INNGEST-COMPATIBLE in spirit: same retry +
 *     checkpoint pattern. Phase B may promote to real Inngest with
 *     ZERO change to the executor's public surface — only the runner
 *     swaps.
 *
 * Out of scope (Phase B):
 *
 *   - Multi-process leader election (uses pg_advisory_lock when wired
 *     to the wake-loop-cron supervisor; the runner itself is single-
 *     process).
 *   - Compensating-action workflow on `paused` runs.
 *   - Real Inngest / Temporal swap-in.
 */

import { randomUUID } from 'crypto';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { agency as agencyKernel } from '@borjie/central-intelligence';
import type { StepCheckpointStore, AdvisoryLockDbClient } from './step-checkpoint-store.js';
import {
  AGENCY_RUN_EVENT,
  type InngestClientLike,
} from './inngest-client.js';

// Re-aliased to keep call-sites tidy; the kernel exports these only
// via the `agency` namespace (see central-intelligence/src/kernel/
// index.ts:480).
type Executor = agencyKernel.Executor;
type ExecutorOutcome = agencyKernel.ExecutorOutcome;
type GoalsPort = agencyKernel.GoalsPort;
type GoalStep = agencyKernel.GoalStep;

/** Backoff schedule (ms) for retries. Exponential base 2 with 200ms
 *  unit. The runner sleeps between attempts. */
const DEFAULT_BACKOFFS_MS: ReadonlyArray<number> = [200, 400, 800];

/** Max number of attempts (initial + retries) before transitioning the
 *  step from `failure` → `paused`. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Default crash-recovery staleness window (ms). A checkpoint in
 *  `running` whose `started_at` is older than this is considered
 *  crashed and eligible for recovery. */
const DEFAULT_RECOVERY_STALENESS_MS = 5 * 60_000;

const TRACER_NAME = 'borjie.api-gateway.durable-runner';

export interface DurableRunnerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

export interface DurableRunnerDeps {
  /** The underlying executor that actually invokes tools. */
  readonly executor: Executor;
  /** Read-only goal port — needed to plan checkpoints per step. */
  readonly goals: Pick<GoalsPort, 'get'>;
  /** Drizzle-backed checkpoint store (or any port-equivalent). */
  readonly checkpoints: StepCheckpointStore;
  /** Optional logger. Defaults to a console-bridged stub. */
  readonly logger?: DurableRunnerLogger;
  /** Overrides the default backoff schedule (ms). */
  readonly backoffsMs?: ReadonlyArray<number>;
  /** Overrides the default max attempts. */
  readonly maxAttempts?: number;
  /** Crash-recovery staleness window (ms). */
  readonly recoveryStalenessMs?: number;
  /** Sleeper — defaults to setTimeout. Tests inject a no-op. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Clock — defaults to Date.now. */
  readonly clock?: () => Date;
  /**
   * Optional postgres client for the advisory-lock-guarded recovery
   * scan. When set, `recoverStuckRuns()` wraps the stuck-rows lookup in
   * `BEGIN / pg_advisory_xact_lock(hashtext(ns)) / COMMIT` so multiple
   * gateway replicas can't double-recover the same row. When unset,
   * recovery falls back to a lock-free scan (single-replica deploys).
   */
  readonly db?: AdvisoryLockDbClient;
  /**
   * Namespace string for the recovery advisory lock. Defaults to
   * `'agency-recovery'`. Override per-deploy when multiple runners
   * share a database but should NOT contend for the same lock.
   */
  readonly recoveryLockNamespace?: string;
  /**
   * Optional Inngest client. When wired, `executeGoal()` becomes a
   * thin dispatcher that emits `agency/run.requested` and returns an
   * outcome with `pauseReason='dispatched-to-inngest'`. The actual
   * agency execution runs on the Inngest worker (see
   * `inngest-functions/agency-run.fn.ts`). On `send()` throw the
   * runner falls back to inline execution so we never lose a run.
   */
  readonly inngest?: InngestClientLike;
}

export interface DurableRunArgs {
  readonly tenantId: string;
  readonly goalId: string;
  /** Optional stable run-id; defaults to a freshly-generated one
   *  (so the runner can be called from both wake-cycle and recovery
   *  paths without collision). */
  readonly runId?: string;
}

export interface DurableRunOutcome {
  readonly runId: string;
  readonly goalId: string;
  readonly tenantId: string;
  /** The executor's own outcome — preserved verbatim so callers don't
   *  need a separate executor reference. */
  readonly executorOutcome: ExecutorOutcome | null;
  /** Number of checkpoints in state=`paused` at end of run (steps
   *  whose retries exhausted). */
  readonly pausedCheckpoints: number;
  /** True when no step transitioned to `paused`. */
  readonly completed: boolean;
  /** Total retry attempts logged across all steps. */
  readonly retries: number;
  /** When a paused step exists, the error message of the FIRST one
   *  the operator should look at. */
  readonly pauseReason: string | null;
}

export interface DurableRunner {
  /**
   * Execute one goal with checkpointing + retry semantics.
   * Idempotent on (tenantId, goalId, runId): re-calling with the
   * same runId resumes from the last `success` checkpoint.
   */
  executeGoal(args: DurableRunArgs): Promise<DurableRunOutcome>;
  /**
   * Sweep the checkpoint store for stuck `running` rows older than
   * the staleness window and resume the affected runs. Returns the
   * outcome of every recovered run.
   */
  recoverStuckRuns(): Promise<ReadonlyArray<DurableRunOutcome>>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    if (typeof handle.unref === 'function') handle.unref();
  });

function defaultLogger(): DurableRunnerLogger {
  /* eslint-disable no-console */
  return {
    info: (obj, msg) => console.info('durable-runner:', msg ?? '', obj),
    warn: (obj, msg) => console.warn('durable-runner:', msg ?? '', obj),
    error: (obj, msg) => console.error('durable-runner:', msg ?? '', obj),
  };
  /* eslint-enable no-console */
}

function makeRunId(): string {
  // crypto.randomUUID is browser-safe and Node-safe; avoid a heavy
  // import for this one-shot identifier.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `run_${globalThis.crypto.randomUUID()}`;
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Emit an OTel child span tagged
 * `agency.step.{stepIndex}.{state}`. The span is recorded
 * synchronously (no children) so even if the tool invocation crashes
 * the trace surfaces the pre-crash checkpoint state.
 */
function emitTransitionSpan(args: {
  readonly tenantId: string;
  readonly runId: string;
  readonly goalId: string;
  readonly stepIndex: number;
  readonly stepName: string;
  readonly state: 'pending' | 'running' | 'success' | 'failure' | 'paused';
  readonly attempt: number;
  readonly errorMessage?: string | null;
}): void {
  try {
    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(
      `agency.step.${args.stepIndex}.${args.state}`,
      {
        attributes: {
          'borjie.tenant_id': args.tenantId,
          'borjie.run_id': args.runId,
          'borjie.goal_id': args.goalId,
          'borjie.step_index': args.stepIndex,
          'borjie.step_name': args.stepName,
          'borjie.state': args.state,
          'borjie.attempt': args.attempt,
        },
      },
    );
    if (args.errorMessage) {
      span.setAttribute('borjie.error', args.errorMessage);
    }
    if (args.state === 'failure' || args.state === 'paused') {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  } catch {
    // OTel must never crash the runner — swallow.
  }
}

interface StepRunResult {
  readonly checkpointId: string;
  readonly succeeded: boolean;
  readonly paused: boolean;
  readonly attempts: number;
  readonly errorMessage: string | null;
}

export function createDurableRunner(deps: DurableRunnerDeps): DurableRunner {
  const logger = deps.logger ?? defaultLogger();
  const backoffs =
    deps.backoffsMs && deps.backoffsMs.length > 0
      ? deps.backoffsMs
      : DEFAULT_BACKOFFS_MS;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const staleness = Math.max(
    1_000,
    deps.recoveryStalenessMs ?? DEFAULT_RECOVERY_STALENESS_MS,
  );
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.clock ?? (() => new Date());
  const checkpoints: StepCheckpointStore = deps.checkpoints;
  const executor: Executor = deps.executor;
  const lockDb: AdvisoryLockDbClient | undefined = deps.db;
  const recoveryLockNamespace = deps.recoveryLockNamespace ?? 'agency-recovery';
  const inngest: InngestClientLike | undefined = deps.inngest;

  async function runStep(args: {
    readonly tenantId: string;
    readonly runId: string;
    readonly goalId: string;
    readonly stepIndex: number;
    readonly step: GoalStep;
  }): Promise<StepRunResult> {
    const stepName = args.step.toolName ?? `informational-${args.step.seq}`;

    // 1) record pending — INSERT
    const { id: checkpointId } = await checkpoints.pending({
      tenantId: args.tenantId,
      runId: args.runId,
      goalId: args.goalId,
      stepIndex: args.stepIndex,
      stepName,
      inputPayload: (args.step.toolPayload as Record<string, unknown>) ?? {},
    });
    emitTransitionSpan({
      tenantId: args.tenantId,
      runId: args.runId,
      goalId: args.goalId,
      stepIndex: args.stepIndex,
      stepName,
      state: 'pending',
      attempt: 0,
    });

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // 2) record running — UPDATE (bumps attempt_count)
      try {
        await checkpoints.running(checkpointId);
      } catch (err) {
        // Checkpoint write failure is itself a retryable transient.
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt >= maxAttempts) break;
        await sleep(backoffs[Math.min(attempt - 1, backoffs.length - 1)] ?? 0);
        continue;
      }
      emitTransitionSpan({
        tenantId: args.tenantId,
        runId: args.runId,
        goalId: args.goalId,
        stepIndex: args.stepIndex,
        stepName,
        state: 'running',
        attempt,
      });

      // 3) invoke the underlying executor's executeGoal — the executor
      //    walks the WHOLE goal internally; for single-step semantics
      //    we still call executeGoal but inspect the outcome's step
      //    counts. The executor is idempotent per-step (already-
      //    completed steps are skipped), so on retry we effectively
      //    re-attempt only the failed step.
      let execOutcome: ExecutorOutcome | null = null;
      let invokeError: string | null = null;
      try {
        execOutcome = await executor.executeGoal(args.goalId);
      } catch (err) {
        invokeError = err instanceof Error ? err.message : String(err);
      }

      // The executor's `stepsFailed` / failureMessages tell us whether
      // THIS step's invocation worked. We treat zero failures as
      // success at the runner layer.
      if (!invokeError && execOutcome) {
        const succeeded =
          execOutcome.stepsFailed === 0 &&
          execOutcome.failureMessages.length === 0;
        if (succeeded) {
          try {
            await checkpoints.success(checkpointId, {
              stepsSucceeded: execOutcome.stepsSucceeded,
              stepsAwaitingApproval: execOutcome.stepsAwaitingApproval,
            });
          } catch (err) {
            // Inability to write the success checkpoint is fatal to
            // the durable contract — surface it so the caller can
            // dispatch a reconciliation flow.
            lastError = err instanceof Error ? err.message : String(err);
            emitTransitionSpan({
              tenantId: args.tenantId,
              runId: args.runId,
              goalId: args.goalId,
              stepIndex: args.stepIndex,
              stepName,
              state: 'failure',
              attempt,
              errorMessage: `checkpoint-success-write-failed: ${lastError}`,
            });
            return {
              checkpointId,
              succeeded: false,
              paused: false,
              attempts: attempt,
              errorMessage: lastError,
            };
          }
          emitTransitionSpan({
            tenantId: args.tenantId,
            runId: args.runId,
            goalId: args.goalId,
            stepIndex: args.stepIndex,
            stepName,
            state: 'success',
            attempt,
          });
          return {
            checkpointId,
            succeeded: true,
            paused: false,
            attempts: attempt,
            errorMessage: null,
          };
        }
        lastError =
          execOutcome.failureMessages.length > 0
            ? execOutcome.failureMessages.join('; ')
            : `executor reported ${execOutcome.stepsFailed} failed step(s)`;
      } else if (invokeError) {
        lastError = invokeError;
      } else {
        lastError = 'executor returned no outcome';
      }

      // Record the attempt's failure on the checkpoint; backoff then
      // continue the retry loop unless attempts are exhausted.
      try {
        await checkpoints.failure(checkpointId, lastError);
      } catch {
        // Best-effort — never crash the runner on a checkpoint write
        // mid-retry.
      }
      emitTransitionSpan({
        tenantId: args.tenantId,
        runId: args.runId,
        goalId: args.goalId,
        stepIndex: args.stepIndex,
        stepName,
        state: 'failure',
        attempt,
        errorMessage: lastError,
      });
      if (attempt < maxAttempts) {
        const wait = backoffs[Math.min(attempt - 1, backoffs.length - 1)] ?? 0;
        await sleep(wait);
      }
    }

    // 4) all attempts exhausted — promote to paused
    try {
      await checkpoints.paused(
        checkpointId,
        lastError ?? 'retries exhausted',
      );
    } catch {
      // best-effort
    }
    emitTransitionSpan({
      tenantId: args.tenantId,
      runId: args.runId,
      goalId: args.goalId,
      stepIndex: args.stepIndex,
      stepName,
      state: 'paused',
      attempt: maxAttempts,
      errorMessage: lastError,
    });
    return {
      checkpointId,
      succeeded: false,
      paused: true,
      attempts: maxAttempts,
      errorMessage: lastError ?? 'retries exhausted',
    };
  }

  async function executeGoalInternal(
    args: DurableRunArgs,
  ): Promise<DurableRunOutcome> {
    const runId = args.runId ?? makeRunId();
    const tenantId = args.tenantId;
    const goalId = args.goalId;

    const goal = await deps.goals.get(goalId);
    if (!goal) {
      logger.warn(
        { tenantId, goalId, runId },
        'durable-runner: goal not found — no-op',
      );
      return {
        runId,
        goalId,
        tenantId,
        executorOutcome: null,
        pausedCheckpoints: 0,
        completed: false,
        retries: 0,
        pauseReason: `unknown goal: ${goalId}`,
      };
    }

    // Resume support: skip checkpoint indexes that already have a
    // `success` row in the checkpoint store. The executor itself is
    // idempotent on completed steps but we don't want to re-emit
    // pending/running checkpoints for them either.
    const existing = await checkpoints.listForRun(runId).catch(() => []);
    const completedSteps = new Set(
      existing
        .filter((c) => c.state === 'success')
        .map((c) => c.stepIndex),
    );

    const orderedSteps: ReadonlyArray<GoalStep> = [...goal.steps].sort(
      (a, b) => a.seq - b.seq,
    );

    let pausedCheckpoints = 0;
    let totalRetries = 0;
    let pauseReason: string | null = null;

    for (let i = 0; i < orderedSteps.length; i += 1) {
      const step = orderedSteps[i];
      if (!step) continue;
      if (completedSteps.has(i)) {
        continue;
      }
      const result = await runStep({
        tenantId,
        runId,
        goalId,
        stepIndex: i,
        step,
      });
      totalRetries += Math.max(0, result.attempts - 1);
      if (result.paused) {
        pausedCheckpoints += 1;
        if (!pauseReason) pauseReason = result.errorMessage ?? 'paused';
        // Stop the walk on paused — the operator must resume.
        break;
      }
      if (!result.succeeded) {
        // Non-paused, non-succeeded path = checkpoint write failure or
        // executor reported a hard error we cannot retry past. Treat
        // it as paused for safety.
        pausedCheckpoints += 1;
        if (!pauseReason) {
          pauseReason = result.errorMessage ?? 'checkpoint-write-failed';
        }
        break;
      }
    }

    // Capture the executor's final outcome once so callers have back-
    // compat with the legacy contract. This is a cheap read since the
    // executor is idempotent on completed steps.
    let executorOutcome: ExecutorOutcome | null = null;
    try {
      executorOutcome = await executor.executeGoal(goalId);
    } catch (err) {
      logger.warn(
        {
          tenantId,
          goalId,
          runId,
          err: err instanceof Error ? err.message : String(err),
        },
        'durable-runner: terminal executor poll failed',
      );
    }

    return {
      runId,
      goalId,
      tenantId,
      executorOutcome,
      pausedCheckpoints,
      completed: pausedCheckpoints === 0,
      retries: totalRetries,
      pauseReason,
    };
  }

  /**
   * Inngest-routed executeGoal — when an Inngest client is wired, emit
   * `agency/run.requested` and return a "dispatched" outcome. The actual
   * agency execution happens on the Inngest worker. On `send()` throw we
   * fall back to inline execution so no run is lost.
   */
  async function dispatchToInngest(
    args: DurableRunArgs,
    client: InngestClientLike,
  ): Promise<DurableRunOutcome> {
    const runId = args.runId ?? randomUUID();
    try {
      await client.send({
        name: AGENCY_RUN_EVENT,
        data: {
          tenantId: args.tenantId,
          goalId: args.goalId,
          runId,
        },
        id: `${args.tenantId}::${runId}`,
      });
      return {
        runId,
        goalId: args.goalId,
        tenantId: args.tenantId,
        executorOutcome: null,
        pausedCheckpoints: 0,
        completed: false,
        retries: 0,
        pauseReason: 'dispatched-to-inngest',
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'durable-runner: inngest dispatch failed, falling back to inline execution',
      );
      return executeGoalInternal({ ...args, runId });
    }
  }

  return {
    async executeGoal(args) {
      if (inngest) {
        return dispatchToInngest(args, inngest);
      }
      return executeGoalInternal(args);
    },
    async recoverStuckRuns() {
      const before = new Date(clock().getTime() - staleness);
      let stuck: ReadonlyArray<{ runId: string; tenantId: string; goalId: string }> = [];
      // Helper: dedupe to (runId, tenantId, goalId) — the runner re-invokes
      // executeGoal once per stuck RUN, not per stuck checkpoint.
      const dedupeStuck = (
        rows: ReadonlyArray<{ tenantId: string; runId: string; goalId: string }>,
      ): ReadonlyArray<{ runId: string; tenantId: string; goalId: string }> => {
        const seen = new Set<string>();
        return rows
          .filter((r) => {
            const key = `${r.tenantId}::${r.runId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((r) => ({
            runId: r.runId,
            tenantId: r.tenantId,
            goalId: r.goalId,
          }));
      };
      // Advisory-lock-guarded path: when a postgres client is wired, hold
      // a transactional advisory lock on `hashtext(recoveryLockNamespace)`
      // while we read stuck rows. Multiple gateway replicas serialise
      // around this lock so we never double-recover a checkpoint. The
      // lock auto-releases on COMMIT / ROLLBACK (transactional variant).
      if (lockDb) {
        try {
          await lockDb.execute('BEGIN');
          try {
            await lockDb.execute(
              `SELECT pg_advisory_xact_lock(hashtext('${recoveryLockNamespace.replace(/'/g, "''")}'))`,
            );
            const rows = await checkpoints.stuckRunning({ olderThan: before });
            stuck = dedupeStuck(rows);
            await lockDb.execute('COMMIT');
          } catch (innerErr) {
            try {
              await lockDb.execute('ROLLBACK');
            } catch {
              // Ignore — original error takes precedence.
            }
            throw innerErr;
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'durable-runner: recovery scan failed',
          );
          return [];
        }
      } else {
        // Lock-free fallback for single-replica deploys / tests.
        try {
          const rows = await checkpoints.stuckRunning({ olderThan: before });
          stuck = dedupeStuck(rows);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'durable-runner: recovery scan failed',
          );
          return [];
        }
      }
      const recovered: DurableRunOutcome[] = [];
      for (const cand of stuck) {
        logger.info(
          {
            tenantId: cand.tenantId,
            runId: cand.runId,
            goalId: cand.goalId,
          },
          'durable-runner: resuming stuck run',
        );
        const outcome = await executeGoalInternal(cand);
        recovered.push(outcome);
      }
      return recovered;
    },
  };
}

// Internal helper export used by the test suite — fine because tests
// live in the same package boundary.
export const __testing = {
  defaultBackoffsMs: DEFAULT_BACKOFFS_MS,
  defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
  defaultRecoveryStalenessMs: DEFAULT_RECOVERY_STALENESS_MS,
};

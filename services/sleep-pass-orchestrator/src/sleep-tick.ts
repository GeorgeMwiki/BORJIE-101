/**
 * Budget-bounded sleep tick (LP-21a + LP-21c).
 *
 * Ported from LITFIN `src/core/heartbeat/sleep-tick.ts` and re-skinned for
 * Borjie's `@borjie/sleep-pass-orchestrator`.
 *
 * `runSleepTick` runs a batch of passes under ONE shared wall-clock budget
 * (`maxOverallDurationMs`) instead of each pass owning an isolated timeout.
 * Without a shared budget a single slow pass can consume the whole off-peak
 * window and every later pass silently never runs. Here:
 *
 *   - Each pass is given `min(pass.maxDurationMs, remainingBudget)` so it
 *     can never overrun what the tick has left.
 *   - When the budget is exhausted, remaining passes are reported as
 *     `skipped` (not failed) with a durable audit row — never silently
 *     dropped.
 *   - The whole pass invocation is bookended by a `brain_sleep_runs` row via
 *     the injected `SleepRunStore` (running → done/failed/timeout/skipped),
 *     and emissions land in `brain_sleep_emissions`.
 *   - `min-interval` is honoured from the DURABLE last-run timestamp, so two
 *     overlapping cron triggers don't double-fire a pass.
 *
 * PLATFORM-CAP UNDERCUT
 * ---------------------
 * Serverless runtimes hard-kill an invocation at a platform ceiling (Vercel
 * ~15 min, AWS Lambda ~15 min). `effectiveOverallDurationMs` undercuts that
 * ceiling by a safety margin so the worker keeps room to flush logs and
 * finalize the run row before the platform pulls the plug. Long-lived k8s /
 * bare-metal pods keep the full default budget.
 *
 * This module is intentionally decoupled from the interval-driven
 * `orchestrator.ts` loop: a cron-style deployment calls `runSleepTick`
 * directly once per off-peak window, while the always-on pod uses the
 * `createOrchestrator` heartbeat. Both share the same `SleepPass` contract.
 *
 * @module sleep-tick
 */

import { raceAgainstAbort } from './race-against-abort.js';
import type {
  IsoTimestamp,
  PassId,
  PassResult,
  PassRunReport,
  SleepEmission,
  SleepPass,
  SleepRunStore,
  SleepTickReport,
} from './types.js';

// ----------------------------------------------------------------------------
// Tunables — platform-cap undercut
// ----------------------------------------------------------------------------

/** Default whole-tick budget for long-lived (k8s / bare-metal) runs: 18 min. */
export const DEFAULT_OVERALL_DURATION_MS = 18 * 60 * 1000;

/**
 * Serverless undercut: cap at 14 min so a ~15-min platform ceiling leaves
 * ~1 min of headroom to flush logs and finalize the run row.
 */
export const SERVERLESS_OVERALL_DURATION_MS = 14 * 60 * 1000;

/**
 * Resolve the whole-tick budget, undercutting known serverless ceilings.
 *
 * Reads only the env object handed in (never the ambient `process.env`
 * directly inside the loop) so it stays unit-testable and honours the
 * CLAUDE.md "no reading process.env outside bootstrap" discipline — the
 * caller passes the env in.
 */
export function effectiveOverallDurationMs(
  env: Readonly<Record<string, string | undefined>> = {},
): number {
  const onServerless =
    env.VERCEL === '1' ||
    env.VERCEL === 'true' ||
    env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    env.FUNCTIONS_WORKER_RUNTIME !== undefined;
  return onServerless
    ? SERVERLESS_OVERALL_DURATION_MS
    : DEFAULT_OVERALL_DURATION_MS;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export interface RunSleepTickArgs {
  /** Passes to run, in priority order (caller pre-sorts if needed). */
  readonly passes: ReadonlyArray<SleepPass>;
  /** Durable run + emission store. */
  readonly store: SleepRunStore;
  /** Whole-tick wall-clock budget. Defaults to {@link effectiveOverallDurationMs}. */
  readonly maxOverallDurationMs?: number;
  /** Clock injection for deterministic tests. */
  readonly now?: () => Date;
  /** Monotonic ms clock injection (defaults to `Date.now`) — drives the budget. */
  readonly monotonicNowMs?: () => number;
  /** Optional sink invoked once per finalized pass report. */
  readonly reportSink?: (report: PassRunReport) => void;
}

/**
 * Run `passes` under one shared budget, persisting a run row per pass.
 * Resolves with a frozen, immutable {@link SleepTickReport}.
 */
export async function runSleepTick(
  args: RunSleepTickArgs,
): Promise<SleepTickReport> {
  const now = args.now ?? (() => new Date());
  const monotonic = args.monotonicNowMs ?? (() => Date.now());
  const overallBudget =
    args.maxOverallDurationMs ?? effectiveOverallDurationMs();

  const startedAt = now().toISOString();
  const tickStart = monotonic();
  const reports: PassRunReport[] = [];

  for (const pass of args.passes) {
    const remainingBudget = overallBudget - (monotonic() - tickStart);
    if (remainingBudget <= 0) {
      reports.push(
        emitReport(args.reportSink, {
          passId: pass.id,
          runId: null,
          status: 'skipped',
          itemsProcessed: 0,
          itemsEmitted: 0,
          durationMs: 0,
          notes: 'skipped: overall sleep-tick budget exhausted',
        }),
      );
      continue;
    }

    const skip = await minIntervalSkip(pass, args.store, now);
    if (skip) {
      reports.push(emitReport(args.reportSink, skip));
      continue;
    }

    const report = await runOnePass({
      pass,
      store: args.store,
      // The pass can never overrun what the tick has left.
      maxDurationMs: Math.min(pass.schedule.maxDurationMs, remainingBudget),
      now,
      monotonic,
    });
    reports.push(emitReport(args.reportSink, report));
  }

  return Object.freeze({
    startedAt,
    completedAt: now().toISOString(),
    overallBudgetMs: overallBudget,
    runs: Object.freeze(reports),
  }) satisfies SleepTickReport;
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

function emitReport(
  sink: ((r: PassRunReport) => void) | undefined,
  report: PassRunReport,
): PassRunReport {
  sink?.(report);
  return report;
}

async function minIntervalSkip(
  pass: SleepPass,
  store: SleepRunStore,
  now: () => Date,
): Promise<PassRunReport | null> {
  const lastRunAtIso = await store.lastRunAt(pass.id);
  if (!lastRunAtIso) return null;
  const minutesSinceLast =
    (now().getTime() - new Date(lastRunAtIso).getTime()) / 60_000;
  if (minutesSinceLast >= pass.schedule.minIntervalMinutes) return null;
  return {
    passId: pass.id,
    runId: null,
    status: 'skipped',
    itemsProcessed: 0,
    itemsEmitted: 0,
    durationMs: 0,
    notes:
      `skipped: only ${minutesSinceLast.toFixed(1)}m since last run ` +
      `(min ${pass.schedule.minIntervalMinutes}m)`,
  };
}

interface RunOnePassArgs {
  readonly pass: SleepPass;
  readonly store: SleepRunStore;
  readonly maxDurationMs: number;
  readonly now: () => Date;
  readonly monotonic: () => number;
}

async function runOnePass(opts: RunOnePassArgs): Promise<PassRunReport> {
  const { pass, store, maxDurationMs, now, monotonic } = opts;
  const startedMs = monotonic();
  const runId = await store.beginRun(pass.id);

  // A single timer drives BOTH the abort signal and the race rejection.
  // The handle is captured so the finally block can clear it — without
  // that, fast-returning passes leave the timer alive until the next
  // process tick, leaking O(N) handles under sustained load.
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutRejection = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`sleep-pass timeout after ${maxDurationMs}ms`));
    }, maxDurationMs);
  });

  let status: PassRunReport['status'] = 'done';
  let result: PassResult | null = null;
  let errorText: string | undefined;

  try {
    // raceAgainstAbort bails the instant the signal fires even if `run`
    // is parked inside a long awaited LLM/DB call; timeoutRejection is the
    // belt-and-braces hard ceiling.
    result = await Promise.race([
      raceAgainstAbort(
        controller.signal,
        pass.run({ abortSignal: controller.signal, now }),
      ),
      timeoutRejection,
    ]);
  } catch (err) {
    if (controller.signal.aborted) {
      status = 'timeout';
      errorText = `aborted after ${maxDurationMs}ms`;
    } else {
      status = 'failed';
      errorText = err instanceof Error ? err.message : String(err);
    }
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }

  // A pass may return cleanly but have observed the abort mid-flight.
  if (status === 'done' && controller.signal.aborted) {
    status = 'timeout';
    errorText = errorText ?? `aborted after ${maxDurationMs}ms`;
  }

  const durationMs = monotonic() - startedMs;
  const emissions: ReadonlyArray<SleepEmission> = result?.emissions ?? [];

  await store.recordEmissions(runId, emissions);
  await store.finalizeRun(runId, {
    status,
    itemsProcessed: result?.itemsProcessed ?? 0,
    itemsEmitted: result?.itemsEmitted ?? emissions.length,
    durationMs,
    notes: result?.notes ?? '',
    ...(errorText !== undefined ? { errorText } : {}),
  });

  return {
    passId: pass.id,
    runId,
    status,
    itemsProcessed: result?.itemsProcessed ?? 0,
    itemsEmitted: result?.itemsEmitted ?? emissions.length,
    durationMs,
    notes: result?.notes ?? '',
    ...(errorText !== undefined ? { errorText } : {}),
  };
}

/** Re-exported for callers that build their own reports. */
export type { PassId, IsoTimestamp };

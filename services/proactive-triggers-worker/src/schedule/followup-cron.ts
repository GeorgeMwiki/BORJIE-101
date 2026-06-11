/**
 * Follow-up cron — the missing scheduled entrypoint.
 *
 * Two follow-up schedulers shipped in prior waves but were never
 * actually invoked by any worker:
 *
 *   1. `@borjie/user-followup`'s `runSchedulerOnce(deps, tenantId)` —
 *      pulls due follow-up candidates (flagged items, regulator
 *      deadlines, dormancy sweeps), applies quiet-hours + daily-cap,
 *      and dispatches each via the recipient's channel.
 *   2. `@borjie/employee-perf-followup`'s `runDailyPerfCronOnce(tenantId,
 *      deps)` — at 06:00 local per employee, computes the daily
 *      scorecard and emits three-tier coaching nudges.
 *
 * This module folds both into a single scheduled pass over every active
 * tenant, reusing the worker's existing {@link TenantDirectory} and the
 * already-wired notification plumbing. The host (composition root)
 * supplies the per-scheduler wiring through {@link FollowupCronWiring};
 * when a wiring is absent the pass cleanly skips that scheduler so the
 * worker stays usable in dev/CI without full plumbing.
 *
 * Design constraints honoured:
 *   - Wire-agnostic: every repository/port the schedulers need is
 *     injected by the host (the only layer with `@borjie/database`
 *     schema access). This module owns orchestration, not adapters.
 *   - Reuses the worker's real notification sink wiring: the
 *     user-followup scheduler dispatches through the SAME
 *     `ReadonlyMap<FollowupChannel, ChannelDispatcher>` the
 *     notification sink uses (see {@link ../sinks/select-sink.ts}).
 *   - Immutable: nothing is mutated; results are freshly constructed.
 *   - Pino only: all logging goes through the injected WorkerLogger.
 *   - Never throws: a single tenant/scheduler failure is logged and the
 *     pass continues — one bad tenant can't sink the whole cron.
 *
 * Invoked two ways (mirrors the hourly sweep):
 *   1. In-process via a sibling cron loop (see {@link ../index.ts}).
 *   2. As a one-shot when launched via a Kubernetes CronJob.
 */
import {
  runSchedulerOnce,
  type ChannelDispatcher,
  type FollowupChannel,
  type SchedulerDeps,
  type SchedulerTickResult,
} from '@borjie/user-followup';
import {
  runDailyPerfCronOnce,
  type DailyPerfCronDeps,
  type ScheduleTickResult as PerfTickResult,
} from '@borjie/employee-perf-followup';
import { iterateTenants } from './tenant-iteration.js';
import type { TenantDirectory, WorkerLogger } from '../types.js';

/**
 * Per-tenant wiring for the user-followup scheduler. The host binds
 * the SQL-backed candidate/prefs repos + audit chain (built from the
 * worker's live db handle at the composition root) and reuses the same
 * channel dispatchers the notification sink already owns.
 *
 * `dispatchers` is the worker's real notification map so follow-up
 * candidates flow through the identical delivery path as fired
 * triggers — one sink, one set of channels.
 */
export interface UserFollowupWiring {
  /**
   * Build the scheduler deps for one tenant. Returning `null` means
   * "no follow-up engine for this tenant" — the pass skips it. The
   * host resolves the tenant-scoped repos here (RLS GUC bound on the
   * connection it hands back).
   */
  readonly buildDepsForTenant: (
    tenantId: string,
  ) => Promise<SchedulerDeps | null> | SchedulerDeps | null;
  /** The shared channel dispatchers (reused from the notification sink). */
  readonly dispatchers: ReadonlyMap<FollowupChannel, ChannelDispatcher>;
}

/**
 * Per-tenant wiring for the employee-perf daily cron. The host binds
 * the scorecard/template/nudge repos, org-scope + voice readers, the
 * KPI measurement port, the audit chain, and the hash/id helpers — all
 * derived from the worker's live db handle at the composition root.
 */
export interface PerfCronWiring {
  /**
   * Build the perf-cron deps for one tenant. Returning `null` skips the
   * tenant. The host resolves tenant-scoped repos here.
   */
  readonly buildDepsForTenant: (
    tenantId: string,
  ) => Promise<DailyPerfCronDeps | null> | DailyPerfCronDeps | null;
}

/**
 * Host-provided wiring for the follow-up cron. Either scheduler may be
 * omitted; an omitted scheduler is skipped (and logged once at start).
 */
export interface FollowupCronWiring {
  readonly userFollowup?: UserFollowupWiring;
  readonly perfCron?: PerfCronWiring;
}

export interface RunFollowupCronDeps {
  readonly directory: TenantDirectory;
  readonly wiring: FollowupCronWiring;
  readonly logger?: WorkerLogger;
  readonly concurrency?: number;
}

export interface TenantFollowupResult {
  readonly tenantId: string;
  readonly status: 'ok' | 'skipped' | 'error';
  /** user-followup dispatch counts (null when scheduler not wired). */
  readonly userFollowup: {
    readonly dispatched: number;
    readonly suppressed: number;
  } | null;
  /** perf-cron fire counts (null when scheduler not wired). */
  readonly perfCron: {
    readonly fired: number;
    readonly nudgesEmitted: number;
    readonly skipped: number;
  } | null;
  readonly errorMessage: string | null;
}

export interface FollowupCronSummary {
  readonly tenantsProcessed: number;
  readonly userFollowupDispatched: number;
  readonly userFollowupSuppressed: number;
  readonly perfNudgesEmitted: number;
  readonly errored: number;
  readonly results: ReadonlyArray<TenantFollowupResult>;
}

/**
 * Run one follow-up cron pass over every active tenant. Never throws.
 * Returns a roll-up summary the entrypoint logs.
 */
export async function runFollowupCron(
  deps: RunFollowupCronDeps,
): Promise<FollowupCronSummary> {
  const hasUserFollowup = deps.wiring.userFollowup !== undefined;
  const hasPerfCron = deps.wiring.perfCron !== undefined;

  if (!hasUserFollowup && !hasPerfCron) {
    deps.logger?.info?.(
      {},
      'proactive-triggers-worker: follow-up cron has no wiring — pass is a no-op',
    );
    return summarise([]);
  }

  deps.logger?.info?.(
    { userFollowup: hasUserFollowup, perfCron: hasPerfCron },
    'proactive-triggers-worker: follow-up cron pass starting',
  );

  const tenantIds = await safeListTenants(deps);
  if (tenantIds.length === 0) {
    deps.logger?.info?.(
      {},
      'proactive-triggers-worker: follow-up cron — no tenants',
    );
    return summarise([]);
  }

  const results = await iterateTenants<TenantFollowupResult>({
    tenantIds,
    ...(deps.concurrency !== undefined ? { concurrency: deps.concurrency } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    runForTenant: (tenantId) => runForTenant(deps, tenantId),
    onTenantError: (tenantId, message) => ({
      tenantId,
      status: 'error',
      userFollowup: null,
      perfCron: null,
      errorMessage: message,
    }),
  });

  return summarise(results);
}

async function safeListTenants(
  deps: RunFollowupCronDeps,
): Promise<ReadonlyArray<string>> {
  try {
    return await deps.directory.listActiveTenants();
  } catch (error) {
    deps.logger?.warn?.(
      { err: errMsg(error) },
      'proactive-triggers-worker: tenant directory failed — follow-up cron aborted',
    );
    return [];
  }
}

async function runForTenant(
  deps: RunFollowupCronDeps,
  tenantId: string,
): Promise<TenantFollowupResult> {
  let userFollowup: TenantFollowupResult['userFollowup'] = null;
  let perfCron: TenantFollowupResult['perfCron'] = null;
  let sawError = false;
  let firstError: string | null = null;

  // 1. user-followup scheduler.
  if (deps.wiring.userFollowup) {
    try {
      const tick = await runUserFollowupForTenant(
        deps.wiring.userFollowup,
        tenantId,
      );
      if (tick !== null) {
        userFollowup = {
          dispatched: tick.dispatched.length,
          suppressed: tick.suppressed.length,
        };
      }
    } catch (error) {
      sawError = true;
      firstError = errMsg(error);
      deps.logger?.warn?.(
        { tenantId, err: firstError },
        'proactive-triggers-worker: user-followup scheduler failed for tenant',
      );
    }
  }

  // 2. employee-perf daily cron.
  if (deps.wiring.perfCron) {
    try {
      const tick = await runPerfCronForTenant(deps.wiring.perfCron, tenantId);
      if (tick !== null) {
        const nudgesEmitted = tick.fired.reduce(
          (sum, f) => sum + f.nudges_emitted,
          0,
        );
        perfCron = {
          fired: tick.fired.length,
          nudgesEmitted,
          skipped: tick.skipped.length,
        };
      }
    } catch (error) {
      sawError = true;
      if (firstError === null) firstError = errMsg(error);
      deps.logger?.warn?.(
        { tenantId, err: errMsg(error) },
        'proactive-triggers-worker: perf-cron scheduler failed for tenant',
      );
    }
  }

  const status: TenantFollowupResult['status'] = sawError
    ? 'error'
    : userFollowup === null && perfCron === null
      ? 'skipped'
      : 'ok';

  return {
    tenantId,
    status,
    userFollowup,
    perfCron,
    errorMessage: firstError,
  };
}

async function runUserFollowupForTenant(
  wiring: UserFollowupWiring,
  tenantId: string,
): Promise<SchedulerTickResult | null> {
  const schedulerDeps = await wiring.buildDepsForTenant(tenantId);
  if (schedulerDeps === null) return null;
  return runSchedulerOnce(schedulerDeps, tenantId);
}

async function runPerfCronForTenant(
  wiring: PerfCronWiring,
  tenantId: string,
): Promise<PerfTickResult | null> {
  const cronDeps = await wiring.buildDepsForTenant(tenantId);
  if (cronDeps === null) return null;
  return runDailyPerfCronOnce(tenantId, cronDeps);
}

function summarise(
  results: ReadonlyArray<TenantFollowupResult>,
): FollowupCronSummary {
  let userFollowupDispatched = 0;
  let userFollowupSuppressed = 0;
  let perfNudgesEmitted = 0;
  let errored = 0;
  for (const r of results) {
    if (r.userFollowup) {
      userFollowupDispatched += r.userFollowup.dispatched;
      userFollowupSuppressed += r.userFollowup.suppressed;
    }
    if (r.perfCron) {
      perfNudgesEmitted += r.perfCron.nudgesEmitted;
    }
    if (r.status === 'error') errored += 1;
  }
  return {
    tenantsProcessed: results.length,
    userFollowupDispatched,
    userFollowupSuppressed,
    perfNudgesEmitted,
    errored,
    results,
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

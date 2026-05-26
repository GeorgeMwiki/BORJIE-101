/**
 * Cron handler — the hourly sweep.
 *
 * For every active tenant:
 *   - For every active (userId, role):
 *     - Build profile + signals
 *     - Compute triggers
 *     - For each trigger with urgency >= MIN_URGENCY:
 *       - Check idempotency — skip if seen in lookback
 *       - Otherwise: mark seen + emit to sink
 *
 * Invoked two ways:
 *   1. In-process via setInterval (or node-cron) every hour
 *   2. As a one-shot when launched via a Kubernetes CronJob
 */
import {
  buildProfile,
  computeTriggers,
  gatherSignals,
  type Role,
  type Trigger,
} from '@borjie/user-context-store';
import { iterateTenants } from './tenant-iteration.js';
import type {
  IdempotencyCache,
  SweepSummary,
  TenantDirectory,
  TenantSweepResult,
  TriggerSink,
  WorkerLogger,
} from '../types.js';

export interface RunSweepDeps {
  readonly directory: TenantDirectory;
  readonly sink: TriggerSink;
  readonly cache: IdempotencyCache;
  readonly db: unknown;
  readonly logger?: WorkerLogger;
  readonly concurrency?: number;
  /** Minimum urgency to fire (default 4). */
  readonly minUrgency?: 1 | 2 | 3 | 4 | 5;
  /** Idempotency lookback window in hours (default 24). */
  readonly lookbackHours?: number;
}

const DEFAULT_MIN_URGENCY: 1 | 2 | 3 | 4 | 5 = 4;
const DEFAULT_LOOKBACK_HOURS = 24;

/**
 * The whole hourly sweep. Never throws.
 */
export async function runHourlySweep(deps: RunSweepDeps): Promise<SweepSummary> {
  const tenantIds = await safeListTenants(deps);
  if (tenantIds.length === 0) {
    deps.logger?.info?.({}, 'proactive-triggers-worker: no tenants — sweep is a no-op');
    return summarise([]);
  }

  const results = await iterateTenants({
    tenantIds,
    ...(deps.concurrency !== undefined ? { concurrency: deps.concurrency } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    runForTenant: (tenantId) => runForTenant(deps, tenantId),
  });

  return summarise(results);
}

async function safeListTenants(deps: RunSweepDeps): Promise<ReadonlyArray<string>> {
  try {
    return await deps.directory.listActiveTenants();
  } catch (error) {
    deps.logger?.warn?.(
      { err: error instanceof Error ? error.message : String(error) },
      'proactive-triggers-worker: tenant directory failed — sweep aborted',
    );
    return [];
  }
}

async function runForTenant(
  deps: RunSweepDeps,
  tenantId: string,
): Promise<TenantSweepResult> {
  const minUrgency = deps.minUrgency ?? DEFAULT_MIN_URGENCY;
  const lookbackHours = deps.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;

  let users: ReadonlyArray<{ userId: string; role: Role }> = [];
  try {
    users = await deps.directory.listActiveUsers(tenantId);
  } catch (error) {
    return {
      tenantId,
      status: 'error',
      usersEvaluated: 0,
      triggersFired: 0,
      triggersSuppressedIdempotent: 0,
      triggersSuppressedLowUrgency: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  if (users.length === 0) {
    return {
      tenantId,
      status: 'skipped',
      usersEvaluated: 0,
      triggersFired: 0,
      triggersSuppressedIdempotent: 0,
      triggersSuppressedLowUrgency: 0,
      errorMessage: null,
    };
  }

  let triggersFired = 0;
  let triggersSuppressedIdempotent = 0;
  let triggersSuppressedLowUrgency = 0;

  for (const user of users) {
    try {
      const profile = await buildProfile({
        role: user.role,
        userId: user.userId,
        tenantId,
        db: deps.db,
      });
      const signals = await gatherSignals({
        role: user.role,
        userId: user.userId,
        tenantId,
        db: deps.db,
        profile,
      });
      const triggers = computeTriggers({
        profile,
        signals,
        role: user.role,
        userId: user.userId,
        tenantId,
      });

      for (const trigger of triggers) {
        if (trigger.urgency < minUrgency) {
          triggersSuppressedLowUrgency += 1;
          continue;
        }
        if (deps.cache.hasSeenRecently(trigger.id, lookbackHours)) {
          triggersSuppressedIdempotent += 1;
          continue;
        }
        deps.cache.markSeen(trigger.id, lookbackHours);
        await safeEmit(deps, tenantId, user.userId, user.role, trigger);
        triggersFired += 1;
      }
    } catch (error) {
      deps.logger?.warn?.(
        {
          tenantId,
          userId: user.userId,
          role: user.role,
          err: error instanceof Error ? error.message : String(error),
        },
        'proactive-triggers-worker: per-user failure — skipping user',
      );
    }
  }

  return {
    tenantId,
    status: 'ok',
    usersEvaluated: users.length,
    triggersFired,
    triggersSuppressedIdempotent,
    triggersSuppressedLowUrgency,
    errorMessage: null,
  };
}

async function safeEmit(
  deps: RunSweepDeps,
  tenantId: string,
  userId: string,
  role: Role,
  trigger: Trigger,
): Promise<void> {
  try {
    await deps.sink.emit({ tenantId, userId, role, trigger });
  } catch (error) {
    deps.logger?.warn?.(
      {
        tenantId,
        userId,
        role,
        triggerId: trigger.id,
        err: error instanceof Error ? error.message : String(error),
      },
      'proactive-triggers-worker: sink emit failed — trigger dropped',
    );
  }
}

function summarise(results: ReadonlyArray<TenantSweepResult>): SweepSummary {
  let usersEvaluated = 0;
  let triggersFired = 0;
  let triggersSuppressedIdempotent = 0;
  let triggersSuppressedLowUrgency = 0;
  let errored = 0;
  for (const r of results) {
    usersEvaluated += r.usersEvaluated;
    triggersFired += r.triggersFired;
    triggersSuppressedIdempotent += r.triggersSuppressedIdempotent;
    triggersSuppressedLowUrgency += r.triggersSuppressedLowUrgency;
    if (r.status === 'error') errored += 1;
  }
  return {
    tenantsProcessed: results.length,
    usersEvaluated,
    triggersFired,
    triggersSuppressedIdempotent,
    triggersSuppressedLowUrgency,
    errored,
    results,
  };
}

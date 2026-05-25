/**
 * BackgroundTaskScheduler
 *
 * Runs the task catalogue for every active tenant on a schedule. This
 * pilot-grade scheduler is in-process (node-cron-style string matched by a
 * 1-minute tick). In production replace the tick loop with BullMQ or Temporal
 * without touching task bodies.
 *
 * Every run is gated by the per-tenant feature flag. Tasks are executed
 * serially per tenant so one tenant's failure never affects another's.
 */

import type {
  FeatureFlagProbe,
  InsightStore,
  ScheduledTaskDefinition,
  TaskRunSummary,
  TenantProvider,
} from './types.js';

export interface SchedulerDeps {
  readonly store: InsightStore;
  readonly tenants: TenantProvider;
  readonly featureFlags: FeatureFlagProbe;
  readonly tasks: readonly ScheduledTaskDefinition[];
  readonly logger?: (msg: string, meta?: Record<string, unknown>) => void;
  readonly now?: () => Date;
}

export class BackgroundTaskScheduler {
  private readonly deps: SchedulerDeps;
  private readonly lastRun = new Map<string, string>();

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  /** Tick the scheduler \u2014 call once per minute from a supervisor. */
  async tick(): Promise<readonly TaskRunSummary[]> {
    const now = this.deps.now?.() ?? new Date();
    const tenantIds = await this.deps.tenants.listActiveTenants();
    const summaries: TaskRunSummary[] = [];

    for (const tenantId of tenantIds) {
      for (const task of this.deps.tasks) {
        if (!shouldRun(task.cron, now)) continue;
        const runKey = `${tenantId}:${task.name}:${bucketKey(now, task.cron)}`;
        if (this.lastRun.has(runKey)) continue;

        const enabled = await this.deps.featureFlags.isEnabled(
          tenantId,
          task.featureFlagKey,
        );
        if (!enabled) continue;

        try {
          const summary = await task.run({
            tenantId,
            now,
            store: this.deps.store,
          });
          this.lastRun.set(runKey, now.toISOString());
          summaries.push(summary);
          this.deps.logger?.('bg task ok', {
            task: task.name,
            tenantId,
            insights: summary.insightsEmitted,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.deps.logger?.('bg task fail', {
            task: task.name,
            tenantId,
            error: message,
          });
        }
      }
    }

    return summaries;
  }

  /** Force a task to run for a single tenant (tests / admin triggers). */
  async runOnce(
    taskName: ScheduledTaskDefinition['name'],
    tenantId: string,
  ): Promise<TaskRunSummary> {
    const task = this.deps.tasks.find((t) => t.name === taskName);
    if (!task) throw new Error(`Unknown task: ${taskName}`);
    const enabled = await this.deps.featureFlags.isEnabled(
      tenantId,
      task.featureFlagKey,
    );
    if (!enabled) {
      throw new Error(
        `Task ${taskName} disabled by flag ${task.featureFlagKey} for tenant ${tenantId}`,
      );
    }
    return task.run({
      tenantId,
      now: this.deps.now?.() ?? new Date(),
      store: this.deps.store,
    });
  }
}

/**
 * Extremely lightweight cron evaluator: accepts a 5-field cron expression
 * with `*` and single integer values. Good enough for the pilot; when we
 * move to BullMQ this goes away.
 */
export function shouldRun(cron: string, at: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron: ${cron}`);
  }
  const [minute, hour, dom, month, dow] = parts;
  const utcMinute = at.getUTCMinutes();
  const utcHour = at.getUTCHours();
  const utcDom = at.getUTCDate();
  const utcMonth = at.getUTCMonth() + 1;
  const utcDow = at.getUTCDay();
  return (
    matchField(minute, utcMinute) &&
    matchField(hour, utcHour) &&
    matchField(dom, utcDom) &&
    matchField(month, utcMonth) &&
    matchField(dow, utcDow)
  );
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true;
  const num = Number(field);
  if (Number.isNaN(num)) return false;
  return num === value;
}

function bucketKey(now: Date, cron: string): string {
  // For tests we just use the full minute bucket so ticks within the same
  // minute do not re-run a task.
  return `${now.toISOString().slice(0, 16)}|${cron}`;
}

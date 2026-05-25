/**
 * Scheduled task: recompute_tenant_credit_ratings (weekly, Sun 03:00).
 *
 * Thin scheduler harness — the concrete scheduling mechanism (cron vs
 * queue vs kubernetes cronjob) is owned by the domain-services layer.
 * We export a pure kickoff function the scheduler can call.
 *
 * Behavior:
 *   1. Enumerate every tenant the supplied enumerator returns.
 *   2. For each tenant, invoke `service.recomputeAll(tenantId)`.
 *   3. Report totals + any failures — fails closed, never crashes the
 *      scheduler on a single tenant's error.
 */

import { CreditRatingService } from './credit-rating-service.js';

export interface ScheduledRecomputeDeps {
  readonly service: CreditRatingService;
  readonly tenantEnumerator: () => Promise<readonly string[]>;
  readonly logger?: {
    info(msg: string, ctx?: Record<string, unknown>): void;
    warn(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string, ctx?: Record<string, unknown>): void;
  };
}

export interface ScheduledRecomputeResult {
  readonly tenantCount: number;
  readonly customersRecomputed: number;
  readonly failures: ReadonlyArray<{ tenantId: string; reason: string }>;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export const SCHEDULED_TASK_NAME = 'recompute_tenant_credit_ratings';
export const SCHEDULED_TASK_CRON = '0 3 * * 0'; // Sunday 03:00 UTC

export async function runScheduledRecompute(
  deps: ScheduledRecomputeDeps,
): Promise<ScheduledRecomputeResult> {
  const startedAt = new Date().toISOString();
  const tenantIds = await deps.tenantEnumerator();
  const failures: Array<{ tenantId: string; reason: string }> = [];
  let recomputed = 0;
  for (const tenantId of tenantIds) {
    try {
      const ratings = await deps.service.recomputeAll(tenantId);
      recomputed += ratings.length;
      deps.logger?.info('scheduled credit recompute: tenant done', {
        tenantId,
        customers: ratings.length,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      failures.push({ tenantId, reason });
      deps.logger?.error('scheduled credit recompute: tenant failed', {
        tenantId,
        reason,
      });
    }
  }
  const finishedAt = new Date().toISOString();
  return {
    tenantCount: tenantIds.length,
    customersRecomputed: recomputed,
    failures,
    startedAt,
    finishedAt,
  };
}

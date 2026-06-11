/**
 * Per-tenant fan-out with bounded concurrency.
 *
 * Mirrors brain-evolution-worker's pattern: a worker pool drains a
 * shared queue. Per-tenant exceptions are caught and surfaced as an
 * error result — one tenant's failure never knocks out another's pass.
 *
 * Generic over the per-tenant result type so the same fan-out drives
 * the proactive-triggers sweep, the follow-up cron, and the intel tick.
 * Each caller supplies its own `onTenantError` factory to shape the
 * error result for its own summary type.
 */
import type { TenantSweepResult, WorkerLogger } from '../types.js';

export interface IterateTenantsArgs<TResult> {
  readonly tenantIds: ReadonlyArray<string>;
  readonly runForTenant: (tenantId: string) => Promise<TResult>;
  /**
   * Build the result recorded when `runForTenant` throws. Defaults to a
   * {@link TenantSweepResult}-shaped error (back-compat with the sweep);
   * other callers pass their own shape.
   */
  readonly onTenantError?: (tenantId: string, message: string) => TResult;
  readonly concurrency?: number;
  readonly logger?: WorkerLogger;
}

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

function clampConcurrency(candidate: number | undefined): number {
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate <= 0
  ) {
    return DEFAULT_CONCURRENCY;
  }
  return Math.min(Math.floor(candidate), MAX_CONCURRENCY);
}

/** Default error-result factory — the sweep's {@link TenantSweepResult}. */
function defaultSweepError(
  tenantId: string,
  message: string,
): TenantSweepResult {
  return {
    tenantId,
    status: 'error',
    usersEvaluated: 0,
    triggersFired: 0,
    triggersSuppressedIdempotent: 0,
    triggersSuppressedLowUrgency: 0,
    errorMessage: message,
  };
}

/**
 * Run `runForTenant` across every tenant with bounded concurrency.
 * Never throws — per-tenant failures fold into the result list via the
 * caller-supplied (or default) error factory.
 */
export async function iterateTenants<TResult = TenantSweepResult>(
  args: IterateTenantsArgs<TResult>,
): Promise<ReadonlyArray<TResult>> {
  const concurrency = clampConcurrency(args.concurrency);
  const queue = [...args.tenantIds];
  const results: TResult[] = [];
  const onError =
    args.onTenantError ??
    (defaultSweepError as unknown as (
      tenantId: string,
      message: string,
    ) => TResult);

  async function worker(): Promise<void> {
    while (true) {
      const tenantId = queue.shift();
      if (!tenantId) return;
      try {
        const result = await args.runForTenant(tenantId);
        results.push(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        args.logger?.warn?.(
          { tenantId, err: msg },
          'proactive-triggers-worker: tenant pass threw — recording error and continuing',
        );
        results.push(onError(tenantId, msg));
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, args.tenantIds.length || 1) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

/**
 * Per-tenant fan-out with bounded concurrency.
 *
 * Mirrors brain-evolution-worker's pattern: a worker pool drains a
 * shared queue. Per-tenant exceptions are caught and surfaced as
 * `status: 'error'` results — one tenant's failure never knocks out
 * another's sweep.
 */
import type { TenantSweepResult, WorkerLogger } from '../types.js';

export interface IterateTenantsArgs {
  readonly tenantIds: ReadonlyArray<string>;
  readonly runForTenant: (tenantId: string) => Promise<TenantSweepResult>;
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

/**
 * Run `runForTenant` across every tenant with bounded concurrency.
 * Never throws — per-tenant failures fold into the result list.
 */
export async function iterateTenants(
  args: IterateTenantsArgs,
): Promise<ReadonlyArray<TenantSweepResult>> {
  const concurrency = clampConcurrency(args.concurrency);
  const queue = [...args.tenantIds];
  const results: TenantSweepResult[] = [];

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
          'proactive-triggers-worker: tenant sweep threw — recording error and continuing',
        );
        results.push({
          tenantId,
          status: 'error',
          usersEvaluated: 0,
          triggersFired: 0,
          triggersSuppressedIdempotent: 0,
          triggersSuppressedLowUrgency: 0,
          errorMessage: msg,
        });
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

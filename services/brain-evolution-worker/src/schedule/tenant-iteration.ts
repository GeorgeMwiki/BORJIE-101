/**
 * Per-tenant iteration with bounded concurrency.
 *
 * The nightly run scans every active tenant. Naively running them in
 * series is too slow for >100 tenants; firing them all in parallel
 * stampedes Postgres + the LLM provider budget. The iterator caps
 * in-flight work at `concurrency` (default 4) using a tiny worker pool.
 *
 * Per-tenant isolation: every tenant runs in its own "transaction" (the
 * pipeline stages each open + commit a single DB tx via their respective
 * services). A throw in tenant A never affects tenant B — the iterator
 * catches per-task errors and surfaces them on the result.
 *
 * Pure module: the actual per-tenant pipeline is passed in as a function.
 * Easier to test and lets the composition root inject the real pipeline.
 */

import type {
  BrainWorkerLogger,
  TenantRunResult,
} from '../types.js';

export interface TenantIterationArgs {
  readonly tenantIds: ReadonlyArray<string>;
  readonly runForTenant: (tenantId: string) => Promise<TenantRunResult>;
  /** Soft cap on in-flight tenants. Defaults to 4. */
  readonly concurrency?: number;
  readonly logger?: BrainWorkerLogger;
}

export interface TenantIterationSummary {
  readonly totalTenants: number;
  readonly ok: number;
  readonly skipped: number;
  readonly errored: number;
  readonly totalDeltasApplied: number;
  readonly totalDeltasEscalated: number;
  readonly totalDeltasBlocked: number;
  readonly results: ReadonlyArray<TenantRunResult>;
}

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

/**
 * Run `runForTenant` across `tenantIds` with bounded concurrency. Never
 * throws — per-tenant exceptions are caught and folded into the
 * `TenantRunResult` with `status: 'error'`.
 */
export async function iterateTenants(
  args: TenantIterationArgs,
): Promise<TenantIterationSummary> {
  const concurrency = clampConcurrency(args.concurrency);
  const queue = [...args.tenantIds];
  const results: TenantRunResult[] = [];

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
          'brain-evolution-worker: tenant pipeline threw — recording as error and continuing',
        );
        results.push({
          tenantId,
          status: 'error',
          tracesRead: 0,
          deltasApplied: 0,
          deltasEscalated: 0,
          deltasBlocked: 0,
          errorMessage: msg,
          report: null,
        });
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return summarise(args.tenantIds.length, results);
}

function summarise(
  totalTenants: number,
  results: ReadonlyArray<TenantRunResult>,
): TenantIterationSummary {
  let ok = 0;
  let skipped = 0;
  let errored = 0;
  let totalDeltasApplied = 0;
  let totalDeltasEscalated = 0;
  let totalDeltasBlocked = 0;

  for (const r of results) {
    if (r.status === 'ok') ok += 1;
    else if (r.status === 'skipped') skipped += 1;
    else errored += 1;
    totalDeltasApplied += r.deltasApplied;
    totalDeltasEscalated += r.deltasEscalated;
    totalDeltasBlocked += r.deltasBlocked;
  }

  return {
    totalTenants,
    ok,
    skipped,
    errored,
    totalDeltasApplied,
    totalDeltasEscalated,
    totalDeltasBlocked,
    results,
  };
}

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

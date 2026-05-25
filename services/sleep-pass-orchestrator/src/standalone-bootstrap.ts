/**
 * Standalone bootstrap helpers for the sleep-pass-orchestrator pod.
 *
 * Extracted from `index.ts` so the barrel export stays a thin public
 * surface and the boot logic can be unit-tested independently.
 *
 * Wires the orchestrator with deterministic in-memory adapters by
 * default. Production wiring (Drizzle + Redis adapters) lives in the
 * api-gateway composition root once those adapters land; this module
 * keeps the pod functional in the interim instead of leaving it as a
 * metrics-only stub.
 *
 * Env vars:
 *   - `SLEEP_PASS_PROD_ADAPTERS=1`  Refuses in-memory mode (production
 *                                   guard — fail-fast so a misconfigured
 *                                   prod deploy never silently runs the
 *                                   in-memory adapters).
 *   - `HEARTBEAT_INTERVAL_MS`       Pass dispatch cadence (default 60s).
 */

import {
  createInMemoryAuditChainAdapter,
  createInMemoryCacheAdapter,
  createInMemoryDataQualityAdapter,
  createInMemoryDeadLetterAdapter,
  createInMemoryIndexAdapter,
  createInMemoryMetricsAdapter,
  createInMemoryTenantAdapter,
  createInMemoryTokenAdapter,
} from './passes/adapters.js';
import {
  createAuditChainVerifyPass,
  createCacheWarmUpPass,
  createDataQualityCheckPass,
  createDeadLetterReplayPass,
  createDormantTenantDetectorPass,
  createExpiredTokenCleanupPass,
  createIndexMaintenancePass,
  createMetricsRollupPass,
  createModelRegistryWarmPass,
} from './passes/index.js';
import {
  createOrchestrator,
  type Orchestrator,
} from './orchestrator.js';
import type {
  HeartbeatTick,
  PassResult,
  SleepPass,
} from './types.js';

const MAX_RECENT_TICKS = 25;
const MAX_RECENT_RESULTS = 50;

export interface StandaloneOrchestratorBundle {
  readonly orchestrator: Orchestrator;
  readonly mode: 'memory' | 'production';
  readonly recentTicks: () => ReadonlyArray<HeartbeatTick>;
  readonly recentResults: () => ReadonlyArray<PassResult>;
}

export interface BuildStandaloneOptions {
  /** Override env-read for tests. */
  readonly prodAdaptersRequired?: boolean;
  /** Override env-read for tests. */
  readonly heartbeatIntervalMs?: number;
}

/**
 * Build the 8 universal sleep passes against in-memory adapters.
 * Refuses to run when `SLEEP_PASS_PROD_ADAPTERS=1` is set — the prod
 * code path wires real adapters from the api-gateway composition root
 * and should fail-fast if it lands here instead.
 */
export function buildStandaloneOrchestrator(
  opts: BuildStandaloneOptions = {},
): StandaloneOrchestratorBundle {
  const prodRequired =
    opts.prodAdaptersRequired ?? process.env.SLEEP_PASS_PROD_ADAPTERS === '1';
  if (prodRequired) {
    throw new Error(
      '[sleep-pass-orchestrator] SLEEP_PASS_PROD_ADAPTERS=1 is set but ' +
        'this pod has no production adapter wiring. Wire Drizzle + Redis ' +
        'adapters from the api-gateway composition root, or unset the env ' +
        'flag to run in memory mode.',
    );
  }

  const passes: ReadonlyArray<SleepPass> = [
    createDeadLetterReplayPass(createInMemoryDeadLetterAdapter()),
    createCacheWarmUpPass(createInMemoryCacheAdapter(), []),
    createDataQualityCheckPass(createInMemoryDataQualityAdapter()),
    createIndexMaintenancePass(createInMemoryIndexAdapter()),
    createAuditChainVerifyPass(createInMemoryAuditChainAdapter([])),
    createExpiredTokenCleanupPass(createInMemoryTokenAdapter()),
    createMetricsRollupPass(createInMemoryMetricsAdapter()),
    createDormantTenantDetectorPass(createInMemoryTenantAdapter()),
    // No-op warmer in standalone mode — api-gateway composition root
    // wires the real `warmAllFamilies` from
    // `@borjie/brain-llm-router/dynamic-registry`.
    createModelRegistryWarmPass({ warmAllFamilies: async () => {} }),
  ];

  // Bounded ring buffers (oldest entries roll off) so `/admin/passes/status`
  // can serve recent tick/result snapshots without unbounded heap growth.
  const ticks: HeartbeatTick[] = [];
  const results: PassResult[] = [];
  function pushBounded<T>(buf: T[], item: T, max: number): void {
    buf.push(item);
    if (buf.length > max) buf.shift();
  }

  const intervalMs =
    opts.heartbeatIntervalMs ??
    Number(process.env.HEARTBEAT_INTERVAL_MS ?? 60_000);

  const orchestrator = createOrchestrator({
    passes,
    heartbeatIntervalMs: intervalMs,
    tickSink: (t) => pushBounded(ticks, t, MAX_RECENT_TICKS),
    resultSink: (r) => pushBounded(results, r, MAX_RECENT_RESULTS),
  });

  return {
    orchestrator,
    mode: 'memory',
    recentTicks: () => [...ticks],
    recentResults: () => [...results],
  };
}

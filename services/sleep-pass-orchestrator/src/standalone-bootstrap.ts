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
  createReflexionConsolidationPass,
  createInMemoryReflexionRunner,
} from './passes/index.js';
import {
  createOrchestrator,
  type Orchestrator,
} from './orchestrator.js';
import { runSleepTick } from './sleep-tick.js';
import { createInMemorySleepRunStore } from './in-memory-sleep-run-store.js';
import { createDrizzleSleepRunStore } from './drizzle-sleep-run-store.js';
import {
  createSleepRunDbClient,
  type SleepRunExecutor,
} from './sleep-run-db-client.js';
import { logger } from './logger.js';
import type {
  HeartbeatTick,
  PassResult,
  PassRunReport,
  SleepPass,
  SleepRunStore,
} from './types.js';

const MAX_RECENT_TICKS = 25;
const MAX_RECENT_RESULTS = 50;

/** How the durable run store was resolved at boot (surfaced on /readyz-style probes). */
export type SleepRunStoreMode = 'drizzle' | 'memory';

export interface StandaloneOrchestratorBundle {
  readonly orchestrator: Orchestrator;
  readonly mode: 'memory' | 'production';
  /** Whether sleep-run rows persist to Postgres ('drizzle') or are in-process ('memory'). */
  readonly runStoreMode: SleepRunStoreMode;
  readonly recentTicks: () => ReadonlyArray<HeartbeatTick>;
  readonly recentResults: () => ReadonlyArray<PassResult>;
}

export interface BuildStandaloneOptions {
  /** Override env-read for tests. */
  readonly prodAdaptersRequired?: boolean;
  /** Override env-read for tests. */
  readonly heartbeatIntervalMs?: number;
  /**
   * Inject a durable run store directly (tests / explicit composition). When
   * omitted, the bootstrap resolves the Drizzle-backed store from the
   * api-gateway db-client and falls back to the in-memory store when no DB is
   * configured.
   */
  readonly sleepRunStore?: SleepRunStore;
}

/**
 * Build the 8 universal sleep passes against in-memory adapters and a durable
 * sleep-run store.
 *
 * Refuses to run when `SLEEP_PASS_PROD_ADAPTERS=1` is set — the prod code path
 * wires real *pass* adapters from the api-gateway composition root and should
 * fail-fast if it lands here instead.
 *
 * The durable run store (LP-21) is resolved independently of the pass
 * adapters: when a DB client is reachable (via the api-gateway db-client) the
 * Drizzle-backed {@link createDrizzleSleepRunStore} persists every pass run +
 * emission to `brain_sleep_runs` / `brain_sleep_emissions`; otherwise the
 * in-memory store is used as the fallback. Each heartbeat tick runs its due
 * passes through {@link runSleepTick}, so the store is exercised regardless of
 * which backend resolved.
 */
export async function buildStandaloneOrchestrator(
  opts: BuildStandaloneOptions = {},
): Promise<StandaloneOrchestratorBundle> {
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

  const passes: SleepPass[] = [
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

  // Wave-3 DARK-ORGAN closure — the nightly reflexion-consolidation pass
  // (kernel `runNightlySleep`). Registered ONLY when the env flag is set
  // (default OFF — this is compute-heavy 4-pass consolidation). In
  // standalone mode the runner is the deterministic in-memory double; the
  // api-gateway composition root wires the real `runNightlySleep` + its
  // Drizzle-backed reflexion adapters over reflexion_buffer /
  // reflexion_guidelines (same "real adapters live in api-gateway" pattern
  // as the other passes above). NEVER touches the live session-end writer.
  if (process.env.BORJIE_REFLEXION_SLEEP_ENABLED === '1') {
    passes.push(
      createReflexionConsolidationPass(createInMemoryReflexionRunner([])),
    );
  }

  // Durable run + emission store: Drizzle-backed when a DB is reachable, else
  // in-memory. Resolved once and shared across every tick.
  const injected = opts.sleepRunStore;
  const resolved: { store: SleepRunStore; runStoreMode: SleepRunStoreMode } =
    injected
      ? { store: injected, runStoreMode: 'drizzle' }
      : await resolveSleepRunStore();
  const store = resolved.store;
  const runStoreMode = resolved.runStoreMode;

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
    // Durable seam: run the due passes through the budget-bounded sleep tick,
    // which bookends each with a `brain_sleep_runs` row + persists emissions.
    // The orchestrator forwards each mapped result to `resultSink`.
    runDispatched: (due) => runDispatchedDurably(due, store),
  });

  return {
    orchestrator,
    mode: 'memory',
    runStoreMode,
    recentTicks: () => [...ticks],
    recentResults: () => [...results],
  };
}

/**
 * Run the orchestrator's due passes through {@link runSleepTick} against the
 * durable store, then map each {@link PassRunReport} back to a
 * {@link PassResult} for the status ring buffer.
 */
async function runDispatchedDurably(
  due: ReadonlyArray<SleepPass>,
  store: SleepRunStore,
): Promise<ReadonlyArray<PassResult>> {
  if (due.length === 0) return [];
  const report = await runSleepTick({ passes: due, store });
  return report.runs.map((r) => reportToResult(r, report.startedAt, report.completedAt));
}

/** Map a durable {@link PassRunReport} onto the {@link PassResult} shape. */
function reportToResult(
  report: PassRunReport,
  startedAt: string,
  completedAt: string,
): PassResult {
  return {
    passId: report.passId,
    itemsProcessed: report.itemsProcessed,
    itemsEmitted: report.itemsEmitted,
    notes: report.notes,
    startedAt,
    completedAt,
    aborted: report.status === 'timeout',
    errored: report.status === 'failed',
  };
}

/**
 * Resolve the durable run store. Imports the api-gateway db-client via the
 * sibling-service dynamic-import pattern (the same one the consolidation
 * worker uses for its db + critic wiring); when a client resolves, the
 * Drizzle-backed store is used. Any failure — no `DATABASE_URL`, dist not
 * built, import error — degrades to the in-memory store so the pod always
 * boots.
 */
async function resolveSleepRunStore(): Promise<{
  store: SleepRunStore;
  runStoreMode: SleepRunStoreMode;
}> {
  try {
    const mod = (await import(
      // @ts-expect-error — sibling-service import resolved by pnpm symlink
      '../../api-gateway/dist/composition/db-client.js'
    )) as { getDb?: () => SleepRunExecutor | null };
    const db = mod.getDb?.() ?? null;
    if (db) {
      const client = createSleepRunDbClient(db);
      logger.info(
        '[sleep-pass-orchestrator] durable sleep-run store wired (brain_sleep_runs)',
      );
      return {
        store: createDrizzleSleepRunStore({ client, logger }),
        runStoreMode: 'drizzle',
      };
    }
    logger.warn(
      '[sleep-pass-orchestrator] no DATABASE_URL — sleep-run store is in-memory (runs do not persist across restarts)',
    );
  } catch (error) {
    logger.warn(
      '[sleep-pass-orchestrator] db-client import failed — sleep-run store is in-memory',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  return {
    store: createInMemorySleepRunStore(),
    runStoreMode: 'memory',
  };
}

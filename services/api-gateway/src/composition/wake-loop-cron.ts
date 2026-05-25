/**
 * Wake-loop cron — scheduled invoker for the kernel agency wake-loop.
 *
 * LITFIN parity gap H (`.planning/parity-litfin/07-agency.md`):
 *   BORJIE built the wake-loop primitive (`agency/initiative/
 *   wake-loop.ts:66-141`) AND the three real detectors (`agency/
 *   initiative/real-detectors.ts:1-321`), but `runWakeCycle` is never
 *   invoked outside kernel-internal callers + tests. The brain cannot
 *   wake itself on schedule. This module closes that gap.
 *
 * Design:
 *
 *   - One supervisor per gateway process. `.start()` arms a setInterval
 *     timer (`WAKE_LOOP_INTERVAL_MS`, default 15 minutes) that calls
 *     `tick()` immediately and then on the cadence. `.stop()` clears
 *     the timer.
 *
 *   - Each `tick()` takes a Postgres SESSION-LEVEL advisory lock keyed
 *     by `pg_try_advisory_lock(WAKE_LOCK_ID)`. If the lock is held by
 *     another gateway replica (or another tick on the same replica
 *     that overran the cadence) the tick exits as a no-op. This
 *     guarantees at-most-one wake cycle in flight cluster-wide.
 *
 *   - Inside the lock we discover active tenants (SELECT id FROM
 *     tenants WHERE is_active = TRUE), build the wake-loop deps from
 *     the existing agency-port-bindings, and call `runWakeCycle({
 *     tenantIds })`. Trigger / executor failures are absorbed by the
 *     wake-loop itself; this supervisor only logs the aggregate
 *     outcome (`goalsOpened` + `goalsExecuted` + `perTrigger`).
 *
 *   - When DATABASE_URL is unset the supervisor is a benign no-op: it
 *     logs and returns. This matches the consolidation-runner
 *     pattern — a misconfigured cron must never crash the gateway.
 *
 * Property-management cadence tailoring:
 *
 *   The default 15-minute cadence is tuned for property-management
 *   horizons: arrears chase (14d), maintenance (7d), lease renewal
 *   (30d). A faster cadence wastes detector queries; slower delays
 *   the first arrears reminder by up to an hour. Operators can override
 *   via `WAKE_LOOP_INTERVAL_MS` for higher-frequency tests.
 */

import { sql } from 'drizzle-orm';
import { agency as agencyKernel } from '@borjie/central-intelligence';
import {
  createKernelGoalsService,
  createKernelActionAuditService,
} from '@borjie/database';
import {
  createBoundActionToolDeps,
  createBoundWakeReadDeps,
} from './agency-port-bindings.js';
import { readSovereignLedgerFailClosedFromEnv } from './service-registry.js';
import { logger } from '../utils/logger.js';

type StallDetectorRunArgs = agencyKernel.StallDetectorRunArgs;
type StallDetectorRunOutcome = agencyKernel.StallDetectorRunOutcome;
type StalledGoalReport = agencyKernel.StalledGoalReport;
type StallDetectorDeps = agencyKernel.StallDetectorDeps;

/**
 * Stall-detection function ref shape — the wake-loop accepts an
 * override so tests can swap a recording stub without spinning up the
 * full kernel agency module. Default = `agencyKernel.runStallDetection`.
 */
export type StallDetectorFn = (
  args: StallDetectorRunArgs,
  deps: StallDetectorDeps,
) => Promise<StallDetectorRunOutcome>;

/**
 * Minimal repo shape the wake-loop uses to discover (tenantId, userId)
 * pairs whose `active` goals should be scanned for stalls. The real
 * Drizzle implementation lives in `@borjie/database`; the wake-loop
 * accepts an override so tests can inject a deterministic stub. The
 * `markStalled` method is OPTIONAL — when present the wake-loop will
 * call it after emitting the observability event; when absent, the
 * event is still emitted (degraded mode).
 */
export interface KernelGoalsRepoLike {
  listStallScanTargets(
    tenantId: string,
  ): Promise<ReadonlyArray<{ tenantId: string; userId: string }>>;
  markStalled?(goalId: string, reason: string): Promise<void>;
}

/**
 * Observability hook for stall events. The default implementation logs
 * via `deps.logger.warn`; tests inject a recording sink. Mirrors the
 * existing kernel `StallEventSink` shape so the same emitter can wire
 * the in-process event bus later without re-plumbing this module.
 */
export interface WakeStallObservabilitySink {
  emit(payload: StalledGoalReport): void | Promise<void>;
}

/**
 * Stable cluster-wide lock id (BIGINT). Picked from sha256("borjie-
 * wake-loop") sliced into the safe BIGINT range. Constant — every
 * replica acquires the same lock so only one cycle runs at a time.
 */
const WAKE_LOCK_ID = 7321946218472901;

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface WakeLoopCronLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

// Drizzle client shape — only `execute` is touched at this level. The
// agency-port-bindings already exhaust the typed Drizzle surface; here
// we just probe for tenants and own the advisory lock dance.
interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

export interface WakeLoopCronDeps {
  /** Drizzle client. May be null — supervisor degrades to no-op. */
  readonly db: unknown | null;
  readonly logger: WakeLoopCronLogger;
  /** Override cadence (ms). Falls back to env `WAKE_LOOP_INTERVAL_MS`,
   *  then to 15 minutes. Bounded to [30s, 24h]. */
  readonly intervalMs?: number;
  /** Override the active-tenant discovery (tests). */
  readonly listActiveTenantIds?: () => Promise<ReadonlyArray<string>>;
  /**
   * Override the stall-detection function (tests). Defaults to
   * `agencyKernel.runStallDetection`. Direct function ref is fine —
   * the supervisor never mutates it.
   */
  readonly stallDetector?: StallDetectorFn;
  /**
   * Override the kernel-goals repo used for stall-scan target
   * discovery (tests). The real composition wires this from the
   * Drizzle-backed services in `@borjie/database`.
   *
   * When this dep is absent the wake-loop SKIPS stall detection for
   * the tick — the supervisor never crashes because of a missing
   * stall infrastructure dep.
   */
  readonly kernelGoalsRepo?: KernelGoalsRepoLike;
  /**
   * Observability sink for `goal_stalled` events. Defaults to a
   * warn-logger fallback that funnels every stalled-goal report
   * through `logger.warn` with a stable `event: 'agency.goal-stalled'`
   * tag so dashboards can filter on it.
   */
  readonly stallEventSink?: WakeStallObservabilitySink;
  /**
   * C6 Phase A — HQ-tier wake-trigger dependencies. When unwired
   * (default), the HQ triggers are still registered with the wake-
   * loop but each detector returns an empty array (so the trigger
   * count stays accurate without firing goals). Composition roots
   * wire `subscriptionChurn` / `aiCostOverrun` / `webhookDlqDepth`
   * / `personaDriftBreach` sub-deps as their backing services come
   * online.
   */
  readonly hqWakeTriggerDeps?: agencyKernel.HqWakeTriggerDeps;
}

export interface WakeLoopCronSupervisor {
  start(): void;
  stop(): void;
  /** Run one cycle immediately, bypassing the cadence. Returns the
   *  wake-loop outcome (or null when the lock was held / DB absent). */
  tick(): Promise<WakeLoopCronTickResult | null>;
  readonly intervalMs: number;
}

export interface WakeLoopCronTickResult {
  readonly tenantsProcessed: number;
  readonly goalsOpened: number;
  readonly goalsExecuted: number;
  readonly perTrigger: Record<string, number>;
  readonly skippedReason: 'lock-held' | 'no-db' | 'no-tenants' | null;
  /**
   * Number of `goal_stalled` reports emitted across all tenants in
   * this tick. Surfaces in the supervisor's structured log alongside
   * `goalsOpened` / `goalsExecuted` so operators can spot a runaway
   * stall storm without grepping for every event.
   */
  readonly goalsStalled: number;
}

function resolveIntervalMs(override?: number): number {
  const envRaw = process.env.WAKE_LOOP_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(candidate)));
}

async function tryAdvisoryLock(db: DrizzleLikeClient): Promise<boolean> {
  try {
    const result = (await db.execute(
      sql`SELECT pg_try_advisory_lock(${WAKE_LOCK_ID}) AS acquired`,
    )) as unknown;
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<{ acquired?: unknown }>)
      : (((result as { rows?: ReadonlyArray<{ acquired?: unknown }> })?.rows ??
          []) as ReadonlyArray<{ acquired?: unknown }>);
    const first = rows[0];
    return Boolean(first?.acquired);
  } catch {
    // If even the probe fails the safest behaviour is to skip the tick.
    return false;
  }
}

async function releaseAdvisoryLock(db: DrizzleLikeClient): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${WAKE_LOCK_ID})`);
  } catch {
    // Session-level locks release on disconnect anyway.
  }
}

async function defaultListActiveTenantIds(
  db: DrizzleLikeClient,
): Promise<ReadonlyArray<string>> {
  try {
    const result = (await db.execute(
      sql`SELECT id FROM tenants WHERE is_active = TRUE`,
    )) as unknown;
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<{ id?: unknown }>)
      : (((result as { rows?: ReadonlyArray<{ id?: unknown }> })?.rows ??
          []) as ReadonlyArray<{ id?: unknown }>);
    return rows
      .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export function createWakeLoopCronSupervisor(
  deps: WakeLoopCronDeps,
): WakeLoopCronSupervisor {
  const intervalMs = resolveIntervalMs(deps.intervalMs);

  let handle: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  async function tick(): Promise<WakeLoopCronTickResult | null> {
    if (inflight) return { tenantsProcessed: 0, goalsOpened: 0, goalsExecuted: 0, perTrigger: {}, skippedReason: 'lock-held', goalsStalled: 0 };
    inflight = true;
    try {
      if (!deps.db) {
        deps.logger.warn(
          { intervalMs },
          'wake-loop-cron: no db — supervisor is no-op',
        );
        return {
          tenantsProcessed: 0,
          goalsOpened: 0,
          goalsExecuted: 0,
          perTrigger: {},
          skippedReason: 'no-db',
          goalsStalled: 0,
        };
      }
      const db = deps.db as DrizzleLikeClient;
      const acquired = await tryAdvisoryLock(db);
      if (!acquired) {
        deps.logger.info(
          { lockId: WAKE_LOCK_ID },
          'wake-loop-cron: lock held by another replica/tick — skipping',
        );
        return {
          tenantsProcessed: 0,
          goalsOpened: 0,
          goalsExecuted: 0,
          perTrigger: {},
          skippedReason: 'lock-held',
          goalsStalled: 0,
        };
      }
      try {
        const listActive =
          deps.listActiveTenantIds ?? (() => defaultListActiveTenantIds(db));
        const tenantIds = await listActive();
        if (tenantIds.length === 0) {
          deps.logger.info(
            {},
            'wake-loop-cron: no active tenants — skipping cycle',
          );
          return {
            tenantsProcessed: 0,
            goalsOpened: 0,
            goalsExecuted: 0,
            perTrigger: {},
            skippedReason: 'no-tenants',
            goalsStalled: 0,
          };
        }

        // The kernel-goals service is reused by BOTH the wake-cycle
        // (executor) and the stall detector (read-only goal list). Build
        // it up front so a failure inside the wake-cycle's tool / trigger
        // wiring does NOT prevent the stall-detection sweep from running.
        const goals = createKernelGoalsService(db as never);

        // Build wake-loop deps from the same composition-root bindings
        // the sovereign brain uses. We construct fresh instances per
        // tick because the bindings are cheap (factories over the
        // shared Drizzle client) and we want every cycle to see the
        // latest registry state without stale closures. The whole setup
        // sits in a try/catch so a bind-time failure (missing service,
        // schema drift, fake-db in tests) degrades to a zeroed-out
        // wake-cycle outcome rather than skipping the stall sweep.
        let outcome: { goalsOpened: number; goalsExecuted: number; perTrigger: Record<string, number> } = {
          goalsOpened: 0,
          goalsExecuted: 0,
          perTrigger: {},
        };
        try {
          const auditSink = createKernelActionAuditService(db as never);
          const toolRegistry = agencyKernel.createActionToolRegistry();
          for (const stub of agencyKernel.DEFAULT_ACTION_TOOL_STUBS) {
            toolRegistry.register(stub);
          }
          const boundActionToolDeps = createBoundActionToolDeps(db as never);
          for (const realTool of agencyKernel.createRealActionTools(
            boundActionToolDeps,
          )) {
            toolRegistry.register(realTool);
          }
          const executor = agencyKernel.createExecutor({
            goals,
            tools: toolRegistry,
            auditSink,
            autonomyPolicy: agencyKernel.createDefaultAllowLowStakesPolicy(),
            sovereignLedgerFailClosed: readSovereignLedgerFailClosedFromEnv(),
          });
          const boundWakeReadDeps = createBoundWakeReadDeps(db as never);
          const tenantTriggers = agencyKernel.createRealWakeTriggers({
            arrears: boundWakeReadDeps.arrearsRead,
            leases: boundWakeReadDeps.leaseRead,
            vacancy: boundWakeReadDeps.vacancyRead,
          });
          // C6 Phase A — HQ-tier wake triggers (subscription-churn,
          // ai-cost-overrun, webhook-dlq-depth, persona-drift-breach).
          // The HQ trigger deps may be partially-wired or fully unwired
          // when their dependent services haven't shipped yet — each
          // trigger no-ops (returns []) when its read port is missing,
          // so registering them unconditionally is safe.
          const hqTriggerDeps =
            (deps as { hqWakeTriggerDeps?: agencyKernel.HqWakeTriggerDeps })
              .hqWakeTriggerDeps ?? {};
          const hqTriggers = agencyKernel.createHqWakeTriggers(hqTriggerDeps);
          const triggers = [...tenantTriggers, ...hqTriggers];
          outcome = await agencyKernel.runWakeCycle(
            { tenantIds },
            { goals, executor, triggers },
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const errLog = deps.logger.error ?? deps.logger.warn;
          errLog({ err: msg }, 'wake-loop-cron: wake-cycle setup/run failed');
        }

        // -----------------------------------------------------------------
        // Stall detection — K7 wave-K wiring. Sweep active goals
        // per (tenantId, userId) and emit `agency.goal-stalled` for any
        // goal whose last step activity is older than its category
        // threshold. The whole block is wrapped in try/catch so any
        // stall infrastructure failure (DB hiccup, repo not bound,
        // detector regression) never crashes the wake-loop's primary
        // duty of executing detectors + goals.
        // -----------------------------------------------------------------
        let goalsStalled = 0;
        try {
          const detector =
            deps.stallDetector ?? agencyKernel.runStallDetection;
          const repo = deps.kernelGoalsRepo ?? null;
          if (repo) {
            const stallSink = deps.stallEventSink ?? null;
            for (const tenantId of tenantIds) {
              let targets: ReadonlyArray<{
                tenantId: string;
                userId: string;
              }> = [];
              try {
                targets = await repo.listStallScanTargets(tenantId);
              } catch (error) {
                const msg =
                  error instanceof Error ? error.message : String(error);
                const errLog = deps.logger.error ?? deps.logger.warn;
                errLog(
                  { err: msg, tenantId },
                  'wake-loop-cron: stall-scan target lookup failed',
                );
                continue;
              }
              for (const { userId } of targets) {
                let stallOutcome: StallDetectorRunOutcome | null = null;
                try {
                  stallOutcome = await detector(
                    { tenantId, userId },
                    { goals },
                  );
                } catch (error) {
                  const msg =
                    error instanceof Error ? error.message : String(error);
                  const errLog = deps.logger.error ?? deps.logger.warn;
                  errLog(
                    { err: msg, tenantId, userId },
                    'wake-loop-cron: stall detector failed',
                  );
                  continue;
                }
                for (const report of stallOutcome.stalled) {
                  goalsStalled += 1;
                  // Emit observability event — operators key dashboards
                  // off the `event` tag.
                  try {
                    if (stallSink) {
                      await stallSink.emit(report);
                    } else {
                      deps.logger.warn(
                        {
                          event: 'agency.goal-stalled',
                          tenantId: report.tenantId,
                          goalId: report.goalId,
                          category: report.category,
                          threshold: report.threshold,
                          days: report.daysSinceLastActivity,
                        },
                        'wake-loop-cron: goal stalled',
                      );
                    }
                  } catch (error) {
                    const msg =
                      error instanceof Error
                        ? error.message
                        : String(error);
                    const errLog =
                      deps.logger.error ?? deps.logger.warn;
                    errLog(
                      { err: msg, goalId: report.goalId },
                      'wake-loop-cron: stall event emit failed',
                    );
                  }
                  // Optional repo-side status bump — degraded path when
                  // the repo doesn't yet support `markStalled`.
                  if (typeof repo.markStalled === 'function') {
                    const reasonProposal =
                      report.proposals.find((p) => p.kind === 'block') ??
                      report.proposals[0];
                    const reason =
                      reasonProposal?.reason ??
                      `stalled ${report.daysSinceLastActivity}d (${report.category})`;
                    try {
                      await repo.markStalled(report.goalId, reason);
                    } catch (error) {
                      const msg =
                        error instanceof Error
                          ? error.message
                          : String(error);
                      const errLog =
                        deps.logger.error ?? deps.logger.warn;
                      errLog(
                        { err: msg, goalId: report.goalId },
                        'wake-loop-cron: markStalled failed',
                      );
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          // Outer catch — pure belt-and-braces. The inner try/catch
          // blocks above already isolate every external call; this
          // guards against a synchronous throw before any of those
          // entered (e.g. a future regression that throws while
          // resolving the detector ref).
          const msg = error instanceof Error ? error.message : String(error);
          const errLog = deps.logger.error ?? deps.logger.warn;
          errLog({ err: msg }, 'wake-loop-cron: stall detection block failed');
        }

        deps.logger.info(
          {
            tenants: tenantIds.length,
            goalsOpened: outcome.goalsOpened,
            goalsExecuted: outcome.goalsExecuted,
            goalsStalled,
            perTrigger: outcome.perTrigger,
          },
          'wake-loop-cron: cycle complete',
        );
        return {
          tenantsProcessed: tenantIds.length,
          goalsOpened: outcome.goalsOpened,
          goalsExecuted: outcome.goalsExecuted,
          perTrigger: { ...outcome.perTrigger },
          skippedReason: null,
          goalsStalled,
        };
      } finally {
        await releaseAdvisoryLock(db);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const errLog = deps.logger.error ?? deps.logger.warn;
      errLog({ err: msg }, 'wake-loop-cron: tick failed');
      return null;
    } finally {
      inflight = false;
    }
  }

  return {
    intervalMs,
    start() {
      if (handle) return;
      // First tick immediately so operators see the cron is alive in
      // the boot log without waiting `intervalMs`. setInterval is then
      // scheduled for steady-state cadence. When WAKE_LOOP_INTERVAL_MS=0
      // the supervisor behaves as a one-shot (the immediate tick fires
      // but no setInterval arms) — useful for k8s CronJob mode.
      void tick();
      if (process.env.WAKE_LOOP_INTERVAL_MS?.trim() === '0') {
        deps.logger.info(
          { mode: 'one-shot' },
          'wake-loop-cron: one-shot mode (CronJob driven)',
        );
        return;
      }
      handle = setInterval(() => void tick(), intervalMs);
      if (typeof handle.unref === 'function') handle.unref();
      deps.logger.info({ intervalMs }, 'wake-loop-cron: started');
    },
    stop() {
      if (!handle) return;
      clearInterval(handle);
      handle = null;
      deps.logger.info({}, 'wake-loop-cron: stopped');
    },
    tick,
  };
}

// ---------------------------------------------------------------------------
// CLI guard — `tsx wake-loop-cron.ts` runs one tick and exits.
// Powers the k8s/wake-loop-cron.yaml CronJob entrypoint. Mirrors the
// `consolidation-runner.ts` CLI pattern: lazy-imports db-client so unit
// tests of this module don't need a real DB connection at import time.
// ---------------------------------------------------------------------------

export async function runFromEnv(): Promise<WakeLoopCronTickResult | null> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    logger.warn('wake-loop-cron CLI: DATABASE_URL not set — no-op');
    return null;
  }
  let db: unknown = null;
  try {
    const mod = await import('./db-client.js');
    db = ((mod as { getDb?: () => unknown }).getDb?.() ?? null) as unknown;
  } catch (error) {
    logger.warn('wake-loop-cron CLI: db-client import failed', { error });
    return null;
  }
  const supervisor = createWakeLoopCronSupervisor({
    db,
    logger: {
      // eslint-disable-next-line no-console
      info: (obj, msg) => console.info('wake-loop-cron:', msg ?? '', obj),
      // eslint-disable-next-line no-console
      warn: (obj, msg) => console.warn('wake-loop-cron:', msg ?? '', obj),
      // eslint-disable-next-line no-console
      error: (obj, msg) => console.error('wake-loop-cron:', msg ?? '', obj),
    },
  });
  return supervisor.tick();
}

const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /wake-loop-cron(\.js|\.ts)?$/.test(process.argv[1]);

if (isDirect) {
  runFromEnv()
    .then((result) => {
      logger.info('wake-loop-cron CLI', { value: result ?? '(no-op)' });
      process.exit(0);
    })
    .catch((error) => {
      logger.error('wake-loop-cron CLI: fatal', { error: error });
      process.exit(2);
    });
}

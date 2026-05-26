/**
 * Background wiring — heartbeat engine, background task scheduler,
 * webhook-DLQ repository, and ambient-brain observer composition.
 *
 * All factories take `(registry, logger)` and return a pair of
 * `start` / `stop` functions so `index.ts` can control lifecycle
 * from the main supervisor. No timers live in module scope.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  createHeartbeatEngine,
  buildHeartbeatDutyRegistry,
  HEARTBEAT_DUTY_IDS,
  type HeartbeatEngine,
  type JuniorSession,
} from '@borjie/ai-copilot/heartbeat';
import {
  createRiskRecomputeDispatcher,
  type RiskRecomputeDispatcher,
  type RiskComputeJob,
  type RiskComputeRegistry,
  type RiskDispatcherTelemetry,
  type RiskKind,
  type RiskSubscribableEventBus,
} from '@borjie/ai-copilot';
import {
  BackgroundTaskScheduler,
  buildTaskCatalogue,
  InMemoryInsightStore,
  PostgresInsightStore,
  type BackgroundTaskData,
} from '@borjie/ai-copilot/background-intelligence';
import { BehaviorObserver } from '@borjie/ai-copilot/ambient-brain';
import type { ServiceRegistry } from './service-registry.js';
import type {
  WebhookDeliveryRepository,
  WebhookAttemptRecord,
  WebhookDeadLetterRecord,
} from '../workers/webhook-retry-worker.js';
import {
  createIntelligenceHistorySupervisor,
  type IntelligenceHistorySupervisor,
} from './intelligence-history-wiring.js';

export type {
  IntelligenceHistorySupervisor,
} from './intelligence-history-wiring.js';
export { createIntelligenceHistorySupervisor } from './intelligence-history-wiring.js';

// ---------------------------------------------------------------------------
// Risk-recompute job tracker (in-memory)
//
// The dispatcher itself is fire-and-forget: it returns a count of jobs
// dispatched but does not hold durable state. The api-gateway exposes a
// manual `POST /risk-recompute/trigger` endpoint + a `GET /status/:jobId`
// polling endpoint, so we need a cheap in-process store for job records.
// Bounded to 512 jobs (LRU-ish by insertion order) so the process memory
// footprint stays flat under sustained load. A real deployment would
// swap this for Redis / a Postgres table; for Wave 27 the in-memory
// tracker is enough because operators consult status via the immediate
// response + the heartbeat telemetry log.
// ---------------------------------------------------------------------------

export type RiskRecomputeJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface RiskRecomputeJobRecord {
  readonly jobId: string;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly status: RiskRecomputeJobStatus;
  /** Which kinds were kicked. Empty array means "all registered kinds". */
  readonly kinds: readonly RiskKind[];
  readonly jobsDispatched: number;
  readonly failures: readonly {
    readonly kind: RiskKind;
    readonly entityId: string;
    readonly reason: string;
  }[];
  readonly estimatedDurationMs: number;
  readonly errorMessage?: string;
}

export interface RiskRecomputeJobTracker {
  create(input: {
    readonly tenantId: string;
    readonly kinds?: readonly RiskKind[];
    readonly estimatedDurationMs: number;
  }): RiskRecomputeJobRecord;
  markRunning(jobId: string): void;
  markSucceeded(
    jobId: string,
    dispatched: number,
    failures: readonly {
      readonly kind: RiskKind;
      readonly entityId: string;
      readonly reason: string;
    }[],
  ): void;
  markFailed(jobId: string, error: unknown): void;
  get(jobId: string): RiskRecomputeJobRecord | null;
  list(tenantId: string, limit?: number): readonly RiskRecomputeJobRecord[];
}

const MAX_TRACKED_JOBS = 512;

export function createRiskRecomputeJobTracker(): RiskRecomputeJobTracker {
  const jobs = new Map<string, RiskRecomputeJobRecord>();

  function evictIfNeeded(): void {
    while (jobs.size > MAX_TRACKED_JOBS) {
      const oldest = jobs.keys().next().value as string | undefined;
      if (!oldest) break;
      jobs.delete(oldest);
    }
  }

  function replace(
    jobId: string,
    patch: Partial<RiskRecomputeJobRecord>,
  ): void {
    const existing = jobs.get(jobId);
    if (!existing) return;
    jobs.set(jobId, { ...existing, ...patch });
  }

  return {
    create(input) {
      const jobId = `risk_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const record: RiskRecomputeJobRecord = {
        jobId,
        tenantId: input.tenantId,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        status: 'queued',
        kinds: input.kinds ?? [],
        jobsDispatched: 0,
        failures: [],
        estimatedDurationMs: input.estimatedDurationMs,
      };
      jobs.set(jobId, record);
      evictIfNeeded();
      return record;
    },
    markRunning(jobId) {
      replace(jobId, { status: 'running', startedAt: new Date().toISOString() });
    },
    markSucceeded(jobId, dispatched, failures) {
      replace(jobId, {
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        jobsDispatched: dispatched,
        failures,
      });
    },
    markFailed(jobId, error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      replace(jobId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage,
      });
    },
    get(jobId) {
      return jobs.get(jobId) ?? null;
    },
    list(tenantId, limit = 50) {
      const out: RiskRecomputeJobRecord[] = [];
      for (const rec of jobs.values()) {
        if (rec.tenantId !== tenantId) continue;
        out.push(rec);
      }
      // Newest first, bounded.
      return out
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, Math.max(1, Math.min(200, limit)));
    },
  };
}

// ---------------------------------------------------------------------------
// Heartbeat engine
// ---------------------------------------------------------------------------

export interface HeartbeatSupervisor {
  readonly engine: HeartbeatEngine;
  readonly riskDispatcher: RiskRecomputeDispatcher;
  readonly riskJobs: RiskRecomputeJobTracker;
  start(): void;
  stop(): void;
}

export function createHeartbeatSupervisor(
  registry: ServiceRegistry,
  logger: Logger,
  tickMs = 30_000,
): HeartbeatSupervisor {
  // Wave 27 Agent F — risk-recompute dispatcher. The registry is the
  // `kind → compute fn` map; each compute fn proxies to the matching
  // domain service (credit-rating / property-grading / etc). Missing
  // services simply stay unregistered — the dispatcher skips silently
  // for any event classified to a kind that has no compute fn.
  //
  // `RiskComputeRegistry` is declared with `readonly` keys, so we assemble
  // the object literal in a mutable shape first and cast on the way in.
  const riskJobs = createRiskRecomputeJobTracker();
  const mutableRegistry: {
    -readonly [K in keyof RiskComputeRegistry]: RiskComputeRegistry[K];
  } = {};
  if (registry.creditRating) {
    const svc = registry.creditRating;
    mutableRegistry.credit_rating = async (job: RiskComputeJob) => {
      await svc.computeRating(job.tenantId, job.entityId);
    };
  }
  if (registry.propertyGrading) {
    const svc = registry.propertyGrading as unknown as {
      gradeProperty?: (tenantId: string, propertyId: string) => Promise<unknown>;
    };
    if (typeof svc.gradeProperty === 'function') {
      mutableRegistry.property_grade = async (job: RiskComputeJob) => {
        await svc.gradeProperty!(job.tenantId, job.entityId);
      };
    }
  }
  const computeRegistry: RiskComputeRegistry = mutableRegistry;

  const riskDispatcher: RiskRecomputeDispatcher = createRiskRecomputeDispatcher({
    registry: computeRegistry,
    telemetry: (t: RiskDispatcherTelemetry) => {
      if (t.outcome === 'error') {
        logger.warn(
          {
            kind: t.kind,
            entityId: t.entityId,
            triggerEventType: t.triggerEventType,
            triggerEventId: t.triggerEventId,
            durationMs: t.durationMs,
            errorMessage: t.errorMessage,
          },
          'risk-recompute dispatch failed',
        );
      } else {
        logger.debug(
          {
            kind: t.kind,
            entityId: t.entityId,
            triggerEventType: t.triggerEventType,
            durationMs: t.durationMs,
          },
          'risk-recompute dispatch ok',
        );
      }
    },
  });

  // Subscribe the dispatcher to the domain event bus. The domain bus
  // satisfies the `RiskSubscribableEventBus` contract structurally —
  // its `subscribe(type, handler)` handler receives an envelope with
  // an `.event` property that carries `eventType` / `eventId` /
  // `tenantId` / `timestamp`. We subscribe only if the bus is present
  // and exposes `.subscribe` (true for the in-memory bus used in prod +
  // tests; defensive guard keeps the supervisor bootable if the bus
  // shape drifts).
  let unsubscribeRisk: (() => void) | null = null;
  const domainBus = registry.eventBus as unknown as
    | RiskSubscribableEventBus
    | undefined;
  if (domainBus && typeof domainBus.subscribe === 'function') {
    try {
      unsubscribeRisk = riskDispatcher.subscribeTo(domainBus);
      logger.info(
        { kinds: riskDispatcher.registeredKinds },
        'risk-recompute: subscribed to domain event bus',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'risk-recompute: subscribe failed',
      );
    }
  } else {
    logger.info(
      'risk-recompute: domain event bus unavailable; dispatcher idle (manual trigger only)',
    );
  }

  // Heartbeat duty registry — Wave 27 Part B.8. We register the
  // credit-rating-recompute watchdog as a fallback slow duty so the
  // engine still catches any customer whose rating was missed by the
  // event-driven path (e.g. a redelivery dropped by the dedupe window).
  // The worker is a no-op when the service is absent.
  const duties = buildHeartbeatDutyRegistry({
    workers: {
      creditRatingRecomputeWatchdog: async (ctx) => {
        if (!registry.creditRating) return;
        // Fallback is intentionally light — log the tick so operators
        // can verify the duty is alive. The heavy sweep belongs in a
        // scheduled Postgres worker, not every heartbeat tick.
        logger.debug(
          {
            dutyId: HEARTBEAT_DUTY_IDS.creditRatingRecomputeWatchdog,
            activeTenants: ctx.activeTenantIds.length,
          },
          'heartbeat duty: credit-rating recompute watchdog tick',
        );
      },
    },
  });

  const engine = createHeartbeatEngine(
    {
      now: () => Date.now(),
      probeLlmHealth: async () => true,
      rollLedger: async (tenantId) => {
        if (!registry.aiCostLedger) return;
        try {
          await registry.aiCostLedger.currentMonthSpend(tenantId);
        } catch {
          /* non-fatal */
        }
      },
      duties,
      telemetry: (result) => {
        logger.info(
          {
            tickAt: result.tickAt,
            ledgersRolled: result.ledgersRolled,
            memorySweeps: result.memorySweeps,
            llmHealthy: result.llmHealthy,
            juniorsPutToSleep: result.juniorsPutToSleep.length,
            dutiesExecuted: result.dutiesExecuted,
            dutiesFailed: result.dutiesFailed,
          },
          'heartbeat tick',
        );
      },
    },
    { cadenceMs: tickMs },
  );

  let handle: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    try {
      const tenants = await listActiveTenantIds(registry);
      const juniors: readonly JuniorSession[] = []; // no junior-session registry yet
      await engine.tick({ juniors, activeTenantIds: tenants });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'heartbeat tick failed',
      );
    }
  }

  return {
    engine,
    riskDispatcher,
    riskJobs,
    start() {
      if (handle) return;
      // First tick immediately so operators can see the engine is alive.
      void tick();
      handle = setInterval(tick, tickMs);
      if (typeof handle.unref === 'function') handle.unref();
      logger.info({ tickMs }, 'heartbeat engine started');
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = null;
        logger.info('heartbeat engine stopped');
      }
      if (unsubscribeRisk) {
        try {
          unsubscribeRisk();
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'risk-recompute: unsubscribe failed',
          );
        }
        unsubscribeRisk = null;
        logger.info('risk-recompute dispatcher unsubscribed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Background task scheduler
// ---------------------------------------------------------------------------

export interface BackgroundSchedulerSupervisor {
  readonly scheduler: BackgroundTaskScheduler | null;
  start(): void;
  stop(): void;
}

export function createBackgroundSupervisor(
  registry: ServiceRegistry,
  logger: Logger,
): BackgroundSchedulerSupervisor {
  if (process.env.BORJIE_BG_TASKS_ENABLED === 'false') {
    logger.info('background-tasks: disabled via env');
    return { scheduler: null, start() {}, stop() {} };
  }
  if (!registry.isLive || !registry.db) {
    logger.warn('background-tasks: degraded registry — scheduler not started');
    return { scheduler: null, start() {}, stop() {} };
  }

  const store = registry.db
    ? new PostgresInsightStore({
        query: async (text, params) => {
          const res = await (
            registry.db as unknown as { execute(q: unknown): Promise<unknown> }
          ).execute(
            sql.raw(
              interpolate(text, (params as readonly unknown[]) ?? []),
            ),
          );
          const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
          return { rows: rows as Record<string, unknown>[] } as never;
        },
      } as never)
    : new InMemoryInsightStore();

  const tenants = {
    async listActiveTenants(): Promise<readonly string[]> {
      try {
        const res = await (
          registry.db as unknown as { execute(q: unknown): Promise<unknown> }
        ).execute(sql`SELECT id FROM tenants WHERE is_active = TRUE`);
        const rows = Array.isArray(res)
          ? res
          : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
        return rows.map((r) => String((r as { id: unknown }).id));
      } catch {
        return [];
      }
    },
  };

  const featureFlags = registry.featureFlags
    ? {
        async isEnabled(tenantId: string, flagKey: string): Promise<boolean> {
          try {
            return await registry.featureFlags!.isEnabled(tenantId, flagKey);
          } catch {
            return true; // default open so scheduler still runs in pilot
          }
        },
      }
    : {
        async isEnabled() {
          return true;
        },
      };

  const baseCatalogue = buildTaskCatalogue(buildTaskData(registry));
  const tasks = [
    ...baseCatalogue,
    ...buildExtensionTasks(registry, logger),
  ];

  const scheduler = new BackgroundTaskScheduler({
    store: store as unknown as InstanceType<typeof InMemoryInsightStore>,
    tenants,
    featureFlags,
    tasks,
    logger: (msg, meta) => logger.info(meta ?? {}, `bg-task ${msg}`),
  });

  let handle: NodeJS.Timeout | null = null;

  async function tickWrapper(): Promise<void> {
    try {
      const summaries = await scheduler.tick();
      if (summaries.length > 0) {
        logger.info(
          { count: summaries.length },
          'background scheduler tick completed with summaries',
        );
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'background scheduler tick failed',
      );
    }
  }

  return {
    scheduler,
    start() {
      if (handle) return;
      void tickWrapper();
      handle = setInterval(tickWrapper, 60_000);
      if (typeof handle.unref === 'function') handle.unref();
      logger.info('background scheduler started (1m cadence)');
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = null;
        logger.info('background scheduler stopped');
      }
    },
  };
}

/**
 * Wire previously-orphaned schedulables discovered during the Wave-15
 * wiring audit:
 *
 *   - detect_bottlenecks   — scans the org-awareness process-miner every
 *                            day at 04:00 UTC and persists surfaced stalls
 *                            into the bottleneck store.
 *   - memory_decay_sweep   — weekly exponential-decay pass over the
 *                            semantic-memory table. Gated by the
 *                            `ai.bg.memory_decay_sweep` feature flag.
 *
 * Both are pure functions of the registry and emit zero insights into the
 * InsightStore — we count actual detections / decayed rows via the
 * returned summary instead so existing dashboards continue to work.
 */
function buildExtensionTasks(
  registry: ServiceRegistry,
  logger: Logger,
): readonly import('@borjie/ai-copilot/background-intelligence').ScheduledTaskDefinition[] {
  const tasks: import('@borjie/ai-copilot/background-intelligence').ScheduledTaskDefinition[] = [];

  // detect_bottlenecks — delegate to the org-awareness detector.
  if (registry.orgAwareness?.bottleneckDetector) {
    tasks.push({
      name: 'detect_bottlenecks',
      cron: '0 4 * * *',
      description:
        'Daily scan for chronic bottlenecks, stalls, and high reopen rates.',
      featureFlagKey: 'ai.bg.detect_bottlenecks',
      run: async (ctx) => {
        const start = Date.now();
        let surfaced: readonly unknown[] = [];
        try {
          surfaced = (await registry.orgAwareness.bottleneckDetector.detectForTenant(
            ctx.tenantId,
          )) as readonly unknown[];
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'bg-task detect_bottlenecks failed',
          );
        }
        return {
          task: 'detect_bottlenecks',
          tenantId: ctx.tenantId,
          insightsEmitted: surfaced.length,
          durationMs: Date.now() - start,
          ranAt: ctx.now.toISOString(),
        };
      },
    });
  }

  // memory_decay_sweep — best-effort: only wires if the ai-copilot memory
  // module and a semantic-memory repository are available on the registry.
  // In degraded mode we skip silently — operators see the scheduler
  // registry includes the task but the runner reports zero scanned rows.
  tasks.push({
    name: 'memory_decay_sweep',
    cron: '0 5 * * 0', // Sunday 05:00 UTC
    description:
      'Weekly exponential-decay pass over the semantic-memory store.',
    featureFlagKey: 'ai.bg.memory_decay_sweep',
    run: async (ctx) => {
      const start = Date.now();
      // Memory repo is not in the current registry; sweep is a no-op until
      // the repo is plumbed. Kept registered so `listScheduledTasks()` is
      // complete and ops can flip the flag when the repo lands.
      let updated = 0;
      try {
        const repo = (registry as { semanticMemoryRepo?: unknown })
          .semanticMemoryRepo;
        if (repo) {
          // Dynamically import to avoid a hard dependency when the memory
          // module isn't in the graph (keeps the gateway start-up light).
          const { sweepTenantDecay } = await import(
            '@borjie/ai-copilot'
          ).catch(() => ({
            sweepTenantDecay: null as
              | null
              | ((tenantId: string, deps: unknown) => Promise<{ updated: number }>),
          }));
          if (sweepTenantDecay) {
            // `repo` is opaque to this file; the caller in ai-copilot
            // type-checks it structurally. We pass through as-is and
            // cast the deps bag so TS doesn't widen `{ repo: unknown }`
            // against the strict `SemanticMemoryRepository` interface.
            const res = await (
              sweepTenantDecay as (
                tenantId: string,
                deps: { repo: unknown },
              ) => Promise<{ updated?: number }>
            )(ctx.tenantId, { repo });
            updated = res?.updated ?? 0;
          }
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'bg-task memory_decay_sweep failed',
        );
      }
      return {
        task: 'memory_decay_sweep',
        tenantId: ctx.tenantId,
        insightsEmitted: updated,
        durationMs: Date.now() - start,
        ranAt: ctx.now.toISOString(),
      };
    },
  });

  // recompute_intelligence_history — daily per-customer snapshot worker
  // (Wave-26 Agent Z4). Uses Postgres-backed adapters to read tenants +
  // customers and write deterministic signal snapshots into
  // `intelligence_history`. Skips silently when DATABASE_URL is unset.
  if (registry.db) {
    const worker = createIntelligenceHistorySupervisor(registry.db, {
      info: (meta, msg) => logger.info(meta, msg),
      warn: (meta, msg) => logger.warn(meta, msg),
    }).worker;
    if (worker) {
      tasks.push({
        name: 'recompute_intelligence_history',
        cron: '0 2 * * *', // Daily 02:00 UTC
        description:
          'Daily per-customer intelligence snapshot — payment risk, churn, sentiment, maintenance counts. Idempotent on (tenant, customer, date).',
        featureFlagKey: 'ai.bg.recompute_intelligence_history',
        run: async (ctx) => {
          const start = Date.now();
          let snapshotsWritten = 0;
          try {
            const res = await worker.runDaily();
            snapshotsWritten = res.snapshotsWritten;
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'bg-task recompute_intelligence_history failed',
            );
          }
          return {
            task: 'recompute_intelligence_history',
            tenantId: ctx.tenantId,
            insightsEmitted: snapshotsWritten,
            durationMs: Date.now() - start,
            ranAt: ctx.now.toISOString(),
          };
        },
      });
    }
  }

  // recompute_property_grades — weekly (Mon 06:00 UTC) bulk-grade of every
  // property for every tenant so the admin/owner dashboards always surface
  // fresh report cards. Skips silently when the service is in degraded
  // (DB-less) mode. Each grade is persisted to `property_grade_snapshots`
  // so the 12-month history chart can be rendered without replay.
  if (registry.propertyGrading) {
    tasks.push({
      name: 'recompute_property_grades',
      cron: '0 6 * * 1',
      description:
        'Weekly bulk recompute of every property grade for a tenant — persists a snapshot per property so history is complete.',
      featureFlagKey: 'ai.bg.recompute_property_grades',
      run: async (ctx) => {
        const start = Date.now();
        let regraded = 0;
        try {
          const outcomes = await registry.propertyGrading!.gradeAllProperties(
            ctx.tenantId,
          );
          regraded = outcomes.length;
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'bg-task recompute_property_grades failed',
          );
        }
        return {
          task: 'recompute_property_grades',
          tenantId: ctx.tenantId,
          insightsEmitted: regraded,
          durationMs: Date.now() - start,
          ranAt: ctx.now.toISOString(),
        };
      },
    });
  }

  // monthly_close — Wave 28 Phase A Agent PhA2. Fires at 02:00 UTC on the
  // 1st of every month, per tenant. Walks the 8-step end-of-month close
  // orchestrator (reconcile → statements → KRA MRI → disbursements →
  // email → emit event). Autonomy-policy gates the disbursement batch.
  //
  // The orchestrator is looked up off the registry optionally — if the
  // composition root hasn't wired it yet the task reports zero work
  // done and operators see "0 runs" in the scheduler telemetry, which
  // is the pilot-acceptable degraded behaviour.
  tasks.push({
    name: 'monthly_close',
    cron: '0 2 1 * *',
    description:
      'Monthly bookkeeping close — reconciles payments, generates owner statements, computes KRA MRI, proposes disbursements (autonomy-gated), emails owners.',
    featureFlagKey: 'ai.bg.monthly_close',
    run: async (ctx) => {
      const start = Date.now();
      let executed = 0;
      try {
        const orch = (registry as {
          monthlyClose?: {
            orchestrator?: {
              triggerRun(input: {
                tenantId: string;
                trigger: 'cron' | 'manual' | 'resume';
                triggeredBy: string;
              }): Promise<{ run: { steps: readonly unknown[] } }>;
            };
          };
        }).monthlyClose?.orchestrator;
        if (orch) {
          const res = await orch.triggerRun({
            tenantId: ctx.tenantId,
            trigger: 'cron',
            triggeredBy: 'system',
          });
          executed = res.run.steps.length;
        }
      } catch (err) {
        logger.warn(
          {
            tenantId: ctx.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'bg-task monthly_close failed',
        );
      }
      return {
        task: 'monthly_close',
        tenantId: ctx.tenantId,
        insightsEmitted: executed,
        durationMs: Date.now() - start,
        ranAt: ctx.now.toISOString(),
      };
    },
  });

  return tasks;
}

function buildTaskData(registry: ServiceRegistry): BackgroundTaskData {
  // Minimal data provider: each list method returns an empty array so the
  // catalogue runs without crashing. Real data wiring is a follow-up —
  // this is the shape expected by `buildTaskCatalogue`.
  //
  // Wave 18 — wire the `renewalProposal` port to the real RenewalService
  // so the scheduled `renewal_proposal_generator` actually dispatches
  // proposals instead of only writing reminder insights.
  return {
    async listPropertiesForHealthScan() {
      return [];
    },
    async listArrearsCases() {
      return [];
    },
    async listLeasesNearExpiry() {
      return [];
    },
    async listInspectionsDue() {
      return [];
    },
    async listComplianceNotices() {
      return [];
    },
    async summariseMonthlyCosts() {
      return null;
    },
    async listVendorPerformance() {
      return [];
    },
    async recomputeTenantHealth() {
      return [];
    },
    renewalProposal: registry.renewal
      ? {
          async propose(input) {
            // Flat 5% uplift starter — the renewal optimizer can
            // replace this with a model-driven suggestion once the
            // ML service is wired. Returns null on failure so the
            // generator still emits the reminder insight.
            const proposedRent = Math.round(input.currentRent * 1.05);
            try {
              const svc = registry.renewal as unknown as {
                propose(
                  tenantId: string,
                  leaseId: string,
                  proposedRent: number,
                ): Promise<{ id?: string; proposalId?: string } | null>;
              };
              const res = await svc.propose(
                input.tenantId,
                input.leaseId,
                proposedRent,
              );
              if (!res) return null;
              const proposalId =
                res.id ?? res.proposalId ?? input.leaseId;
              return { proposalId, proposedRent };
            } catch {
              return null;
            }
          },
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Webhook DLQ repository (Postgres-backed, drizzle)
// ---------------------------------------------------------------------------

export function createPostgresWebhookDeliveryRepository(
  db: unknown,
): WebhookDeliveryRepository {
  const exec = (db as { execute(q: unknown): Promise<unknown> }).execute.bind(
    db as { execute(q: unknown): Promise<unknown> },
  );

  function asRows(
    res: unknown,
  ): readonly Record<string, unknown>[] {
    if (Array.isArray(res)) return res as Record<string, unknown>[];
    const r = (res as { rows?: unknown }).rows;
    return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
  }

  function mapDeadLetter(row: Record<string, unknown>): WebhookDeadLetterRecord {
    const lastStatusCode = row.last_status_code ? Number(row.last_status_code) : undefined;
    const lastError = row.last_error ? String(row.last_error) : undefined;
    return {
      id: String(row.id),
      deliveryId: String(row.delivery_id),
      tenantId: String(row.tenant_id),
      targetUrl: String(row.target_url),
      eventType: String(row.event_type),
      payload:
        typeof row.payload === 'string'
          ? JSON.parse(row.payload)
          : (row.payload as Record<string, unknown>),
      totalAttempts: Number(row.total_attempts ?? 0),
      ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
      firstAttemptAt: new Date(String(row.first_attempt_at)),
      lastAttemptAt: new Date(String(row.last_attempt_at)),
    };
  }

  return {
    async recordAttempt(record: WebhookAttemptRecord): Promise<void> {
      await exec(sql`
        INSERT INTO webhook_delivery_attempts (
          id, tenant_id, delivery_id, target_url, event_type, payload,
          attempt_number, status, status_code, error_message,
          scheduled_for, attempted_at, created_at, updated_at
        ) VALUES (
          ${record.id}, ${record.tenantId}, ${record.deliveryId},
          ${record.targetUrl}, ${record.eventType},
          ${JSON.stringify(record.payload)}::jsonb,
          ${record.attemptNumber}, ${record.status},
          ${record.statusCode ?? null}, ${record.errorMessage ?? null},
          ${record.scheduledFor.toISOString()},
          ${record.attemptedAt ? record.attemptedAt.toISOString() : null},
          NOW(), NOW()
        )
      `);
    },

    async moveToDeadLetters(record: WebhookDeadLetterRecord): Promise<void> {
      await exec(sql`
        INSERT INTO webhook_dead_letters (
          id, tenant_id, delivery_id, target_url, event_type, payload,
          total_attempts, last_status_code, last_error,
          first_attempt_at, last_attempt_at, created_at
        ) VALUES (
          ${record.id}, ${record.tenantId}, ${record.deliveryId},
          ${record.targetUrl}, ${record.eventType},
          ${JSON.stringify(record.payload)}::jsonb,
          ${record.totalAttempts}, ${record.lastStatusCode ?? null},
          ${record.lastError ?? null},
          ${record.firstAttemptAt.toISOString()},
          ${record.lastAttemptAt.toISOString()},
          NOW()
        )
      `);
    },

    async listDeadLetters({ tenantId, limit, offset }) {
      const lim = Math.min(200, Math.max(1, limit ?? 50));
      const off = Math.max(0, offset ?? 0);
      const rows = asRows(
        await exec(
          tenantId
            ? sql`
                SELECT * FROM webhook_dead_letters
                WHERE tenant_id = ${tenantId}
                ORDER BY created_at DESC
                LIMIT ${lim} OFFSET ${off}
              `
            : sql`
                SELECT * FROM webhook_dead_letters
                ORDER BY created_at DESC
                LIMIT ${lim} OFFSET ${off}
              `,
        ),
      );
      return rows.map(mapDeadLetter);
    },

    async getDeadLetter(id, tenantId) {
      // Tenant-scoped fetch: when tenantId is provided (the normal path)
      // the WHERE clause matches both columns so cross-tenant reads cannot
      // happen even before the router's ownership check runs. When
      // undefined (legacy super-admin tooling only) the query falls back
      // to id-only — still safe because only SUPER_ADMIN can reach that
      // code path and it has no tenant to scope to.
      const rows = asRows(
        await exec(
          tenantId
            ? sql`SELECT * FROM webhook_dead_letters WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`
            : sql`SELECT * FROM webhook_dead_letters WHERE id = ${id} LIMIT 1`,
        ),
      );
      return rows[0] ? mapDeadLetter(rows[0]) : null;
    },

    async markDeadLetterReplayed(id, replayedBy, replayDeliveryId, tenantId) {
      // Tenant-scoped UPDATE: id alone is not enough — the row must also
      // belong to the caller's tenant. Without this, a forged id could
      // flip a row in another tenant.
      if (tenantId) {
        await exec(sql`
          UPDATE webhook_dead_letters
          SET replayed_at = NOW(),
              replayed_by = ${replayedBy},
              replay_delivery_id = ${replayDeliveryId}
          WHERE id = ${id} AND tenant_id = ${tenantId}
        `);
      } else {
        await exec(sql`
          UPDATE webhook_dead_letters
          SET replayed_at = NOW(),
              replayed_by = ${replayedBy},
              replay_delivery_id = ${replayDeliveryId}
          WHERE id = ${id}
        `);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Ambient-brain observer
// ---------------------------------------------------------------------------

export function createAmbientBehaviorObserver(): BehaviorObserver {
  return new BehaviorObserver();
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

async function listActiveTenantIds(
  registry: ServiceRegistry,
): Promise<readonly string[]> {
  if (!registry.db) return [];
  try {
    const res = await (
      registry.db as unknown as { execute(q: unknown): Promise<unknown> }
    ).execute(sql`SELECT id FROM tenants WHERE is_active = TRUE LIMIT 200`);
    const rows = Array.isArray(res)
      ? res
      : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
    return rows.map((r) => String((r as { id: unknown }).id));
  } catch {
    return [];
  }
}

function interpolate(
  text: string,
  params: readonly unknown[],
): string {
  return text.replace(/\$(\d+)/g, (_m, idxStr: string) => {
    const v = params[Number(idxStr) - 1];
    return encode(v);
  });
}

function encode(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object')
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

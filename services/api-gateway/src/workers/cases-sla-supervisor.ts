/**
 * Cases SLA Worker Supervisor
 *
 * `CaseSLAWorker` (in @borjie/domain-services/cases) is tenant-bound:
 * each instance scans overdue cases for a single tenant and either
 * auto-escalates them or emits a `CaseSLABreached` event once the
 * ceiling is hit. Production has many tenants, so we wrap the worker
 * in a multi-tenant supervisor that:
 *
 *   1. Lists active tenants on each tick (same query the heartbeat
 *      supervisor uses — keeps behaviour consistent and avoids yet
 *      another "which tenants are live" predicate).
 *   2. Constructs (and caches) a `CaseSLAWorker` per tenant, sharing
 *      the composition-root CaseService + CaseRepository + EventBus.
 *   3. Invokes `tick()` sequentially per tenant. Failures are logged
 *      and swallowed so one bad tenant cannot stall the rest.
 *
 * Lifecycle mirrors `outbox-worker.ts` and the background supervisor:
 * `start()` schedules a recurring tick, `stop()` clears the timer.
 * Safe to call both idempotently.
 *
 * Gating:
 *   - Skipped when DATABASE_URL is unset (degraded registry).
 *   - Skipped when NODE_ENV === 'test' or BORJIE_CASES_SLA_DISABLED=true.
 *   - Default cadence: 5 minutes (CASES_SLA_INTERVAL_MS override).
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { CaseSLAWorker } from '@borjie/domain-services/cases';
import type { ServiceRegistry } from '../composition/service-registry.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches SCAFFOLDED_COMPLETION §3

export interface CaseSLASupervisorHandle {
  start(): void;
  stop(): void;
  /** Exposed for tests: drive a single multi-tenant tick synchronously. */
  tickOnce(): Promise<void>;
}

export interface CaseSLASupervisorOptions {
  readonly intervalMs?: number;
  readonly enabled?: boolean;
}

export function createCaseSLASupervisor(
  registry: ServiceRegistry,
  logger: Logger,
  options: CaseSLASupervisorOptions = {},
): CaseSLASupervisorHandle {
  const envIntervalMs = Number(process.env.CASES_SLA_INTERVAL_MS);
  const intervalMs = Math.max(
    1_000,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0
        ? envIntervalMs
        : DEFAULT_INTERVAL_MS),
  );
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.BORJIE_CASES_SLA_DISABLED !== 'true');

  // Early-out in degraded mode — nothing to scan without a DB or the
  // cases service.
  if (!registry.isLive || !registry.cases?.service || !registry.cases?.repo) {
    logger.warn('cases-sla-supervisor: degraded registry — worker not started');
    return {
      start() {},
      stop() {},
      async tickOnce() {},
    };
  }
  if (!enabled) {
    logger.info('cases-sla-supervisor: disabled by env');
    return {
      start() {},
      stop() {},
      async tickOnce() {},
    };
  }

  const workersByTenant = new Map<string, CaseSLAWorker>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  function getWorker(tenantId: string): CaseSLAWorker {
    const cached = workersByTenant.get(tenantId);
    if (cached) return cached;
    // The worker is cheap to construct (pure references) so caching is
    // purely to avoid re-binding per tick. All three dependencies are
    // the shared composition-root singletons — NOT tenant-specific.
    const worker = new CaseSLAWorker({
      tenantId: tenantId as never,
      caseRepo: registry.cases!.repo as never,
      caseService: registry.cases!.service as never,
      eventBus: registry.eventBus,
      logger: {
        info: (msg, meta) => logger.info({ tenantId, ...(meta ?? {}) }, msg),
        error: (msg, meta) => logger.error({ tenantId, ...(meta ?? {}) }, msg),
      },
    });
    workersByTenant.set(tenantId, worker);
    return worker;
  }

  async function listActiveTenants(): Promise<readonly string[]> {
    if (!registry.db) return [];
    try {
      const res = await (
        registry.db as unknown as { execute(q: unknown): Promise<unknown> }
      ).execute(sql`SELECT id FROM tenants WHERE is_active = TRUE LIMIT 500`);
      const rows = Array.isArray(res)
        ? res
        : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
      return rows.map((r) => String((r as { id: unknown }).id));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'cases-sla-supervisor: failed to list active tenants',
      );
      return [];
    }
  }

  async function tick(): Promise<void> {
    if (running) return; // skip if previous tick still in flight
    running = true;
    const started = Date.now();
    let tenantsScanned = 0;
    let tenantsErrored = 0;
    try {
      const tenants = await listActiveTenants();
      for (const tenantId of tenants) {
        try {
          const worker = getWorker(tenantId);
          await worker.tick();
          tenantsScanned += 1;
        } catch (err) {
          tenantsErrored += 1;
          logger.error(
            {
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'cases-sla-supervisor: tenant tick failed',
          );
        }
      }
      logger.debug(
        {
          durationMs: Date.now() - started,
          tenantsScanned,
          tenantsErrored,
        },
        'cases-sla-supervisor: tick complete',
      );
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) {
        logger.warn('cases-sla-supervisor: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs }, 'cases-sla-supervisor started');
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      // Kick once immediately so overdue cases don't sit idle until the
      // first interval elapses.
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info('cases-sla-supervisor stopped');
      }
      // Stop all cached workers defensively — they don't own any
      // timers (the supervisor drives them), but the idempotent stop()
      // is cheap and keeps the invariant clean.
      for (const worker of workersByTenant.values()) {
        try {
          worker.stop();
        } catch {
          /* swallow — cached workers have no timer of their own */
        }
      }
      workersByTenant.clear();
    },
    async tickOnce() {
      await tick();
    },
  };
}

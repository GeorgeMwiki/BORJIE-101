/**
 * Proactive scheduler — composition root.
 *
 * Closes the "MD PROACTIVE loop never FIRES + never DELIVERS" gap from the
 * wiring audit. Before this file:
 *
 *   (a) `ProactiveOrchestrator` had NO live trigger — `ingestSignal` was
 *       called only on the forecast request-path; nothing drove it on a
 *       cadence.
 *   (b) `runTabSuggesterTick` was NEVER scheduled, and `tab_proposals_inbox`
 *       was never drained to the owner-web tray, so the suggester's rows
 *       sat in the table forever.
 *   (c) kernel `proactive_nudge` rows landed in `tab_event_log` with ZERO
 *       consumers — never surfaced to the UI.
 *
 * This supervisor mirrors `mwikila-autonomous-wiring`'s interval-supervisor
 * shape: `scheduleProactive(deps)` returns a handle with `.start()` /
 * `.stop()` so `index.ts` can arm/disarm it from the main supervisor. NO
 * `index.ts` edit is required here — the caller wires the returned handle.
 *
 * Two cadences ride one supervisor:
 *
 *   - SIGNAL cadence (default 5 min): pull fresh signals from the injected
 *     `signalSource` and feed each into `orchestrator.ingestSignal`. The
 *     orchestrator runs the autonomy gate itself (policy_threshold /
 *     low_confidence / safety_critical / shadow_mode) and swallows its own
 *     errors, so one bad signal never tears down the loop. When no
 *     orchestrator + source are wired the cadence logs once and idles
 *     (degraded-safe) — the forecast request-path still calls ingestSignal.
 *
 *   - DELIVERY cadence (default 1 h): per (tenant, owner) run
 *     `runTabSuggesterTick` (dedup/cooldown already enforced inside the
 *     suggester) THEN drain the OPEN `tab_proposals_inbox` rows into the
 *     `cockpit.tab.proposed` cockpit event the owner-web tray already
 *     consumes — stamping `last_surfaced_at` so the same row is delivered
 *     at most once per cadence (idempotent delivery). The same pass drains
 *     any kernel `proactive_nudge` rows from `tab_event_log` onto the bus
 *     (minimal consumer, item (c)).
 *
 * HARD RULES honoured:
 *   - Tenant-scoped: every query carries `tenant_id`; the GUC is bound
 *     per-tenant before any read/write so RLS FORCE holds for the
 *     out-of-band worker path (the request middleware does not run here).
 *   - Idempotent: the suggester dedups; the inbox drain stamps
 *     `last_surfaced_at` and only re-surfaces after a cooldown.
 *   - Pino only (no console.log). Per-tenant / per-signal failures are
 *     caught + logged; they never crash a tick.
 *   - Disabled in `NODE_ENV=test` and when
 *     `BORJIE_PROACTIVE_SCHEDULER_DISABLED=true` so the test suite is not
 *     polluted by background timers.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { ProactiveLoop } from '@borjie/ai-copilot';

import { runTabSuggesterTick } from '../../services/tab-suggester/index.js';
import {
  buildDrizzleSuggesterObservations,
  buildDrizzleSuggesterPersistence,
} from './suggester-adapters.js';
import {
  drainTabProposalsInbox,
  drainProactiveNudges,
} from './proactive-delivery.js';
import { publishCockpitEvent } from '../../services/cockpit-events/index.js';

const DEFAULT_SIGNAL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_DELIVERY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MIN_INTERVAL_MS = 30 * 1000; // 30s floor
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h ceiling

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * A source of fresh signals for the proactive orchestrator. The scheduler
 * is the LOOP; the source is pure data. Implementations scan whatever
 * AI-native capability feed they own (market-surveillance, sentiment,
 * predictive-interventions, forecasting) and return the signals detected
 * since the last poll. Returning `[]` is the normal idle case.
 *
 * Kept injectable so the scheduler stays decoupled from the (separately
 * wired) forecasting / surveillance stacks and is unit-testable with a
 * stub. The orchestrator itself maps each signal to a proposal + runs the
 * autonomy gate, so the source never needs policy knowledge.
 */
export interface ProactiveSignalSource {
  poll(input: {
    readonly tenantId: string;
    readonly sinceMs: number;
  }): Promise<ReadonlyArray<ProactiveLoop.Signal>>;
}

export interface ProactiveWiringDeps {
  /** Drizzle client. Null → inert stub so `.start()`/`.stop()` are no-ops. */
  readonly db: DbLike | null;
  readonly logger: Logger;
  /**
   * The live orchestrator. When omitted the signal cadence idles (the
   * forecast request-path still drives `ingestSignal` directly).
   */
  readonly orchestrator?: ProactiveLoop.ProactiveOrchestrator | null;
  /**
   * Signal source feeding the orchestrator. Omitted → signal cadence idles.
   */
  readonly signalSource?: ProactiveSignalSource | null;
  /** Override signal cadence (ms). Bounded [30s, 6h]. */
  readonly signalIntervalMs?: number;
  /** Override delivery cadence (ms). Bounded [30s, 6h]. */
  readonly deliveryIntervalMs?: number;
}

export interface ProactiveSupervisor {
  start(): void;
  stop(): void;
  /**
   * Run one DELIVERY pass immediately (suggester tick + inbox/nudge drain)
   * across all active tenants. Returns the number of proposals delivered.
   * Exposed for tests + manual triggers.
   */
  runDeliveryOnce(): Promise<number>;
  /**
   * Run one SIGNAL pass immediately (poll source → ingestSignal). Returns
   * the number of signals ingested. Exposed for tests + manual triggers.
   */
  runSignalOnce(): Promise<number>;
}

const INERT_SUPERVISOR: ProactiveSupervisor = Object.freeze({
  start() {},
  stop() {},
  async runDeliveryOnce() {
    return 0;
  },
  async runSignalOnce() {
    return 0;
  },
});

function clampInterval(value: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(value)));
}

function resolveSignalIntervalMs(override?: number): number {
  const envRaw = process.env.BORJIE_PROACTIVE_SIGNAL_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_SIGNAL_INTERVAL_MS;
  return clampInterval(candidate);
}

function resolveDeliveryIntervalMs(override?: number): number {
  const envRaw = process.env.BORJIE_PROACTIVE_DELIVERY_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_DELIVERY_INTERVAL_MS;
  return clampInterval(candidate);
}

/**
 * Bind the tenant GUC for an out-of-band worker write. The request
 * middleware (which normally sets `app.current_tenant_id`) does not run on
 * the scheduler path, so we bind BOTH GUC names because the two inboxes
 * this loop touches disagree on the canonical name:
 *   - `mwikila_actions_inbox` RLS reads `app.current_tenant_id`
 *   - `tab_proposals_inbox`   RLS reads `app.tenant_id`
 * Setting both keeps every tenant-scoped write inside RLS FORCE.
 */
async function bindTenantGuc(db: DbLike, tenantId: string): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.tenant_id', ${tenantId}, false), set_config('app.current_tenant_id', ${tenantId}, false)`,
  );
}

/**
 * Active-tenant lister with owner-user resolution — one row per active
 * tenant joined to its flagged owner. Tenants without an owner are dropped
 * (the suggester needs a `user_id` to scope the proposal). Returns `[]` on
 * any failure so a tick degrades gracefully instead of crashing.
 */
async function listActiveTenantsWithOwner(
  db: DbLike,
  logger: Logger,
): Promise<ReadonlyArray<{ readonly tenantId: string; readonly ownerUserId: string }>> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (t.id)
             t.id AS tenant_id,
             u.id AS owner_user_id
        FROM tenants t
        JOIN users   u
          ON u.tenant_id = t.id
         AND u.is_owner  = TRUE
         AND u.status    = 'active'
       WHERE t.status = 'active'
       ORDER BY t.id, u.created_at ASC
    `);
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<Record<string, unknown>>)
      : (((result as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
          []) as ReadonlyArray<Record<string, unknown>>);
    const out: Array<{ readonly tenantId: string; readonly ownerUserId: string }> = [];
    for (const r of rows) {
      const tenantId = typeof r.tenant_id === 'string' ? r.tenant_id : null;
      const ownerUserId =
        typeof r.owner_user_id === 'string' ? r.owner_user_id : null;
      if (tenantId && ownerUserId) {
        out.push(Object.freeze({ tenantId, ownerUserId }));
      }
    }
    return Object.freeze(out);
  } catch (err) {
    logger.warn(
      {
        worker: 'proactive-scheduler',
        err: err instanceof Error ? err.message : String(err),
      },
      'proactive: listActiveTenantsWithOwner failed; degrading to []',
    );
    return Object.freeze([]);
  }
}

/** Active tenant ids (no owner join) — for the signal cadence. */
async function listActiveTenantIds(
  db: DbLike,
  logger: Logger,
): Promise<ReadonlyArray<string>> {
  try {
    const res = await db.execute(
      sql`SELECT id FROM tenants WHERE status = 'active' LIMIT 500`,
    );
    const rows = Array.isArray(res)
      ? res
      : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
    return rows
      .map((r) => (r as { id: unknown }).id)
      .filter((id): id is string => typeof id === 'string');
  } catch (err) {
    logger.warn(
      {
        worker: 'proactive-scheduler',
        err: err instanceof Error ? err.message : String(err),
      },
      'proactive: listActiveTenantIds failed; degrading to []',
    );
    return [];
  }
}

/**
 * Wire the proactive scheduler. Returns an inert stub in degraded mode
 * (no DB) or under `NODE_ENV=test` / the disable env so callers can invoke
 * `.start()` / `.stop()` unconditionally.
 */
export function scheduleProactive(deps: ProactiveWiringDeps): ProactiveSupervisor {
  if (!deps.db) {
    deps.logger.info(
      { worker: 'proactive-scheduler' },
      'proactive: no DB — wiring inert stub',
    );
    return INERT_SUPERVISOR;
  }
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.BORJIE_PROACTIVE_SCHEDULER_DISABLED === 'true'
  ) {
    deps.logger.info(
      { worker: 'proactive-scheduler' },
      'proactive: disabled by env — wiring inert stub',
    );
    return INERT_SUPERVISOR;
  }

  const db = deps.db;
  const logger = deps.logger;
  const orchestrator = deps.orchestrator ?? null;
  const signalSource = deps.signalSource ?? null;
  const signalIntervalMs = resolveSignalIntervalMs(deps.signalIntervalMs);
  const deliveryIntervalMs = resolveDeliveryIntervalMs(deps.deliveryIntervalMs);

  const observations = buildDrizzleSuggesterObservations(db, logger);
  const persistence = buildDrizzleSuggesterPersistence(db, logger);

  // Track the last signal poll watermark per tenant so the source only
  // returns events detected since the previous tick.
  const lastSignalPollMs = new Map<string, number>();

  let signalHandle: NodeJS.Timeout | null = null;
  let deliveryHandle: NodeJS.Timeout | null = null;

  async function runSignalOnce(): Promise<number> {
    if (!orchestrator || !signalSource) {
      logger.debug(
        { worker: 'proactive-scheduler' },
        'proactive: signal cadence idle — no orchestrator/source wired',
      );
      return 0;
    }
    let ingested = 0;
    const tenants = await listActiveTenantIds(db, logger);
    for (const tenantId of tenants) {
      try {
        await bindTenantGuc(db, tenantId);
        const sinceMs = lastSignalPollMs.get(tenantId) ?? Date.now() - signalIntervalMs;
        const signals = await signalSource.poll({ tenantId, sinceMs });
        lastSignalPollMs.set(tenantId, Date.now());
        for (const signal of signals) {
          // The orchestrator runs the autonomy gate + records audit; it
          // never throws (errors land in its audit sink). We still wrap
          // per-signal so a thrown infra fault cannot abort the tenant loop.
          try {
            await orchestrator.ingestSignal(signal);
            ingested += 1;
          } catch (err) {
            logger.warn(
              {
                worker: 'proactive-scheduler',
                tenantId,
                signalId: signal.signalId,
                err: err instanceof Error ? err.message : String(err),
              },
              'proactive: ingestSignal failed for one signal',
            );
          }
        }
      } catch (err) {
        logger.warn(
          {
            worker: 'proactive-scheduler',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'proactive: signal tick failed for tenant',
        );
      }
    }
    if (ingested > 0) {
      logger.info(
        { worker: 'proactive-scheduler', ingested, tenants: tenants.length },
        'proactive: signal cadence ingested signals',
      );
    }
    return ingested;
  }

  async function runDeliveryOnce(): Promise<number> {
    let delivered = 0;
    const pairs = await listActiveTenantsWithOwner(db, logger);
    for (const { tenantId, ownerUserId } of pairs) {
      try {
        await bindTenantGuc(db, tenantId);

        // 1 — drive the suggester (its own dedup/cooldown applies).
        try {
          await runTabSuggesterTick({
            tenantId,
            userId: ownerUserId,
            now: new Date(),
            observations,
            persistence,
          });
        } catch (err) {
          logger.warn(
            {
              worker: 'proactive-scheduler',
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'proactive: tab-suggester tick failed',
          );
        }

        // 2 — drain OPEN proposals → cockpit.tab.proposed (idempotent via
        //     last_surfaced_at stamp inside the drain).
        const proposed = await drainTabProposalsInbox({
          db,
          tenantId,
          logger,
          publish: publishCockpitEvent,
        });
        delivered += proposed;

        // 3 — surface any kernel proactive_nudge rows (item (c)).
        await drainProactiveNudges({
          db,
          tenantId,
          logger,
          publish: publishCockpitEvent,
        });
      } catch (err) {
        logger.warn(
          {
            worker: 'proactive-scheduler',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'proactive: delivery tick failed for tenant',
        );
      }
    }
    if (delivered > 0) {
      logger.info(
        { worker: 'proactive-scheduler', delivered, tenants: pairs.length },
        'proactive: delivery cadence published tab proposals',
      );
    }
    return delivered;
  }

  return Object.freeze({
    start() {
      if (signalHandle || deliveryHandle) return;
      // Fire each cadence once on boot so operators see the loop is alive,
      // then arm the intervals. void — never block start().
      void runSignalOnce().catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'proactive: initial signal tick failed',
        );
      });
      void runDeliveryOnce().catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'proactive: initial delivery tick failed',
        );
      });
      signalHandle = setInterval(() => {
        void runSignalOnce().catch(() => {});
      }, signalIntervalMs);
      deliveryHandle = setInterval(() => {
        void runDeliveryOnce().catch(() => {});
      }, deliveryIntervalMs);
      if (typeof signalHandle.unref === 'function') signalHandle.unref();
      if (typeof deliveryHandle.unref === 'function') deliveryHandle.unref();
      logger.info(
        {
          worker: 'proactive-scheduler',
          signalIntervalMs,
          deliveryIntervalMs,
          orchestratorWired: orchestrator !== null,
          signalSourceWired: signalSource !== null,
        },
        'proactive: scheduler started',
      );
    },
    stop() {
      if (signalHandle) {
        clearInterval(signalHandle);
        signalHandle = null;
      }
      if (deliveryHandle) {
        clearInterval(deliveryHandle);
        deliveryHandle = null;
      }
      logger.info({ worker: 'proactive-scheduler' }, 'proactive: scheduler stopped');
    },
    runDeliveryOnce,
    runSignalOnce,
  });
}

// Test-only exports — the tenant-resolution + interval-bounds helpers are
// the riskiest pieces (the rest delegates to the suggester / drain modules
// tested separately).
export const __testing = {
  listActiveTenantsWithOwner,
  listActiveTenantIds,
  resolveSignalIntervalMs,
  resolveDeliveryIntervalMs,
  bindTenantGuc,
};

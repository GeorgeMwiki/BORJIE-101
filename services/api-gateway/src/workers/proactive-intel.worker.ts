/**
 * Proactive-intel worker — Wave 2b (W2b).
 *
 * Lights up the DARK proactive-insight loop: the @borjie/proactive-intel
 * detectors + recommendation composer were fully built but NOTHING on the
 * live path drove them, so Mr. Mwikila never proactively surfaced an insight.
 * This worker is that driver.
 *
 * Each tick, for every ACTIVE tenant, it:
 *
 *   1. Resolves the tenant's already-fetched `TickInputs` via an injected
 *      `inputsForTenant` provider (the detectors are PURE — they never do
 *      I/O, so the I/O lives in the provider, kept injectable to stay
 *      decoupled + unit-testable; mirrors `proactive-wiring.ts`'s injected
 *      `signalSource`).
 *   2. Builds a `TickContext` and runs `runTick` over the de-duplicated
 *      union of every cadence's detector kinds (the worker IS the outer
 *      scheduler the package's docs reference, so it folds all three
 *      cadence tiers into one cadence — the cadence interval itself is
 *      this worker's interval).
 *   3. `compose()`s each produced `DetectorEvent` into a `Recommendation`.
 *   4. Routes each recommendation into the EXISTING proactive delivery sink
 *      (`publish` → `mwikila.proposes` cockpit event, the same bus the
 *      owner-web cockpit already consumes via `/api/v1/cockpit/stream`),
 *      so the insight actually reaches the cockpit.
 *
 * HARD RULES honoured:
 *   - Tenant-scoped: the active-tenant list is a cross-tenant read; the
 *     injected `inputsForTenant` provider owns its own tenant-scoped data
 *     access (it receives `tenantId` explicitly) so RLS FORCE holds.
 *   - Pino only (no console.log). Per-tenant failures are caught + logged;
 *     one bad tenant never tears down the tick.
 *   - Honest-degrade: no DB → inert stub; no `inputsForTenant`/`entityStore`
 *     → warn ONCE on boot then idle (never crash boot).
 *   - Cluster-leader-gated at the `index.ts` call site (via
 *     `withClusterLeader`) so only the elected replica ticks.
 *   - Tunable interval (BORJIE_PROACTIVE_INTEL_INTERVAL_MS); the timer is
 *     `unref`'d so it never holds the process open.
 *   - `tickOnce()` exposed for tests + manual triggers.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  ALL_CADENCES,
  compose,
  runTick,
  type AnomalyKind,
  type CadenceSpec,
  type EntityStore,
  type OpportunityKind,
  type Recommendation,
  type TickContext,
  type TickInputs,
} from '@borjie/proactive-intel';

import type { CockpitEvent } from '../services/cockpit-events';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const WORKER_NAME = 'proactive-intel';
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min — the package's hot cadence
const MIN_INTERVAL_MS = 30 * 1000; // 30s floor
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h ceiling
const DEFAULT_TENANT_LIMIT = 500;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Provider that returns the already-fetched `TickInputs` for one tenant.
 *
 * The proactive-intel detectors are pure (no I/O), so all the data-fetching
 * lives HERE, behind an injectable seam. Returning empty/partial inputs is
 * the normal idle case — each detector self-skips when its slice is absent
 * (`if (!ctx.inputs.cashflow) return []`), so a thin provider degrades to a
 * no-detection tick rather than a crash.
 *
 * Kept injectable so this worker stays decoupled from the (separately wired)
 * forecasting / arrears / churn stacks and is unit-testable with a stub.
 */
export interface ProactiveIntelInputsProvider {
  inputsForTenant(input: {
    readonly tenantId: string;
    readonly nowMs: number;
  }): Promise<TickInputs>;
}

export interface ProactiveIntelWorkerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  /**
   * Resolves the live `TickInputs` per tenant. Omitted → the worker idles
   * (warns once on boot) because the detectors would have nothing to read.
   */
  readonly inputsForTenant?: ProactiveIntelInputsProvider | null;
  /**
   * The entity-store the tick-runner persists detected events to (the MD's
   * blackboard). Omitted → events are composed + delivered but not persisted
   * (warn once). A real store makes re-detection idempotent across ticks.
   */
  readonly entityStore?: EntityStore | null;
  /**
   * Cockpit delivery sink. Defaults to the in-process cockpit bus
   * (`publishCockpitEvent`) wired by `index.ts`; injectable so tests can
   * assert on what reaches the cockpit without standing up the bus.
   */
  readonly publish: (event: CockpitEvent) => number;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  /** Cap tenants scanned per tick (defence against a huge tenant table). */
  readonly tenantLimit?: number;
}

export interface ProactiveIntelWorkerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<ProactiveIntelTickResult>;
}

export interface ProactiveIntelTickResult {
  /** Active tenants scanned this tick. */
  readonly tenants: number;
  /** Detector events produced across all tenants. */
  readonly detected: number;
  /** Recommendations delivered onto the cockpit bus. */
  readonly delivered: number;
  /** Tenants whose tick threw (isolated — the loop continued). */
  readonly failed: number;
}

function clampInterval(value: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(value)));
}

function resolveIntervalMs(override?: number): number {
  const envRaw = process.env.BORJIE_PROACTIVE_INTEL_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return clampInterval(candidate);
}

function rowsOf(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

/**
 * The de-duplicated union of every cadence's anomaly + opportunity kinds.
 * The worker is the outer scheduler, so it runs ALL declared detectors each
 * tick; the registry's `if (!fn) continue;` cleanly skips kinds that are
 * declared in a cadence but not yet shipped. Derived from `ALL_CADENCES`
 * (NOT hardcoded) so adding a detector to a cadence flows through for free.
 */
const UNION_CADENCE: CadenceSpec = {
  // `tier` is only echoed back by `runTick` into its result; the worker
  // collapses all three real tiers into one pass, so we reuse 'hot' as a
  // valid `CadenceTier` label rather than inventing a new one.
  tier: 'hot',
  intervalMs: DEFAULT_INTERVAL_MS,
  anomalyKinds: [
    ...new Set<AnomalyKind>(ALL_CADENCES.flatMap((c) => c.anomalyKinds)),
  ],
  opportunityKinds: [
    ...new Set<OpportunityKind>(ALL_CADENCES.flatMap((c) => c.opportunityKinds)),
  ],
};

/**
 * No-op entity store — used when no real store is injected so `runTick`
 * still composes + returns events (delivery is unaffected; only the
 * cross-tick blackboard persistence is skipped).
 */
const NOOP_ENTITY_STORE: EntityStore = {
  async read() {
    return null;
  },
  async write(input) {
    const stampedAt = new Date(0).toISOString();
    return {
      ...input,
      version: 0,
      createdAt: stampedAt,
      updatedAt: stampedAt,
    };
  },
  async list() {
    return [];
  },
  async delete() {
    /* no-op */
  },
};

/**
 * Map a composed `Recommendation` onto the existing `mwikila.proposes`
 * cockpit event — the bus surface the owner-web cockpit already renders for
 * "Mr. Mwikila has drafted a proposal awaiting your approval". A null
 * tenantId (platform-internal scope) is dropped: the cockpit event is
 * tenant-scoped by contract.
 */
function recommendationToCockpitEvent(
  rec: Recommendation,
  nowIso: string,
): CockpitEvent | null {
  if (!rec.tenantId) return null;
  return {
    kind: 'mwikila.proposes',
    tenantId: rec.tenantId,
    emittedAt: nowIso,
    actionId: rec.id,
    actionKind: `proactive-intel.${rec.type}.${rec.kind}`,
    category: rec.type,
    // P0/P1 → T1 (owner sign-off expected fast); P2/P3 → T0 (FYI / queued).
    delegationTier: rec.severity === 'P0' || rec.severity === 'P1' ? 'T1' : 'T0',
    summary: rec.summary,
  };
}

/** Active tenant ids — cross-tenant read, mirrors proactive-wiring.ts. */
async function listActiveTenantIds(
  db: DbLike,
  logger: Logger,
  limit: number,
): Promise<readonly string[]> {
  try {
    const res = await db.execute(
      sql`SELECT id FROM tenants WHERE status = 'active' LIMIT ${limit}`,
    );
    return rowsOf(res)
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string');
  } catch (err) {
    logger.warn(
      { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
      'proactive-intel: listActiveTenantIds failed; degrading to []',
    );
    return [];
  }
}

export function createProactiveIntelWorker(
  options: ProactiveIntelWorkerOptions,
): ProactiveIntelWorkerHandle {
  const intervalMs = resolveIntervalMs(options.intervalMs);
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  const tenantLimit = Math.min(
    2000,
    Math.max(1, options.tenantLimit ?? DEFAULT_TENANT_LIMIT),
  );
  const inputsProvider = options.inputsForTenant ?? null;
  const entityStore = options.entityStore ?? NOOP_ENTITY_STORE;

  let timer: ReturnType<typeof setInterval> | null = null;
  let bootWarned = false;

  function warnBootOnce(): void {
    if (bootWarned) return;
    bootWarned = true;
    if (!inputsProvider) {
      options.logger.warn(
        { worker: WORKER_NAME },
        'proactive-intel: no inputs provider wired — detectors will idle until one is injected',
      );
    }
    if (!options.entityStore) {
      options.logger.warn(
        { worker: WORKER_NAME },
        'proactive-intel: no entity store wired — events composed + delivered but not persisted across ticks',
      );
    }
  }

  /**
   * Run the full detector pipeline for one tenant and deliver every
   * resulting recommendation. Returns the per-tenant counts. NEVER throws —
   * the caller increments `failed` on a rejected promise, but every internal
   * fault is already contained here.
   */
  async function runForTenant(
    tenantId: string,
    nowMs: number,
    nowIso: string,
  ): Promise<{ detected: number; delivered: number }> {
    let inputs: TickInputs;
    try {
      inputs = inputsProvider
        ? await inputsProvider.inputsForTenant({ tenantId, nowMs })
        : {};
    } catch (err) {
      options.logger.warn(
        {
          worker: WORKER_NAME,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive-intel: inputsForTenant failed; treating tenant as no-signal',
      );
      inputs = {};
    }

    const ctx: TickContext = {
      scope: 'tenant',
      tenantId,
      nowMs,
      inputs,
    };

    let events;
    try {
      const result = await runTick(ctx, UNION_CADENCE, entityStore);
      events = [...result.anomalies, ...result.opportunities];
    } catch (err) {
      options.logger.warn(
        {
          worker: WORKER_NAME,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive-intel: runTick failed for tenant',
      );
      return { detected: 0, delivered: 0 };
    }

    let delivered = 0;
    for (const event of events) {
      // compose is a pure, idempotent DetectorEvent → Recommendation map.
      const rec = compose(event);
      const cockpitEvent = recommendationToCockpitEvent(rec, nowIso);
      if (!cockpitEvent) continue;
      try {
        options.publish(cockpitEvent);
        delivered += 1;
      } catch (err) {
        options.logger.warn(
          {
            worker: WORKER_NAME,
            tenantId,
            recommendationId: rec.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'proactive-intel: failed to deliver recommendation to cockpit',
        );
      }
    }
    return { detected: events.length, delivered };
  }

  async function tickOnce(): Promise<ProactiveIntelTickResult> {
    warnBootOnce();
    if (!enabled) {
      return { tenants: 0, detected: 0, delivered: 0, failed: 0 };
    }
    try {
      const tNow = now();
      const nowMs = tNow.getTime();
      const nowIso = tNow.toISOString();
      const tenants = await listActiveTenantIds(options.db, options.logger, tenantLimit);
      let detected = 0;
      let delivered = 0;
      let failed = 0;
      for (const tenantId of tenants) {
        try {
          const r = await runForTenant(tenantId, nowMs, nowIso);
          detected += r.detected;
          delivered += r.delivered;
        } catch (err) {
          // Defence-in-depth: runForTenant already contains its faults, but a
          // truly unexpected throw must not abort the remaining tenants.
          failed += 1;
          options.logger.warn(
            {
              worker: WORKER_NAME,
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'proactive-intel: tenant tick threw (isolated)',
          );
        }
      }
      if (delivered > 0 || failed > 0) {
        options.logger.info(
          { worker: WORKER_NAME, tenants: tenants.length, detected, delivered, failed },
          'proactive-intel: tick done',
        );
      }
      workerHeartbeat(WORKER_NAME);
      return { tenants: tenants.length, detected, delivered, failed };
    } catch (err) {
      workerHeartbeatFailure(WORKER_NAME, err);
      throw err;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info({ worker: WORKER_NAME }, 'proactive-intel: disabled by config');
      return;
    }
    if (timer) return;
    registerWorker({ name: WORKER_NAME, intervalMs });
    // Fire one tick on boot so the loop is visibly alive, then arm the
    // interval. void — never block start().
    void tickOnce().catch((err) => {
      options.logger.warn(
        { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
        'proactive-intel: initial tick failed',
      );
    });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
          'proactive-intel: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info(
      { worker: WORKER_NAME, intervalMs },
      'proactive-intel: started',
    );
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}

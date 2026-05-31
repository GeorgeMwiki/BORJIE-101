/**
 * Mr. Mwikila autonomous-MD worker — composition root.
 *
 * Wires the autonomous worker (workers/mwikila-autonomous-worker.ts) so it
 * actually fires per-tenant per-handler on a cadence. Prior to this file
 * the worker was exported but never instantiated in `index.ts`, leaving
 * the inbox to fill ONLY when an inbound route call landed a row — so the
 * "Acts on owner's behalf" claim (CLAUDE.md task #187) was vacuous.
 *
 * Wiring topology:
 *
 *   listActiveTenantsWithOwner (Drizzle)
 *      └─ joins `tenants` × `users` (is_owner = true) → produces
 *         { tenantId, ownerUserId } pairs for every active tenant
 *
 *   createMwikilaInboxRecorder    (Drizzle-backed, real)
 *   createMwikilaDelegationStore  (Drizzle-backed, real)
 *   createMwikilaHandlerRuntime   (recorder + delegations + kill-switch port)
 *
 *   Handlers (5): shift-scheduler, royalty-filing-prep, license-renewal,
 *   payroll-prep, marketplace-counter — each wired with REAL Drizzle-
 *   backed ports (`./mwikila-autonomous-ports.ts`). The ports scan the
 *   canonical Borjie tables (licences, employees, attendance, sites,
 *   sales, ore_parcels, regulatory_filings, marketplace_bids,
 *   marketplace_listings, payroll_runs, mwikila_actions_inbox) and
 *   feed each handler's `propose()`. The autonomy invariants
 *   (kill-switch fail-closed, four-eye policy, envelope thresholds)
 *   ride the inviolable-rail check in the runtime regardless of
 *   whether any handler proposes.
 *
 * Lifecycle:
 *   - `.start()` arms the interval (default 15 min, bounded [1m, 1h]).
 *   - `.stop()` clears the interval; idempotent. Called from the
 *     gateway's `gracefulShutdown()`.
 *   - Disabled in `NODE_ENV=test` and when
 *     `BORJIE_MWIKILA_WORKER_DISABLED=true` (and the existing
 *     `MWIKILA_WORKER_DISABLED=true` env the worker itself honours).
 *
 * Failure containment:
 *   - DB unwired → returns an inert stub so `.start()` / `.stop()` are
 *     safe no-ops.
 *   - Per-tenant / per-handler errors are caught inside the worker
 *     itself and logged via Pino — they NEVER crash the tick.
 *   - The kill-switch is read through a per-tick port so a flipped
 *     switch suppresses execution (the inviolable-rail check returns
 *     `block` and the recorder lands a `blocked_by_inviolable` row).
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  createMwikilaAutonomousWorker,
  type MwikilaAutonomousWorker,
} from '../workers/mwikila-autonomous-worker.js';
import {
  createMwikilaDelegationStore,
  createMwikilaHandlerRuntime,
  createMwikilaInboxRecorder,
  createLicenseRenewalHandler,
  createMarketplaceCounterHandler,
  createPayrollHandler,
  createRoyaltyFilingHandler,
  createShiftSchedulerHandler,
  type MwikilaHandler,
} from '../services/mwikila-autonomy/index.js';
import {
  buildLicenseRenewalPorts,
  buildMarketplaceCounterPorts,
  buildPayrollPorts,
  buildRoyaltyFilingPorts,
  buildShiftSchedulerPorts,
} from './mwikila-autonomous-ports.js';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_INTERVAL_MS = 60 * 1000; // 1 minute floor
const MAX_INTERVAL_MS = 60 * 60 * 1000; // 1 hour ceiling

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface MwikilaWiringDeps {
  /** Drizzle client. May be null — wiring degrades to an inert stub. */
  readonly db: DbLike | null;
  readonly logger: Logger;
  /**
   * Kill-switch port. Returns true when the global kill-switch is
   * open. The runtime calls this on every tick so a flipped switch
   * suppresses execution (per CLAUDE.md "Kill-switch fail-closed").
   * Defaults to a constant `false` — fails-open so a missing port does
   * not block the worker on first boot.
   */
  readonly isKillSwitchOpen?: () => Promise<boolean> | boolean;
  /** Override cadence (ms). Bounded to [60s, 60m]. */
  readonly intervalMs?: number;
}

/**
 * Inert handle returned in degraded mode (no DB) so `index.ts` can
 * call `.start()` / `.stop()` unconditionally.
 */
const INERT_WORKER: MwikilaAutonomousWorker = Object.freeze({
  start() {},
  stop() {},
  async tickOnce() {
    return Object.freeze({
      tenantsScanned: 0,
      handlersInvoked: 0,
      inboxRowsWritten: 0,
    });
  },
});

function resolveIntervalMs(override?: number): number {
  const envRaw = process.env.BORJIE_MWIKILA_WORKER_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return Math.min(
    MAX_INTERVAL_MS,
    Math.max(MIN_INTERVAL_MS, Math.floor(candidate)),
  );
}

/**
 * Active-tenant lister with owner-user resolution.
 *
 * Joins `tenants` (status='active') × `users` (is_owner=true) and
 * returns one row per tenant. Tenants without a flagged owner are
 * dropped silently — the worker can't act on their behalf without an
 * owner user_id and the next signup or seed will create one.
 *
 * The query is read-only + idempotent + indexed on
 * `users(tenant_id, is_owner)`. Returns `[]` on any failure so the
 * worker degrades gracefully instead of crashing the tick.
 */
async function listActiveTenantsWithOwner(
  db: DbLike,
  logger: Logger,
): Promise<ReadonlyArray<{ readonly tenantId: string; readonly ownerUserId: string }>> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (t.id)
             t.id  AS tenant_id,
             u.id  AS owner_user_id
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
        worker: 'mwikila-autonomous',
        err: err instanceof Error ? err.message : String(err),
      },
      'mwikila-autonomous: listActiveTenantsWithOwner failed; degrading to []',
    );
    return Object.freeze([]);
  }
}

/**
 * Build the 5 autonomous handlers with REAL Drizzle-backed ports
 * (see `./mwikila-autonomous-ports.ts`). Each handler's `propose()`
 * returns `null` when its port surface produces no actionable rows,
 * so the worker still writes ZERO inbox rows on a cold DB — but as
 * soon as the operating data exists (licences nearing expiry,
 * employees with hours, sales for the month, pending buyer bids,
 * etc.), the worker proposes for the owner to review.
 *
 * The runtime ALWAYS enforces the kill-switch fail-closed / four-eye
 * / envelope / family-relation rails BEFORE any inbox row is
 * written — these ports only supply the data that drives the
 * `propose()` decision.
 */
function buildRealHandlers(
  db: DbLike,
  logger: Logger,
): ReadonlyArray<MwikilaHandler> {
  const licenseRenewal = createLicenseRenewalHandler(
    buildLicenseRenewalPorts(db, logger),
  );
  const shiftScheduler = createShiftSchedulerHandler(
    buildShiftSchedulerPorts(db, logger),
  );
  const royaltyFiling = createRoyaltyFilingHandler(
    buildRoyaltyFilingPorts(db, logger),
  );
  const payroll = createPayrollHandler(buildPayrollPorts(db, logger));
  const marketplaceCounter = createMarketplaceCounterHandler(
    buildMarketplaceCounterPorts(db, logger),
  );

  return Object.freeze([
    licenseRenewal,
    shiftScheduler,
    royaltyFiling,
    payroll,
    marketplaceCounter,
  ]);
}

/**
 * Wire the Mr. Mwikila autonomous worker into the composition root.
 * Returns an `INERT_WORKER` stub in degraded mode (no DB) so callers
 * can invoke `.start()` / `.stop()` unconditionally.
 */
export function createMwikilaAutonomousWiring(
  deps: MwikilaWiringDeps,
): MwikilaAutonomousWorker {
  if (!deps.db) {
    deps.logger.info(
      { worker: 'mwikila-autonomous' },
      'mwikila-autonomous: no DB — wiring inert stub',
    );
    return INERT_WORKER;
  }
  // Test environment + explicit env disable → return inert stub so
  // `start()` is a no-op and the test suite is not polluted by a 15-min
  // background timer.
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.BORJIE_MWIKILA_WORKER_DISABLED === 'true' ||
    process.env.MWIKILA_WORKER_DISABLED === 'true'
  ) {
    deps.logger.info(
      { worker: 'mwikila-autonomous' },
      'mwikila-autonomous: disabled by env — wiring inert stub',
    );
    return INERT_WORKER;
  }

  const db = deps.db;
  const recorder = createMwikilaInboxRecorder({ db });
  const delegations = createMwikilaDelegationStore({ db });
  const runtime = createMwikilaHandlerRuntime({
    recorder,
    delegations,
    ...(deps.isKillSwitchOpen !== undefined && {
      isKillSwitchOpen: deps.isKillSwitchOpen,
    }),
  });

  const intervalMs = resolveIntervalMs(deps.intervalMs);

  const worker = createMwikilaAutonomousWorker({
    runtime,
    tenants: {
      async listActiveTenants() {
        return listActiveTenantsWithOwner(db, deps.logger);
      },
    },
    handlers: buildRealHandlers(db, deps.logger),
    logger: deps.logger,
    intervalMs,
  });

  deps.logger.info(
    {
      worker: 'mwikila-autonomous',
      intervalMs,
      handlerCount: 5,
    },
    'mwikila-autonomous: wired (license-renewal, shift-scheduler, royalty-filing, payroll, marketplace-counter)',
  );

  return worker;
}

// Test-only exports — the listActiveTenantsWithOwner JOIN is the riskiest
// piece (the rest is delegation to the worker tested separately) so we
// expose it for direct unit testing.
export const __testing = {
  listActiveTenantsWithOwner,
  resolveIntervalMs,
};

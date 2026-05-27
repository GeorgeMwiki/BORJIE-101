/**
 * Owner brief snapshot cron — Wave OWNER-HOME.
 *
 * Pre-computes today's `owner_brief_snapshots` row for every tenant
 * that has at least one active owner (logged in within the last 30
 * days). Scheduled at 06:00 EAT (UTC+3) → 03:00 UTC.
 *
 * Companion to:
 *   - services/api-gateway/src/routes/owner/brief.hono.ts (on-demand fallback)
 *   - packages/database/src/migrations/0079_owner_brief_snapshots.sql
 *   - Docs/research/owner-status-sota.md
 *
 * Architecture
 * ---------------------------------------------------------------------
 *   - All side effects (tenant discovery, brief composition, snapshot
 *     upsert) are behind ports. The orchestrator (`runOwnerBriefCron`)
 *     is pure — tests inject fakes for both the tenant lister and the
 *     composer/persister.
 *   - Idempotent on (tenant_id, snapshot_date): the underlying SQL is
 *     INSERT … ON CONFLICT DO UPDATE, so re-running the cron at any
 *     point on the same day overwrites the prior row rather than
 *     duplicating it (snapshot_date UNIQUE).
 *   - Dormant tenants are skipped. A tenant is "active" if at least one
 *     user with mining_role='owner' (or is_owner=true) has a
 *     last_login_at within the last 30 days. The SQL lives in
 *     `defaultActiveTenantsLister()`. The threshold lifts the cron's
 *     cost in line with the active-cohort, not the whole tenant table.
 *
 * Operational contract
 * ---------------------------------------------------------------------
 *   - `runOwnerBriefCron(deps, options?)` → `OwnerBriefCronResult`
 *     - `{ scanned, upserted, failed, dormantSkipped }`
 *     - never throws; per-tenant errors are caught + logged so a
 *       single bad tenant cannot poison the whole batch.
 *
 *   - The cron registration intent is documented for the
 *     consolidation-worker's task registry; orchestration glue is added
 *     when the corresponding registry surface lands (the worker today
 *     boots a single supervisor in `index.ts`, so this module exports
 *     `runOwnerBriefCron` for the supervisor to call on the EAT 06:00
 *     schedule).
 */

import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface ActiveOwnerTenant {
  /** UUID of the tenant. */
  readonly tenantId: string;
  /** Most recent owner login timestamp (ISO). */
  readonly lastOwnerLoginIso: string;
}

export interface OwnerBriefCronResult {
  readonly scanned: number;
  readonly upserted: number;
  readonly failed: number;
  /** Tenants without an active owner in the last 30 days. */
  readonly dormantSkipped: number;
  readonly errors: ReadonlyArray<{
    readonly tenantId: string;
    readonly reason: string;
  }>;
}

export interface OwnerBriefSnapshotWritten {
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly id: string;
  readonly hashChainId: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Ports (adapter-free orchestration)
// ─────────────────────────────────────────────────────────────────────

export interface ActiveTenantLister {
  /**
   * Return tenants whose at-least-one-owner-user has logged in within
   * the last `dormancyWindowDays` days. The orchestrator iterates this
   * list and composes a snapshot for each.
   */
  list(args: {
    readonly now: Date;
    readonly dormancyWindowDays: number;
  }): Promise<ReadonlyArray<ActiveOwnerTenant>>;
}

export interface SnapshotComposer {
  /**
   * Compose today's seven-slot brief for one tenant and persist it
   * idempotently to `owner_brief_snapshots`. Source is fixed to
   * 'cron' by this adapter to mark provenance.
   */
  composeAndPersist(args: {
    readonly tenantId: string;
    readonly now: Date;
  }): Promise<OwnerBriefSnapshotWritten>;
}

export interface CronLogger {
  info(meta: Readonly<Record<string, unknown>>, msg?: string): void;
  warn(meta: Readonly<Record<string, unknown>>, msg?: string): void;
  error(meta: Readonly<Record<string, unknown>>, msg?: string): void;
}

export interface OwnerBriefCronDeps {
  readonly lister: ActiveTenantLister;
  readonly composer: SnapshotComposer;
  readonly logger?: CronLogger;
}

export interface OwnerBriefCronOptions {
  /** Defaults to new Date() at call time. */
  readonly now?: Date;
  /** Defaults to 30 days. Tenants whose latest owner login is older are skipped. */
  readonly dormancyWindowDays?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator — pure, dependency-injected.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_DORMANCY_WINDOW_DAYS = 30;

/**
 * EAT (Africa/Dar_es_Salaam) is UTC+3 with no DST. The cron is intended
 * to run at 06:00 EAT every day, i.e. 03:00 UTC. This is informational
 * — the actual schedule is the responsibility of the worker supervisor
 * or the platform scheduler that calls `runOwnerBriefCron()`.
 */
export const OWNER_BRIEF_CRON_SCHEDULE_UTC = '0 3 * * *';

/** Internal Crockford-style: pure JS, no side-effects we don't own. */
export async function runOwnerBriefCron(
  deps: OwnerBriefCronDeps,
  options: OwnerBriefCronOptions = {},
): Promise<OwnerBriefCronResult> {
  const log = deps.logger ?? toCronLogger();
  const now = options.now ?? new Date();
  const dormancyWindowDays =
    options.dormancyWindowDays ?? DEFAULT_DORMANCY_WINDOW_DAYS;

  log.info(
    { evt: 'owner_brief_cron.start', dormancyWindowDays },
    'owner-brief-cron: starting batch',
  );

  let activeTenants: ReadonlyArray<ActiveOwnerTenant>;
  try {
    activeTenants = await deps.lister.list({ now, dormancyWindowDays });
  } catch (err) {
    log.error(
      { evt: 'owner_brief_cron.lister_failed', reason: messageOf(err) },
      'owner-brief-cron: tenant lister failed — batch aborted',
    );
    return Object.freeze({
      scanned: 0,
      upserted: 0,
      failed: 0,
      dormantSkipped: 0,
      errors: Object.freeze([
        Object.freeze({ tenantId: '(none)', reason: messageOf(err) }),
      ]),
    });
  }

  let upserted = 0;
  let failed = 0;
  const errors: Array<{ tenantId: string; reason: string }> = [];

  for (const tenant of activeTenants) {
    try {
      await deps.composer.composeAndPersist({
        tenantId: tenant.tenantId,
        now,
      });
      upserted += 1;
    } catch (err) {
      failed += 1;
      const reason = messageOf(err);
      errors.push({ tenantId: tenant.tenantId, reason });
      log.warn(
        {
          evt: 'owner_brief_cron.tenant_failed',
          tenantId: tenant.tenantId,
          reason,
        },
        'owner-brief-cron: composition failed for tenant',
      );
    }
  }

  const result: OwnerBriefCronResult = Object.freeze({
    scanned: activeTenants.length,
    upserted,
    failed,
    // The lister already filters out dormant tenants; we surface the
    // implicit drop here for observability. The orchestrator does not
    // see dormant tenants directly, so we cannot count them in this
    // pass. The lister returns an exact active set.
    dormantSkipped: 0,
    errors: Object.freeze(errors),
  });

  log.info(
    {
      evt: 'owner_brief_cron.done',
      scanned: result.scanned,
      upserted: result.upserted,
      failed: result.failed,
    },
    'owner-brief-cron: batch complete',
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Default Drizzle-backed adapters — wired by the supervisor.
// ─────────────────────────────────────────────────────────────────────

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

/**
 * SQL-backed active-tenant lister. A tenant is "active" if it has at
 * least one user with mining_role='owner' OR is_owner=true who has
 * logged in within the last `dormancyWindowDays`.
 */
export function createSqlActiveTenantLister(
  db: DrizzleLikeClient,
): ActiveTenantLister {
  return {
    async list({ now, dormancyWindowDays }) {
      const cutoff = new Date(
        now.getTime() - dormancyWindowDays * 86_400_000,
      ).toISOString();
      // Borrow drizzle-orm's `sql` template via dynamic import so this
      // module compiles in the worker without pulling drizzle-orm into
      // the runtime path of the orchestrator (the worker has it as a
      // dep already, but we want the orchestrator to be testable
      // standalone).
      const drizzle = await import('drizzle-orm');
      const sqlFn = (drizzle as { sql: (...a: unknown[]) => unknown }).sql;
      const query = (sqlFn as any)`
        SELECT u.tenant_id::text AS tenant_id,
               MAX(u.last_login_at)::text AS last_owner_login_iso
          FROM users u
         WHERE u.deleted_at IS NULL
           AND (u.mining_role = 'owner' OR u.is_owner = TRUE)
           AND u.last_login_at IS NOT NULL
           AND u.last_login_at >= ${cutoff}::timestamptz
         GROUP BY u.tenant_id
      `;
      const result = await db.execute(query);
      const rows = rowsOf(result) as ReadonlyArray<{
        tenant_id?: unknown;
        last_owner_login_iso?: unknown;
      }>;
      const out: ActiveOwnerTenant[] = [];
      for (const r of rows) {
        const tenantId = asString(r.tenant_id);
        if (!tenantId) continue;
        out.push({
          tenantId,
          lastOwnerLoginIso:
            asString(r.last_owner_login_iso) ?? new Date().toISOString(),
        });
      }
      return out;
    },
  };
}

/**
 * Default composer adapter — calls into the api-gateway's brief
 * composition functions via a sibling-service dynamic import. Identical
 * to the pattern in `services/consolidation-worker/src/index.ts` for
 * the brain critic dynamic import. When the api-gateway build is not
 * present (fresh checkout, isolated unit test), the composer returns
 * a typed "unavailable" error and the orchestrator records a per-tenant
 * failure for that row.
 */
export function createDefaultSnapshotComposer(
  db: DrizzleLikeClient,
): SnapshotComposer {
  return {
    async composeAndPersist({ tenantId, now }) {
      const mod = (await import(
        // @ts-expect-error — sibling-service import resolved by pnpm symlink
        '../../../api-gateway/dist/routes/owner/brief.hono.js'
      )) as {
        composeOwnerBrief?: (db: unknown, tenantId: string) => Promise<unknown>;
        persistSnapshot?: (
          db: unknown,
          args: Readonly<{
            tenantId: string;
            brief: unknown;
            source: 'cron' | 'on-demand';
            now?: Date;
          }>,
        ) => Promise<{ id: string; hashChainId: string | null }>;
      };
      if (
        typeof mod.composeOwnerBrief !== 'function' ||
        typeof mod.persistSnapshot !== 'function'
      ) {
        throw new Error(
          'owner-brief composer unavailable — api-gateway dist not built',
        );
      }
      const brief = await mod.composeOwnerBrief(db, tenantId);
      const written = await mod.persistSnapshot(db, {
        tenantId,
        brief,
        source: 'cron',
        now,
      });
      return {
        tenantId,
        snapshotDate: now.toISOString().slice(0, 10),
        id: written.id,
        hashChainId: written.hashChainId,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Worker supervisor entry — designed to be called by the
// consolidation-worker's main supervisor on the 06:00 EAT schedule.
// Exported so the task is invocable from a CLI/cron orchestrator
// without re-wiring the worker's main loop.
// ─────────────────────────────────────────────────────────────────────

export interface SupervisorBootArgs {
  readonly db: DrizzleLikeClient;
  readonly now?: Date;
  readonly dormancyWindowDays?: number;
}

export async function runOwnerBriefCronWithDefaultAdapters(
  args: SupervisorBootArgs,
): Promise<OwnerBriefCronResult> {
  const lister = createSqlActiveTenantLister(args.db);
  const composer = createDefaultSnapshotComposer(args.db);
  return runOwnerBriefCron(
    { lister, composer, logger: toCronLogger() },
    {
      ...(args.now !== undefined ? { now: args.now } : {}),
      ...(args.dormancyWindowDays !== undefined
        ? { dormancyWindowDays: args.dormancyWindowDays }
        : {}),
    },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toCronLogger(): CronLogger {
  return {
    info: (meta, msg) => logger.info(msg ?? 'owner-brief-cron.info', meta),
    warn: (meta, msg) => logger.warn(msg ?? 'owner-brief-cron.warn', meta),
    error: (meta, msg) =>
      logger.error(msg ?? 'owner-brief-cron.error', meta),
  };
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: unknown }).rows;
  return Array.isArray(wrapped)
    ? (wrapped as ReadonlyArray<Record<string, unknown>>)
    : [];
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

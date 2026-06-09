/**
 * Knowledge-Graph Sync Worker — Wave 2 (W2d) self-ingesting GraphRAG spine.
 *
 * THE GAP IT CLOSES
 * ─────────────────
 * `kg_nodes` / `kg_edges` (migration 0298) were populated ONLY by a manual
 * `POST /api/v1/mining/knowledge-graph/ingest`. Without a cadence, a tenant's
 * graph is whatever it was the last time someone hit that button — every new
 * licence, royalty return, production record, task, listing or off-take lands
 * INVISIBLE to GraphRAG until a human re-triggers ingest. This worker makes the
 * graph self-maintaining: on a cadence it walks every active tenant and runs
 * the registry-driven `ingestKnowledgeGraph` pass for each, inside that
 * tenant's RLS context.
 *
 * GENERATIVE BY CONSTRUCTION
 * ──────────────────────────
 * The worker ingests whatever the declarative `INGEST_SOURCE` registry in
 * `composition/knowledge-graph/ingest.ts` declares — it has ZERO per-domain
 * knowledge. Adding a domain to the graph is one registry entry; this worker
 * picks it up automatically.
 *
 * LIFECYCLE (mirrors reminders-dispatch.worker.ts)
 * ────────────────────────────────────────────────
 *   - `start()`   arms a `setInterval` (default 6h; env-tunable) and `unref()`s
 *                 it so it never holds the process open. `registerWorker` +
 *                 `workerHeartbeat` feed /health/deep. No-op when disabled.
 *   - `tickOnce()` runs ONE full pass (exposed for tests + a manual kick).
 *   - `stop()`    clears the timer (SIGTERM-safe, idempotent).
 *
 * CLUSTER SAFETY
 * ──────────────
 * The composition root wraps the returned handle with `withClusterLeader(...)`
 * so, when leader-election is on, only the elected replica ticks (one ingest
 * pass per cluster). Re-running is harmless regardless: ingestion is idempotent
 * (deterministic node slugs + ON CONFLICT upserts), so a duplicate tick simply
 * converges.
 *
 * TENANT SCOPE
 * ────────────
 * Each tenant's pass runs inside `withWorkerTenantContext` (a real pinned
 * transaction binding `app.current_tenant_id`) so both the source reads and the
 * kg writes are RLS-filtered to that tenant — the worker bypasses the HTTP
 * `databaseMiddleware`, so it must bind the GUC itself.
 *
 * FAILURE CONTAINMENT
 * ───────────────────
 *   - No DB → no-op + warn once on boot (honest-degrade, never crash).
 *   - Per-tenant failures isolated; the loop continues to the next tenant.
 *   - All errors via Pino — no console statements in services.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  ingestKnowledgeGraph,
  type KgIngestResult,
} from '../composition/knowledge-graph/ingest';
import {
  withWorkerTenantContext,
  type TenantContextDbLike,
} from './with-tenant-context';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const WORKER_NAME = 'kg-sync';
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — graph freshness budget.
const MIN_INTERVAL_MS = 60 * 1000; // 1m floor — guard against typos.
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h ceiling.
const DEFAULT_TENANT_LIMIT = 500; // bound a single pass.

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface KgSyncWorkerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  /** Max tenants ingested per pass (defaults to 500). */
  readonly tenantLimit?: number;
  /** Test seam: override active-tenant discovery. */
  readonly listActiveTenants?: () => Promise<ReadonlyArray<string>>;
  /**
   * Test seam: override the per-tenant ingest call. Defaults to running
   * `ingestKnowledgeGraph` inside `withWorkerTenantContext`. Lets unit tests
   * drive the loop without a real transaction.
   */
  readonly ingestForTenant?: (tenantId: string) => Promise<KgIngestResult>;
}

export interface KgSyncTickResult {
  readonly tenantsScanned: number;
  readonly tenantsIngested: number;
  readonly tenantsFailed: number;
  readonly nodes: number;
  readonly edges: number;
}

export interface KgSyncWorkerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<KgSyncTickResult>;
}

function resolveIntervalMs(override?: number): number {
  const envRaw = process.env.BORJIE_KG_SYNC_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(candidate)));
}

function rowsOf(raw: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const r = (raw as { rows?: unknown } | null)?.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

export function createKgSyncWorker(
  options: KgSyncWorkerOptions,
): KgSyncWorkerHandle {
  const intervalMs = resolveIntervalMs(options.intervalMs);
  const enabled = options.enabled !== false;
  const tenantLimit = Math.max(1, options.tenantLimit ?? DEFAULT_TENANT_LIMIT);
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight = false;
  let bootWarned = false;

  async function listActiveTenants(): Promise<ReadonlyArray<string>> {
    if (options.listActiveTenants) return options.listActiveTenants();
    try {
      const raw = await options.db.execute(sql`
        SELECT id::text AS id
          FROM tenants
         WHERE status = 'active'
         LIMIT ${tenantLimit}
      `);
      return rowsOf(raw)
        .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
        .filter((s) => s.length > 0);
    } catch (err) {
      // Schema-pre-migration / connectivity hiccup → degrade to "no tenants"
      // so the worker stays safe rather than crashing the tick.
      options.logger.warn(
        { worker: WORKER_NAME, err: err instanceof Error ? err.message : String(err) },
        'kg-sync: listActiveTenants failed; degrading to []',
      );
      return [];
    }
  }

  async function ingestForTenant(tenantId: string): Promise<KgIngestResult> {
    if (options.ingestForTenant) return options.ingestForTenant(tenantId);
    // Bind the tenant GUC in a pinned transaction; run the registry-driven
    // ingest pass through THAT handle so every read + write is RLS-scoped.
    return withWorkerTenantContext(
      options.db as TenantContextDbLike,
      tenantId,
      (tx) => ingestKnowledgeGraph({ db: tx, tenantId }),
    );
  }

  async function tickOnce(): Promise<KgSyncTickResult> {
    if (inflight) {
      return {
        tenantsScanned: 0,
        tenantsIngested: 0,
        tenantsFailed: 0,
        nodes: 0,
        edges: 0,
      };
    }
    inflight = true;
    try {
      const tenantIds = await listActiveTenants();
      let tenantsIngested = 0;
      let tenantsFailed = 0;
      let nodes = 0;
      let edges = 0;
      for (const tenantId of tenantIds) {
        try {
          const result = await ingestForTenant(tenantId);
          tenantsIngested += 1;
          nodes += result.nodes;
          edges += result.edges;
        } catch (err) {
          tenantsFailed += 1;
          options.logger.warn(
            {
              worker: WORKER_NAME,
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'kg-sync: per-tenant ingest failed',
          );
        }
      }
      if (tenantIds.length > 0) {
        options.logger.info(
          {
            worker: WORKER_NAME,
            tenantsScanned: tenantIds.length,
            tenantsIngested,
            tenantsFailed,
            nodes,
            edges,
          },
          'kg-sync: tick done',
        );
      }
      workerHeartbeat(WORKER_NAME);
      return {
        tenantsScanned: tenantIds.length,
        tenantsIngested,
        tenantsFailed,
        nodes,
        edges,
      };
    } catch (err) {
      workerHeartbeatFailure(WORKER_NAME, err);
      throw err;
    } finally {
      inflight = false;
    }
  }

  function warnBootOnce(): void {
    if (bootWarned) return;
    bootWarned = true;
    options.logger.info(
      { worker: WORKER_NAME, intervalMs },
      'kg-sync: started',
    );
  }

  function start(): void {
    if (!enabled) {
      options.logger.info(
        { worker: WORKER_NAME },
        'kg-sync: disabled by config',
      );
      return;
    }
    if (timer) return;
    registerWorker({ name: WORKER_NAME, intervalMs });
    warnBootOnce();
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          {
            worker: WORKER_NAME,
            err: err instanceof Error ? err.message : String(err),
          },
          'kg-sync: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}

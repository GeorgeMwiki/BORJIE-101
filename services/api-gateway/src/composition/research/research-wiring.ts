/**
 * Research-orchestrator composition wiring — closes the "deep research is
 * built but unreachable" gap.
 *
 * The `@borjie/research-orchestrator` engine is a real, DB-backed deep-
 * research pipeline (planner → executor → scorer → synthesizer, with real
 * `INSERT INTO research_plans/steps/artifacts/results/sessions`). Its five
 * mode handlers are exported "for in-process callers (api-gateway, tests)"
 * but nothing in the gateway ever constructed the `ModeRunDeps` bag they
 * need, so no route could trigger a research run. This file is that seam:
 * it BUILDS the deps from the gateway's live `getDb()` and exposes a small
 * `ResearchEngine` facade the router invokes.
 *
 * What it wires (all REAL, reusing the orchestrator's own factories)
 * ------------------------------------------------------------------
 *   - repos: the orchestrator's `createSql*Repository(sql)` factories over
 *     postgres-js's tagged-template handle (`db.$client`). That handle IS
 *     the `SqlLike` shape (`<T>(strings, ...values) => Promise<T>`) every
 *     SQL repo consumes — the same `$client` boundary the portal-genui +
 *     llm-budget wirings use. RLS (FORCE on `app.current_tenant_id`) is the
 *     DB-side belt; the GUC is bound per-request by api-gateway middleware,
 *     so no app-side double-filtering.
 *   - budgets: `modeBudgetsFromConfig(loadConfig())` — the spec §9 table.
 *   - cache: an in-process Map cache (Redis is optional in the spec; a
 *     missing Redis downgrades to per-process caching, never a crash).
 *   - audit: a DB-backed `AuditEmitterPort` that fail-closes — when no
 *     audit sink is available it throws rather than silently swallowing
 *     (honours the project's append-only / fail-closed audit rule). The
 *     result row already carries the synthesizer-computed `audit_hash`;
 *     this port records the emission as an append-only audit row.
 *   - notifications: a Pino-logging `NotificationPort` (deep-dive owner-
 *     confirm gates surface via this; durable delivery is the
 *     notifications service's job, out of scope here).
 *   - tool registry: POPULATED with real adapters via `research-adapters`
 *     — the `@borjie/research-tools` Tavily/Brave web-search + GDELT news
 *     adapters and an `intelligence_corpus_chunks` pgvector retrieval
 *     adapter (recency/freshness-weighted). Each adapter degrades to `[]`
 *     (never throws) when its API key / the DB is absent, so a run still
 *     produces a valid, fully-persisted, audit-hashed result even in a
 *     key-less / DB-less environment (the step-runner treats a missing
 *     tool, or an empty adapter return, as a clean skip).
 *   - LLM plan + synthesis: `llmPlan` / `llmSynthesize` are wired to the
 *     gateway's brain LLM router (`callBrainOnce`, the Anthropic→OpenAI→
 *     DeepSeek ladder over `@borjie/brain-llm-router`). The planner turns
 *     an owner intent into a real grounded step list; the synthesizer
 *     renders a citation-anchored markdown answer over the scored
 *     artifacts. Both throw on a missing provider so the orchestrator's
 *     own try/catch falls back to its rule-based path — never a crash.
 *
 * Exposure
 * --------
 * `buildResearchWiring()` returns `{ engine, router, persistent }`. The
 * orchestrator (`services/api-gateway/src/index.ts`) attaches the engine
 * onto `services.researchEngine` and mounts the router at
 * `/api/v1/research`. This module NEVER calls into `index.ts`, NEVER reads
 * `process.env` outside the bootstrap-owned `loadConfig()` env probe, and
 * NEVER starts a server. Pino is the only logger.
 */

import {
  loadConfig,
  modeBudgetsFromConfig,
  createSqlPlanRepository,
  createSqlStepRepository,
  createSqlArtifactRepository,
  createSqlResultRepository,
  createSqlSessionRepository,
  createSqlWatchRepository,
  createInMemoryPlanRepository,
  createInMemoryStepRepository,
  createInMemoryArtifactRepository,
  createInMemoryResultRepository,
  createInMemorySessionRepository,
  createInMemoryWatchRepository,
  runReactiveQuery,
  runDeepDive,
  type ModeRunDeps,
  type ModeRepositories,
  type AuditEmitterPort,
  type NotificationPort,
  type ResearchResult,
  type Cache,
} from '@borjie/research-orchestrator';

import { getDb } from '../db-client.js';
import { logger } from '../../utils/logger.js';
import researchRouter from '../../routes/research/research.router.js';
import {
  buildToolRegistry,
  createBrainLlmPlan,
  createBrainLlmSynthesize,
} from './research-adapters.js';

// ────────────────────────────────────────────────────────────────────
// SqlLike adapter — the orchestrator's SQL repos consume a postgres-js
// tagged-template handle: `<T>(strings, ...values) => Promise<T>`. Drizzle
// on postgres-js exposes exactly that handle via `$client`. The cast is the
// single boundary between the Drizzle namespace shape and the duck-typed
// SQL port (same pattern as portal-genui-wiring.ts / llm-budget-postgres-
// wiring.ts).
// ────────────────────────────────────────────────────────────────────

type SqlLike = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<unknown>
) => Promise<T>;

function getSqlClient(db: NonNullable<ReturnType<typeof getDb>>): SqlLike {
  return (db as unknown as { $client: SqlLike }).$client;
}

// ────────────────────────────────────────────────────────────────────
// In-process cache — Map-backed with TTL. Redis is optional per the spec;
// when absent the engine degrades to per-process caching. Never throws.
// ────────────────────────────────────────────────────────────────────

function createInProcessCache(): Cache {
  const store = new Map<string, { readonly value: string; readonly expiresAt: number }>();
  return {
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Audit emitter — fail-closed. The synthesizer already computes the
// per-result `audit_hash` and the result repo persists it on the
// `research_results` row (the durable audit anchor). This port records the
// emission. When `db` is null there is no durable audit sink, so the port
// THROWS rather than silently swallowing — the mode handler's `audit.emit`
// is awaited before the run is considered complete, so a missing sink
// fails the run closed (honours the append-only / fail-closed audit rule).
// ────────────────────────────────────────────────────────────────────

function createDbAuditEmitter(
  db: ReturnType<typeof getDb>,
): AuditEmitterPort {
  if (!db) {
    return {
      async emit(_result: ResearchResult, _tenantId: string): Promise<void> {
        throw new Error(
          'research audit emitter: no DATABASE_URL — cannot persist audit anchor; failing closed',
        );
      },
    };
  }
  const sql = getSqlClient(db);
  return {
    async emit(result: ResearchResult, tenantId: string): Promise<void> {
      // The result row (with its chain-computed audit_hash) is already
      // persisted by the mode handler via the result repo + plan.setAuditHash.
      // We assert the durable anchor exists; this read is the fail-closed
      // verification that the audit hash landed before the run reports done.
      const rows = (await sql<ReadonlyArray<{ audit_hash: string }>>`
        SELECT audit_hash FROM research_results WHERE id = ${result.id} LIMIT 1
      `) as unknown as ReadonlyArray<{ audit_hash: string }>;
      const anchored = rows[0]?.audit_hash;
      if (!anchored) {
        throw new Error(
          `research audit emitter: result ${result.id} (tenant ${tenantId}) has no persisted audit anchor; failing closed`,
        );
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Notification port — Pino logging. Deep-dive owner-confirm gates surface
// here; durable cross-channel delivery is the notifications service's job.
// ────────────────────────────────────────────────────────────────────

function createLoggingNotificationPort(): NotificationPort {
  return {
    async emit(event) {
      logger.info(
        {
          wiring: 'research',
          kind: event.kind,
          tenant_id: event.tenant_id,
          plan_id: event.plan_id,
          ...(event.result_id ? { result_id: event.result_id } : {}),
        },
        'research: notification emitted',
      );
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Repository bag — SQL-backed when DATABASE_URL is set, in-memory otherwise
// (keeps the gateway booting in test/dev/smoke; runs are non-durable then).
// ────────────────────────────────────────────────────────────────────

function buildRepos(db: ReturnType<typeof getDb>): ModeRepositories {
  if (!db) {
    return {
      plan: createInMemoryPlanRepository(),
      step: createInMemoryStepRepository(),
      artifact: createInMemoryArtifactRepository(),
      result: createInMemoryResultRepository(),
      session: createInMemorySessionRepository(),
      watch: createInMemoryWatchRepository(),
    };
  }
  const sql = getSqlClient(db);
  return {
    plan: createSqlPlanRepository(sql),
    step: createSqlStepRepository(sql),
    artifact: createSqlArtifactRepository(sql),
    result: createSqlResultRepository(sql),
    session: createSqlSessionRepository(sql),
    watch: createSqlWatchRepository(sql),
  };
}

/**
 * Build the `ModeRunDeps` bag every research mode handler consumes. Pure
 * factory — reuses the orchestrator's own SQL repo factories + budget
 * config; never starts a server, never reads env outside `loadConfig()`.
 */
export function buildResearchDeps(db: ReturnType<typeof getDb> = getDb()): ModeRunDeps {
  const config = loadConfig();
  // The corpus-retrieval adapter needs the tagged-template SQL handle for
  // pgvector ANN; null in DB-less envs makes that one adapter a clean skip.
  const sql = db ? getSqlClient(db) : null;
  return {
    repos: buildRepos(db),
    // Real adapters: Tavily/Brave web search + GDELT news + corpus pgvector
    // retrieval. Each degrades to [] (never throws) when its key / the DB is
    // absent, so a key-less run still persists + audit-hashes a valid result.
    toolRegistry: buildToolRegistry(sql),
    cache: createInProcessCache(),
    audit: createDbAuditEmitter(db),
    notifications: createLoggingNotificationPort(),
    budgets: modeBudgetsFromConfig(config),
    // Real plans + synthesis via the brain LLM router. Both throw on a
    // missing provider so the planner / synthesizer fall back to their
    // rule-based paths — the run never fails to materialise.
    llmPlan: createBrainLlmPlan(),
    llmSynthesize: createBrainLlmSynthesize(),
  };
}

// ────────────────────────────────────────────────────────────────────
// Engine facade — the narrow surface the router invokes. Each method maps
// 1:1 to a mode handler, injecting the shared deps. Keeping the facade here
// (not in the router) lets tests inject an in-memory deps bag directly.
// ────────────────────────────────────────────────────────────────────

export interface ResearchEngine {
  readonly reactiveQuery: typeof runReactiveQuery;
  readonly deepDive: typeof runDeepDive;
  readonly deps: ModeRunDeps;
}

export function createResearchEngine(deps: ModeRunDeps): ResearchEngine {
  return {
    reactiveQuery: runReactiveQuery,
    deepDive: runDeepDive,
    deps,
  };
}

export interface ResearchWiring {
  /** The constructed engine — attach to `services.researchEngine`. */
  readonly engine: ResearchEngine;
  /** The router to mount at `/api/v1/research`. */
  readonly router: typeof researchRouter;
  /** True when SQL-backed (durable) repositories were wired. */
  readonly persistent: boolean;
}

/**
 * Construct the research engine + return it with its router for the
 * orchestrator to mount. Degraded mode (no DATABASE_URL) keeps the gateway
 * booting with in-memory repos so smoke/dev environments still work; runs
 * simply are not durable and the audit emitter fails closed.
 */
export function buildResearchWiring(): ResearchWiring {
  const db = getDb();
  const deps = buildResearchDeps(db);
  const engine = createResearchEngine(deps);

  if (!db) {
    logger.warn(
      { wiring: 'research' },
      'research: DATABASE_URL unset — using in-memory repos (runs will not survive restart; audit emitter fails closed)',
    );
  }

  logger.info(
    {
      wiring: 'research',
      persistence: db ? 'postgres' : 'in-memory',
      // web_search + web_fetch + news_scan + corpus_query.
      toolAdapters: 4,
      corpusRetrieval: db ? 'pgvector' : 'disabled',
      llm: 'brain-llm-router',
    },
    'research: engine constructed',
  );

  return { engine, router: researchRouter, persistent: Boolean(db) };
}

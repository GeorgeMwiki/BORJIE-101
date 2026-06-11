/**
 * llm-routing-config-wiring.ts — composition root for the CONTROL-PLANE
 * read-half (LANE B5 closure).
 *
 * The admin console's WRITE half (admin-web → control-plane.hono →
 * platform_llm_routing_config, migration 0320) was already real. But nothing
 * called `setRoutingConfigReader()` in production, so the brain-llm-router's
 * `resolveConfigDrivenLadder` never saw admin config and always returned the
 * static `TASK_LADDER`. This module is the missing seam: it warms a process
 * cache from `platform_llm_routing_config` and installs the SYNC reader the
 * resolver consults on the hot path.
 *
 * SHAPE (mirrors kill-switch + egress-filter wiring):
 *   - `initLlmRoutingConfig({ db, logger, ttlMs? })` — warms the cache once,
 *     installs the sync reader, and schedules a TTL refresh. Idempotent.
 *   - `invalidateLlmRoutingConfig()` — drops the cache so the next read
 *     re-warms from the DB. The control-plane PUT /llm-routing handler calls
 *     this after a successful write so an admin change takes effect on the
 *     next turn without a restart.
 *
 * FAIL-SAFE (HARD): the sync reader NEVER throws. On a cold cache (warm not
 * yet completed), a DB failure, or a malformed row, the reader returns `null`
 * for the scope — and the resolver then falls back to the static TASK_LADDER,
 * identical to today's behaviour. A bad config can never break a turn.
 *
 * PLATFORM-METADATA, not tenant business data: the store is service-role-only;
 * the `tenant:<id>` scope is a STRING KEY naming which tenant an override
 * applies to, never a row read through a tenant JWT path. No RLS GUC is bound
 * here (the table is platform-scoped, not tenant-scoped).
 *
 * IP-EGRESS: the cache holds canonical model ids server-side. Nothing here
 * surfaces a model/provider/agent name to a client — the resolver + seam
 * adapter only rewrite the model id sent to a provider SDK.
 *
 * No `console.*` (Pino shim only). `process.env` is not read here.
 *
 * @module services/api-gateway/src/composition/llm-routing-config-wiring
 */

import {
  setRoutingConfigReader,
  resetRoutingConfigReader,
  validateRoutingConfig,
  tenantScope,
  type ConfigScope,
  type LlmRoutingConfig,
} from '@borjie/brain-llm-router';
import { createPlatformLlmRoutingConfigService } from '@borjie/database';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// The named `DatabaseClient` type export resolves to a NAMESPACE under this
// project's module setup (same gotcha the control-plane route documents), so we
// structurally recover the db client type from the service factory's first
// parameter instead of importing the name.
type DatabaseClient = Parameters<typeof createPlatformLlmRoutingConfigService>[0];

/** Default cache TTL: 60s. An admin write also invalidates immediately. */
const DEFAULT_TTL_MS = 60_000;

/** The actor stamp the read-only warmer uses (no writes flow through it). */
const WARMER_ACTOR = 'system:llm-routing-warmer';

export interface InitLlmRoutingConfigArgs {
  /** The platform DatabaseClient (service-role; the table is platform-scoped). */
  readonly db: DatabaseClient;
  /** Optional logger; defaults to a pino-shim child. */
  readonly logger?: PinoLikeLogger;
  /** Cache TTL in ms; defaults to 60_000. A non-positive value disables the timer. */
  readonly ttlMs?: number;
}

export interface LlmRoutingConfigHandle {
  /** Force a re-warm from the DB on the next read (the PUT handler calls this). */
  readonly invalidate: () => void;
  /** Stop the TTL timer + reset the injected reader. For shutdown / tests. */
  readonly stop: () => void;
}

// ---------------------------------------------------------------------------
// Process singleton state.
// ---------------------------------------------------------------------------

interface CacheState {
  /** scope → validated config (or null when the row was absent/invalid). */
  readonly byScope: Map<ConfigScope, LlmRoutingConfig | null>;
  /** Epoch ms the cache was last warmed; 0 means cold. */
  warmedAt: number;
  /** True while a warm is in-flight (de-dupes concurrent triggers). */
  warming: boolean;
}

let state: CacheState | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let initialised = false;

/**
 * Validate a raw routing-config document through the router's authoritative
 * gate. Returns the validated config or null (a malformed row reads as absent,
 * fail-safe). Never throws.
 */
function coerceConfig(raw: unknown): LlmRoutingConfig | null {
  if (raw === null || raw === undefined) return null;
  try {
    const res = validateRoutingConfig(raw);
    return res.success && res.data ? res.data : null;
  } catch {
    return null;
  }
}

/**
 * Warm the cache from the DB. Reads EVERY scope row in one query (the table is
 * tiny: one row per scope), validates each, and replaces the cache atomically.
 * On any DB failure the previous cache is kept (degrade-safe) and an error is
 * logged. Never throws.
 */
async function warm(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): Promise<void> {
  if (!state) return;
  if (state.warming) return;
  state.warming = true;
  try {
    const service = createPlatformLlmRoutingConfigService(db, {
      resolveActor: () => WARMER_ACTOR,
    });
    const rows = await service.readAll();
    const next = new Map<ConfigScope, LlmRoutingConfig | null>();
    for (const row of rows) {
      next.set(row.scope as ConfigScope, coerceConfig(row.config));
    }
    // Atomic-ish replace: clear + repopulate the same Map instance so existing
    // closures keep their reference.
    state.byScope.clear();
    for (const [scope, cfg] of next) state.byScope.set(scope, cfg);
    state.warmedAt = Date.now();
    logger.info(
      { wiring: 'llm-routing-config', scopeCount: next.size },
      'llm-routing-config: cache warmed',
    );
  } catch (err) {
    // Degrade-safe: keep the previous cache; the reader still serves it.
    logger.error(
      {
        wiring: 'llm-routing-config',
        err: err instanceof Error ? err.message : String(err),
      },
      'llm-routing-config: warm failed (keeping previous cache)',
    );
  } finally {
    if (state) state.warming = false;
  }
}

/**
 * The SYNC reader installed via `setRoutingConfigReader`. MUST be cheap +
 * non-throwing. Serves the cached config for a scope; returns null on a cold
 * cache or an absent scope (→ resolver falls back to the static ladder). When
 * the cache is stale (past TTL) it triggers an ASYNC re-warm but still returns
 * the current value synchronously — the next turn sees the fresh value.
 */
function makeReader(
  db: DatabaseClient,
  logger: PinoLikeLogger,
  ttlMs: number,
): (scope: ConfigScope) => LlmRoutingConfig | null {
  return (scope: ConfigScope): LlmRoutingConfig | null => {
    if (!state) return null;
    // Stale-while-revalidate: serve the current value, kick a refresh when the
    // TTL has elapsed (or the cache is cold) so an admin change converges.
    const isStale =
      state.warmedAt === 0 || (ttlMs > 0 && Date.now() - state.warmedAt > ttlMs);
    if (isStale && !state.warming) {
      void warm(db, logger);
    }
    return state.byScope.get(scope) ?? null;
  };
}

// ---------------------------------------------------------------------------
// Public composition surface.
// ---------------------------------------------------------------------------

/**
 * Initialise the control-plane routing-config read-half. Warms the cache,
 * installs the sync reader, and schedules a TTL refresh. Idempotent: a second
 * call returns the existing handle without re-installing.
 *
 * DEFERRED BOOT: the chokepoint wave wires the single call to this from
 * `services/api-gateway/src/index.ts` (see deferredMounts). Until then this is
 * exported but unwired — and an unwired deployment is identical to pre-config
 * behaviour by construction (the resolver has no reader → static ladder).
 */
export function initLlmRoutingConfig(
  args: InitLlmRoutingConfigArgs,
): LlmRoutingConfigHandle {
  const logger = args.logger ?? createPinoLikeLogger('llm-routing-config');
  const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS;

  if (initialised && state) {
    return { invalidate: invalidateLlmRoutingConfig, stop: stopLlmRoutingConfig };
  }

  state = { byScope: new Map(), warmedAt: 0, warming: false };
  initialised = true;

  // Install the sync reader BEFORE the first warm completes — the reader
  // fail-safes to null on a cold cache, so an early turn simply uses the
  // static ladder until the warm lands.
  setRoutingConfigReader(makeReader(args.db, logger, ttlMs));

  // Kick the initial warm (fire-and-forget; the reader is already safe).
  void warm(args.db, logger);

  // Schedule periodic refresh. `unref` so the timer never holds the process
  // open. A non-positive ttl disables the timer (manual-invalidate only).
  if (ttlMs > 0) {
    refreshTimer = setInterval(() => {
      void warm(args.db, logger);
    }, ttlMs);
    if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
  }

  logger.info(
    { wiring: 'llm-routing-config', ttlMs },
    'llm-routing-config: reader installed',
  );

  return { invalidate: invalidateLlmRoutingConfig, stop: stopLlmRoutingConfig };
}

/**
 * Drop the cache so the next read re-warms from the DB. The control-plane
 * PUT /llm-routing handler calls this after a successful write so an admin
 * change converges on the next turn (not just after the TTL). No-op when the
 * reader was never initialised. Cheap + synchronous; never throws.
 */
export function invalidateLlmRoutingConfig(): void {
  if (!state) return;
  // Mark the cache cold → the next reader call triggers a fresh warm.
  state.warmedAt = 0;
}

/**
 * Convenience for the control-plane route: invalidate ONLY when initialised,
 * returning whether anything was invalidated. The PUT handler uses this so it
 * never has to know whether the boot wiring ran in this deployment.
 */
export function invalidateIfInitialised(): boolean {
  if (!initialised || !state) return false;
  invalidateLlmRoutingConfig();
  return true;
}

/**
 * Stop the TTL timer + reset the injected reader. Used on shutdown + by tests.
 * After this the resolver falls back to the static ladder (no reader).
 */
export function stopLlmRoutingConfig(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  resetRoutingConfigReader();
  state = null;
  initialised = false;
}

/** Test seam — true iff the reader is currently installed. */
export function __isLlmRoutingConfigInitialised(): boolean {
  return initialised;
}

/**
 * Dynamic model registry — 3-level resolver.
 *
 *     hot path: getModelLatest("opus")
 *                       ↓
 *     ┌─ L1: in-memory TTL cache (1h) ────┐  warmed by sleep-pass +
 *     │  HIT → return cached id            │  lazy first-call init
 *     └────────────────────────────────────┘
 *                       ↓ miss (returns L3 + schedules L2 refresh)
 *     ┌─ L2: GET /v1/models via safeHttpFetch (5s) ──┐  numeric-aware
 *     │  picks newest id matching family pattern     │  version compare
 *     └───────────────────────────────────────────────┘
 *                       ↓ provider down / 5xx / no key
 *     ┌─ L3: MODELS[family] baseline ──────┐  always present, never throws
 *     │  L2-failure cached for 5min        │  (avoid thundering)
 *     └─────────────────────────────────────┘
 *
 * Properties:
 *   - **Single-arg API**: `getModelLatest(family)` returns `string`.
 *   - **L1 miss does NOT block**: hot path returns baseline immediately
 *     and schedules an async refresh. Subsequent calls hit L1.
 *   - **Inflight dedupe**: concurrent first-callers share one L2 fetch.
 *   - **L2 failure caches baseline for 5 min**: avoids slamming the
 *     provider when it's down. After the short TTL, next miss re-tries.
 *   - **Never throws**: any error path collapses to the L3 baseline.
 *
 * The sleep-pass orchestrator (`services/sleep-pass-orchestrator`)
 * invokes `warmAllFamilies()` once per quiet window so the first
 * production call never even sees L3 — the cache is already hot.
 */

import {
  MODELS,
  MODEL_FAMILIES,
  isModelFamily,
  type ModelFamily,
} from './baselines.js';
import { cache } from './cache.js';
import { fetchLatestForFamily } from './fetchers.js';
import { getLogger } from './logger-port.js';
import { validateModel } from './validate-model.js';

/** Short TTL we use to re-cache the baseline when L2 fails. */
const BASELINE_RECACHE_MS = 5 * 60 * 1000;

/** Dedupe map: only one L2 refresh per family at a time. */
const inflight = new Map<ModelFamily, Promise<void>>();

/**
 * Hot-path resolver. Synchronous; safe to call on every brain-call.
 *
 * Returns the L1-cached id when present, otherwise returns the L3
 * baseline and fires an L2 refresh in the background. Throws only on
 * unknown family — that signals a caller bug (typo in a `ModelFamily`
 * literal) which we want to surface loudly rather than silently
 * dispatching to a wrong baseline.
 */
export function getModelLatest(family: ModelFamily): string {
  const log = getLogger();

  if (!isModelFamily(family)) {
    // Eager guard: thrown by JS only if a caller bypassed the type
    // system (e.g. read a string from JSON). Production code paths
    // never hit this — TypeScript prevents it at the call site.
    throw new Error(
      `getModelLatest: unknown family "${String(family)}". ` +
        `Allowed: ${MODEL_FAMILIES.join(', ')}`,
    );
  }

  const hit = cache.get(family);
  if (hit !== null) {
    log.debug({ family, source: 'L1', model: hit }, 'model-resolver hit');
    return hit;
  }

  // L1 miss → schedule an L2 refresh in the background, return L3 now.
  scheduleRefresh(family);
  const baseline = MODELS[family];
  log.debug(
    { family, source: 'L3-baseline', model: baseline },
    'model-resolver baseline (L2 refresh queued)',
  );
  return baseline;
}

/**
 * Kick off an L2 refresh for `family`. Returns the in-flight promise
 * so warmers (and tests) can `await` it. If a refresh is already
 * in-flight for this family, returns the existing promise — multiple
 * concurrent misses share one provider call.
 */
export function scheduleRefresh(family: ModelFamily): Promise<void> {
  const existing = inflight.get(family);
  if (existing !== undefined) return existing;

  const promise = (async (): Promise<void> => {
    try {
      const latest = await fetchLatestForFamily(family);
      if (latest !== null) {
        await adoptOrHold(family, latest);
      } else {
        // L2 returned nothing (no key / network / no matching id). Cache
        // the baseline for a short window so we don't retry on every
        // hot-path call, but still re-attempt soon (next refresh after
        // BASELINE_RECACHE_MS).
        holdBaseline(family, 'model-resolver L2 returned no match — cached baseline');
      }
    } catch (err) {
      // fetchLatestForFamily / validateModel are contract-bound to never
      // throw; if one does (e.g. caller injected a broken port), still
      // don't crash the warmer.
      getLogger().error(
        {
          family,
          err: err instanceof Error ? err.message : String(err),
        },
        'model-resolver refresh threw unexpectedly',
      );
      cache.set(family, MODELS[family], BASELINE_RECACHE_MS);
    } finally {
      inflight.delete(family);
    }
  })();

  inflight.set(family, promise);
  return promise;
}

/**
 * Decide whether an L2-discovered `latest` id may be promoted into L1.
 *
 *   - `latest` equals the baseline OR the value already cached in L1 →
 *     already trusted; adopt with the normal TTL, no probe needed.
 *   - `latest` is a NEW id (differs from baseline AND from the current
 *     L1 value) → run the bounded smoke probe first. Only a `pass`
 *     verdict adopts it; `fail`/`skipped` hold the baseline (short TTL)
 *     so the hot path never routes at an unvalidated model.
 *
 * The probe lives ENTIRELY here in the async refresh — the sync hot
 * path (`getModelLatest`) never awaits it.
 */
async function adoptOrHold(
  family: ModelFamily,
  latest: string,
): Promise<void> {
  const log = getLogger();
  const baseline = MODELS[family];
  const currentL1 = cache.get(family);

  if (latest === baseline || latest === currentL1) {
    cache.set(family, latest);
    log.info(
      { family, source: 'L2', model: latest, probed: false },
      'model-resolver L2 refresh succeeded (known id — no probe)',
    );
    return;
  }

  // NEW id never served before → smoke-validate before adopting.
  const verdict = await validateModel(family, latest);
  if (verdict.outcome === 'pass') {
    cache.set(family, latest);
    log.info(
      { family, source: 'L2', model: latest, probed: true },
      'model-resolver adopted new model after passing validation probe',
    );
    return;
  }

  // fail / skipped → do NOT adopt. Hold the baseline on a short TTL so
  // the next refresh re-attempts (the model may become available, or a
  // transient probe error clears).
  cache.set(family, baseline, BASELINE_RECACHE_MS);
  log.warn(
    {
      family,
      candidate: latest,
      baseline,
      outcome: verdict.outcome,
      reason: verdict.reason,
      recacheMs: BASELINE_RECACHE_MS,
    },
    `model-resolver new model ${latest} failed validation probe — holding ${baseline}`,
  );
}

/** Cache the baseline on the short retry TTL and warn. */
function holdBaseline(family: ModelFamily, message: string): void {
  cache.set(family, MODELS[family], BASELINE_RECACHE_MS);
  getLogger().warn(
    {
      family,
      source: 'L3-cached',
      model: MODELS[family],
      recacheMs: BASELINE_RECACHE_MS,
    },
    message,
  );
}

/**
 * Eagerly refresh every family. Called by the sleep-pass orchestrator
 * during quiet windows and by the api-gateway composition root at
 * boot. Returns once **all** family refreshes have settled (success
 * or no-op) so callers can chain readiness checks.
 */
export async function warmAllFamilies(): Promise<void> {
  await Promise.allSettled(
    MODEL_FAMILIES.map((family) => scheduleRefresh(family)),
  );
}

/** Test-only — drop all in-flight refresh promises. */
export function __resetInflight(): void {
  inflight.clear();
}

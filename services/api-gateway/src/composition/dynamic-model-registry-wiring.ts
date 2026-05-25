/**
 * Composition-root wiring for the dynamic model registry.
 *
 * Binds two ports on `@borjie/brain-llm-router/dynamic-registry`:
 *
 *   1. **Fetch port** → `@borjie/enterprise-hardening#safeHttpFetch`
 *      (SSRF allowlist + DNS-screened + 5s timeout). The router's L2
 *      provider queries (`api.anthropic.com/v1/models`, etc.) go
 *      through the canonical egress guard.
 *   2. **Logger port** → the api-gateway's Pino instance, so every
 *      `model-resolver hit/baseline/L2 refresh` event lands in the
 *      same structured-log stream as every other request.
 *
 * Also kicks off a fire-and-forget `warmAllFamilies()` so the first
 * brain-call lands on a hot L1 cache. Failure is swallowed (logged
 * only) — `getModelLatest()` never throws even if warm fails, because
 * L3 baselines are always present.
 *
 * Call once at boot from `services/api-gateway/src/index.ts` right
 * after the Pino `logger` is constructed.
 */

import {
  setFetchPort,
  setLogger,
  warmAllFamilies,
  type DynamicRegistryFetchPort,
  type DynamicRegistryFetchOptions,
  type DynamicRegistryFetchResult,
  type ResolverLogger,
} from '@borjie/brain-llm-router/dynamic-registry';
import { safeHttpFetch } from '@borjie/enterprise-hardening';

interface PinoLikeLogger {
  debug(ctx: Record<string, unknown>, msg: string): void;
  info(ctx: Record<string, unknown>, msg: string): void;
  warn(ctx: Record<string, unknown>, msg: string): void;
  error(ctx: Record<string, unknown>, msg: string): void;
}

/**
 * Adapter — turns `safeHttpFetch`'s `SafeHttpFetchResult` into the
 * router's `DynamicRegistryFetchResult` (shapes are 1:1 already, this
 * is mostly a re-declared port so the router stays zero-dep on
 * `enterprise-hardening`).
 */
const safeFetchAdapter: DynamicRegistryFetchPort = async (
  url: string,
  options?: DynamicRegistryFetchOptions,
): Promise<DynamicRegistryFetchResult> => {
  try {
    const res = await safeHttpFetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      timeoutMs: options?.timeoutMs ?? 5_000,
    });
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      json: () => res.json(),
      text: () => res.text(),
    };
  } catch (err) {
    // safeHttpFetch throws on policy violation. The router's L2 contract
    // is "returns null on any failure"; re-throwing here lets the
    // router's own try/catch (in `fetchers.ts`) handle it uniformly.
    throw err;
  }
};

export function wireDynamicModelRegistry(args: {
  readonly logger: PinoLikeLogger;
}): { warmPromise: Promise<void> } {
  setFetchPort(safeFetchAdapter);

  // Pino's `(ctx, msg)` shape matches `ResolverLogger` exactly.
  const resolverLogger: ResolverLogger = {
    debug: (ctx, msg) => args.logger.debug(ctx, msg),
    info: (ctx, msg) => args.logger.info(ctx, msg),
    warn: (ctx, msg) => args.logger.warn(ctx, msg),
    error: (ctx, msg) => args.logger.error(ctx, msg),
  };
  setLogger(resolverLogger);

  // Fire-and-forget warm. `getModelLatest` works immediately via L3
  // baselines; this just speeds up the first call.
  const warmPromise = warmAllFamilies().catch((err: unknown) => {
    args.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'initial dynamic-model-registry warm failed (L3 baselines still active)',
    );
  });

  return { warmPromise };
}

/**
 * Re-export for sleep-pass-orchestrator integration. The api-gateway
 * passes this through when constructing the standalone bundle (when
 * embedded mode is added) or when wiring the production sleep-pass
 * pod. The injected warmer makes `warmAllFamilies()` reachable from
 * services that don't want a direct dep on brain-llm-router.
 */
export { warmAllFamilies } from '@borjie/brain-llm-router/dynamic-registry';

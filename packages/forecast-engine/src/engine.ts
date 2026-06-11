/**
 * Forecast engine entry — `createForecastEngine(deps)`.
 *
 * Composes the registry + router into one `forecast(request)` call that
 * returns a calibrated, evidence-stamped `ForecastResult`. The engine is
 * target-aware: when a request's `target` matches a registered
 * `ForecastTargetDef` it adopts that target's recommended coverage and,
 * for 'tsfm' targets, names the candidate provider so the router will
 * try to escalate above the floor (and reject it if it does not beat it).
 *
 * The engine NEVER reaches the ledger and NEVER mutates a rule-based
 * decision; it produces advisory forecasts that append via the
 * prediction-append port.
 *
 * Pure orchestration over the injected registry; deterministic for
 * deterministic providers.
 */

import type { ProviderRegistry } from './providers/registry.js';
import { createProviderRegistry } from './providers/registry.js';
import {
  createForecastRouter,
  type ForecastRouter,
  type RouterConfig,
  type RouteOutcome,
} from './router/forecast-router.js';
import { getTarget } from './targets/registry.js';
import { ForecastRequestSchema } from './types.js';
import type { ForecastRequest, ForecastResult } from './types.js';

export interface ForecastEngineDeps {
  /** Provider registry. Defaults to classical-floor-only (zero config). */
  readonly registry?: ProviderRegistry;
  /** Router overrides (candidate provider name, blend, conformal mode). */
  readonly router?: RouterConfig;
}

export interface ForecastEngine {
  /** Forecast a request and return a calibrated, evidence-stamped result. */
  forecast(request: ForecastRequest): Promise<ForecastResult>;
  /** Forecast and return the full route outcome (scores + escalation flag). */
  route(request: ForecastRequest): Promise<RouteOutcome>;
}

export function createForecastEngine(
  deps: ForecastEngineDeps = {},
): ForecastEngine {
  const registry = deps.registry ?? createProviderRegistry();
  const baseRouterConfig: RouterConfig = deps.router ?? {};
  // The router config (candidate provider / blend / conformal mode) is
  // engine-wide; target-awareness only adjusts the request's coverage.
  const router: ForecastRouter = createForecastRouter(registry, baseRouterConfig);

  async function routeRequest(request: ForecastRequest): Promise<RouteOutcome> {
    const parsed = ForecastRequestSchema.parse(request);
    const def = getTarget(parsed.target);
    // Target-aware: adopt the target's recommended coverage when the
    // caller did not pin one.
    const withCoverage: ForecastRequest =
      parsed.targetCoverage === undefined && def
        ? { ...parsed, targetCoverage: def.targetCoverage }
        : parsed;
    return router.route(withCoverage);
  }

  return {
    async route(request: ForecastRequest): Promise<RouteOutcome> {
      return routeRequest(request);
    },
    async forecast(request: ForecastRequest): Promise<ForecastResult> {
      const outcome = await routeRequest(request);
      return outcome.result;
    },
  };
}

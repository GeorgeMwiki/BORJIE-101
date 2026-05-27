// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: the 503
// branch widens the response union enough that the TypedResponse overload
// rejects the unified return type. Same workaround as `kill-switch.middleware.ts`
// and `hono-auth.ts`. Tracked at hono-dev/hono#3891.

/**
 * Pilot kill-switch middleware — emergency disable for the pilot cohort.
 *
 * This middleware MUST only be mounted on routes that explicitly opt in
 * via the `x-pilot: true` tag (i.e. surfaces actively used by the 3–5
 * pilot tenants during the May/Jun 2026 window). Mounting it globally
 * would let a single env flip take the whole platform down.
 *
 * Behaviour:
 *   - When `isPilotEnabled` returns FALSE for the caller's tenant the
 *     middleware short-circuits with 503 PILOT_PAUSED.
 *   - When `isPilotEnabled` returns TRUE the middleware falls through to
 *     the next handler.
 *   - When no tenant is bound on `c.get('auth')` we pass through — the
 *     route's own auth middleware will reject the call. The kill-switch
 *     is not an auth gate.
 *
 * The decision uses the canonical `isPilotEnabled` predicate from
 * `@borjie/feature-flags-adapter`, which encapsulates the precedence
 * (env emergency switch > DB flag > env opt-in > default OFF).
 */

import type { MiddlewareHandler } from 'hono';
import {
  isPilotEnabled,
  PILOT_KILL_SWITCH_RESPONSE,
  type PilotEnvSource,
} from '@borjie/feature-flags-adapter';
import type { FeatureFlagsPort } from '@borjie/feature-flags-adapter';
import { createLogger } from '../utils/logger.js';

const moduleLogger = createLogger('pilot-kill-switch');

/** Options for {@link pilotKillSwitch}. */
export interface PilotKillSwitchOptions {
  /**
   * Resolve the feature-flags adapter for the request. Default reads
   * `c.get('services').featureFlags` (the canonical accessor wired by
   * `service-context.middleware.ts`). When the registry is in degraded
   * mode the accessor returns null and the predicate falls back to env
   * vars — so degraded boots still behave correctly.
   */
  readonly resolveFlags?: (c: any) => FeatureFlagsPort | null;
  /**
   * Override the env source. Tests pass a plain record so they never
   * touch the host `process.env`.
   */
  readonly env?: PilotEnvSource;
  /**
   * Cohort label forwarded to the flag adapter. Defaults to the auth
   * context's `cohort` attribute when present.
   */
  readonly cohort?: string;
}

function defaultResolveFlags(c: any): FeatureFlagsPort | null {
  const services = c.get('services');
  const ff = services?.featureFlags;
  if (!ff || typeof ff.isEnabled !== 'function') {
    return null;
  }
  return ff as FeatureFlagsPort;
}

/**
 * Build a Hono middleware that gates pilot-tagged routes on the
 * pilot kill-switch. Default state when no signals are set is **OFF**
 * (the route returns 503) so a fresh environment never exposes pilot
 * surface by accident.
 */
export function pilotKillSwitch(
  options: PilotKillSwitchOptions = {},
): MiddlewareHandler {
  const resolveFlags = options.resolveFlags ?? defaultResolveFlags;

  return async (c, next) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string; cohort?: string }
      | undefined;
    const tenantId = auth?.tenantId;
    if (!tenantId) {
      // Auth middleware will reject; kill-switch never blocks auth-less calls.
      return next();
    }

    const featureFlags = resolveFlags(c);
    const cohort = options.cohort ?? auth?.cohort;

    const enabled = await isPilotEnabled(
      {
        tenantId,
        ...(auth?.userId !== undefined ? { userId: auth.userId } : {}),
        ...(cohort !== undefined ? { cohort } : {}),
      },
      {
        ...(featureFlags ? { featureFlags } : {}),
        ...(options.env ? { env: options.env } : {}),
      },
    );

    if (enabled) {
      return next();
    }

    moduleLogger.warn('pilot kill-switch tripped', {
      evt: 'pilot_kill_switch_tripped',
      tenantId,
      userId: auth?.userId ?? null,
      cohort: cohort ?? null,
      path: c.req.path,
      method: c.req.method,
    });

    return c.json(PILOT_KILL_SWITCH_RESPONSE, 503);
  };
}

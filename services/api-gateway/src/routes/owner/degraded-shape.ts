/**
 * Shared "degraded skeleton" helper for owner-scoped routes that the
 * owner-portal calls but whose backing services are not yet wired.
 *
 * Wave-2 commit 0ee27a0 converted ten owner-portal pages to render a
 * `MissingBackendNotice` component, each declaring a precise endpoint
 * the gateway is expected to expose. Wave-4 D6 scaffolds those routes
 * so the front-end stops 404'ing while the underlying services are
 * still being designed.
 *
 * Contract:
 *   - HTTP 200 with `{ success: true, data: [], meta: {...} }`
 *   - `X-Backend-Status: degraded` header (so observability dashboards
 *     and operators can detect the gap without parsing the body).
 *   - `meta.degradedReason: 'not_implemented'` (machine-readable signal).
 *   - `meta.concreteNextStep: <string>` describing the DB tables /
 *     services that need to be wired before the endpoint goes live.
 *   - `meta.tenantId` so logs/queries can confirm tenant-isolation was
 *     enforced even when the response body is empty.
 *
 * Immutability: every helper here returns a brand-new object per call;
 * no shared shape is mutated.
 */

import type { Context } from 'hono';

export const DEGRADED_HEADER = 'X-Backend-Status';
export const DEGRADED_VALUE = 'degraded';
export const DEGRADED_REASON = 'not_implemented';

export type DegradedListPayload = {
  success: true;
  data: ReadonlyArray<unknown>;
  meta: {
    degradedReason: typeof DEGRADED_REASON;
    concreteNextStep: string;
    tenantId: string;
  };
};

export type DegradedObjectPayload<T extends Record<string, unknown>> = {
  success: true;
  data: T & {
    meta: {
      degradedReason: typeof DEGRADED_REASON;
      concreteNextStep: string;
      tenantId: string;
    };
  };
};

/**
 * Build an empty list-shaped degraded payload.
 *
 * @param tenantId          tenant the call was scoped to (must come from
 *                          the auth context, never from the body).
 * @param concreteNextStep  one-line description of the work that needs to
 *                          land before this endpoint can serve real data.
 */
export function buildDegradedList(
  tenantId: string,
  concreteNextStep: string,
): DegradedListPayload {
  return {
    success: true,
    data: [],
    meta: {
      degradedReason: DEGRADED_REASON,
      concreteNextStep,
      tenantId,
    },
  };
}

/**
 * Build a degraded payload for endpoints that return a single object
 * (e.g. `/billing/subscription`). The supplied `data` shape is preserved
 * and a `meta` block is merged in. Caller owns the empty-state defaults.
 */
export function buildDegradedObject<T extends Record<string, unknown>>(
  tenantId: string,
  concreteNextStep: string,
  data: T,
): DegradedObjectPayload<T> {
  return {
    success: true,
    data: {
      ...data,
      meta: {
        degradedReason: DEGRADED_REASON,
        concreteNextStep,
        tenantId,
      },
    },
  };
}

/**
 * Set the `X-Backend-Status: degraded` header on a Hono response.
 * Centralised so we never typo the header name.
 */
export function markDegraded(c: Context): void {
  c.header(DEGRADED_HEADER, DEGRADED_VALUE);
}

/**
 * Build a `501 Not Implemented` envelope for an endpoint whose downstream
 * service has not been wired into the api-gateway composition root yet.
 *
 * Loud-failure pattern: a 501 forces the caller to either (a) flip the
 * feature flag on (operator-confirmed dev mode) or (b) wait for the real
 * wire. The previous behaviour (silent empty array) hid the gap from
 * observability dashboards and confused operators who reasonably
 * believed an empty response meant the tenant had no data.
 */
export function notImplementedFlagged(
  c: Context,
  flagKey: string,
  concreteNextStep: string,
): Response {
  c.header(DEGRADED_HEADER, DEGRADED_VALUE);
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          `Downstream service for this endpoint is not wired. Concrete next-step: ${concreteNextStep}`,
        flagKey,
      },
    },
    501 as never,
  );
}

/**
 * Resolve a feature flag from the service context, defaulting to OFF
 * when the flag service is unavailable. Off → fall through to 501.
 */
export async function isFlagOn(
  c: Context,
  flagKey: string,
): Promise<boolean> {
  const services = (c as unknown as { get: (k: string) => any }).get('services') ?? {};
  const ff = services.featureFlags;
  if (!ff || typeof ff.isEnabled !== 'function') return false;
  try {
    const auth = (c as unknown as { get: (k: string) => any }).get('auth');
    const tenantId = auth?.tenantId ?? '';
    return Boolean(await ff.isEnabled(tenantId, flagKey));
  } catch {
    return false;
  }
}

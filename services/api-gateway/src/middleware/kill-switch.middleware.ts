// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: same
// workaround used by `capability-gate.ts` and `hono-auth.ts`. The 503 branch
// widens the response union enough that the TypedResponse overload rejects
// the unified return type. Tracked at hono-dev/hono#3891.

/**
 * Kill-switch middleware — closes a multi-way valve on the platform's
 * highest-risk irreversible mutations:
 *
 *   - eviction                 → POST /leases/:id/terminate
 *   - payment-reversal         → POST /payments + POST /payments/:id/process
 *   - account-deletion         → POST /gdpr/delete-request + .../execute
 *   - refund                   → POST /move-out/:leaseId/finalize
 *   - data-export              → GET  /dsar/:subjectId/export
 *   - monthly-close-reverse    → POST /monthly-close/trigger
 *   - sublease-cancel          → POST /sublease/:id/revoke
 *   - sovereign-ledger-override → POST /admin/sovereign-ledger/verify
 *
 * Surfaced in `.audit/deep-audit-2026-05-20.md`: the feature-flags service
 * was wired into `c.get('services').featureFlags` but no route group was
 * actually consulting it. A single misconfigured deploy, ABAC bug, or
 * compromised admin session could fire one of these endpoints with no
 * blast-radius cap. This middleware closes that gap.
 *
 * Design:
 *
 *   1. Each guarded operation maps to a snake_case feature-flag key
 *      (the service validator enforces `/^[a-z][a-z0-9_]*$/` — `:` and `-`
 *      are rejected). Flags default OFF (FALSE) — the migration seeds them
 *      so they show up in operator listings.
 *
 *   2. When a flag is ON for the caller's tenant, the middleware short-
 *      circuits with a structured 503 envelope so callers (UI, integrations)
 *      can distinguish "policy fired" from "service down". Audit log is
 *      written before the response so operators always see who tripped
 *      the wire.
 *
 *   3. When the flag is OFF (or unknown — service returns FALSE), the
 *      middleware passes through. Unknown-flag is treated as "safe" rather
 *      than "fail closed" because the seed migration may not yet have
 *      run in a sandbox; production deploys see seeded values.
 *
 *   4. The feature-flags service is read off `c.get('services').featureFlags`
 *      — the canonical accessor wired by `service-context.middleware.ts`.
 *      When the registry is in degraded mode (no DB) the accessor is null
 *      and the guard passes through (no flag → no kill).
 *
 *   5. Flag-lookup ERRORS fail CLOSED in production (DA1 HIGH finding):
 *      a DB outage, RLS denial, or transient network blip MUST NOT silently
 *      bypass the kill-switch on irreversible ops. Production returns
 *      503 `KILL_SWITCH_LOOKUP_FAILED`. Dev/test keep fail-open with a
 *      structured WARN so local-loop iteration stays fast.
 *
 * Tests in `__tests__/kill-switch.middleware.test.ts`:
 *   - flag OFF  → next() called, handler runs, 200
 *   - flag ON   → 503 with `KILL_SWITCH_ACTIVE`, audit emitted
 *   - svc null  → pass-through (degraded mode)
 *   - lookup throws + prod → 503 KILL_SWITCH_LOOKUP_FAILED
 *   - lookup throws + dev  → pass-through + WARN
 */

import type { MiddlewareHandler } from 'hono';
import { createLogger } from '../utils/logger.js';

// DA1 MEDIUM: replace ad-hoc `console.warn(JSON.stringify(...))` fallbacks
// with the project's structured logger so kill-switch audit-fallbacks
// and lookup-failure warnings flow through the same log pipeline (and
// scrubber) as every other middleware. Tenant ID is always passed in
// the meta bag so SRE can correlate per-tenant.
const moduleLogger = createLogger('kill-switch');

/**
 * Kill-switch operation identifiers. Adding a new operation requires:
 *   1. Add it to this union
 *   2. Add a row to `KILL_SWITCH_FLAG_KEYS`
 *   3. Seed the row in the feature_flags migration
 *   4. Apply the middleware to the route
 */
export type KillSwitchOperation =
  | 'eviction'
  | 'payment-reversal'
  | 'account-deletion'
  | 'refund'
  | 'data-export'
  | 'monthly-close-reverse'
  | 'sublease-cancel'
  | 'sovereign-ledger-override';

/**
 * Operation → feature-flag key. snake_case to satisfy the service-layer
 * validator `/^[a-z][a-z0-9_]*$/`.
 */
export const KILL_SWITCH_FLAG_KEYS: Readonly<
  Record<KillSwitchOperation, string>
> = Object.freeze({
  eviction: 'killswitch_eviction',
  'payment-reversal': 'killswitch_payment_reversal',
  'account-deletion': 'killswitch_account_deletion',
  refund: 'killswitch_refund',
  'data-export': 'killswitch_data_export',
  'monthly-close-reverse': 'killswitch_monthly_close_reverse',
  'sublease-cancel': 'killswitch_sublease_cancel',
  'sovereign-ledger-override': 'killswitch_sovereign_ledger_override',
});

/**
 * Shape of the feature-flags service accessed via `c.get('services')`.
 * Mirrors the production `FeatureFlagsService` in
 * `@borjie/domain-services/feature-flags` so we can keep this middleware
 * free of a hard dependency on that package (avoids a circular import
 * between api-gateway middleware and domain-services).
 */
export interface KillSwitchFeatureFlagsLike {
  isEnabled(tenantId: string, flagKey: string): Promise<boolean>;
}

/**
 * Audit-emitter shape. We accept a narrow function instead of the full
 * `AuditLogger` so tests can inject a recorder without standing up the
 * whole observability bootstrap.
 */
export interface KillSwitchAuditEmitter {
  (event: KillSwitchAuditEvent): Promise<void> | void;
}

/**
 * Audit payload emitted when a kill-switch fires. Routed through the
 * observability audit log so operators see a clear breadcrumb trail
 * ("we blocked this attempt, here's who tried it").
 */
export interface KillSwitchAuditEvent {
  readonly operation: KillSwitchOperation;
  readonly flagKey: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly path: string;
  readonly method: string;
  readonly timestampMs: number;
}

export interface KillSwitchGuardOptions {
  /**
   * Override the feature-flags accessor. Default: read from
   * `c.get('services').featureFlags`.
   */
  readonly resolveFlags?: (c: any) => KillSwitchFeatureFlagsLike | null;
  /**
   * Override the audit emitter. Default: lazy-resolves
   * `getAuditLogger()` from `@borjie/observability`, falls back to a
   * structured `console.warn` if the logger has not been initialized
   * (tests, degraded boot).
   */
  readonly emitAudit?: KillSwitchAuditEmitter;
}

/**
 * Default flag accessor. Reads the `featureFlags` service off the request
 * context's `services` bag, which is populated by
 * `createServiceContextMiddleware`.
 */
function defaultResolveFlags(
  c: any,
): KillSwitchFeatureFlagsLike | null {
  const services = c.get('services');
  const ff = services?.featureFlags;
  if (!ff || typeof ff.isEnabled !== 'function') return null;
  return ff as KillSwitchFeatureFlagsLike;
}

/**
 * Default audit emitter. Lazy-imports the observability package so the
 * middleware can be unit-tested without standing up an audit store.
 * If the audit logger has not been initialised (i.e. boot ran without
 * `initAuditLogger`), we fall back to `console.warn` with the structured
 * payload so the breadcrumb is never lost.
 */
async function defaultEmitAudit(event: KillSwitchAuditEvent): Promise<void> {
  try {
    // Dynamic import keeps this middleware loadable in tests that don't
    // pull the observability package's full surface into the dep graph.
    const obs: typeof import('@borjie/observability') = await import(
      '@borjie/observability'
    );
    const logger = obs.getAuditLogger();
    await logger
      .event(obs.AuditCategory.SYSTEM, 'KILL_SWITCH_FIRED')
      .describe(
        `Kill-switch blocked ${event.operation} on ${event.method} ${event.path}`,
      )
      .denied('Kill-switch active for tenant')
      .severity(obs.AuditSeverity.CRITICAL)
      .bySystem('kill-switch-middleware')
      .on('FeatureFlag', event.flagKey, event.operation)
      .inTenant(event.tenantId)
      .metadata({
        operation: event.operation,
        flagKey: event.flagKey,
        userId: event.userId,
        path: event.path,
        method: event.method,
      })
      .record();
  } catch (err) {
    // DA1 MEDIUM: route the audit-store-down fallback through the
    // project's structured logger (same pipeline + scrubber every other
    // middleware uses) instead of a bare `console.warn(JSON.stringify)`.
    // The `evt` discriminator stays so log queries can still find it.
    moduleLogger.warn('kill-switch audit fallback', {
      evt: 'kill_switch_fired_audit_fallback',
      operation: event.operation,
      flagKey: event.flagKey,
      tenantId: event.tenantId,
      userId: event.userId,
      path: event.path,
      method: event.method,
      timestampMs: event.timestampMs,
      reason:
        err instanceof Error ? err.message : 'audit logger unavailable',
    });
  }
}

/**
 * Build a Hono middleware that blocks a request when the kill-switch
 * for `operation` is enabled for the caller's tenant.
 *
 * The middleware is intentionally tolerant of degraded modes:
 *   - no `auth` context  → pass-through (the route's own auth middleware
 *                          will reject; kill-switch is not an auth gate)
 *   - no flags service   → pass-through (degraded boot, no DB)
 *   - flag lookup throws + prod → 503 KILL_SWITCH_LOOKUP_FAILED
 *                                 (fail closed — DA1 HIGH finding)
 *   - flag lookup throws + dev  → pass-through + WARN
 *   - flag is TRUE       → 503 KILL_SWITCH_ACTIVE + audit log
 *   - flag is FALSE/UNK  → pass-through
 */
export function killSwitchGuard(
  operation: KillSwitchOperation,
  options: KillSwitchGuardOptions = {},
): MiddlewareHandler {
  const flagKey = KILL_SWITCH_FLAG_KEYS[operation];
  if (!flagKey) {
    throw new Error(
      `killSwitchGuard: unknown operation "${String(operation)}"`,
    );
  }
  const resolveFlags = options.resolveFlags ?? defaultResolveFlags;
  const emitAudit = options.emitAudit ?? defaultEmitAudit;

  return async (c, next) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string }
      | undefined;
    const tenantId = auth?.tenantId;
    if (!tenantId) {
      // The route's auth middleware will reject this anyway. We don't
      // gate on missing tenant — the kill-switch is a per-tenant
      // operator lever, not an auth check.
      return next();
    }

    const flags = resolveFlags(c);
    if (!flags) {
      // Degraded boot: no flag service wired. Pass-through so the
      // platform stays operational; operators see a NOT_IMPLEMENTED
      // signal elsewhere (the feature-flags router itself returns 503
      // when the service is missing).
      return next();
    }

    let enabled = false;
    try {
      enabled = Boolean(await flags.isEnabled(tenantId, flagKey));
    } catch (err) {
      // DA1 HIGH finding: previously this branch silently returned next()
      // and bypassed the kill-switch on any DB blip / RLS denial / network
      // hiccup. That undid the load-bearing safety property — a single
      // transient outage could let a compromised admin slip an eviction /
      // refund / sovereign-ledger override through unguarded.
      //
      // Production: fail CLOSED with 503 KILL_SWITCH_LOOKUP_FAILED so the
      // caller knows policy state is indeterminate and the platform won't
      // commit the irreversible mutation.
      //
      // Dev/test: keep fail-open with a structured WARN so the local-loop
      // iteration stays fast (no DB needed to test a route).
      const reason = err instanceof Error ? err.message : 'unknown';
      // DA1 MEDIUM: structured logger (was bare console.warn). Tenant-
      // scoped meta so the SRE search "evt=kill_switch_flag_lookup_failed"
      // surfaces every affected tenant.
      moduleLogger.warn('kill-switch flag lookup failed', {
        evt: 'kill_switch_flag_lookup_failed',
        operation,
        flagKey,
        tenantId,
        reason,
      });

      if (process.env.NODE_ENV === 'production') {
        return c.json(
          {
            success: false,
            error: {
              code: 'KILL_SWITCH_LOOKUP_FAILED',
              operation,
              flagKey,
              message:
                'Cannot verify kill-switch state for this operation. ' +
                'The platform is refusing the request fail-closed; ' +
                'retry once the feature-flag service recovers.',
            },
          },
          503,
        );
      }
      return next();
    }

    if (!enabled) {
      return next();
    }

    const event: KillSwitchAuditEvent = {
      operation,
      flagKey,
      tenantId,
      userId: auth?.userId ?? null,
      path: c.req.path,
      method: c.req.method,
      timestampMs: Date.now(),
    };

    // Fire-and-forget the audit emission — but `await` it so we don't
    // race the response. The emitter has its own internal fallback so
    // it never throws.
    try {
      await emitAudit(event);
    } catch {
      // emitAudit has its own fallback; if it still throws we still
      // serve the 503. Swallowing here keeps the kill-switch the
      // load-bearing path.
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'KILL_SWITCH_ACTIVE',
          operation,
          flagKey,
          message:
            'This operation is temporarily disabled by a platform safety switch. ' +
            'Contact your tenant administrator or platform operator to re-enable it.',
        },
      },
      503,
    );
  };
}

/**
 * Re-export the flag-key set so the seed-migration generator and any
 * admin tooling can iterate the canonical list without re-declaring it.
 */
export const ALL_KILL_SWITCH_FLAG_KEYS: readonly string[] = Object.freeze(
  Object.values(KILL_SWITCH_FLAG_KEYS),
);

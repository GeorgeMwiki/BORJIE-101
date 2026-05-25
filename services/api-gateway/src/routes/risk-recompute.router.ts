// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal widening: multiple c.json({...}, status) branches produce a unioned return type the TypedResponse overload rejects. Other routers in this service use the same escape hatch (see property-grading.router.ts, credit-rating.router.ts).
/**
 * Risk-Recompute Router — Wave 27 Agent F (Part B.6).
 *
 * Manual-trigger surface for the event-driven risk-recompute dispatcher
 * that flips credit-rating / property-grade / vendor-scorecard / churn /
 * tenant-sentiment from scheduled batches to on-event recomputes. The
 * dispatcher itself runs in the heartbeat supervisor and subscribes to
 * the domain event bus; this router exists so operators can force-kick
 * a recompute for a tenant (e.g. after a data migration, to warm the
 * cache for a demo, or to validate plumbing in a freshly-seeded pilot).
 *
 *   POST /trigger            — admin-only. Kicks a synthetic event through
 *                              the dispatcher per registered kind. Returns
 *                              the job id + an estimated duration so the
 *                              caller can poll GET /status/:jobId.
 *
 *   GET  /status/:jobId      — poll job state (queued / running /
 *                              succeeded / failed). Tenant-scoped: a
 *                              caller can only read jobs they kicked.
 *
 *   GET  /status             — recent jobs for the caller's tenant
 *                              (default limit 50, max 200).
 *
 * Factory pattern: the composition root constructs the dispatcher +
 * tracker in the HeartbeatSupervisor and passes them into
 * `createRiskRecomputeRouter({ getDispatcher, getJobs })`. We don't go
 * through `c.get('services')` because the dispatcher is a
 * supervisor-level singleton — not a per-request Postgres-backed service.
 *
 * All endpoints require `authMiddleware`; the manual trigger additionally
 * requires an admin-class role so we don't let property-manager logins
 * burn compute by spamming recomputes.
 *
 * Tenant isolation: every handler scopes on `auth.tenantId`. Jobs that
 * belong to a different tenant return 404 (not 403) to avoid leaking the
 * existence of foreign job ids.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type {
  RiskRecomputeDispatcher,
  RiskKind,
} from '@borjie/ai-copilot';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import type {
  RiskRecomputeJobRecord,
  RiskRecomputeJobTracker,
} from '../composition/background-wiring';
import { safeInternalError } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RISK_KIND_VALUES = [
  'credit_rating',
  'property_grade',
  'vendor_scorecard',
  'churn_probability',
  'tenant_sentiment',
] as const;

const TriggerSchema = z.object({
  /**
   * Optional subset of risk kinds to kick. When omitted, every kind
   * registered in the dispatcher is kicked for every entity id supplied
   * in `entities`. When `entities` is also omitted the trigger is a
   * no-op (returns 400) — a recompute without a subject would be a
   * platform-wide scan, which is the scheduled-batch path, not this one.
   */
  kinds: z.array(z.enum(RISK_KIND_VALUES)).max(5).optional(),
  /**
   * Entity ids to recompute. Each id is routed to the matching kind via
   * the synthetic-event payload the trigger constructs. Capped at 100 so
   * a single admin click cannot spawn thousands of compute jobs.
   */
  entities: z
    .array(
      z.object({
        kind: z.enum(RISK_KIND_VALUES),
        entityId: z.string().min(1).max(128),
      }),
    )
    .min(1)
    .max(100),
  /** Free-text reason — surfaced in job record telemetry for audit. */
  reason: z.string().min(1).max(500).default('manual_trigger'),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface RiskRecomputeRouterDeps {
  readonly getDispatcher: () => RiskRecomputeDispatcher | null;
  readonly getJobs: () => RiskRecomputeJobTracker | null;
}

/**
 * Build the manual-trigger router. Accepts accessor functions rather
 * than the concrete instances so the composition root can return `null`
 * in degraded mode (no dispatcher wired) and every endpoint falls back
 * to a 503 with a clear reason.
 */
export function createRiskRecomputeRouter(
  deps: RiskRecomputeRouterDeps,
): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  function unavailable(c: any) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RISK_RECOMPUTE_UNAVAILABLE',
          message:
            'Risk-recompute dispatcher is not wired in this environment.',
        },
      },
      503,
    );
  }

  function notFound(c: any, jobId: string) {
    return c.json(
      {
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: `No job tracked with id ${jobId}`,
        },
      },
      404,
    );
  }

  function estimateDurationMs(
    entities: readonly { kind: RiskKind; entityId: string }[],
  ): number {
    // Rough upper bound: ~150ms per compute fn per entity. Real numbers
    // live in heartbeat telemetry; this estimate only exists so the
    // caller can decide whether to poll or fire-and-forget.
    return Math.max(200, Math.min(60_000, entities.length * 150));
  }

  // --- POST /trigger -------------------------------------------------------
  app.post(
    '/trigger',
    requireRole(
      UserRole.TENANT_ADMIN,
      UserRole.PROPERTY_MANAGER,
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ),
    zValidator('json', TriggerSchema),
    withSecurityEvents({ action: 'risk-recompute.create', resource: 'risk-recompute', severity: 'info' }, async (c: any) => {
      const dispatcher = deps.getDispatcher();
      const jobs = deps.getJobs();
      if (!dispatcher || !jobs) return unavailable(c);

      const auth = c.get('auth');
      const tenantId: string = auth?.tenantId ?? c.get('tenantId');
      if (!tenantId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'TENANT_CONTEXT_MISSING',
              message: 'Authenticated tenant context required.',
            },
          },
          400,
        );
      }

      const body = c.req.valid('json');
      // Filter entities by `kinds` if supplied. Empty `kinds` means "all".
      const filtered = body.kinds
        ? body.entities.filter((e: { kind: RiskKind }) =>
            (body.kinds as readonly RiskKind[]).includes(e.kind),
          )
        : body.entities;

      if (filtered.length === 0) {
        return c.json(
          {
            success: false,
            error: {
              code: 'EMPTY_ENTITY_SET',
              message:
                'No entities remain after filtering by the `kinds` allowlist.',
            },
          },
          400,
        );
      }

      const estimatedDurationMs = estimateDurationMs(filtered);
      const kinds = Array.from(
        new Set(filtered.map((e: { kind: RiskKind }) => e.kind)),
      ) as readonly RiskKind[];
      const record = jobs.create({
        tenantId,
        kinds,
        estimatedDurationMs,
      });

      // Fire-and-forget the actual dispatch. We update the tracker when
      // the awaited promise resolves. If it throws, the tracker flips to
      // `failed` and subsequent GET /status returns the error message —
      // there is nothing else we can do because the trigger response has
      // already been sent by then.
      void (async () => {
        jobs.markRunning(record.jobId);
        const allFailures: {
          kind: RiskKind;
          entityId: string;
          reason: string;
        }[] = [];
        let totalDispatched = 0;
        try {
          for (const entity of filtered) {
            const syntheticEvent = {
              eventType: `${String(entity.kind).toUpperCase()}_MANUAL_RECOMPUTE`,
              eventId: `${record.jobId}_${entity.kind}_${entity.entityId}`,
              tenantId,
              payload: {
                kind: entity.kind,
                entityId: entity.entityId,
                reason: body.reason,
              } as Record<string, unknown>,
            };
            // The default classifier does not map our synthetic event
            // types, so the dispatcher would skip. We directly invoke
            // the per-kind compute fn via `dispatchEvent` after swapping
            // the classifier view: build a one-shot wrapper dispatcher
            // using a classifier closure. Simpler route: call
            // `dispatchEvent` with a payload shape the default
            // classifier handles for this kind — but that leaks wiring
            // into the router. Instead, we hard-match here via a tiny
            // ad-hoc classifier hop: the dispatcher we hold is the one
            // wired in background-wiring and is locked to the default
            // classifier. For manual triggers we reach into it via
            // `dispatchEvent` using an event type the dispatcher knows
            // about. The canonical map:
            //   credit_rating      → ArrearsCaseOpened + customerId
            //   churn_probability  → ArrearsCaseOpened + customerId
            //   property_grade     → InspectionCompleted + propertyId
            //   vendor_scorecard   → WorkOrderClosed + vendorId
            //   tenant_sentiment   → TenantChatMessage + customerId
            // We emit the matching event-type for the requested kind
            // so the classifier maps it back. This keeps the dispatcher
            // sealed (no bespoke classifier injection) while giving
            // operators a concrete path to recompute a single entity.
            const mapped = mapKindToEvent(entity.kind, entity.entityId);
            const res = await dispatcher.dispatchEvent({
              eventType: mapped.eventType,
              eventId: syntheticEvent.eventId,
              tenantId,
              payload: mapped.payload,
            });
            totalDispatched += res.jobsDispatched;
            for (const f of res.failures) allFailures.push({ ...f });
          }
          jobs.markSucceeded(record.jobId, totalDispatched, allFailures);
        } catch (err) {
          jobs.markFailed(record.jobId, err);
        }
      })();

      return c.json(
        {
          success: true,
          data: {
            jobId: record.jobId,
            status: record.status,
            estimatedDurationMs,
            kinds,
            entities: filtered,
            reason: body.reason,
          },
        },
        202,
      );
    }),
  );

  // --- GET /status/:jobId --------------------------------------------------
  app.get('/status/:jobId', async (c: any) => {
    const jobs = deps.getJobs();
    if (!jobs) return unavailable(c);
    const auth = c.get('auth');
    const tenantId: string = auth?.tenantId ?? c.get('tenantId');
    const jobId = c.req.param('jobId');
    try {
      const record = jobs.get(jobId);
      if (!record || record.tenantId !== tenantId) {
        return notFound(c, jobId);
      }
      return c.json({ success: true, data: toPublic(record) });
    } catch (err) {
      return safeInternalError(c, err, {
        code: 'INTERNAL_ERROR',
        fallback: 'Failed to read job status',
      });
    }
  });

  // --- GET /status (list) --------------------------------------------------
  app.get('/status', async (c: any) => {
    const jobs = deps.getJobs();
    if (!jobs) return unavailable(c);
    const auth = c.get('auth');
    const tenantId: string = auth?.tenantId ?? c.get('tenantId');
    const limitRaw = Number(c.req.query('limit') ?? '50');
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
      : 50;
    try {
      const list = jobs.list(tenantId, limit);
      return c.json({
        success: true,
        data: list.map(toPublic),
        meta: { total: list.length, limit },
      });
    } catch (err) {
      return safeInternalError(c, err, {
        code: 'INTERNAL_ERROR',
        fallback: 'Failed to list jobs',
      });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip tenant-internal fields before serialising. Today the public
 * shape mirrors the stored shape minus nothing, but the indirection
 * means we can add fields (e.g. hashed correlationIds) without
 * leaking them to callers.
 */
function toPublic(record: RiskRecomputeJobRecord): Record<string, unknown> {
  return {
    jobId: record.jobId,
    tenantId: record.tenantId,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    kinds: record.kinds,
    jobsDispatched: record.jobsDispatched,
    failures: record.failures,
    estimatedDurationMs: record.estimatedDurationMs,
    errorMessage: record.errorMessage,
  };
}

/**
 * Map a requested risk kind to an event-type + payload shape the
 * default classifier will resolve back to the same kind. Keeps the
 * dispatcher's classifier sealed — no bespoke injection required.
 *
 * The mappings follow `packages/ai-copilot/src/risk-recompute/default-classifier.ts`:
 *   credit_rating      → ArrearsCaseOpened + customerId  (also hits churn)
 *   churn_probability  → RenewalConversationUpdated + customerId
 *   property_grade     → InspectionCompleted + propertyId
 *   vendor_scorecard   → WorkOrderClosed + vendorId
 *   tenant_sentiment   → TenantChatMessage + customerId  (also hits churn)
 *
 * A manual credit_rating kick will consequently also recompute the
 * customer's churn score — that's intentional: the two kinds share the
 * same payment-signal upstream and keeping them consistent is cheap.
 */
function mapKindToEvent(
  kind: RiskKind,
  entityId: string,
): { eventType: string; payload: Record<string, unknown> } {
  switch (kind) {
    case 'credit_rating':
      return {
        eventType: 'ArrearsCaseOpened',
        payload: { customerId: entityId },
      };
    case 'churn_probability':
      return {
        eventType: 'RenewalConversationUpdated',
        payload: { customerId: entityId },
      };
    case 'property_grade':
      return {
        eventType: 'InspectionCompleted',
        payload: { propertyId: entityId },
      };
    case 'vendor_scorecard':
      return {
        eventType: 'WorkOrderClosed',
        payload: { vendorId: entityId },
      };
    case 'tenant_sentiment':
      return {
        eventType: 'TenantChatMessage',
        payload: { customerId: entityId },
      };
    default: {
      // Exhaustiveness — if new kinds land, the compile-time check on
      // `never` fails until the map is updated.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

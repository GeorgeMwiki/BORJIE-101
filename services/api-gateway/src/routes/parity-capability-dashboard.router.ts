/**
 * Parity capability dashboard router — Wave-K (parity-litfin).
 *
 * Mounted at `/api/v1/parity/capability/dashboard`. Mirrors LITFIN's
 * `GET /api/parity/capability/dashboard` (see
 * `Docs/parity-tests/capability/results/`). Aggregates over
 * `kernel_provenance` + `kernel_cot_reservoir` so admin operators can:
 *
 *   GET  /dashboard                       — top-level capability tile
 *   GET  /dashboard/runs                  — list eval runs (filterable)
 *   GET  /dashboard/runs/:thoughtId       — drill into one captured CoT
 *   POST /dashboard/runs/:thoughtId/judge — re-judge a captured run
 *
 * Capability filter values mirror the property-management surface set
 * (rent reconciliation, lease renewal, KRA MRI, GePG, maintenance
 * triage, voice agent). They are mapped to scenario-id prefixes that
 * already exist in `packages/central-intelligence/__tests__/eval/
 * scenarios.ts` so this is a UI-side filter, not a new tag set.
 *
 * Read endpoints: SUPER_ADMIN / ADMIN / TENANT_ADMIN.
 * POST /dashboard/runs/:thoughtId/judge: SUPER_ADMIN / ADMIN only (sovereign,
 * cost-bearing — also rate-limited + audit-emitted, see endpoint comment).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { customRateLimit } from '../middleware/rate-limiter';
import { UserRole } from '../types/user-role';
import { safeInternalError } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
type AnyCtx = any;

// ─────────────────────────────────────────────────────────────────────
// Property-management capabilities. Each maps to a scenario-id-prefix
// matcher so the dashboard can carve the 222 + 87 corpus into the
// business-surface buckets a property-ops operator thinks in.
// ─────────────────────────────────────────────────────────────────────

const CAPABILITIES = [
  'rent-reconciliation',
  'lease-renewal',
  'kra-mri',
  'gepg',
  'maintenance-triage',
  'voice-agent',
] as const;

const CAPABILITY_PREFIXES: Record<(typeof CAPABILITIES)[number], ReadonlyArray<string>> = {
  'rent-reconciliation': ['finance.', 'tenant.payment', 'arrears.', 'recon.'],
  'lease-renewal': ['lease.', 'renewal.', 'tenant.renew', 'leasing.'],
  'kra-mri': ['compliance.kra', 'tax.', 'mri.'],
  'gepg': ['gepg.', 'gov.payment', 'public.bill'],
  'maintenance-triage': ['maintenance.', 'workorder.', 'triage.'],
  'voice-agent': ['voice.', 'call.', 'ivr.', 'whatsapp.voice'],
};

const RunsQuerySchema = z.object({
  capability: z.enum(CAPABILITIES).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  maxScore: z.coerce.number().min(0).max(1).optional(),
  category: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const RejudgeBodySchema = z.object({
  /**
   * Optional override text. When omitted, the router asks the
   * substrate service for the cached CoT thoughtText and re-runs the
   * judge against that.
   */
  draft: z.string().min(1).max(20_000).optional(),
});

function getServices(c: AnyCtx) {
  const services = c.get('services') ?? {};
  return services;
}

function unavailable(c: AnyCtx, reason: string) {
  return c.json(
    {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: reason },
    },
    503,
  );
}

function badRequest(c: AnyCtx, message: string) {
  return c.json(
    { success: false, error: { code: 'BAD_REQUEST', message } },
    400,
  );
}

function internalError(c: AnyCtx, err: unknown) {
  return safeInternalError(c, err, {
    code: 'INTERNAL_ERROR',
    fallback: 'Internal server error',
  });
}

export const parityCapabilityDashboardRouter = new Hono();
parityCapabilityDashboardRouter.use('*', authMiddleware);
parityCapabilityDashboardRouter.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN),
);

// ─────────────────────────────────────────────────────────────────────
// GET /dashboard — top-level rollup card.
// ─────────────────────────────────────────────────────────────────────

parityCapabilityDashboardRouter.get('/dashboard', async (c: AnyCtx) => {
  const services = getServices(c);
  const auth = c.get('auth');
  const dashboard = services.parityCapabilityDashboard;
  if (!dashboard) {
    // Degraded mode: surface a zeroed payload so the UI can render.
    return c.json({
      success: true,
      data: {
        capabilities: CAPABILITIES.map((id) => ({
          id,
          runsLast24h: 0,
          meanJudgeScore: null,
          regenRateLast24h: null,
        })),
        totals: { provenanceCount: 0, cotSampleCount: 0 },
        generatedAt: new Date().toISOString(),
        degraded: true,
      },
    });
  }
  try {
    const payload = await dashboard.getRollup(auth.tenantId, {
      capabilities: CAPABILITIES,
      capabilityPrefixes: CAPABILITY_PREFIXES,
    });
    return c.json({ success: true, data: payload });
  } catch (e) {
    return internalError(c, e);
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /dashboard/runs — filterable list of captured eval runs.
// ─────────────────────────────────────────────────────────────────────

parityCapabilityDashboardRouter.get('/dashboard/runs', async (c: AnyCtx) => {
  const services = getServices(c);
  const dashboard = services.parityCapabilityDashboard;
  if (!dashboard) return unavailable(c, 'parity-capability-dashboard not wired');
  const auth = c.get('auth');
  const parsed = RunsQuerySchema.safeParse({
    capability: c.req.query('capability'),
    minScore: c.req.query('minScore'),
    maxScore: c.req.query('maxScore'),
    category: c.req.query('category'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) return badRequest(c, parsed.error.message);
  const filters = parsed.data;
  if (
    filters.minScore !== undefined &&
    filters.maxScore !== undefined &&
    filters.minScore > filters.maxScore
  ) {
    return badRequest(c, 'minScore must be ≤ maxScore');
  }
  try {
    const result = await dashboard.listRuns(auth.tenantId, {
      capability: filters.capability,
      capabilityPrefixes: filters.capability
        ? CAPABILITY_PREFIXES[filters.capability]
        : undefined,
      minScore: filters.minScore,
      maxScore: filters.maxScore,
      category: filters.category,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    });
    return c.json({
      success: true,
      data: result.runs,
      meta: {
        total: result.total,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      },
    });
  } catch (e) {
    return internalError(c, e);
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /dashboard/runs/:thoughtId — drill into one captured run.
// ─────────────────────────────────────────────────────────────────────

parityCapabilityDashboardRouter.get('/dashboard/runs/:thoughtId', async (c: AnyCtx) => {
  const services = getServices(c);
  const dashboard = services.parityCapabilityDashboard;
  if (!dashboard) return unavailable(c, 'parity-capability-dashboard not wired');
  const auth = c.get('auth');
  const thoughtId = c.req.param('thoughtId');
  if (!thoughtId) return badRequest(c, 'thoughtId required');
  try {
    const run = await dashboard.getRun(auth.tenantId, thoughtId);
    if (!run) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'run not found' } },
        404,
      );
    }
    return c.json({ success: true, data: run });
  } catch (e) {
    return internalError(c, e);
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /dashboard/runs/:thoughtId/judge — re-judge a captured run.
//
// Re-judge is sovereign and cost-bearing (re-runs the LLM-judge against a
// captured CoT). The router-level guard allows TENANT_ADMIN for read traffic,
// but rejudge is restricted to platform-level admins only (SUPER_ADMIN /
// ADMIN). A per-endpoint token-bucket rate-limit caps abuse: 5 calls per
// 10 minutes per (tenant + user) key. Each invocation also fires through
// the audit-trail recorder (`parity.rejudge`) so the action is permanently
// recorded in the hash-chain.
// ─────────────────────────────────────────────────────────────────────

const rejudgeRateLimit = customRateLimit({
  // 5 calls per 600 s window. Burst of 1 over the budget is acceptable —
  // anything beyond returns 429.
  maxRequests: 5,
  windowSizeSeconds: 600,
  keyGenerator: (c) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string } | undefined;
    return `parity:rejudge:${auth?.tenantId ?? 'unknown'}:${auth?.userId ?? 'unknown'}`;
  },
});

parityCapabilityDashboardRouter.post(
  '/dashboard/runs/:thoughtId/judge',
  // Override the router-level role gate — re-judge is platform-admin only.
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  rejudgeRateLimit,
  withSecurityEvents({ action: 'parity-capability-dashboard.create', resource: 'parity-capability-dashboard', severity: 'warn' }, async (c: AnyCtx) => {
    const services = getServices(c);
    const dashboard = services.parityCapabilityDashboard;
    if (!dashboard?.rejudge) {
      return unavailable(c, 'rejudge service is not wired in this environment');
    }
    const auth = c.get('auth');
    const thoughtId = c.req.param('thoughtId');
    if (!thoughtId) return badRequest(c, 'thoughtId required');
    const body = await c.req.json().catch(() => ({}));
    const parsed = RejudgeBodySchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.message);
    try {
      const verdict = await dashboard.rejudge(auth.tenantId, thoughtId, {
        draftOverride: parsed.data.draft,
      });
      // Best-effort audit-trail emission. The recorder shape mirrors
      // audit-trail.router.ts:152 — degraded gateways without an auditTrail
      // service slot simply skip the emission so the rejudge still returns.
      try {
        const auditPipeline = services.auditTrail;
        if (auditPipeline?.recorder?.record) {
          await auditPipeline.recorder.record({
            tenantId: auth.tenantId,
            actor: {
              kind: 'human_action',
              id: auth.userId ?? null,
              display: null,
            },
            actionKind: 'parity.rejudge',
            actionCategory: 'compliance',
            subject: {
              entityType: 'parity.thought',
              entityId: thoughtId,
              resourceUri: null,
            },
            ai: {
              attachments: {
                requestedBy: auth.userId ?? null,
                draftOverride: parsed.data.draft ? true : false,
              },
            },
          });
        }
      } catch {
        // Audit emission must never fail the action — rejudge is the primary
        // contract here. The audit chain has its own verify path that will
        // surface a missing entry on next consistency check.
      }
      return c.json({ success: true, data: verdict }, 201);
    } catch (e) {
      return internalError(c, e);
    }
  }),
);

export default parityCapabilityDashboardRouter;

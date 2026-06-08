/**
 * Research router — makes the deep-research engine reachable on demand.
 *
 * Mounted at `/api/v1/research`. Drives the `@borjie/research-orchestrator`
 * mode handlers end-to-end (planner → executor → scorer → synthesizer →
 * `INSERT INTO research_plans/steps/artifacts/results` + audit anchor):
 *
 *   POST /v1/research/reactive   — quick cited answer (Reactive Query mode)
 *   POST /v1/research/deep-dive  — multi-step deep dive (Deep Dive mode)
 *
 * Tenant id + actor id come from `c.get('auth')` (JWT-derived). The client
 * never supplies these in the request body — that would let a caller forge
 * a tenant. Bodies are zod-validated; only the `query`/`topic` text is
 * trusted from the client.
 *
 * Every route is state-changing (it persists plan/step/result rows) so each
 * is wrapped in `withSecurityEvents` for the SOC 2 audit trail (mirrors
 * `portal-genui.router.ts` / `ask.router.ts`; the api-gateway is a Hono app
 * so we use the Hono variant of the helper).
 *
 * The engine is read off `c.get('services').researchEngine` — the
 * composition root (`research-wiring.ts`) wires it. When the engine is
 * missing every route returns 503 with a config-missing code rather than
 * crashing.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import type { ResearchEngine } from '../../composition/research/research-wiring.js';

type AnyCtx = any;

function getServices(c: AnyCtx): Record<string, unknown> {
  return c.get('services') ?? {};
}

function getEngine(c: AnyCtx): ResearchEngine | undefined {
  return getServices(c).researchEngine as ResearchEngine | undefined;
}

function unavailable(c: AnyCtx, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, 503);
}

const ENGINE_MISSING = 'RESEARCH_ENGINE_MISSING';
const ENGINE_MISSING_MSG = 'research engine is not wired in this environment';

// ────────────────────────────────────────────────────────────────────
// Request schemas
// ────────────────────────────────────────────────────────────────────

const ReactiveBodySchema = z
  .object({
    query: z.string().min(1).max(4000),
    /**
     * Who triggered this. Defaults to `owner_explicit` (a human hit the
     * endpoint). `mr_mwikila` is set when the brain calls in-process. The
     * value never affects tenant scope.
     */
    createdBy: z.enum(['mr_mwikila', 'owner_explicit']).optional(),
  })
  .strict();

const DeepDiveBodySchema = z
  .object({
    query: z.string().min(1).max(4000),
    /** Short topic label for the persisted session row. */
    topic: z.string().min(1).max(200),
    /** Previously-acknowledged owner-confirm budget gates (USD dollars). */
    acknowledgedGatesUsd: z
      .array(z.number().nonnegative().max(10_000))
      .max(16)
      .optional(),
  })
  .strict();

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

const router = new Hono();
router.use('*', authMiddleware);

async function parseJsonBody(c: AnyCtx): Promise<unknown | symbol> {
  try {
    return await c.req.json();
  } catch {
    return PARSE_FAILED;
  }
}
const PARSE_FAILED = Symbol('parse_failed');

function badJson(c: AnyCtx) {
  return c.json(
    { success: false, error: { code: 'INVALID_JSON', message: 'invalid JSON body' } },
    400,
  );
}

function badRequest(c: AnyCtx, message: string) {
  return c.json({ success: false, error: { code: 'BAD_REQUEST', message } }, 400);
}

function missingTenant(c: AnyCtx) {
  return c.json(
    {
      success: false,
      error: {
        code: 'MISSING_TENANT_OR_USER',
        message: 'auth context missing tenantId/userId',
      },
    },
    401,
  );
}

// ─── POST /v1/research/reactive ────────────────────────────────
router.post(
  '/reactive',
  withSecurityEvents(
    {
      action: 'research.reactive',
      resource: 'research',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) return unavailable(c, ENGINE_MISSING, ENGINE_MISSING_MSG);

      const body = await parseJsonBody(c);
      if (body === PARSE_FAILED) return badJson(c);

      const parsed = ReactiveBodySchema.safeParse(body);
      if (!parsed.success) return badRequest(c, parsed.error.message);

      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) return missingTenant(c);

      try {
        const out = await engine.reactiveQuery(
          {
            tenantId: auth.tenantId,
            query: parsed.data.query,
            createdBy: parsed.data.createdBy ?? 'owner_explicit',
          },
          engine.deps,
        );
        return c.json({
          success: true,
          data: {
            planId: out.plan_id,
            status: out.status,
            result: {
              id: out.result.id,
              summaryMd: out.result.summary_md,
              confidence: out.result.confidence,
              citations: out.result.span_citations,
              disagreements: out.result.disagreements,
              auditHash: out.result.audit_hash,
              costUsdCents: out.result.total_cost_usd_cents,
              durationMs: out.result.total_duration_ms,
            },
          },
        });
      } catch (err) {
        return c.json(
          {
            success: false,
            error: {
              code: 'RESEARCH_FAILED',
              message: err instanceof Error ? err.message : 'unknown error',
            },
          },
          500,
        );
      }
    },
  ),
);

// ─── POST /v1/research/deep-dive ───────────────────────────────
router.post(
  '/deep-dive',
  withSecurityEvents(
    {
      action: 'research.deep-dive',
      resource: 'research',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) return unavailable(c, ENGINE_MISSING, ENGINE_MISSING_MSG);

      const body = await parseJsonBody(c);
      if (body === PARSE_FAILED) return badJson(c);

      const parsed = DeepDiveBodySchema.safeParse(body);
      if (!parsed.success) return badRequest(c, parsed.error.message);

      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) return missingTenant(c);

      try {
        const out = await engine.deepDive(
          {
            tenantId: auth.tenantId,
            query: parsed.data.query,
            topic: parsed.data.topic,
            createdBy: 'owner_explicit',
            ...(parsed.data.acknowledgedGatesUsd !== undefined
              ? { acknowledgedGatesUsd: parsed.data.acknowledgedGatesUsd }
              : {}),
          },
          engine.deps,
        );
        return c.json({
          success: true,
          data: {
            planId: out.plan_id,
            sessionId: out.session_id,
            status: out.status,
            ...(out.paused_reason ? { pausedReason: out.paused_reason } : {}),
            ...(out.result
              ? {
                  result: {
                    id: out.result.id,
                    summaryMd: out.result.summary_md,
                    confidence: out.result.confidence,
                    citations: out.result.span_citations,
                    disagreements: out.result.disagreements,
                    auditHash: out.result.audit_hash,
                    costUsdCents: out.result.total_cost_usd_cents,
                    durationMs: out.result.total_duration_ms,
                  },
                }
              : {}),
          },
        });
      } catch (err) {
        return c.json(
          {
            success: false,
            error: {
              code: 'RESEARCH_FAILED',
              message: err instanceof Error ? err.message : 'unknown error',
            },
          },
          500,
        );
      }
    },
  ),
);

export default router;

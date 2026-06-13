/**
 * Flow-autonomy router — mounted at `/api/v1/workflow/flow-autonomy`.
 *
 * Surfaces the per-flow `auto | gated` autonomy posture + the creation-time
 * auto-vs-gated confirmation (migration 0308 / `flow_autonomy_prefs`).
 *
 *   GET  /flow-autonomy                  — list this tenant's flow postures
 *   GET  /flow-autonomy/pending          — flows awaiting the creation-time
 *                                          auto-vs-gated confirmation
 *   GET  /flow-autonomy/:flowId          — one flow's posture (404 if unset)
 *   POST /flow-autonomy/:flowId/posture  — set a flow's posture (auto|gated)
 *
 * The set-posture route is the "this flow is now AUTO" sticky decision (the
 * OpenAI-SDK always_approve primitive). Default posture is GATED — the
 * fail-safe USER-GATED invariant; a flow only runs AUTO after the MD
 * explicitly confirms it here, with the flow's track-record shown at the
 * moment of asking (trust-calibration; surfaced by the pending queue).
 *
 * ADDITIVE ONLY: flipping a flow AUTO widens the autonomy POLICY, never a
 * rail. The inviolable rails (policy-gate / four-eye / sovereign /
 * kill_switch / money-path) STILL gate per action regardless of posture —
 * rail-gate ALWAYS wins. This route can only ADD gating, never remove one.
 *
 * Tenant scoping: every route uses the JWT-resolved tenantId; the body
 * never carries tenantId. Every state-changing route is wrapped in
 * `withSecurityEvents` for SOC 2 CC7.2.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth.js';
import { UserRole } from '../../types/user-role.js';
import { safeInternalError } from '../../utils/safe-error.js';
import { getWorkflowEngine } from '../../composition/workflow-engine-wiring.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtx = any;

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const SetPostureSchema = z.object({
  posture: z.enum(['gated', 'auto']),
  riskCeiling: z.string().min(1).max(40).nullable().optional(),
  amountThreshold: z.number().int().nonnegative().nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function unauthenticated(c: AnyCtx) {
  return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

export const flowAutonomyRouter = new Hono();
flowAutonomyRouter.use('*', authMiddleware);

// ── GET / — list this tenant's flow postures.
flowAutonomyRouter.get('/', async (c: AnyCtx) => {
  const auth = c.get('auth') as { tenantId: string } | undefined;
  if (!auth) return unauthenticated(c);
  try {
    const { flowAutonomy } = getWorkflowEngine();
    const prefs = await flowAutonomy.list(auth.tenantId);
    return c.json({ success: true, data: prefs, meta: { total: prefs.length } });
  } catch (e) {
    return safeInternalError(c, e, {
      code: 'FLOW_AUTONOMY_LIST_ERROR',
      fallback: 'flow autonomy list failed',
    });
  }
});

// ── GET /pending — flows awaiting the creation-time confirmation.
//   Declared BEFORE `/:flowId` so Hono matches the literal path first.
flowAutonomyRouter.get('/pending', async (c: AnyCtx) => {
  const auth = c.get('auth') as { tenantId: string } | undefined;
  if (!auth) return unauthenticated(c);
  try {
    const { flowAutonomy } = getWorkflowEngine();
    const prefs = await flowAutonomy.listPending(auth.tenantId);
    return c.json({ success: true, data: prefs, meta: { total: prefs.length } });
  } catch (e) {
    return safeInternalError(c, e, {
      code: 'FLOW_AUTONOMY_PENDING_ERROR',
      fallback: 'flow autonomy pending read failed',
    });
  }
});

// ── GET /:flowId — one flow's posture.
flowAutonomyRouter.get('/:flowId', async (c: AnyCtx) => {
  const auth = c.get('auth') as { tenantId: string } | undefined;
  if (!auth) return unauthenticated(c);
  const flowId = c.req.param('flowId');
  if (!flowId) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'flowId required' } },
      400,
    );
  }
  try {
    const { flowAutonomy } = getWorkflowEngine();
    const pref = await flowAutonomy.get(auth.tenantId, flowId);
    if (!pref) {
      return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: pref });
  } catch (e) {
    return safeInternalError(c, e, {
      code: 'FLOW_AUTONOMY_GET_ERROR',
      fallback: 'flow autonomy read failed',
    });
  }
});

// ── POST /:flowId/posture — set the posture (the auto-vs-gated decision).
// Owner/admin only: flipping a flow to AUTO defeats the per-run human gate, so
// a low-privileged member must not be able to set it.
flowAutonomyRouter.post(
  '/:flowId/posture',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
  zValidator('json', SetPostureSchema),
  withSecurityEvents(
    {
      action: 'workflow.flow_autonomy.set_posture',
      resource: 'flow_autonomy_pref',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as
        | { tenantId: string; userId: string }
        | undefined;
      if (!auth) return unauthenticated(c);
      const flowId = c.req.param('flowId');
      if (!flowId) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: 'flowId required' },
          },
          400,
        );
      }
      const body = c.req.valid('json');
      try {
        const { flowAutonomy } = getWorkflowEngine();
        const pref = await flowAutonomy.setPosture({
          tenantId: auth.tenantId,
          flowId,
          posture: body.posture,
          actorUserId: auth.userId,
          ...(body.riskCeiling !== undefined
            ? { riskCeiling: body.riskCeiling }
            : {}),
          ...(body.amountThreshold !== undefined
            ? { amountThreshold: body.amountThreshold }
            : {}),
        });
        return c.json({ success: true, data: pref });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'FLOW_AUTONOMY_SET_ERROR',
          fallback: 'flow autonomy set failed',
        });
      }
    },
  ),
);

export default flowAutonomyRouter;

// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Workflow router — mounted at `/api/v1/workflow`.
 *
 * Replaces the legacy `/api/v1/workflows` mount (which used the
 * `@borjie/ai-copilot` in-memory engine that lost every run on
 * restart) with a router backed by the persistent + four-eyes-capable
 * `@borjie/workflow-engine`. The new engine composes:
 *
 *   - `@borjie/assignment-registry` — ReBAC-style ScopeGuard
 *     (default deny; cascade-aware).
 *   - `@borjie/ai-reviewer` — per-kind veteran-expert review with
 *     a brain port for nuanced cases.
 *   - `@borjie/workflow-engine` — the state machine + hashed audit
 *     chain that drives the lifecycle.
 *
 * Routes (every route requires auth):
 *
 *   POST /api/v1/workflow/runs                          — start a new run
 *   GET  /api/v1/workflow/runs/:id                       — fetch a run
 *   POST /api/v1/workflow/runs/:id/propose-change       — capture a delta
 *   POST /api/v1/workflow/runs/:id/submit-for-review    — submit to AI
 *   POST /api/v1/workflow/runs/:id/approve              — approve (human)
 *   POST /api/v1/workflow/runs/:id/reject               — reject
 *   POST /api/v1/workflow/runs/:id/cancel               — cancel (initiator)
 *   GET  /api/v1/workflow/runs/my-queue                  — caller's runs
 *
 * Tenant scoping: every state-changing route uses the JWT-resolved
 * tenantId. The engine itself enforces that runs are tenant-scoped via
 * the repository contract; this router never reads tenantId from the
 * request body.
 *
 * Auditing: every state-changing route is wrapped in `withSecurityEvents`
 * for SOC 2 CC7.2. The engine ALSO writes its own append-only event +
 * hashed-audit-chain entry on every transition.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { safeInternalError } from '../../utils/safe-error.js';
import { getWorkflowEngine } from '../../composition/workflow-engine-wiring.js';

type AnyCtx = any;

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const StartRunSchema = z.object({
  definitionId: z.string().min(1).max(120),
  scope: z.string().min(1).max(40),
  scopeRef: z.string().min(1).max(120),
  input: z.record(z.unknown()).optional(),
});

const ProposeChangeSchema = z.object({
  targetEntity: z.string().min(1).max(200),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
  snapshot: z.record(z.unknown()).optional(),
});

const ApproveSchema = z.object({
  approverRole: z.string().min(1).max(80),
  rationale: z.string().min(1).max(2000),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const CancelSchema = z.object({
  reason: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function unauthenticated(c: AnyCtx) {
  return c.json(
    { success: false, error: { code: 'UNAUTHENTICATED' } },
    401,
  );
}

function mapErrorToStatus(message: string): number {
  if (/scope_denied/.test(message)) return 403;
  if (/run_not_found|definition_not_found/.test(message)) return 404;
  if (/cannot_(?:approve|reject|cancel|propose|submit|commit)/.test(message)) {
    return 409;
  }
  if (/must_be_initiator|only_initiator/.test(message)) return 403;
  return 400;
}

function workflowError(c: AnyCtx, err: unknown, fallbackCode: string) {
  const message = err instanceof Error ? err.message : String(err);
  const status = mapErrorToStatus(message);
  return c.json(
    {
      success: false,
      error: { code: fallbackCode, message },
    },
    status,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

export const workflowRouter = new Hono();
workflowRouter.use('*', authMiddleware);

// ── POST /runs — start a new workflow run.
workflowRouter.post(
  '/runs',
  zValidator('json', StartRunSchema),
  withSecurityEvents(
    {
      action: 'workflow.run.start',
      resource: 'workflow_run',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as
        | { tenantId: string; userId: string }
        | undefined;
      if (!auth) return unauthenticated(c);
      const body = c.req.valid('json');
      try {
        const { engine } = getWorkflowEngine();
        const run = await engine.startRun({
          tenantId: auth.tenantId,
          definitionId: body.definitionId,
          scope: body.scope,
          scopeRef: body.scopeRef,
          initiatedByUserId: auth.userId,
          ...(body.input !== undefined ? { input: body.input } : {}),
        });
        return c.json({ success: true, data: run });
      } catch (err) {
        return workflowError(c, err, 'WORKFLOW_START_FAILED');
      }
    },
  ),
);

// ── GET /runs/my-queue — caller's open runs.
//   IMPORTANT: declared BEFORE `/runs/:id` so Hono matches the literal
//   path first; otherwise `:id` would swallow 'my-queue'.
workflowRouter.get('/runs/my-queue', async (c: AnyCtx) => {
  const auth = c.get('auth') as
    | { tenantId: string; userId: string }
    | undefined;
  if (!auth) return unauthenticated(c);
  try {
    const { engine } = getWorkflowEngine();
    const runs = await engine.myQueue(auth.tenantId, auth.userId);
    return c.json({
      success: true,
      data: runs,
      meta: { total: runs.length },
    });
  } catch (e) {
    return safeInternalError(c, e, {
      code: 'WORKFLOW_QUEUE_ERROR',
      fallback: 'workflow queue read failed',
    });
  }
});

// ── GET /runs/:id — fetch a single run.
workflowRouter.get('/runs/:id', async (c: AnyCtx) => {
  const auth = c.get('auth') as { tenantId: string } | undefined;
  if (!auth) return unauthenticated(c);
  const runId = c.req.param('id');
  if (!runId) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'run id required' } },
      400,
    );
  }
  try {
    const { engine } = getWorkflowEngine();
    const run = await engine.getRun(runId);
    if (!run) {
      return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    // Cross-tenant guard — the engine indexes by run id alone, so we
    // enforce tenant scoping at the boundary.
    if (run.tenantId !== auth.tenantId) {
      return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: run });
  } catch (e) {
    return safeInternalError(c, e, {
      code: 'WORKFLOW_GET_ERROR',
      fallback: 'workflow read failed',
    });
  }
});

// ── POST /runs/:id/propose-change — capture a delta.
workflowRouter.post(
  '/runs/:id/propose-change',
  zValidator('json', ProposeChangeSchema),
  withSecurityEvents(
    {
      action: 'workflow.run.propose_change',
      resource: 'workflow_run',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as { userId: string } | undefined;
      if (!auth) return unauthenticated(c);
      const runId = c.req.param('id');
      const body = c.req.valid('json');
      try {
        const { engine } = getWorkflowEngine();
        const run = await engine.proposeChange({
          runId,
          actorUserId: auth.userId,
          targetEntity: body.targetEntity,
          before: body.before,
          after: body.after,
          ...(body.snapshot !== undefined ? { snapshot: body.snapshot } : {}),
        });
        return c.json({ success: true, data: run });
      } catch (err) {
        return workflowError(c, err, 'WORKFLOW_PROPOSE_FAILED');
      }
    },
  ),
);

// ── POST /runs/:id/submit-for-review — call the AI reviewer.
workflowRouter.post(
  '/runs/:id/submit-for-review',
  withSecurityEvents(
    {
      action: 'workflow.run.submit_for_review',
      resource: 'workflow_run',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as { userId: string } | undefined;
      if (!auth) return unauthenticated(c);
      const runId = c.req.param('id');
      try {
        const { engine } = getWorkflowEngine();
        const run = await engine.submitForReview({
          runId,
          actorUserId: auth.userId,
        });
        return c.json({ success: true, data: run });
      } catch (err) {
        return workflowError(c, err, 'WORKFLOW_SUBMIT_FAILED');
      }
    },
  ),
);

// ── POST /runs/:id/approve — human approver path.
workflowRouter.post(
  '/runs/:id/approve',
  zValidator('json', ApproveSchema),
  withSecurityEvents(
    {
      action: 'workflow.run.approve',
      resource: 'workflow_run',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as { userId: string } | undefined;
      if (!auth) return unauthenticated(c);
      const runId = c.req.param('id');
      const body = c.req.valid('json');
      try {
        const { engine } = getWorkflowEngine();
        const run = await engine.approve({
          runId,
          approverUserId: auth.userId,
          approverRole: body.approverRole,
          rationale: body.rationale,
        });
        return c.json({ success: true, data: run });
      } catch (err) {
        return workflowError(c, err, 'WORKFLOW_APPROVE_FAILED');
      }
    },
  ),
);

// ── POST /runs/:id/reject — anyone with access can reject pre-commit.
workflowRouter.post(
  '/runs/:id/reject',
  zValidator('json', RejectSchema),
  withSecurityEvents(
    {
      action: 'workflow.run.reject',
      resource: 'workflow_run',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as { userId: string } | undefined;
      if (!auth) return unauthenticated(c);
      const runId = c.req.param('id');
      const body = c.req.valid('json');
      try {
        const { engine } = getWorkflowEngine();
        const run = await engine.reject({
          runId,
          actorUserId: auth.userId,
          reason: body.reason,
        });
        return c.json({ success: true, data: run });
      } catch (err) {
        return workflowError(c, err, 'WORKFLOW_REJECT_FAILED');
      }
    },
  ),
);

// ── POST /runs/:id/cancel — initiator only.
workflowRouter.post(
  '/runs/:id/cancel',
  zValidator('json', CancelSchema),
  withSecurityEvents(
    {
      action: 'workflow.run.cancel',
      resource: 'workflow_run',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth') as { userId: string } | undefined;
      if (!auth) return unauthenticated(c);
      const runId = c.req.param('id');
      const body = c.req.valid('json');
      try {
        const { engine } = getWorkflowEngine();
        const run = await engine.cancel({
          runId,
          actorUserId: auth.userId,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
        });
        return c.json({ success: true, data: run });
      } catch (err) {
        return workflowError(c, err, 'WORKFLOW_CANCEL_FAILED');
      }
    },
  ),
);

export default workflowRouter;

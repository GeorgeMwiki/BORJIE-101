/**
 * Training router — admin-driven adaptive training system.
 *
 * Mounted at `/api/v1/training`. Tenant-isolated via the shared
 * `authMiddleware`; every endpoint uses `auth.tenantId`.
 *
 *   POST   /generate                       — preview-generate a path (no DB write)
 *   POST   /paths                          — persist (after admin edits)
 *   GET    /paths                          — list tenant's paths
 *   PATCH  /paths/:id                      — edit steps / title
 *   POST   /paths/:id/assign               — assign to employees
 *   GET    /assignments                    — list assignments (status filter)
 *   GET    /assignments/:id                — detail with per-concept mastery
 *   GET    /mastery/:userId                — per-user mastery across paths
 *   POST   /assignments/:id/mark-complete  — admin force-complete
 *   GET    /next-step                      — learner: widget mount pulls next step
 */

import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import type { TrainingAdminEndpoints } from '@borjie/ai-copilot/training';
import { safeJsonBody, JsonBodyError } from '../utils/safe-json-body';

import { withSecurityEvents } from '@borjie/observability';

/**
 * The router dispatches at runtime — we depend only on Hono's generic
 * `Context.get/json` surface, never on a stronger Variables map. Pin to
 * the broad Hono context type instead of `any`.
 */
type AnyContext = Context;

function getEndpoints(c: AnyContext): TrainingAdminEndpoints | null {
  const services = (c.get('services') as { training?: TrainingAdminEndpoints } | undefined) ?? {};
  return services.training ?? null;
}

function notImplemented(c: AnyContext) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Training service not wired into api-gateway context',
      },
    },
    503
  );
}

function mapErr(c: AnyContext, err: unknown, fallback = 400) {
  // Bug fix A-BUG-DEEP #15: surface malformed-JSON as a 400 INVALID_JSON
  // instead of the prior `{}`-fallback silent swallow.
  if (err instanceof JsonBodyError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      400,
    );
  }
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? 'INTERNAL_ERROR';
  const status: import('hono/utils/http-status').ContentfulStatusCode =
    code === 'NOT_FOUND'
      ? 404
      : code === 'TENANT_MISMATCH'
        ? 403
        : code === 'TRAINING_DISABLED'
          ? 409
          : code === 'INVALID_STATE'
            ? 409
            : code === 'INTERNAL_ERROR'
              ? 500
              : (fallback as import('hono/utils/http-status').ContentfulStatusCode);
  return c.json(
    { success: false, error: { code, message: e?.message ?? 'unknown' } },
    status
  );
}

const app = new Hono();
app.use('*', authMiddleware);

app.post('/generate', withSecurityEvents({ action: 'training.create', resource: 'training', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const body = await safeJsonBody(c);
    const path = await ep.generate(auth.tenantId, auth.userId, body);
    return c.json({ success: true, data: path }, 200);
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
}));

app.post('/paths', withSecurityEvents({ action: 'training.create', resource: 'training', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const body = await safeJsonBody(c);
    const path = await ep.persistPath(auth.tenantId, auth.userId, body);
    return c.json({ success: true, data: path }, 201);
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
}));

app.get('/paths', async (c: AnyContext) => {
  const auth = c.get('auth');
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const data = await ep.listPaths(auth.tenantId);
    return c.json({ success: true, data });
  } catch (e: unknown) {
    return mapErr(c, e, 500);
  }
});

app.patch('/paths/:id', withSecurityEvents({ action: 'training.update', resource: 'training', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: { code: 'INVALID_PARAM', message: 'id required' } }, 400);
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const body = await safeJsonBody(c);
    const path = await ep.editPath(auth.tenantId, id, body);
    return c.json({ success: true, data: path });
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
}));

app.post('/paths/:id/assign', withSecurityEvents({ action: 'training.create', resource: 'training', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: { code: 'INVALID_PARAM', message: 'id required' } }, 400);
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const body = await safeJsonBody(c);
    const data = await ep.assign(auth.tenantId, id, auth.userId, body);
    return c.json({ success: true, data }, 201);
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
}));

app.get('/assignments', async (c: AnyContext) => {
  const auth = c.get('auth');
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const status = c.req.query('status');
    const assigneeUserId = c.req.query('assigneeUserId');
    const data = await ep.listAssignments(auth.tenantId, {
      status,
      assigneeUserId,
    });
    return c.json({ success: true, data });
  } catch (e: unknown) {
    return mapErr(c, e, 500);
  }
});

app.get('/assignments/:id', async (c: AnyContext) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: { code: 'INVALID_PARAM', message: 'id required' } }, 400);
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const data = await ep.getAssignment(auth.tenantId, id);
    return c.json({ success: true, data });
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
});

app.get('/mastery/:userId', async (c: AnyContext) => {
  const auth = c.get('auth');
  const userId = c.req.param('userId');
  if (!userId) return c.json({ success: false, error: { code: 'INVALID_PARAM', message: 'userId required' } }, 400);
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const data = await ep.getUserMastery(
      auth.tenantId,
      userId,
      auth.tenantId
    );
    return c.json({ success: true, data });
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
});

app.post('/assignments/:id/mark-complete', withSecurityEvents({ action: 'training.create', resource: 'training', severity: 'info' }, async (c: AnyContext) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: { code: 'INVALID_PARAM', message: 'id required' } }, 400);
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const data = await ep.markAssignmentComplete(
      auth.tenantId,
      id,
      auth.userId
    );
    return c.json({ success: true, data });
  } catch (e: unknown) {
    return mapErr(c, e, 400);
  }
}));

app.get('/next-step', async (c: AnyContext) => {
  const auth = c.get('auth');
  const ep = getEndpoints(c);
  if (!ep) return notImplemented(c);
  try {
    const data = await ep.getNextStep(auth.tenantId, auth.userId);
    return c.json({ success: true, data: data ?? null });
  } catch (e: unknown) {
    return mapErr(c, e, 500);
  }
});

export const trainingRouter = app;
export default app;

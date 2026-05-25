/**
 * Workflows API — start / inspect / advance AI-orchestrated workflows.
 *
 *   POST /workflows/run            — start a named workflow
 *   GET  /workflows/:runId         — fetch run status + step logs
 *   POST /workflows/:runId/advance — approve or reject a human-gated step
 *   GET  /workflows                — list available workflow definitions
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  WorkflowEngine,
  InMemoryWorkflowRunStore,
  listWorkflows,
  type WorkflowRunStore,
} from '@borjie/ai-copilot';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const StartSchema = z.object({
  workflowId: z.string().min(1).max(80),
  input: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const AdvanceSchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(2000).optional(),
});

// Process-local store singleton — in production composition, swap for a
// Drizzle-backed store. The in-memory store is safe because every run is
// scoped by tenant and the engine never leaks across tenants.
const store: WorkflowRunStore = new InMemoryWorkflowRunStore();
const engine = new WorkflowEngine(store);

const app = new Hono();
app.use('*', authMiddleware);

app.get('/', (c) => {
  return c.json({
    success: true,
    data: listWorkflows().map((w) => ({
      id: w.id,
      version: w.version,
      name: w.name,
      description: w.description,
      stepCount: w.steps.length,
      defaultRoles: w.defaultRoles,
    })),
  });
});

app.post('/run', zValidator('json', StartSchema), withSecurityEvents({ action: 'workflow.create', resource: 'workflow', severity: 'info' }, async (c) => {
  const auth = c.get('auth') as
    | { tenantId: string; userId: string; role: string; roles?: string[] }
    | undefined;
  if (!auth) {
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
  }
  const body = c.req.valid('json');
  try {
    const run = await engine.start({
      tenantId: auth.tenantId,
      workflowId: body.workflowId,
      initiatedBy: auth.userId,
      initiatorRoles: auth.roles ?? [auth.role],
      input: body.input ?? {},
      ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey } : {}),
    });
    return c.json({ success: true, data: run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'workflow start failed';
    const status = /role check/.test(msg) ? 403 : /unknown workflow/.test(msg) ? 404 : 400;
    return c.json({ success: false, error: { code: 'WORKFLOW_START_FAILED', message: msg } }, status);
  }
}));

app.get('/:runId', async (c) => {
  const auth = c.get('auth') as { tenantId: string } | undefined;
  if (!auth) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
  const run = await engine.get(auth.tenantId, c.req.param('runId'));
  if (!run) {
    return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: run });
});

app.post('/:runId/advance', zValidator('json', AdvanceSchema), withSecurityEvents({ action: 'workflow.create', resource: 'workflow', severity: 'info' }, async (c) => {
  const auth = c.get('auth') as { tenantId: string; userId: string } | undefined;
  if (!auth) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
  const body = c.req.valid('json');
  try {
    const advance: { approve: boolean; reason?: string } = body.reason !== undefined
      ? { approve: body.approve, reason: body.reason }
      : { approve: body.approve };
    const run = await engine.advance(
      auth.tenantId,
      c.req.param('runId'),
      auth.userId,
      advance
    );
    return c.json({ success: true, data: run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'advance failed';
    const status = /not awaiting/.test(msg) ? 409 : /not found|mismatch/.test(msg) ? 404 : 400;
    return c.json({ success: false, error: { code: 'ADVANCE_FAILED', message: msg } }, status);
  }
}));

export default app;

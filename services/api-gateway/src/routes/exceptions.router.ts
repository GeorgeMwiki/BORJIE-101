/**
 * Exception Inbox Router — Wave-13.
 *
 * REST surface for the head-of-department's decision queue:
 *   GET  /api/v1/exceptions?domain=...&priority=...&limit=...
 *   POST /api/v1/exceptions/:id/acknowledge
 *   POST /api/v1/exceptions/:id/resolve
 *
 * Uses an in-memory exception repository by default so the endpoints
 * return 200 empty-lists even when the gateway is in degraded mode.
 * Production binds the Postgres repository via the composition root.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  ExceptionInbox,
  InMemoryExceptionRepository,
  type ExceptionRepository,
} from '@borjie/ai-copilot/autonomy';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const fallbackRepo: ExceptionRepository = new InMemoryExceptionRepository();
const fallbackInbox = new ExceptionInbox({ repository: fallbackRepo });

const ListQuerySchema = z.object({
  domain: z
    .enum([
      'finance',
      'leasing',
      'maintenance',
      'compliance',
      'communications',
      'strategic',
      'anomaly',
    ])
    .optional(),
  priority: z.enum(['P1', 'P2', 'P3']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const ResolveBodySchema = z.object({
  resolution: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

const IdParamSchema = z.object({
  id: z.string().min(1),
});

export const exceptionsRouter = new Hono();

exceptionsRouter.use('*', authMiddleware);

function getInbox(c): ExceptionInbox {
  const candidate = c.get('exceptionInbox') as ExceptionInbox | undefined;
  return candidate ?? fallbackInbox;
}

exceptionsRouter.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const tenantId = c.get('tenantId') as string | undefined;
  if (!tenantId) {
    return c.json({ success: false, error: 'tenant context missing' }, 400);
  }
  const query = c.req.valid('query');
  try {
    const items = await getInbox(c).listOpen(tenantId, {
      domain: query.domain,
      priority: query.priority,
      limit: query.limit,
    });
    return c.json({
      success: true,
      data: items,
      meta: { total: items.length, page: 1, limit: query.limit ?? items.length },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'EXCEPTIONS_LIST_FAILED',
      status: 500,
      fallback: 'listOpen failed',
    });
  }
});

exceptionsRouter.post(
  '/:id/acknowledge',
  zValidator('param', IdParamSchema),
  withSecurityEvents({ action: 'exception.create', resource: 'exception', severity: 'info' }, async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    if (!tenantId || !userId) {
      return c.json({ success: false, error: 'auth context missing' }, 400);
    }
    const { id } = c.req.valid('param');
    try {
      const updated = await getInbox(c).acknowledge(tenantId, id, userId);
      return c.json({ success: true, data: updated });
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : 'acknowledge failed' },
        400,
      );
    }
  }),
);

exceptionsRouter.post(
  '/:id/resolve',
  zValidator('param', IdParamSchema),
  zValidator('json', ResolveBodySchema),
  withSecurityEvents({ action: 'exception.create', resource: 'exception', severity: 'info' }, async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    if (!tenantId || !userId) {
      return c.json({ success: false, error: 'auth context missing' }, 400);
    }
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const resolved = await getInbox(c).resolve(tenantId, id, {
        resolution: body.resolution,
        note: body.note,
        resolvedByUserId: userId,
      });
      return c.json({ success: true, data: resolved });
    } catch (err) {
      return c.json(
        { success: false, error: err instanceof Error ? err.message : 'resolve failed' },
        400,
      );
    }
  }),
);

export default exceptionsRouter;

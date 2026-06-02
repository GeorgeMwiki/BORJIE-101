/**
 * /api/v1/analytics/exports — owner-portal AnalyticsExportsPage.
 *
 * WS-4: now serves REAL saved export templates from the
 * `analytics_export_templates` warehouse (migration 0177). The previous
 * `X-Backend-Status: degraded` skeleton is gone.
 *
 * Routes:
 *   GET  /templates  list the tenant's saved export definitions (newest first)
 *   POST /templates  create a new export definition
 *
 * Reads/writes run on the RLS-pinned request client (`c.get('db')`), so tenant
 * isolation is enforced by FORCE row-level security. NO money columns.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { listExportTemplates, analyticsExportTemplates } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['csv', 'xlsx', 'pdf', 'json']).default('csv'),
  schema: z.record(z.unknown()).default({}),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/templates', async (c: any) => {
  const { tenantId } = c.get('auth');
  const parsed = ListQuerySchema.safeParse({ limit: c.req.query('limit') });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
      },
      400,
    );
  }
  const db = c.get('db');
  const templates = await listExportTemplates(db, tenantId, {
    limit: parsed.data.limit,
  });
  return c.json(
    { success: true as const, data: templates, meta: { tenantId, count: templates.length } },
    200,
  );
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/templates', async (c: any) => {
  const { tenantId, userId } = c.get('auth');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
      },
      400,
    );
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid export template' },
      },
      400,
    );
  }
  const db = c.get('db');
  const now = new Date();
  const [row] = await db
    .insert(analyticsExportTemplates)
    .values({
      id: `aet_${randomUUID()}`,
      tenantId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      schema: parsed.data.schema,
      createdBy: userId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ success: true as const, data: row }, 201);
});

export const analyticsExportsRouter = app;

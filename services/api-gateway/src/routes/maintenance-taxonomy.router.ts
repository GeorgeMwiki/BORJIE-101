/**
 * Maintenance problem taxonomy router — Wave 8 (S7 gap closure)
 *
 * Mounted at `/api/v1/maintenance-taxonomy`. Returns the merged view
 * (platform defaults + tenant overrides); tenant-specific overrides win
 * on `code` collision.
 *
 *   GET  /categories                         — merged category list
 *   POST /categories                         — tenant-scoped category override
 *   GET  /problems                           — merged problem list (?categoryId=, ?severity=, ?assetType=)
 *   GET  /problems/by-category/:categoryId   — problems under a category
 *   POST /problems                           — tenant-scoped problem override
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical', 'emergency']);

const CreateCategorySchema = z.object({
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  displayOrder: z.number().int().optional(),
  iconName: z.string().max(80).optional(),
  active: z.boolean().optional(),
});

const CreateProblemSchema = z.object({
  categoryId: z.string().min(1),
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  defaultSeverity: SeveritySchema.optional(),
  defaultSlaHours: z.number().int().nonnegative().optional(),
  assetTypeScope: z.array(z.string()).optional(),
  roomScope: z.array(z.string()).optional(),
  evidenceRequired: z.boolean().optional(),
  suggestedVendorTags: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.maintenanceTaxonomy;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'MaintenanceTaxonomy service not wired into api-gateway context',
      },
    },
    503
  );
}

app.get('/categories', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const items = await s.listCategories(auth.tenantId);
  return c.json({ success: true, data: items });
});

app.post('/categories', zValidator('json', CreateCategorySchema), withSecurityEvents({ action: 'maintenance-taxonomy.create', resource: 'maintenance-taxonomy', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const created = await s.createCategory(auth.tenantId, body, auth.userId);
    return c.json({ success: true, data: created }, 201);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      err?.code === 'DUPLICATE' ? 409 : 400
    );
  }
}));

app.get('/problems', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const filters = {
    categoryId: c.req.query('categoryId') || undefined,
    severity: c.req.query('severity') || undefined,
    assetType: c.req.query('assetType') || undefined,
  };
  const items = await s.listProblems(auth.tenantId, filters);
  return c.json({ success: true, data: items });
});

app.get('/problems/by-category/:categoryId', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  const items = await s.listProblemsByCategory(auth.tenantId, c.req.param('categoryId'));
  return c.json({ success: true, data: items });
});

app.post('/problems', zValidator('json', CreateProblemSchema), withSecurityEvents({ action: 'maintenance-taxonomy.create', resource: 'maintenance-taxonomy', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const created = await s.createProblem(auth.tenantId, body, auth.userId);
    return c.json({ success: true, data: created }, 201);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    return c.json(
      { success: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'unknown' } },
      err?.code === 'DUPLICATE' ? 409 : 400
    );
  }
}));

export const maintenanceTaxonomyRouter = app;
export default app;

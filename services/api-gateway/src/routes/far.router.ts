/**
 * FAR (Fitness-for-Assessment Review) API Routes (Wave 26 Agent Z2)
 *
 *   POST   /components                        → register new asset component
 *   GET    /components/:id                    → fetch component
 *   POST   /components/:id/assign             → assign monitoring cadence
 *   GET    /assignments/due                   → list due assignments (scheduler)
 *   POST   /assignments/:id/check             → log a condition check
 *   GET    /components/:id/scheduled-checks   → upcoming / logged checks
 *
 * Wired to `FarService` via the composition root. Degrades to 503 when
 * DATABASE_URL is unset.
 */

// @ts-nocheck — Hono context types are open-ended by design in this project.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'FarService not configured — DATABASE_URL unset',
      },
    },
    503,
  );
}

const ComponentSchema = z.object({
  propertyId: z.string().min(1),
  unitId: z.string().optional().nullable(),
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  category: z.string().max(120).optional(),
  manufacturer: z.string().max(120).optional(),
  modelNumber: z.string().max(120).optional(),
  serialNumber: z.string().max(120).optional(),
  installedAt: z.string().optional(),
  expectedLifespanMonths: z.number().int().positive().optional(),
  status: z
    .enum(['active', 'monitoring', 'needs_repair', 'decommissioned'])
    .optional(),
  currentCondition: z
    .enum(['excellent', 'good', 'fair', 'poor', 'critical'])
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const AssignSchema = z.object({
  frequency: z.enum([
    'weekly',
    'monthly',
    'quarterly',
    'biannual',
    'annual',
    'ad_hoc',
  ]),
  assignedTo: z.string().optional().nullable(),
  firstCheckDueAt: z.string().optional(),
  notifyRecipients: z
    .array(
      z.object({
        role: z.enum(['landlord', 'manager', 'vendor', 'tenant', 'other']),
        userId: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
      }),
    )
    .optional(),
  triggerRules: z.record(z.string(), z.unknown()).optional(),
});

const CheckSchema = z.object({
  outcome: z.enum(['pass', 'warning', 'fail', 'skipped']),
  conditionAfter: z
    .enum(['excellent', 'good', 'fair', 'poor', 'critical'])
    .optional(),
  notes: z.string().max(4000).optional(),
  photos: z.array(z.string()).optional(),
  measurements: z.record(z.string(), z.unknown()).optional(),
  performedAt: z.string().optional(),
});

const DueQuerySchema = z.object({
  now: z.string().optional(),
});

// Root — discoverability endpoint.
app.get('/', async (c: any) => {
  const repo = c.get('services')?.far?.repo;
  if (!repo) return notConfigured(c);
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'FAR routes: POST /components, POST /components/:id/assign, POST /assignments/:id/check, GET /assignments/due',
    },
  });
});

app.post('/components', zValidator('json', ComponentSchema), withSecurityEvents({ action: 'far.create', resource: 'far', severity: 'info' }, async (c: any) => {
  const service = c.get('farService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const createdBy = c.get('userId');
    const body = c.req.valid('json');
    const result = await service.addComponent({
      tenantId,
      propertyId: body.propertyId,
      unitId: body.unitId ?? null,
      code: body.code,
      name: body.name,
      category: body.category,
      manufacturer: body.manufacturer,
      modelNumber: body.modelNumber,
      serialNumber: body.serialNumber,
      installedAt: body.installedAt,
      expectedLifespanMonths: body.expectedLifespanMonths,
      status: body.status,
      currentCondition: body.currentCondition,
      metadata: body.metadata,
      createdBy,
    });
    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        result.error.code === 'INVALID_INPUT' ? 400 : 409,
      );
    }
    return c.json({ success: true, data: result.data }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FAR_COMPONENT_FAILED',
      status: 500,
      fallback: 'Failed to register asset component',
    });
  }
}));

app.get('/components/:id', async (c: any) => {
  const repo = c.get('services')?.far?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const row = await repo.findComponentById(id, tenantId);
    if (!row) {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Component not found' },
        },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FAR_READ_FAILED',
      status: 500,
      fallback: 'Failed to read asset component',
    });
  }
});

app.post(
  '/components/:id/assign',
  zValidator('json', AssignSchema),
  withSecurityEvents({ action: 'far.create', resource: 'far', severity: 'info' }, async (c: any) => {
    const service = c.get('farService');
    if (!service) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const createdBy = c.get('userId');
      const componentId = c.req.param('id');
      const body = c.req.valid('json');
      const result = await service.assignMonitoring({
        tenantId,
        componentId,
        frequency: body.frequency,
        assignedTo: body.assignedTo ?? null,
        firstCheckDueAt: body.firstCheckDueAt,
        notifyRecipients: body.notifyRecipients,
        triggerRules: body.triggerRules,
        createdBy,
      });
      if (!result.success) {
        const status =
          result.error.code === 'COMPONENT_NOT_FOUND'
            ? 404
            : result.error.code === 'INVALID_INPUT'
              ? 400
              : 409;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({ success: true, data: result.data }, 201);
    } catch (err) {
      return routeCatch(c, err, {
        code: 'FAR_ASSIGN_FAILED',
        status: 500,
        fallback: 'Failed to assign monitoring',
      });
    }
  }),
);

app.get(
  '/assignments/due',
  zValidator('query', DueQuerySchema),
  async (c: any) => {
    const repo = c.get('services')?.far?.repo;
    if (!repo) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const { now } = c.req.valid('query');
      const iso = now ?? new Date().toISOString();
      const rows = await repo.findDueAssignments(tenantId, iso);
      return c.json({ success: true, data: rows });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'FAR_DUE_FAILED',
        status: 500,
        fallback: 'Failed to list due assignments',
      });
    }
  },
);

app.post(
  '/assignments/:id/check',
  zValidator('json', CheckSchema),
  withSecurityEvents({ action: 'far.create', resource: 'far', severity: 'info' }, async (c: any) => {
    const service = c.get('farService');
    if (!service) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const performedBy = c.get('userId');
      const assignmentId = c.req.param('id');
      const body = c.req.valid('json');
      const result = await service.logCheck({
        tenantId,
        assignmentId,
        performedBy,
        outcome: body.outcome,
        conditionAfter: body.conditionAfter,
        notes: body.notes,
        photos: body.photos,
        measurements: body.measurements,
        performedAt: body.performedAt,
      });
      if (!result.success) {
        const status =
          result.error.code === 'ASSIGNMENT_NOT_FOUND'
            ? 404
            : result.error.code === 'INVALID_STATUS'
              ? 409
              : 400;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({ success: true, data: result.data }, 201);
    } catch (err) {
      return routeCatch(c, err, {
        code: 'FAR_CHECK_FAILED',
        status: 500,
        fallback: 'Failed to log condition check',
      });
    }
  }),
);

app.get('/components/:id/scheduled-checks', async (c: any) => {
  const service = c.get('farService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const componentId = c.req.param('id');
    const result = await service.getScheduledChecks(tenantId, componentId);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FAR_SCHEDULED_FAILED',
      status: 500,
      fallback: 'Failed to read scheduled checks',
    });
  }
});

export default app;

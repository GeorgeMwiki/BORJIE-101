/**
 * Conditional Survey API Routes (Wave 26 Agent Z2)
 *
 *   POST   /                          → schedule new survey
 *   GET    /:id                       → fetch survey (+ findings + plans)
 *   POST   /:id/findings              → attach a finding
 *   POST   /:id/compile               → compile findings into a report
 *   POST   /:id/plans/:planId/approve → approve a proposed action plan
 *   GET    /overdue                   → list surveys past scheduledAt cutoff
 *
 * Wired to `ConditionalSurveyService` via the composition root. When
 * DATABASE_URL is unset the router returns a clean 503.
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
        message:
          'ConditionalSurveyService not configured — DATABASE_URL unset',
      },
    },
    503,
  );
}

const ScheduleSchema = z.object({
  propertyId: z.string().min(1),
  unitId: z.string().optional().nullable(),
  scheduledAt: z.string().min(1),
  surveyorId: z.string().optional().nullable(),
  sourceInspectionId: z.string().optional().nullable(),
});

const FindingSchema = z.object({
  area: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  severity: z
    .enum(['low', 'medium', 'high', 'critical'])
    .optional(),
  photos: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CompileSchema = z.object({
  tenantCountryCode: z.string().length(2).optional(),
});

const OverdueQuerySchema = z.object({
  cutoff: z.string().optional(),
});

app.get('/', async (c: any) => {
  const repo = c.get('services')?.conditionalSurveys?.repo;
  if (!repo) return notConfigured(c);
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'Use GET /:id, GET /overdue, or POST / to schedule a new survey.',
    },
  });
});

app.post('/', zValidator('json', ScheduleSchema), withSecurityEvents({ action: 'conditional-survey.create', resource: 'conditional-survey', severity: 'info' }, async (c: any) => {
  const service = c.get('conditionalSurveyService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const body = c.req.valid('json');
    const result = await service.scheduleSurvey({
      tenantId,
      propertyId: body.propertyId,
      unitId: body.unitId ?? null,
      scheduledAt: body.scheduledAt,
      surveyorId: body.surveyorId ?? null,
      sourceInspectionId: body.sourceInspectionId ?? null,
      createdBy: actor,
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
      code: 'CSURVEY_SCHEDULE_FAILED',
      status: 500,
      fallback: 'Failed to schedule conditional survey',
    });
  }
}));

app.get(
  '/overdue',
  zValidator('query', OverdueQuerySchema),
  async (c: any) => {
    const repo = c.get('services')?.conditionalSurveys?.repo;
    if (!repo) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const { cutoff } = c.req.valid('query');
      const cutoffIso = cutoff ?? new Date().toISOString();
      const rows = await repo.findOverdue(tenantId, cutoffIso);
      return c.json({ success: true, data: rows });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'CSURVEY_OVERDUE_FAILED',
        status: 500,
        fallback: 'Failed to list overdue conditional surveys',
      });
    }
  },
);

app.get('/:id', async (c: any) => {
  const repo = c.get('services')?.conditionalSurveys?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const row = await repo.findById(id, tenantId);
    if (!row) {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Survey not found' },
        },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'CSURVEY_READ_FAILED',
      status: 500,
      fallback: 'Failed to read conditional survey',
    });
  }
});

app.post(
  '/:id/findings',
  zValidator('json', FindingSchema),
  withSecurityEvents({ action: 'conditional-survey.create', resource: 'conditional-survey', severity: 'info' }, async (c: any) => {
    const service = c.get('conditionalSurveyService');
    if (!service) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const actor = c.get('userId');
      const surveyId = c.req.param('id');
      const body = c.req.valid('json');
      const result = await service.attachFinding({
        surveyId,
        tenantId,
        area: body.area,
        title: body.title,
        description: body.description,
        severity: body.severity,
        photos: body.photos,
        attachments: body.attachments,
        metadata: body.metadata,
        createdBy: actor,
      });
      if (!result.success) {
        const status =
          result.error.code === 'SURVEY_NOT_FOUND'
            ? 404
            : result.error.code === 'INVALID_INPUT'
              ? 400
              : 409;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({ success: true, data: result.data }, 201);
    } catch (err) {
      return routeCatch(c, err, {
        code: 'CSURVEY_FINDING_FAILED',
        status: 500,
        fallback: 'Failed to attach finding',
      });
    }
  }),
);

app.post(
  '/:id/compile',
  zValidator('json', CompileSchema),
  withSecurityEvents({ action: 'conditional-survey.create', resource: 'conditional-survey', severity: 'info' }, async (c: any) => {
    const service = c.get('conditionalSurveyService');
    if (!service) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const actor = c.get('userId');
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await service.compileReport(id, tenantId, actor, {
        tenantCountryCode: body.tenantCountryCode,
      });
      if (!result.success) {
        const status =
          result.error.code === 'SURVEY_NOT_FOUND'
            ? 404
            : result.error.code === 'INVALID_STATUS'
              ? 409
              : 400;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({ success: true, data: result.data });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'CSURVEY_COMPILE_FAILED',
        status: 500,
        fallback: 'Failed to compile conditional survey report',
      });
    }
  }),
);

app.post('/:id/plans/:planId/approve', withSecurityEvents({ action: 'conditional-survey.create', resource: 'conditional-survey', severity: 'info' }, async (c: any) => {
  const service = c.get('conditionalSurveyService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const approvedBy = c.get('userId');
    const surveyId = c.req.param('id');
    const actionPlanId = c.req.param('planId');
    const result = await service.approveActionPlan({
      surveyId,
      actionPlanId,
      tenantId,
      approvedBy,
    });
    if (!result.success) {
      const status =
        result.error.code === 'SURVEY_NOT_FOUND' ||
        result.error.code === 'ACTION_PLAN_NOT_FOUND'
          ? 404
          : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'CSURVEY_PLAN_APPROVE_FAILED',
      status: 500,
      fallback: 'Failed to approve action plan',
    });
  }
}));

export default app;

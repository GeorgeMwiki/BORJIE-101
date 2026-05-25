/**
 * Classroom router (Wave 11).
 *
 * Mounted at `/api/v1/classroom`. Tenant-isolated via auth middleware.
 *
 *   POST   /sessions                     — create a session
 *   GET    /sessions/:id                 — fetch one session
 *   POST   /sessions/:id/quiz            — record a quiz response (advances BKT)
 *   GET    /mastery/:userId              — per-concept BKT snapshot for a user
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const CreateSessionSchema = z.object({
  title: z.string().min(1).max(200),
  language: z.enum(['en', 'sw', 'mixed']).optional(),
  targetConceptIds: z.array(z.string().min(1).max(80)).max(40).default([]),
});

const QuizAnswerSchema = z.object({
  quizId: z.string().min(1).max(100).optional(),
  conceptId: z.string().min(1).max(80),
  userId: z.string().min(1).max(80),
  isCorrect: z.boolean(),
  answerIndex: z.number().int().min(0).max(20).optional(),
  answerText: z.string().max(1000).optional(),
  latencyMs: z.number().int().nonnegative().max(600_000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.classroom;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Classroom service not wired into api-gateway context',
      },
    },
    503
  );
}

function mapErr(c: any, err: unknown, fallback = 400) {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? 'INTERNAL_ERROR';
  const status =
    code === 'NOT_FOUND'
      ? 404
      : code === 'TENANT_MISMATCH'
        ? 403
        : code === 'INVALID_STATE'
          ? 409
          : code === 'INTERNAL_ERROR'
            ? 500
            : fallback;
  return c.json(
    { success: false, error: { code, message: e?.message ?? 'unknown' } },
    status
  );
}

app.post('/sessions', zValidator('json', CreateSessionSchema), withSecurityEvents({ action: 'classroom.create', resource: 'classroom', severity: 'info' }, async (c: any) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const session = await s.createSession({
      tenantId: auth.tenantId,
      createdBy: auth.userId,
      title: body.title,
      language: body.language ?? 'mixed',
      targetConceptIds: body.targetConceptIds ?? [],
    });
    return c.json({ success: true, data: session }, 201);
  } catch (e: unknown) {
    return mapErr(c, e, 500);
  }
}));

app.get('/sessions/:id', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const session = await s.getSession(auth.tenantId, c.req.param('id'));
    if (!session) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'session not found' } },
        404
      );
    }
    return c.json({ success: true, data: session });
  } catch (e: unknown) {
    return mapErr(c, e, 500);
  }
});

app.post(
  '/sessions/:id/quiz',
  zValidator('json', QuizAnswerSchema),
  withSecurityEvents({ action: 'classroom.create', resource: 'classroom', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      const result = await s.recordQuizResponse({
        tenantId: auth.tenantId,
        sessionId: c.req.param('id'),
        ...body,
      });
      return c.json({ success: true, data: result });
    } catch (e: unknown) {
      return mapErr(c, e, 500);
    }
  })
);

app.get('/mastery/:userId', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const data = await s.getMastery(auth.tenantId, c.req.param('userId'));
    return c.json({ success: true, data });
  } catch (e: unknown) {
    return mapErr(c, e, 500);
  }
});

export const classroomRouter = app;
export default app;

/**
 * /api/v1/estate/succession-plans — succession CRUD.
 *
 * Wave ESTATE-OS. Multi-generational wealth-transfer plan per estate
 * group. `next_review_due_at` drives reminders via the existing
 * reminders worker (the brain tool `succession_review_needed` reads
 * this column).
 *
 * Routes:
 *   GET    /            list plans (optionally filtered by groupId)
 *   POST   /            create
 *   PATCH  /:id         update
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';

import {
  successionPlans,
  SUCCESSION_PLAN_STATUSES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('estate-succession-plans');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  estateGroupId: z.string().uuid(),
  currentPrincipalName: z.string().min(1).max(240),
  designatedSuccessorName: z.string().min(1).max(240),
  designatedSuccessorRelation: z.string().min(1).max(120),
  designatedSuccessorNida: z.string().min(1).max(40).optional(),
  contingencySuccessorName: z.string().min(1).max(240).optional(),
  willDocId: z.string().uuid().optional(),
  lastReviewAt: z.string().datetime({ offset: true }).optional(),
  nextReviewDueAt: z.string().datetime({ offset: true }),
  status: z.enum(SUCCESSION_PLAN_STATUSES).default('drafted'),
  notes: z.string().min(1).max(4000).optional(),
});

const patchSchema = z
  .object({
    currentPrincipalName: z.string().min(1).max(240).optional(),
    designatedSuccessorName: z.string().min(1).max(240).optional(),
    designatedSuccessorRelation: z.string().min(1).max(120).optional(),
    designatedSuccessorNida: z.string().min(1).max(40).optional(),
    contingencySuccessorName: z.string().min(1).max(240).optional(),
    willDocId: z.string().uuid().optional(),
    lastReviewAt: z.string().datetime({ offset: true }).optional(),
    nextReviewDueAt: z.string().datetime({ offset: true }).optional(),
    status: z.enum(SUCCESSION_PLAN_STATUSES).optional(),
    notes: z.string().min(1).max(4000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'patch must include at least one field',
  });

const listQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function dbUnavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'ESTATE_DB_UNAVAILABLE',
        message: 'Database not configured',
      },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);

  const parsed = listQuerySchema.safeParse({ groupId: c.req.query('groupId') });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const conditions = [eq(successionPlans.tenantId, auth.tenantId)];
  if (parsed.data.groupId) {
    conditions.push(eq(successionPlans.estateGroupId, parsed.data.groupId));
  }

  const rows = await db
    .select()
    .from(successionPlans)
    .where(and(...conditions))
    .orderBy(desc(successionPlans.createdAt));

  return c.json({
    success: true,
    data: { plans: rows, count: rows.length },
  });
});

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

app.post('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);

  const raw = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid succession plan payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;

  try {
    const [row] = await db
      .insert(successionPlans)
      .values({
        tenantId: auth.tenantId,
        estateGroupId: input.estateGroupId,
        currentPrincipalName: input.currentPrincipalName,
        designatedSuccessorName: input.designatedSuccessorName,
        designatedSuccessorRelation: input.designatedSuccessorRelation,
        designatedSuccessorNida: input.designatedSuccessorNida,
        contingencySuccessorName: input.contingencySuccessorName,
        willDocId: input.willDocId,
        lastReviewAt: input.lastReviewAt
          ? new Date(input.lastReviewAt)
          : new Date(),
        nextReviewDueAt: new Date(input.nextReviewDueAt),
        status: input.status,
        notes: input.notes,
      })
      .returning();

    moduleLogger.info('estate-succession-plans: created', {
      tenantId: auth.tenantId,
      planId: row.id,
      groupId: input.estateGroupId,
    });
    return c.json({ success: true, data: { plan: row } }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    moduleLogger.error('estate-succession-plans: insert failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      {
        success: false,
        error: { code: 'ESTATE_SUCCESSION_INSERT_FAILED', message },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id
// ---------------------------------------------------------------------------

app.patch('/:id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  const id = c.req.param('id');
  if (!db) return dbUnavailable(c);

  const raw = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid patch payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(successionPlans)
    .where(
      and(
        eq(successionPlans.tenantId, auth.tenantId),
        eq(successionPlans.id, id),
      ),
    )
    .limit(1);
  if (!existing) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Plan not found' } },
      404,
    );
  }

  const next: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    if (k === 'lastReviewAt' || k === 'nextReviewDueAt') {
      next[k] = new Date(v as string);
    } else {
      next[k] = v;
    }
  }

  const [row] = await db
    .update(successionPlans)
    .set(next)
    .where(
      and(
        eq(successionPlans.tenantId, auth.tenantId),
        eq(successionPlans.id, id),
      ),
    )
    .returning();

  moduleLogger.info('estate-succession-plans: patched', {
    tenantId: auth.tenantId,
    planId: id,
  });

  return c.json({ success: true, data: { plan: row } });
});

export const estateSuccessionPlansRouter = app;
export default estateSuccessionPlansRouter;

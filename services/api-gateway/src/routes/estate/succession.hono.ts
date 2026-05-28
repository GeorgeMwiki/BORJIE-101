// @ts-nocheck — Hono v4 TypedResponse widening.
/**
 * /api/v1/estate/succession-plans — successor designation + review
 * cadence.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  successionPlans,
  SUCCESSION_PLAN_STATUSES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from '../ops/audit-helper';

const moduleLogger = createLogger('estate-succession');

const listQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const createSchema = z.object({
  estateGroupId: z.string().uuid(),
  currentPrincipalName: z.string().trim().min(1).max(300),
  designatedSuccessorName: z.string().trim().min(1).max(300),
  designatedSuccessorRelation: z.string().trim().min(1).max(120),
  designatedSuccessorNida: z.string().trim().max(64).nullable().optional(),
  contingencySuccessorName: z.string().trim().max(300).nullable().optional(),
  willDocId: z.string().trim().max(120).nullable().optional(),
  nextReviewDueAt: z.string().datetime(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = z.object({
  currentPrincipalName: z.string().trim().min(1).max(300).optional(),
  designatedSuccessorName: z.string().trim().min(1).max(300).optional(),
  designatedSuccessorRelation: z.string().trim().min(1).max(120).optional(),
  designatedSuccessorNida: z.string().trim().max(64).nullable().optional(),
  contingencySuccessorName: z.string().trim().max(300).nullable().optional(),
  willDocId: z.string().trim().max(120).nullable().optional(),
  lastReviewAt: z.string().datetime().optional(),
  nextReviewDueAt: z.string().datetime().optional(),
  status: z.enum(SUCCESSION_PLAN_STATUSES).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export function createEstateSuccessionRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'ESTATE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = listQuerySchema.safeParse({
      groupId: c.req.query('groupId'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_QUERY', issues: parsed.error.issues },
        },
        400,
      );
    }
    const whereParts = [eq(successionPlans.tenantId, auth.tenantId)];
    if (parsed.data.groupId) {
      whereParts.push(
        eq(successionPlans.estateGroupId, parsed.data.groupId),
      );
    }
    const rows = await db
      .select()
      .from(successionPlans)
      .where(and(...whereParts))
      .orderBy(asc(successionPlans.nextReviewDueAt))
      .limit(parsed.data.limit);
    return c.json({
      success: true,
      data: { plans: rows, count: rows.length },
    });
  });

  app.post('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'ESTATE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = createSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_BODY', issues: parsed.error.issues },
        },
        400,
      );
    }
    const id = randomUUID();
    const d = parsed.data;
    let auditHashId: string | null = null;
    try {
      auditHashId = await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.succession.create',
        details: { id, groupId: d.estateGroupId },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'succession audit append failed');
    }
    await db.insert(successionPlans).values({
      id,
      tenantId: auth.tenantId,
      estateGroupId: d.estateGroupId,
      currentPrincipalName: d.currentPrincipalName,
      designatedSuccessorName: d.designatedSuccessorName,
      designatedSuccessorRelation: d.designatedSuccessorRelation,
      designatedSuccessorNida: d.designatedSuccessorNida ?? null,
      contingencySuccessorName: d.contingencySuccessorName ?? null,
      willDocId: d.willDocId ?? null,
      nextReviewDueAt: new Date(d.nextReviewDueAt),
      notes: d.notes ?? null,
      auditHashId,
    });
    return c.json({ success: true, data: { id, auditHashId } }, 201);
  });

  app.patch('/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'ESTATE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const parsed = updateSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_BODY', issues: parsed.error.issues },
        },
        400,
      );
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v === undefined) continue;
      if (k === 'lastReviewAt' || k === 'nextReviewDueAt') {
        patch[k] = new Date(v as string);
      } else {
        patch[k] = v;
      }
    }
    const updated = await db
      .update(successionPlans)
      .set(patch)
      .where(
        and(
          eq(successionPlans.tenantId, auth.tenantId),
          eq(successionPlans.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'PLAN_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.succession.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'succession audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const estateSuccessionRouter = createEstateSuccessionRouter();

/**
 * /api/v1/ops/regulatory-filings — calendar + status of regulator
 * obligations.
 *
 * Wave: OPS-WIDE.
 *
 * Endpoints:
 *   GET    /                       list (regulator, status, dueBefore)
 *   POST   /                       create
 *   PATCH  /:id                    update (status, submittedAt, etc.)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  regulatoryFilings,
  REGULATORS,
  FILING_STATUSES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from './audit-helper';

const moduleLogger = createLogger('ops-regulatory-filings');

const listQuerySchema = z.object({
  regulator: z.enum(REGULATORS).optional(),
  status: z.enum(FILING_STATUSES).optional(),
  dueBefore: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const createBodySchema = z.object({
  regulator: z.enum(REGULATORS),
  filingType: z.string().trim().min(1).max(200),
  dueAt: z.string().datetime(),
  status: z.enum(FILING_STATUSES).default('upcoming'),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  payloadDocId: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateBodySchema = z.object({
  status: z.enum(FILING_STATUSES).optional(),
  submittedAt: z.string().datetime().nullable().optional(),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  payloadDocId: z.string().trim().max(120).nullable().optional(),
  decidedAt: z.string().datetime().nullable().optional(),
  decidedOutcome: z.string().trim().max(2000).nullable().optional(),
  feePaidTzs: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export function createRegulatoryFilingsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = listQuerySchema.safeParse({
      regulator: c.req.query('regulator'),
      status: c.req.query('status'),
      dueBefore: c.req.query('dueBefore'),
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
    const q = parsed.data;
    const whereParts = [eq(regulatoryFilings.tenantId, auth.tenantId)];
    if (q.regulator) {
      whereParts.push(eq(regulatoryFilings.regulator, q.regulator));
    }
    if (q.status) {
      whereParts.push(eq(regulatoryFilings.status, q.status));
    }
    if (q.dueBefore) {
      whereParts.push(lte(regulatoryFilings.dueAt, new Date(q.dueBefore)));
    }
    const rows = await db
      .select()
      .from(regulatoryFilings)
      .where(and(...whereParts))
      .orderBy(asc(regulatoryFilings.dueAt))
      .limit(q.limit);
    return c.json({
      success: true,
      data: { filings: rows, count: rows.length },
    });
  });

  app.post('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = createBodySchema.safeParse(body);
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
    await db.insert(regulatoryFilings).values({
      id,
      tenantId: auth.tenantId,
      regulator: d.regulator,
      filingType: d.filingType,
      dueAt: new Date(d.dueAt),
      status: d.status,
      referenceNo: d.referenceNo ?? null,
      payloadDocId: d.payloadDocId ?? null,
      notes: d.notes ?? null,
    });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.regulatory_filing.create',
        details: {
          id,
          regulator: d.regulator,
          filingType: d.filingType,
          dueAt: d.dueAt,
        },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'filing audit append failed');
    }
    return c.json({ success: true, data: { id } }, 201);
  });

  app.patch('/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateBodySchema.safeParse(body);
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
    const d = parsed.data;
    if (d.status !== undefined) patch.status = d.status;
    if (d.submittedAt !== undefined) {
      patch.submittedAt = d.submittedAt ? new Date(d.submittedAt) : null;
    }
    if (d.referenceNo !== undefined) patch.referenceNo = d.referenceNo;
    if (d.payloadDocId !== undefined) patch.payloadDocId = d.payloadDocId;
    if (d.decidedAt !== undefined) {
      patch.decidedAt = d.decidedAt ? new Date(d.decidedAt) : null;
    }
    if (d.decidedOutcome !== undefined) patch.decidedOutcome = d.decidedOutcome;
    if (d.feePaidTzs !== undefined) patch.feePaidTzs = String(d.feePaidTzs);
    if (d.notes !== undefined) patch.notes = d.notes;
    const updated = await db
      .update(regulatoryFilings)
      .set(patch)
      .where(
        and(
          eq(regulatoryFilings.tenantId, auth.tenantId),
          eq(regulatoryFilings.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'FILING_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.regulatory_filing.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'filing audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const regulatoryFilingsRouter = createRegulatoryFilingsRouter();

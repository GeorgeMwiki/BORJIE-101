/**
 * /api/v1/ops/engagements — interaction timeline per counterparty / site.
 *
 * Wave: OPS-WIDE.
 *
 * Endpoints:
 *   GET  /                       list (partyId, status)
 *   POST /                       log a new engagement
 *   PATCH /:id                   close / annotate
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  externalPartyEngagements,
  ENGAGEMENT_KINDS,
  ENGAGEMENT_STATUSES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from './audit-helper';

const moduleLogger = createLogger('ops-engagements');

const listQuerySchema = z.object({
  partyId: z.string().uuid().optional(),
  status: z.enum(ENGAGEMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createBodySchema = z.object({
  partyId: z.string().uuid(),
  siteId: z.string().nullable().optional(),
  kind: z.enum(ENGAGEMENT_KINDS),
  summary: z.string().trim().min(1).max(4000),
  docLinks: z.array(z.record(z.unknown())).default([]),
});

const updateBodySchema = z.object({
  status: z.enum(ENGAGEMENT_STATUSES).optional(),
  summary: z.string().trim().min(1).max(4000).optional(),
  closedAt: z.string().datetime().optional(),
});

export function createEngagementsRouter(): Hono {
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
      partyId: c.req.query('partyId'),
      status: c.req.query('status'),
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
    const whereParts = [
      eq(externalPartyEngagements.tenantId, auth.tenantId),
    ];
    if (q.partyId) {
      whereParts.push(eq(externalPartyEngagements.partyId, q.partyId));
    }
    if (q.status) {
      whereParts.push(eq(externalPartyEngagements.status, q.status));
    }
    const rows = await db
      .select()
      .from(externalPartyEngagements)
      .where(and(...whereParts))
      .orderBy(desc(externalPartyEngagements.openedAt))
      .limit(q.limit);
    return c.json({
      success: true,
      data: { engagements: rows, count: rows.length },
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
    const data = parsed.data;
    let auditHashId: string | null = null;
    try {
      auditHashId = await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.engagement.create',
        details: {
          id,
          partyId: data.partyId,
          kind: data.kind,
          siteId: data.siteId ?? null,
        },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'engagement audit append failed');
    }
    await db.insert(externalPartyEngagements).values({
      id,
      tenantId: auth.tenantId,
      partyId: data.partyId,
      siteId: data.siteId ?? null,
      kind: data.kind,
      summary: data.summary,
      docLinks: data.docLinks,
      auditHashId,
      createdBy: auth.userId ?? null,
    });
    return c.json({ success: true, data: { id, auditHashId } }, 201);
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
    const patch: Record<string, unknown> = {};
    const d = parsed.data;
    if (d.status !== undefined) patch.status = d.status;
    if (d.summary !== undefined) patch.summary = d.summary;
    if (d.closedAt !== undefined) patch.closedAt = new Date(d.closedAt);
    if (Object.keys(patch).length === 0) {
      return c.json(
        { success: false, error: { code: 'EMPTY_PATCH' } },
        400,
      );
    }
    const updated = await db
      .update(externalPartyEngagements)
      .set(patch)
      .where(
        and(
          eq(externalPartyEngagements.tenantId, auth.tenantId),
          eq(externalPartyEngagements.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'ENGAGEMENT_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.engagement.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'engagement audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const engagementsRouter = createEngagementsRouter();

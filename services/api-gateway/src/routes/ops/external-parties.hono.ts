// @ts-nocheck — Hono v4 TypedResponse widening across many c.json branches.
/**
 * /api/v1/ops/external-parties — counterparty registry.
 *
 * Wave: OPS-WIDE.
 *
 * Endpoints:
 *   GET    /                        list + filter (partyType, search)
 *   GET    /:id                     drill into one counterparty
 *   POST   /                        create
 *   PATCH  /:id                     update (partial)
 *   DELETE /:id                     soft-delete (status=blocked)
 *
 * Every mutating call appends to ai_audit_chain.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  externalParties,
  EXTERNAL_PARTY_TYPES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from './audit-helper';

const moduleLogger = createLogger('ops-external-parties');

const listQuerySchema = z.object({
  partyType: z.enum(EXTERNAL_PARTY_TYPES).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createBodySchema = z.object({
  partyType: z.enum(EXTERNAL_PARTY_TYPES),
  name: z.string().trim().min(1).max(300),
  tin: z.string().trim().max(64).nullable().optional(),
  brelaNo: z.string().trim().max(64).nullable().optional(),
  country: z.string().trim().min(2).max(8).default('TZ'),
  region: z.string().trim().max(120).nullable().optional(),
  primaryContact: z.record(z.unknown()).default({}),
  paymentTerms: z.record(z.unknown()).default({}),
  scorecardScore: z.coerce.number().min(0).max(99).default(0),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateBodySchema = createBodySchema.partial().extend({
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
});

export function createExternalPartiesRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // GET /
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
      partyType: c.req.query('partyType'),
      search: c.req.query('search'),
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
    const whereParts = [eq(externalParties.tenantId, auth.tenantId)];
    if (q.partyType) whereParts.push(eq(externalParties.partyType, q.partyType));
    if (q.status) whereParts.push(eq(externalParties.status, q.status));
    if (q.search) {
      whereParts.push(
        or(
          ilike(externalParties.name, `%${q.search}%`),
          ilike(externalParties.tin, `%${q.search}%`),
          ilike(externalParties.brelaNo, `%${q.search}%`),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(externalParties)
      .where(and(...whereParts))
      .orderBy(desc(externalParties.createdAt))
      .limit(q.limit);
    return c.json({
      success: true,
      data: { parties: rows, count: rows.length },
    });
  });

  // GET /:id
  app.get('/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const rows = await db
      .select()
      .from(externalParties)
      .where(
        and(
          eq(externalParties.tenantId, auth.tenantId),
          eq(externalParties.id, id),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json(
        { success: false, error: { code: 'PARTY_NOT_FOUND' } },
        404,
      );
    }
    return c.json({ success: true, data: { party: row } });
  });

  // POST /
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
    await db.insert(externalParties).values({
      id,
      tenantId: auth.tenantId,
      partyType: data.partyType,
      name: data.name,
      tin: data.tin ?? null,
      brelaNo: data.brelaNo ?? null,
      country: data.country,
      region: data.region ?? null,
      primaryContact: data.primaryContact,
      paymentTerms: data.paymentTerms,
      scorecardScore: String(data.scorecardScore),
      notes: data.notes ?? null,
    });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.external_parties.create',
        details: { id, partyType: data.partyType, name: data.name },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'audit append failed');
    }
    return c.json({ success: true, data: { id } }, 201);
  });

  // PATCH /:id
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
    if (d.partyType !== undefined) patch.partyType = d.partyType;
    if (d.name !== undefined) patch.name = d.name;
    if (d.tin !== undefined) patch.tin = d.tin;
    if (d.brelaNo !== undefined) patch.brelaNo = d.brelaNo;
    if (d.country !== undefined) patch.country = d.country;
    if (d.region !== undefined) patch.region = d.region;
    if (d.primaryContact !== undefined) patch.primaryContact = d.primaryContact;
    if (d.paymentTerms !== undefined) patch.paymentTerms = d.paymentTerms;
    if (d.scorecardScore !== undefined)
      patch.scorecardScore = String(d.scorecardScore);
    if (d.notes !== undefined) patch.notes = d.notes;
    if (d.status !== undefined) patch.status = d.status;
    const updated = await db
      .update(externalParties)
      .set(patch)
      .where(
        and(
          eq(externalParties.tenantId, auth.tenantId),
          eq(externalParties.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'PARTY_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.external_parties.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  // DELETE /:id  — soft-delete (status=blocked)
  app.delete('/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const updated = await db
      .update(externalParties)
      .set({ status: 'blocked', updatedAt: new Date() })
      .where(
        and(
          eq(externalParties.tenantId, auth.tenantId),
          eq(externalParties.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'PARTY_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.external_parties.block',
        details: { id },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const externalPartiesRouter = createExternalPartiesRouter();

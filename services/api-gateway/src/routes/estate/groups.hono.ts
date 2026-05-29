/**
 * /api/v1/estate/groups — top-level estate groups.
 *
 * Wave: ESTATE-OS.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  estateGroups,
  ESTATE_GROUP_HOLDING_TYPES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from '../ops/audit-helper';

const moduleLogger = createLogger('estate-groups');

const createSchema = z.object({
  name: z.string().trim().min(1).max(300),
  holdingType: z.enum(ESTATE_GROUP_HOLDING_TYPES),
  country: z.string().trim().min(2).max(8).default('TZ'),
  principalOwnerName: z.string().trim().min(1).max(300),
  principalOwnerNida: z.string().trim().max(64).nullable().optional(),
  principalOwnerTin: z.string().trim().max(64).nullable().optional(),
  foundingYear: z.coerce.number().int().min(1900).max(2200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = createSchema.partial();

export function createEstateGroupsRouter(): Hono {
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
    const rows = await db
      .select()
      .from(estateGroups)
      .where(eq(estateGroups.tenantId, auth.tenantId))
      .orderBy(desc(estateGroups.createdAt))
      .limit(200);
    return c.json({
      success: true,
      data: { groups: rows, count: rows.length },
    });
  });

  app.get('/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'ESTATE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const rows = await db
      .select()
      .from(estateGroups)
      .where(
        and(
          eq(estateGroups.tenantId, auth.tenantId),
          eq(estateGroups.id, id),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return c.json(
        { success: false, error: { code: 'GROUP_NOT_FOUND' } },
        404,
      );
    }
    return c.json({ success: true, data: { group: rows[0] } });
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
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
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
    await db.insert(estateGroups).values({
      id,
      tenantId: auth.tenantId,
      name: d.name,
      holdingType: d.holdingType,
      country: d.country,
      principalOwnerName: d.principalOwnerName,
      principalOwnerNida: d.principalOwnerNida ?? null,
      principalOwnerTin: d.principalOwnerTin ?? null,
      foundingYear: d.foundingYear ?? null,
      notes: d.notes ?? null,
    });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.group.create',
        details: { id, name: d.name, holdingType: d.holdingType },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'audit append failed');
    }
    return c.json({ success: true, data: { id } }, 201);
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
      if (v !== undefined) patch[k] = v;
    }
    const updated = await db
      .update(estateGroups)
      .set(patch)
      .where(
        and(
          eq(estateGroups.tenantId, auth.tenantId),
          eq(estateGroups.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'GROUP_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.group.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const estateGroupsRouter = createEstateGroupsRouter();

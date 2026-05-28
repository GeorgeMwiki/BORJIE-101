// @ts-nocheck — Hono v4 TypedResponse widening.
/**
 * /api/v1/estate/assets — asset register per estate entity.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  estateAssets,
  ESTATE_ASSET_CLASSES,
  ESTATE_VALUATION_METHODS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from '../ops/audit-helper';

const moduleLogger = createLogger('estate-assets');

const listQuerySchema = z.object({
  entityId: z.string().uuid().optional(),
  assetClass: z.enum(ESTATE_ASSET_CLASSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const createSchema = z.object({
  estateEntityId: z.string().uuid(),
  assetClass: z.enum(ESTATE_ASSET_CLASSES),
  descriptor: z.string().trim().min(1).max(400),
  acquiredAt: z.string().nullable().optional(),
  acquiredCostTzs: z.coerce.number().min(0).nullable().optional(),
  currentValueTzs: z.coerce.number().min(0).default(0),
  valuationMethod: z.enum(ESTATE_VALUATION_METHODS).default('book_value'),
  valuationAt: z.string().datetime().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  insuredUntil: z.string().nullable().optional(),
  encumbrances: z.array(z.record(z.unknown())).default([]),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = createSchema.partial().omit({ estateEntityId: true });

export function createEstateAssetsRouter(): Hono {
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
      entityId: c.req.query('entityId'),
      assetClass: c.req.query('assetClass'),
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
    const whereParts = [eq(estateAssets.tenantId, auth.tenantId)];
    if (parsed.data.entityId) {
      whereParts.push(eq(estateAssets.estateEntityId, parsed.data.entityId));
    }
    if (parsed.data.assetClass) {
      whereParts.push(eq(estateAssets.assetClass, parsed.data.assetClass));
    }
    const rows = await db
      .select()
      .from(estateAssets)
      .where(and(...whereParts))
      .orderBy(desc(estateAssets.valuationAt))
      .limit(parsed.data.limit);
    return c.json({
      success: true,
      data: { assets: rows, count: rows.length },
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
    await db.insert(estateAssets).values({
      id,
      tenantId: auth.tenantId,
      estateEntityId: d.estateEntityId,
      assetClass: d.assetClass,
      descriptor: d.descriptor,
      acquiredAt: d.acquiredAt ?? null,
      acquiredCostTzs:
        d.acquiredCostTzs !== null && d.acquiredCostTzs !== undefined
          ? String(d.acquiredCostTzs)
          : null,
      currentValueTzs: String(d.currentValueTzs),
      valuationMethod: d.valuationMethod,
      valuationAt: d.valuationAt ? new Date(d.valuationAt) : new Date(),
      location: d.location ?? null,
      insuredUntil: d.insuredUntil ?? null,
      encumbrances: d.encumbrances,
      notes: d.notes ?? null,
    });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.asset.create',
        details: {
          id,
          entityId: d.estateEntityId,
          assetClass: d.assetClass,
        },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'asset audit append failed');
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
      if (v === undefined) continue;
      if (k === 'acquiredCostTzs' || k === 'currentValueTzs') {
        patch[k] = v === null ? null : String(v);
      } else if (k === 'valuationAt') {
        patch[k] = new Date(v as string);
      } else {
        patch[k] = v;
      }
    }
    const updated = await db
      .update(estateAssets)
      .set(patch)
      .where(
        and(
          eq(estateAssets.tenantId, auth.tenantId),
          eq(estateAssets.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'ASSET_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.asset.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'asset audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const estateAssetsRouter = createEstateAssetsRouter();

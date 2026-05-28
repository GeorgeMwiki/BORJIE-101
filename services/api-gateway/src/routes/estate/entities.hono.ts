// @ts-nocheck — Hono v4 TypedResponse widening.
/**
 * /api/v1/estate/entities — subsidiaries / JVs / standalone holdings.
 *
 * Supports `?tree=1` to return a hierarchical structure rooted at
 * each estate_group, ordered by status then created_at.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  estateEntities,
  ESTATE_ENTITY_KINDS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from '../ops/audit-helper';

const moduleLogger = createLogger('estate-entities');

const listQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  kind: z.enum(ESTATE_ENTITY_KINDS).optional(),
  tree: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const createSchema = z.object({
  estateGroupId: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  kind: z.enum(ESTATE_ENTITY_KINDS),
  brelaNo: z.string().trim().max(64).nullable().optional(),
  tin: z.string().trim().max(64).nullable().optional(),
  ownershipPct: z.coerce.number().min(0).max(100).default(100),
  parentEntityId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'dormant', 'divested', 'closed']).default('active'),
  foundedAt: z.string().nullable().optional(),
  divestedAt: z.string().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = createSchema.partial().omit({ estateGroupId: true });

interface EntityRow {
  readonly id: string;
  readonly parentEntityId: string | null;
}

interface TreeNode {
  readonly entity: EntityRow;
  readonly children: TreeNode[];
}

function buildTree(rows: ReadonlyArray<EntityRow>): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const e of rows) {
    byId.set(e.id, { entity: e, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const e of rows) {
    const node = byId.get(e.id)!;
    if (e.parentEntityId && byId.has(e.parentEntityId)) {
      byId.get(e.parentEntityId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function createEstateEntitiesRouter(): Hono {
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
      kind: c.req.query('kind'),
      tree: c.req.query('tree'),
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
    const whereParts = [eq(estateEntities.tenantId, auth.tenantId)];
    if (q.groupId) whereParts.push(eq(estateEntities.estateGroupId, q.groupId));
    if (q.kind) whereParts.push(eq(estateEntities.kind, q.kind));
    const rows = await db
      .select()
      .from(estateEntities)
      .where(and(...whereParts))
      .orderBy(asc(estateEntities.createdAt))
      .limit(q.limit);
    if (q.tree) {
      const tree = buildTree(rows as ReadonlyArray<EntityRow>);
      return c.json({
        success: true,
        data: { tree, count: rows.length },
      });
    }
    return c.json({
      success: true,
      data: { entities: rows, count: rows.length },
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
    await db.insert(estateEntities).values({
      id,
      tenantId: auth.tenantId,
      estateGroupId: d.estateGroupId,
      name: d.name,
      kind: d.kind,
      brelaNo: d.brelaNo ?? null,
      tin: d.tin ?? null,
      ownershipPct: String(d.ownershipPct),
      parentEntityId: d.parentEntityId ?? null,
      status: d.status,
      foundedAt: d.foundedAt ?? null,
      divestedAt: d.divestedAt ?? null,
      notes: d.notes ?? null,
    });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.entity.create',
        details: { id, name: d.name, kind: d.kind, groupId: d.estateGroupId },
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
      if (v !== undefined) {
        if (k === 'ownershipPct') patch[k] = String(v);
        else patch[k] = v;
      }
    }
    const updated = await db
      .update(estateEntities)
      .set(patch)
      .where(
        and(
          eq(estateEntities.tenantId, auth.tenantId),
          eq(estateEntities.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'ENTITY_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.entity.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  return app;
}

export const estateEntitiesRouter = createEstateEntitiesRouter();

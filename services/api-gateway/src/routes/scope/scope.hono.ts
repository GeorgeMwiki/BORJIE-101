// @ts-nocheck — Hono v4 TypedResponse widening.
/**
 * /api/v1/scope — taxonomy tree + label preferences.
 *
 * Wave: SCOPE-SEGMENTATION.
 *
 * Endpoints:
 *   GET    /nodes                    list nodes (filter by kind, parent)
 *   POST   /nodes                    create node
 *   PATCH  /nodes/:id                update node
 *   DELETE /nodes/:id                soft-delete (active=false)
 *   GET    /taxonomy                 read tenant display-label preferences
 *   PUT    /taxonomy                 upsert display-label preferences
 *   GET    /recent-entities          recent scope nodes by kind (for
 *                                    the mobile chat composer @-menu)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  scopeNodes,
  scopeTaxonomyPreferences,
  SCOPE_NODE_KINDS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from '../ops/audit-helper';

const moduleLogger = createLogger('scope-routes');

const listNodesQuerySchema = z.object({
  kind: z.enum(SCOPE_NODE_KINDS).optional(),
  parentId: z.string().uuid().nullable().optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

const createNodeSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  kindCanonical: z.enum(SCOPE_NODE_KINDS),
  name: z.string().trim().min(1).max(300),
  identifiers: z.record(z.unknown()).default({}),
  attributes: z.record(z.unknown()).default({}),
});

const updateNodeSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  identifiers: z.record(z.unknown()).optional(),
  attributes: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const taxonomyUpsertSchema = z.object({
  displayLabelEn: z.record(z.string()).default({}),
  displayLabelSw: z.record(z.string()).default({}),
  defaultKind: z.enum(SCOPE_NODE_KINDS).default('site'),
});

export function createScopeRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/nodes', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = listNodesQuerySchema.safeParse({
      kind: c.req.query('kind'),
      parentId: c.req.query('parentId'),
      active: c.req.query('active'),
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
    const whereParts = [eq(scopeNodes.tenantId, auth.tenantId)];
    if (q.kind) whereParts.push(eq(scopeNodes.kindCanonical, q.kind));
    if (q.parentId) whereParts.push(eq(scopeNodes.parentId, q.parentId));
    if (q.active !== undefined) whereParts.push(eq(scopeNodes.active, q.active));
    const rows = await db
      .select()
      .from(scopeNodes)
      .where(and(...whereParts))
      .orderBy(asc(scopeNodes.name))
      .limit(q.limit);
    return c.json({
      success: true,
      data: { nodes: rows, count: rows.length },
    });
  });

  app.post('/nodes', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = createNodeSchema.safeParse(
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
    await db.insert(scopeNodes).values({
      id,
      tenantId: auth.tenantId,
      parentId: d.parentId ?? null,
      kindCanonical: d.kindCanonical,
      name: d.name,
      identifiers: d.identifiers,
      attributes: d.attributes,
    });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'scope.node.create',
        details: { id, kind: d.kindCanonical, name: d.name },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'scope audit append failed');
    }
    return c.json({ success: true, data: { id } }, 201);
  });

  app.patch('/nodes/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const parsed = updateNodeSchema.safeParse(
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
      .update(scopeNodes)
      .set(patch)
      .where(
        and(
          eq(scopeNodes.tenantId, auth.tenantId),
          eq(scopeNodes.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'NODE_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'scope.node.update',
        details: { id, patch: parsed.data },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'scope audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  app.delete('/nodes/:id', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const id = c.req.param('id');
    const updated = await db
      .update(scopeNodes)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(scopeNodes.tenantId, auth.tenantId),
          eq(scopeNodes.id, id),
        ),
      )
      .returning();
    if (updated.length === 0) {
      return c.json(
        { success: false, error: { code: 'NODE_NOT_FOUND' } },
        404,
      );
    }
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'scope.node.deactivate',
        details: { id },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'scope audit append failed');
    }
    return c.json({ success: true, data: { id } });
  });

  app.get('/taxonomy', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const rows = await db
      .select()
      .from(scopeTaxonomyPreferences)
      .where(eq(scopeTaxonomyPreferences.tenantId, auth.tenantId))
      .limit(1);
    if (rows.length === 0) {
      return c.json({
        success: true,
        data: {
          taxonomy: null,
        },
      });
    }
    return c.json({ success: true, data: { taxonomy: rows[0] } });
  });

  app.put('/taxonomy', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = taxonomyUpsertSchema.safeParse(
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
    const d = parsed.data;
    await db
      .insert(scopeTaxonomyPreferences)
      .values({
        tenantId: auth.tenantId,
        displayLabelEn: d.displayLabelEn,
        displayLabelSw: d.displayLabelSw,
        defaultKind: d.defaultKind,
      })
      .onConflictDoUpdate({
        target: scopeTaxonomyPreferences.tenantId,
        set: {
          displayLabelEn: d.displayLabelEn,
          displayLabelSw: d.displayLabelSw,
          defaultKind: d.defaultKind,
          updatedAt: new Date(),
        },
      });
    try {
      await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'scope.taxonomy.upsert',
        details: { defaultKind: d.defaultKind },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'taxonomy audit append failed');
    }
    return c.json({ success: true });
  });

  // GET /recent-entities — feed for the mobile chat composer @-menu.
  // Returns recent scope nodes filtered by kind, keyed for the @-menu
  // typeahead. Bilingual labels are derived from `name` for now; the
  // taxonomy preferences upsert provides display labels later.
  app.get('/recent-entities', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'SCOPE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const kindParam = c.req.query('kind');
    const limitParam = c.req.query('limit');
    const limit = Math.min(
      Math.max(Number.parseInt(String(limitParam ?? '20'), 10) || 20, 1),
      50,
    );
    const ALLOWED = ['parcel', 'licence', 'employee', 'scope_node'] as const;
    type Allowed = (typeof ALLOWED)[number];
    const isAllowed = (k: string): k is Allowed =>
      (ALLOWED as readonly string[]).includes(k);
    const requestedKind = typeof kindParam === 'string' && isAllowed(kindParam)
      ? kindParam
      : null;
    // For now we surface scope nodes the user can @-mention; the
    // taxonomy maps parcel/licence/employee to scope-node kinds.
    const lookupKind = requestedKind === 'employee'
      ? 'employee'
      : requestedKind === 'parcel'
        ? 'parcel'
        : requestedKind === 'licence'
          ? 'licence'
          : 'site';
    const whereParts = [
      eq(scopeNodes.tenantId, auth.tenantId),
      eq(scopeNodes.active, true),
    ];
    // kind-filter only when the schema actually has that enum value;
    // SCOPE_NODE_KINDS is the source of truth.
    if ((SCOPE_NODE_KINDS as readonly string[]).includes(lookupKind)) {
      whereParts.push(eq(scopeNodes.kindCanonical, lookupKind as any));
    }
    const rows = await db
      .select()
      .from(scopeNodes)
      .where(and(...whereParts))
      .orderBy(asc(scopeNodes.name))
      .limit(limit);
    return c.json({
      success: true,
      data: {
        entities: rows.map((r: { id: string; name: string; kindCanonical: string }) => ({
          id: r.id,
          label: { en: r.name, sw: r.name },
          kind: r.kindCanonical,
        })),
        count: rows.length,
        requestedKind: requestedKind ?? 'scope_node',
      },
    });
  });

  return app;
}

export const scopeRouter = createScopeRouter();

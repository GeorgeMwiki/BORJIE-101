// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/licences — TZ mining licences + licence-events.
 *
 * Routes:
 *   GET  /              list licences (filter by kind, status, mineral)
 *   GET  /:id           fetch one
 *   POST /              create (admin-only)
 *   POST /:id/renew     register renewal event + extend expiry
 *
 * Migrated to `@hono/zod-openapi` (issue #19). Route defs live in
 * `./_openapi/route-defs.ts`; this file only carries handlers.
 *
 * Auth: licence creation is admin-only. The role guard is wired as a
 * route-level middleware (registered against the same `POST /` path
 * the create handler binds to) so it short-circuits before the create
 * handler ever runs.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { licences, licenceEvents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import {
  licencesListRoute,
  licencesGetRoute,
  licencesCreateRoute,
  licencesRenewRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// Method-aware role guard for POST `/` only. Hono's `app.use('/', ...)`
// matches the exact path the create route binds to (`createRoute({
// method: 'post', path: '/' })`), and the inner method check lets the
// list-licences GET pass through to its handler unguarded.
app.use('/', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const guard = requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.TENANT_ADMIN,
  );
  return guard(c, next);
});

app.openapi(licencesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(licences.tenantId, tenantId)];
  if (q.kind) conds.push(eq(licences.kind, q.kind));
  if (q.status) conds.push(eq(licences.status, q.status));
  if (q.mineral) conds.push(eq(licences.mineral, q.mineral));
  const rows = await db
    .select()
    .from(licences)
    .where(and(...conds))
    .orderBy(desc(licences.updatedAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(licencesGetRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const { id } = c.req.valid('param');
  const [row] = await db
    .select()
    .from(licences)
    .where(and(eq(licences.id, id), eq(licences.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Licence not found' },
      },
      404,
    );
  }
  return c.json({ success: true as const, data: row }, 200);
});

app.openapi(
  licencesCreateRoute,
  withSecurityEvents(
    { action: 'mining.licence.create', resource: 'mining.licence', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const now = new Date();
      const [row] = await db
        .insert(licences)
        .values({
          id: randomUUID(),
          tenantId,
          companyId: input.companyId,
          kind: input.kind,
          number: input.number,
          mineral: input.mineral,
          holderUserId: input.holderUserId ?? null,
          grantDate: input.grantDate ?? null,
          expiryDate: input.expiryDate ?? null,
          areaHa: input.areaHa ?? null,
          polygon: input.polygon ?? null,
          status: 'active',
          fees: input.fees ?? {},
          obligations: input.obligations ?? {},
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  licencesRenewRoute,
  withSecurityEvents(
    { action: 'mining.licence.renew', resource: 'mining.licence', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const [updated] = await db
        .update(licences)
        .set({ expiryDate: input.newExpiryDate, status: 'active', updatedAt: new Date() })
        .where(and(eq(licences.id, id), eq(licences.tenantId, tenantId)))
        .returning();
      if (!updated) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Licence not found' },
          },
          404,
        );
      }
      const [event] = await db
        .insert(licenceEvents)
        .values({
          id: randomUUID(),
          tenantId,
          licenceId: id,
          kind: 'renewal_due',
          summary: input.summary ?? `Renewed until ${input.newExpiryDate}`,
          dueDate: input.newExpiryDate,
          status: 'completed',
          payload: {
            feePaidTzs: input.feePaidTzs ?? null,
            referenceNo: input.referenceNo ?? null,
          },
          evidenceIds: input.evidenceIds ?? [],
          createdAt: new Date(),
          closedAt: new Date(),
        })
        .returning();
      return c.json(
        { success: true as const, data: { licence: updated, event } },
        201,
      );
    },
  ),
);

export const miningLicencesRouter = app;

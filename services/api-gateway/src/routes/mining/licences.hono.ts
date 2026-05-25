// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/licences — TZ mining licences + licence-events.
 *
 * Routes:
 *   GET  /              list licences (filter by kind, status, mineral)
 *   GET  /:id           fetch one
 *   POST /              create (admin-only)
 *   POST /:id/renew     register renewal event + extend expiry
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { licences, licenceEvents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const KindEnum = z.enum([
  'PL', 'PML', 'ML', 'SML',
  'DEALER', 'BROKER', 'PROCESSING', 'SMELTING', 'REFINING',
]);

const CreateLicenceSchema = z.object({
  companyId: z.string().min(1),
  kind: KindEnum,
  number: z.string().min(1).max(120),
  mineral: z.string().min(1).max(80),
  holderUserId: z.string().optional(),
  grantDate: z.string().optional(),
  expiryDate: z.string().optional(),
  areaHa: z.string().optional(),
  polygon: z.string().optional(),
  fees: z.record(z.unknown()).optional(),
  obligations: z.record(z.unknown()).optional(),
});

const RenewSchema = z.object({
  newExpiryDate: z.string().min(8),
  feePaidTzs: z.number().int().nonnegative().optional(),
  referenceNo: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  summary: z.string().max(2000).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const kind = c.req.query('kind');
  const status = c.req.query('status');
  const mineral = c.req.query('mineral');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(licences.tenantId, tenantId)];
  if (kind) conds.push(eq(licences.kind, kind));
  if (status) conds.push(eq(licences.status, status));
  if (mineral) conds.push(eq(licences.mineral, mineral));
  const rows = await db
    .select()
    .from(licences)
    .where(and(...conds))
    .orderBy(desc(licences.updatedAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.get('/:id', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(licences)
    .where(and(eq(licences.id, id), eq(licences.tenantId, tenantId)))
    .limit(1);
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Licence not found' } }, 404);
  return c.json({ success: true, data: row });
});

app.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN),
  zValidator('json', CreateLicenceSchema),
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.post(
  '/:id/renew',
  zValidator('json', RenewSchema),
  withSecurityEvents(
    { action: 'mining.licence.renew', resource: 'mining.licence', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db');
      const id = c.req.param('id');
      const input = c.req.valid('json');
      const [updated] = await db
        .update(licences)
        .set({ expiryDate: input.newExpiryDate, status: 'active', updatedAt: new Date() })
        .where(and(eq(licences.id, id), eq(licences.tenantId, tenantId)))
        .returning();
      if (!updated) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Licence not found' } }, 404);
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
          payload: { feePaidTzs: input.feePaidTzs ?? null, referenceNo: input.referenceNo ?? null },
          evidenceIds: input.evidenceIds ?? [],
          createdAt: new Date(),
          closedAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: { licence: updated, event } }, 201);
    },
  ),
);

export const miningLicencesRouter = app;

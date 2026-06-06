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
import { and, asc, desc, eq } from 'drizzle-orm';
import { licences, licenceEvents, sites } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { UserRole } from '../../types/user-role';
import {
  buildLicenceCockpit,
  type LicenceEventInput,
} from './licence-cockpit-projection';
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

// GET /{id} — the per-licence COCKPIT projection (OW-5). Computed REAL from
// `licences` + `licence_events` (payments) + the linked site name (+ ledger
// is reflected through the payment-event amounts). Returns a proper 404 when
// the licence does not exist for the tenant — never a raw row, never a 200
// with a fabricated body.
app.openapi(licencesGetRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const { id } = c.req.valid('param');

  const [row] = await db
    .select({
      id: licences.id,
      number: licences.number,
      mineral: licences.mineral,
      expiryDate: licences.expiryDate,
      dormancyScore: licences.dormancyScore,
      obligations: licences.obligations,
    })
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

  // Linked site name (first site on this licence) — best-effort; an empty
  // string is honest when the licence has no site yet.
  const [site] = await db
    .select({ name: sites.name })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.licenceId, id)))
    .orderBy(asc(sites.createdAt))
    .limit(1);

  // Money-bearing + renewal events drive the payment history + nothing is
  // fabricated: an empty list is returned when there are none.
  const eventRows = await db
    .select({
      kind: licenceEvents.kind,
      summary: licenceEvents.summary,
      dueDate: licenceEvents.dueDate,
      status: licenceEvents.status,
      payload: licenceEvents.payload,
      closedAt: licenceEvents.closedAt,
      createdAt: licenceEvents.createdAt,
    })
    .from(licenceEvents)
    .where(and(eq(licenceEvents.tenantId, tenantId), eq(licenceEvents.licenceId, id)))
    .orderBy(desc(licenceEvents.createdAt))
    .limit(200);

  const events: ReadonlyArray<LicenceEventInput> = eventRows.map((e) => ({
    kind: e.kind,
    summary: e.summary ?? null,
    dueDate: e.dueDate ?? null,
    status: e.status,
    payload: (e.payload ?? null) as Record<string, unknown> | null,
    closedAt: e.closedAt ?? null,
    createdAt: e.createdAt,
  }));

  const cockpit = buildLicenceCockpit({
    licence: {
      id: row.id,
      number: row.number,
      mineral: row.mineral,
      expiryDate: row.expiryDate ?? null,
      dormancyScore: row.dormancyScore ?? null,
      obligations: (row.obligations ?? null) as Record<string, unknown> | null,
    },
    siteName: site?.name ?? '',
    events,
    now: new Date(),
  });

  // Project onto the OpenAPI response schema (mutable arrays — the zod-
  // inferred type is not ReadonlyArray, so map the readonly projection arrays
  // into fresh mutable ones).
  return c.json(
    {
      success: true as const,
      data: {
        id: cockpit.id,
        reference: cockpit.reference,
        mineral: cockpit.mineral,
        siteName: cockpit.siteName,
        windowOpensAt: cockpit.windowOpensAt,
        windowClosesAt: cockpit.windowClosesAt,
        daysToWindow: cockpit.daysToWindow,
        dormancyScore: cockpit.dormancyScore,
        dormancyCitation: cockpit.dormancyCitation,
        payments: cockpit.payments.map((p) => ({
          date: p.date,
          description: p.description,
          amountTzs: p.amountTzs,
          status: p.status,
        })),
        renewalPackCompletePct: cockpit.renewalPackCompletePct,
        renewalPackMissing: [...cockpit.renewalPackMissing],
      },
    },
    200,
  );
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
      const { tenantId, userId } = c.get('auth');
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

      // RT-1: pulse the owner cockpit "Compliance" tile within 200 ms.
      setImmediate(() => {
        try {
          publishCockpitEvent({
            kind: 'licence.renewed',
            tenantId,
            emittedAt: new Date().toISOString(),
            licenceId: id,
            licenceKind: updated.kind,
            renewedThrough: String(input.newExpiryDate),
            renewedBy: userId,
          });
        } catch {
          // bus failures must never leak to the request response.
        }
      });

      return c.json(
        { success: true as const, data: { licence: updated, event } },
        201,
      );
    },
  ),
);

export const miningLicencesRouter = app;

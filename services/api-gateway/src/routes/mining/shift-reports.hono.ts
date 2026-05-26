/**
 * /api/v1/mining/shift-reports — daily shift roll-ups per site.
 *
 * Routes:
 *   GET    /              list (filter by siteId, fromDate, toDate)
 *   POST   /              create — photos, fuel, blockers, voice-notes ref
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { shiftReports } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  shiftReportsListRoute,
  shiftReportsCreateRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(shiftReportsListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(shiftReports.tenantId, tenantId)];
  if (q.siteId) conds.push(eq(shiftReports.siteId, q.siteId));
  if (q.fromDate) conds.push(gte(shiftReports.shiftDate, q.fromDate));
  if (q.toDate) conds.push(lte(shiftReports.shiftDate, q.toDate));
  const rows = await db
    .select()
    .from(shiftReports)
    .where(and(...conds))
    .orderBy(desc(shiftReports.shiftDate))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  shiftReportsCreateRoute,
  withSecurityEvents(
    {
      action: 'mining.shift_report.create',
      resource: 'mining.shift_report',
      severity: 'info',
    },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(shiftReports)
        .values({
          id: randomUUID(),
          tenantId,
          siteId: input.siteId,
          supervisorUserId: userId,
          shiftDate: input.shiftDate,
          shiftKind: input.shiftKind,
          workersPresent: input.workersPresent ?? null,
          machineHours: input.machineHours ?? {},
          fuelLitres: input.fuelLitres ?? null,
          metresAdvanced: input.metresAdvanced ?? null,
          bcmOverburden: input.bcmOverburden ?? null,
          romTonnes: input.romTonnes ?? null,
          blastsFired: input.blastsFired,
          delays: input.delays ?? [],
          incidents: input.incidents ?? [],
          photos: input.photos ?? [],
          nextShiftPlan: input.nextShiftPlan
            ? input.voiceNoteRef
              ? `${input.nextShiftPlan} [voice:${input.voiceNoteRef}]`
              : input.nextShiftPlan
            : input.voiceNoteRef
              ? `[voice:${input.voiceNoteRef}]`
              : null,
          signedOffAt: null,
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningShiftReportsRouter = app;

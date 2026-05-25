// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/shift-reports — daily shift roll-ups per site.
 *
 * Routes:
 *   GET    /              list (filter by siteId, fromDate, toDate)
 *   POST   /              create — photos, fuel, blockers, voice-notes ref
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { shiftReports } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ShiftKindEnum = z.enum(['day', 'night']);

const DelaySchema = z.object({
  code: z.string(),
  minutes: z.number().int().nonnegative(),
  description: z.string().optional(),
});

const CreateShiftReportSchema = z.object({
  siteId: z.string().min(1),
  shiftDate: z.string().min(8),
  shiftKind: ShiftKindEnum.default('day'),
  workersPresent: z.number().int().nonnegative().optional(),
  machineHours: z.record(z.number()).optional(),
  fuelLitres: z.string().optional(),
  metresAdvanced: z.string().optional(),
  bcmOverburden: z.string().optional(),
  romTonnes: z.string().optional(),
  blastsFired: z.number().int().nonnegative().default(0),
  delays: z.array(DelaySchema).optional(),
  incidents: z.array(z.record(z.unknown())).optional(),
  photos: z.array(z.string()).optional(),
  voiceNoteRef: z.string().optional(),
  nextShiftPlan: z.string().max(4000).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  const fromDate = c.req.query('fromDate');
  const toDate = c.req.query('toDate');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const conds = [eq(shiftReports.tenantId, tenantId)];
  if (siteId) conds.push(eq(shiftReports.siteId, siteId));
  if (fromDate) conds.push(gte(shiftReports.shiftDate, fromDate));
  if (toDate) conds.push(lte(shiftReports.shiftDate, toDate));
  const rows = await db
    .select()
    .from(shiftReports)
    .where(and(...conds))
    .orderBy(desc(shiftReports.shiftDate))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', CreateShiftReportSchema),
  withSecurityEvents(
    { action: 'mining.shift_report.create', resource: 'mining.shift_report', severity: 'info' },
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
            ? (input.voiceNoteRef
                ? `${input.nextShiftPlan} [voice:${input.voiceNoteRef}]`
                : input.nextShiftPlan)
            : (input.voiceNoteRef ? `[voice:${input.voiceNoteRef}]` : null),
          signedOffAt: null,
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningShiftReportsRouter = app;

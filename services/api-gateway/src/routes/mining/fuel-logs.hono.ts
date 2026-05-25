// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/fuel-logs — fuel issued or consumed per asset.
 *
 * Routes:
 *   POST  /   create fuel log (worker-only)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { fuelLogs } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const FuelKindEnum = z.enum(['diesel', 'petrol', 'lubricant', 'other']);

const CreateFuelLogSchema = z.object({
  assetId: z.string().min(1),
  siteId: z.string().optional(),
  logDate: z.string().min(8),
  fuelKind: FuelKindEnum.default('diesel'),
  litres: z.string().min(1),
  pricePerLitreTzs: z.string().optional(),
  totalCostTzs: z.string().optional(),
  meterReading: z.string().optional(),
  receivedByUserId: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

const WORKER_ROLES = [
  UserRole.MAINTENANCE_STAFF,
  UserRole.PROPERTY_MANAGER,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
];

app.post(
  '/',
  requireRole(...WORKER_ROLES),
  zValidator('json', CreateFuelLogSchema),
  withSecurityEvents(
    { action: 'mining.fuel_log.create', resource: 'mining.fuel_log', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(fuelLogs)
        .values({
          id: randomUUID(),
          tenantId,
          assetId: input.assetId,
          siteId: input.siteId ?? null,
          logDate: input.logDate,
          fuelKind: input.fuelKind,
          litres: input.litres,
          pricePerLitreTzs: input.pricePerLitreTzs ?? null,
          totalCostTzs: input.totalCostTzs ?? null,
          meterReading: input.meterReading ?? null,
          issuedByUserId: userId,
          receivedByUserId: input.receivedByUserId ?? null,
          evidenceIds: input.evidenceIds ?? [],
          notes: input.notes ?? null,
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const miningFuelLogsRouter = app;

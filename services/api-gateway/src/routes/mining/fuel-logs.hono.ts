// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/fuel-logs — fuel issued or consumed per asset.
 *
 * Routes:
 *   POST  /   create fuel log (worker-only)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { fuelLogs } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { fuelLogsCreateRoute } from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const WORKER_ROLES = [
  UserRole.MAINTENANCE_STAFF,
  UserRole.PROPERTY_MANAGER,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
];

app.openapi(
  { ...fuelLogsCreateRoute, middleware: [requireRole(...WORKER_ROLES)] },
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
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

export const miningFuelLogsRouter = app;

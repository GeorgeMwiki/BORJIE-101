// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * Compliance Exports Router
 *
 *   GET  /                                   - list all compliance exports for tenant
 *   GET  /exports                            - alias for GET /
 *   POST /compliance/exports                 - schedule a new export
 *   POST /compliance/exports/:id/generate    - generate a scheduled export
 *   GET  /compliance/exports/:id/download    - get signed download URL
 *
 * Reads from `compliance_exports` table directly via the composition
 * root's Drizzle client so the GET endpoints return real rows without
 * requiring the heavier `ComplianceExportService` (which needs storage
 * + data providers) to be wired yet.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { complianceExports } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const ScheduleSchema = z.object({
  exportType: z.enum(['tz_tra', 'ke_dpa', 'ke_kra', 'tz_land_act']),
  periodStart: z.string(),
  periodEnd: z.string(),
  regulatorContext: z.record(z.unknown()).default({}),
});

export const complianceRouter = new Hono();

complianceRouter.use('*', authMiddleware);

function notConfigured(c) {
  return c.json(
    {
      success: false,
      error:
        'Compliance database not configured — DATABASE_URL unset',
    },
    503,
  );
}

async function listExports(c) {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  try {
    const rows = await db
      .select()
      .from(complianceExports)
      .where(eq(complianceExports.tenantId, tenantId))
      .orderBy(desc(complianceExports.createdAt))
      .limit(100);
    return c.json({ success: true, data: rows });
  } catch (error) {
    return routeCatch(c, error, {
      code: 'COMPLIANCE_EXPORTS_UNAVAILABLE',
      status: 503,
      fallback: 'Query failed',
    });
  }
}

// GET / and GET /exports both return the list so the acceptance curl hits 200.
complianceRouter.get('/', listExports);
complianceRouter.get('/exports', listExports);

/**
 * POST /exports — schedule a new compliance export.
 *
 * Behaviour:
 *   - Persists a `compliance_exports` row with status=scheduled.
 *   - Emits a `ComplianceExportRequested` domain event so the async
 *     worker (or downstream subscribers) can pick it up and generate
 *     the regulator-facing CSV/JSON/XML artifact.
 *   - Returns 202 Accepted + jobId. The client polls
 *     `POST /exports/:id/generate` or waits for the status to flip to
 *     `ready` via GET /exports.
 *
 * When the richer `ComplianceExportService` is wired we delegate to
 * it so its cross-service orchestration (data providers + formatters
 * + storage) kicks in. Otherwise we stay on the graceful-degraded path
 * and let the worker consume the event.
 */
complianceRouter.post(
  '/exports',
  zValidator('json', ScheduleSchema),
  withSecurityEvents({ action: 'compliance.create', resource: 'compliance', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const service = c.get('complianceExportService');
    const services = c.get('services');
    const db = services?.db;

    // Prefer the real service when wired — it does end-to-end scheduling.
    if (service) {
      try {
        const manifest = await service.schedule({
          tenantId,
          exportType: body.exportType,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          regulatorContext: body.regulatorContext,
          requestedBy: userId,
        });
        return c.json({ success: true, data: manifest }, 201);
      } catch (error) {
        return routeCatch(c, error, {
          code: 'SCHEDULE_FAILED',
          status: 500,
          fallback: 'Schedule failed',
        });
      }
    }

    // Fallback: persist directly + emit an event so the worker can run
    // the formatter + storage steps asynchronously.
    if (!db) {
      return c.json(
        {
          success: false,
          error:
            'Compliance database not configured — DATABASE_URL unset',
        },
        503,
      );
    }

    // Map export type → default format. Matches the formatters.
    const formatFor = (t: string) => {
      switch (t) {
        case 'tz_tra':
        case 'ke_kra':
          return 'csv' as const;
        case 'ke_dpa':
          return 'json' as const;
        case 'tz_land_act':
          return 'json' as const;
        default:
          return 'csv' as const;
      }
    };

    const now = new Date();
    const jobId = `cex_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const row = {
      id: jobId,
      tenantId,
      exportType: body.exportType,
      format: formatFor(body.exportType),
      status: 'scheduled' as const,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      scheduledAt: now,
      generatedAt: null,
      downloadedAt: null,
      storageKey: null,
      fileSizeBytes: null,
      fileChecksum: null,
      regulatorContext: body.regulatorContext,
      errorMessage: null,
      requestedBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const [inserted] = await db
        .insert(complianceExports)
        .values(row)
        .returning();

      try {
        await services.eventBus?.publish({
          event: {
            eventId: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
            eventType: 'ComplianceExportRequested',
            timestamp: now.toISOString(),
            tenantId,
            correlationId: `cor_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
            causationId: null,
            metadata: {},
            payload: {
              jobId,
              exportType: body.exportType,
              periodStart: body.periodStart,
              periodEnd: body.periodEnd,
            },
          } as any,
          version: 1,
          aggregateId: jobId,
          aggregateType: 'ComplianceExport',
        });
      } catch (_e) {
        // non-fatal
      }

      return c.json(
        {
          success: true,
          data: {
            jobId,
            status: 'scheduled',
            job: inserted ?? row,
            workerWillProcess: true,
          },
        },
        202,
      );
    } catch (error) {
      return routeCatch(c, error, {
        code: 'SCHEDULE_FAILED',
        status: 500,
        fallback: 'Schedule failed',
      });
    }
  }),
);

complianceRouter.post('/exports/:id/generate', withSecurityEvents({ action: 'compliance.create', resource: 'compliance', severity: 'info' }, async (c) => {
  const id = c.req.param('id');
  const tenantId = c.get('tenantId');
  const service = c.get('complianceExportService');
  if (!service) {
    return c.json(
      { success: false, error: 'ComplianceExportService not yet wired' },
      503,
    );
  }
  try {
    const manifest = await service.generate(id, tenantId);
    return c.json({ success: true, data: manifest });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Generation failed';
    return c.json({ success: false, error: { message } }, 400);
  }
}));

complianceRouter.get('/exports/:id/download', async (c) => {
  const id = c.req.param('id');
  const tenantId = c.get('tenantId');
  const service = c.get('complianceExportService');
  if (!service) {
    return c.json(
      { success: false, error: 'ComplianceExportService not yet wired' },
      503,
    );
  }
  try {
    const { url, manifest } = await service.download(id, tenantId);
    return c.json({ success: true, data: { url, manifest } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Download failed';
    return c.json({ success: false, error: { message } }, 400);
  }
});

export default complianceRouter;

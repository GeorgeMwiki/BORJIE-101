/**
 * FAR (Field Asset Register) API Routes — mining-native.
 *
 *   POST   /components                        → register a site fixed asset
 *   GET    /components/:id                    → fetch an asset
 *   POST   /components/:id/assign             → schedule an inspection cadence
 *   GET    /assignments/due                   → list due scheduled inspections
 *   POST   /assignments/:id/check             → log an inspection outcome
 *   GET    /components/:id/scheduled-checks   → inspection / maintenance history
 *
 * Wired to the mining `MiningFarService` (`c.get('farService')`, set by the
 * service-context middleware from `registry.far.service`) and the mining
 * `PostgresSiteFarRepository` (`services.far.repo`) via the composition root.
 * Degrades to 503 when DATABASE_URL is unset.
 *
 * Mining-native mapping (the legacy property "component / monitoring
 * assignment / condition check" surface is preserved at the URL level):
 *   - a "component" IS a site fixed ASSET (`assets` row).
 *   - an "assignment" IS a SCHEDULED inspection/maintenance event.
 *   - a "check"      IS a LOGGED inspection/maintenance outcome.
 * The `:id` on `/assignments/:id/check` is the ASSET id the outcome is
 * logged against (the mining service logs the event by asset, not by a
 * standalone assignment row).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'FarService not configured — DATABASE_URL unset',
      },
    },
    503,
  );
}

// Mining asset kinds / statuses / maintenance kinds / inspection cadence +
// outcomes. Kept in sync with `@borjie/domain-services` site-far + mining-far
// types; declared here so the route validates the payload before it reaches
// the service (defence-in-depth — the service re-validates with zod too).
const ASSET_KINDS = [
  'excavator',
  'compressor',
  'generator',
  'pump',
  'crusher',
  'truck',
  'vehicle',
  'drill_rig',
  'tool',
  'ppe',
] as const;

const ASSET_STATUSES = [
  'operational',
  'under_maintenance',
  'broken',
  'sold',
  'retired',
] as const;

const MAINTENANCE_KINDS = [
  'scheduled_service',
  'repair',
  'inspection',
  'breakdown',
  'overhaul',
  'tyre_change',
  'survey',
] as const;

const INSPECTION_FREQUENCIES = [
  'weekly',
  'monthly',
  'quarterly',
  'biannual',
  'annual',
  'ad_hoc',
] as const;

const INSPECTION_OUTCOMES = ['pass', 'warning', 'fail', 'skipped'] as const;

// POST /components → register a site fixed asset.
const AssetSchema = z.object({
  companyId: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  currentSiteId: z.string().min(1).optional().nullable(),
  make: z.string().max(200).optional().nullable(),
  model: z.string().max(200).optional().nullable(),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  serialNumber: z.string().max(200).optional().nullable(),
  owned: z.boolean().optional(),
  currentOperatorUserId: z.string().min(1).optional().nullable(),
  status: z.enum(ASSET_STATUSES).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

// POST /components/:id/assign → schedule an inspection cadence on the asset.
const AssignSchema = z.object({
  frequency: z.enum(INSPECTION_FREQUENCIES),
  kind: z.enum(MAINTENANCE_KINDS).optional(),
  assignedToUserId: z.string().min(1).optional().nullable(),
  firstDueAt: z.string().optional().nullable(),
  summary: z.string().max(4000).optional().nullable(),
  evidenceIds: z.array(z.string().min(1)).optional(),
});

// POST /assignments/:id/check → log an inspection outcome (`:id` = assetId).
const CheckSchema = z.object({
  outcome: z.enum(INSPECTION_OUTCOMES),
  kind: z.enum(MAINTENANCE_KINDS).optional(),
  summary: z.string().max(4000).optional().nullable(),
  downtimeHours: z.number().nonnegative().optional().nullable(),
  costAmount: z.number().nonnegative().optional().nullable(),
  costCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .nullable(),
  partsUsed: z.array(z.record(z.string(), z.unknown())).optional(),
  performedAt: z.string().optional().nullable(),
  evidenceIds: z.array(z.string().min(1)).optional(),
  assetStatusAfter: z.enum(ASSET_STATUSES).optional().nullable(),
});

const DueQuerySchema = z.object({
  now: z.string().optional(),
});

const HistoryQuerySchema = z.object({
  currency: z.string().optional(),
});

// Root — discoverability endpoint. Keys off `services.far.repo` so it
// degrades cleanly when the registry slot is null.
app.get('/', async (c: any) => {
  const repo = c.get('services')?.far?.repo;
  if (!repo) return notConfigured(c);
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'FAR routes: POST /components, GET /components/:id, POST /components/:id/assign, GET /assignments/due, POST /assignments/:id/check, GET /components/:id/scheduled-checks',
    },
  });
});

app.post(
  '/components',
  zValidator('json', AssetSchema),
  withSecurityEvents(
    { action: 'far.create', resource: 'far', severity: 'info' },
    async (c: any) => {
      const service = c.get('farService');
      if (!service) return notConfigured(c);
      try {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const result = await service.addAsset({
          tenantId,
          companyId: body.companyId,
          kind: body.kind,
          currentSiteId: body.currentSiteId ?? null,
          make: body.make ?? null,
          model: body.model ?? null,
          year: body.year ?? null,
          serialNumber: body.serialNumber ?? null,
          owned: body.owned,
          currentOperatorUserId: body.currentOperatorUserId ?? null,
          status: body.status,
          attributes: body.attributes,
        });
        if (!result.success) {
          return c.json(
            { success: false, error: result.error },
            result.error.code === 'INVALID_INPUT' ? 400 : 409,
          );
        }
        return c.json({ success: true, data: result.data }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'FAR_COMPONENT_FAILED',
          status: 500,
          fallback: 'Failed to register site asset',
        });
      }
    },
  ),
);

app.get('/components/:id', async (c: any) => {
  const repo = c.get('services')?.far?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    // Mining repo signature is `findAssetById(tenantId, id)` (tenantId FIRST).
    const row = await repo.findAssetById(tenantId, id);
    if (!row) {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Asset not found' },
        },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FAR_READ_FAILED',
      status: 500,
      fallback: 'Failed to read site asset',
    });
  }
});

app.post(
  '/components/:id/assign',
  zValidator('json', AssignSchema),
  withSecurityEvents(
    { action: 'far.create', resource: 'far', severity: 'info' },
    async (c: any) => {
      const service = c.get('farService');
      if (!service) return notConfigured(c);
      try {
        const tenantId = c.get('tenantId');
        const assetId = c.req.param('id');
        const body = c.req.valid('json');
        const result = await service.scheduleInspection({
          tenantId,
          assetId,
          frequency: body.frequency,
          kind: body.kind,
          assignedToUserId: body.assignedToUserId ?? null,
          firstDueAt: body.firstDueAt ?? null,
          summary: body.summary ?? null,
          evidenceIds: body.evidenceIds,
        });
        if (!result.success) {
          const status =
            result.error.code === 'ASSET_NOT_FOUND'
              ? 404
              : result.error.code === 'INVALID_INPUT'
                ? 400
                : 409;
          return c.json({ success: false, error: result.error }, status);
        }
        return c.json({ success: true, data: result.data }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'FAR_ASSIGN_FAILED',
          status: 500,
          fallback: 'Failed to schedule inspection',
        });
      }
    },
  ),
);

app.get(
  '/assignments/due',
  zValidator('query', DueQuerySchema),
  async (c: any) => {
    const repo = c.get('services')?.far?.repo;
    if (!repo) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const { now } = c.req.valid('query');
      const iso = now ?? new Date().toISOString();
      // Mining repo: `findDueScheduledMaintenance(tenantId, cutoffIso)`.
      const rows = await repo.findDueScheduledMaintenance(tenantId, iso);
      return c.json({ success: true, data: rows });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'FAR_DUE_FAILED',
        status: 500,
        fallback: 'Failed to list due inspections',
      });
    }
  },
);

app.post(
  '/assignments/:id/check',
  zValidator('json', CheckSchema),
  withSecurityEvents(
    { action: 'far.create', resource: 'far', severity: 'info' },
    async (c: any) => {
      const service = c.get('farService');
      if (!service) return notConfigured(c);
      try {
        const tenantId = c.get('tenantId');
        const performedByUserId = c.get('userId');
        // `:id` is the ASSET id the inspection outcome is logged against.
        const assetId = c.req.param('id');
        const body = c.req.valid('json');
        const result = await service.logInspection({
          tenantId,
          assetId,
          outcome: body.outcome,
          kind: body.kind,
          performedByUserId: performedByUserId ?? null,
          summary: body.summary ?? null,
          downtimeHours: body.downtimeHours ?? null,
          costAmount: body.costAmount ?? null,
          costCurrency: body.costCurrency ?? null,
          partsUsed: body.partsUsed,
          performedAt: body.performedAt ?? null,
          evidenceIds: body.evidenceIds,
          assetStatusAfter: body.assetStatusAfter ?? null,
        });
        if (!result.success) {
          const status =
            result.error.code === 'ASSET_NOT_FOUND'
              ? 404
              : result.error.code === 'INVALID_STATUS'
                ? 409
                : 400;
          return c.json({ success: false, error: result.error }, status);
        }
        return c.json({ success: true, data: result.data }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'FAR_CHECK_FAILED',
          status: 500,
          fallback: 'Failed to log inspection',
        });
      }
    },
  ),
);

app.get(
  '/components/:id/scheduled-checks',
  zValidator('query', HistoryQuerySchema),
  async (c: any) => {
    const service = c.get('farService');
    if (!service) return notConfigured(c);
    try {
      const tenantId = c.get('tenantId');
      const assetId = c.req.param('id');
      const { currency } = c.req.valid('query');
      const result = await service.getInspectionHistory(
        tenantId,
        assetId,
        currency,
      );
      if (!result.success) {
        return c.json({ success: false, error: result.error }, 400);
      }
      return c.json({ success: true, data: result.data });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'FAR_SCHEDULED_FAILED',
        status: 500,
        fallback: 'Failed to read inspection history',
      });
    }
  },
);

export default app;

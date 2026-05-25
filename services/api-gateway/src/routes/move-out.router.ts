/**
 * Move-Out Checklist API (Wave 26 Agent Z3)
 *
 *   POST /:leaseId/checklist                   → create / initialize
 *   GET  /:leaseId/checklist                   → fetch current state
 *   POST /:leaseId/checklist/:itemId/complete  → mark a step done
 *   POST /:leaseId/finalize                    → final sign-off (deposit refund calc)
 *
 * Wired to `MoveOutChecklistService` via the composition root. Degrades to
 * 503 when DATABASE_URL is unset. All handlers are tenant-scoped; role gates
 * restrict finalize / complete to admin-adjacent roles.
 *
 * Step identifiers accepted by /checklist/:itemId/complete:
 *   - final_inspection       body: { conditionReportId, notes? }
 *   - utility_readings       body: { readings: UtilityReading[] }
 *   - deposit_reconciliation body: { totalDeductions, notes? }
 *   - residency_proof_letter body: { documentId }
 */

// @ts-nocheck — Hono context typing is open-ended; routers dispatch at runtime.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import { createMoveOutChecklist } from '@borjie/domain-services/lease';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'MOVE_OUT_SERVICE_UNAVAILABLE',
        message:
          'MoveOutChecklistService not configured — DATABASE_URL unset.',
      },
    },
    503,
  );
}

function svc(c: any) {
  const services = c.get('services') ?? {};
  return (
    services.moveOut?.service ??
    c.get('moveOutChecklistService') ??
    null
  );
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateChecklistSchema = z.object({
  currency: z.string().min(3).max(8).default('KES'),
  totalDeposit: z.number().nonnegative().default(0),
});

const FinalInspectionBody = z.object({
  conditionReportId: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

const UtilityReadingSchema = z.object({
  utility: z.enum(['electricity', 'water', 'gas', 'other']),
  meterReading: z.number().nonnegative(),
  unit: z.string().min(1).max(20),
  readingDate: z.string(),
});
const UtilityReadingsBody = z.object({
  readings: z.array(UtilityReadingSchema).min(1),
});

const DepositReconciliationBody = z.object({
  totalDeductions: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
});

const ResidencyProofBody = z.object({
  documentId: z.string().min(1),
});

const FinalizeBody = z.object({
  refundMethod: z.string().max(64).optional(),
  refundReference: z.string().max(128).optional(),
});

// ---------------------------------------------------------------------------
// POST /:leaseId/checklist — create / initialize
// ---------------------------------------------------------------------------
// Not on the service directly, so we poke the repository through
// `service['repo']` (field is private but readable at runtime) only when
// the caller hasn't pre-created the checklist. Keeps the service class
// unchanged per Wave-26 constraint.
app.post(
  '/:leaseId/checklist',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', CreateChecklistSchema),
  withSecurityEvents({ action: 'move-out.create', resource: 'move-out', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const leaseId = c.req.param('leaseId');
    const body = c.req.valid('json');
    try {
      // Reach through to the repo via the service — the class exposes
      // `this.repo` as a constructor field; at runtime it is accessible.
      // Wave-26 constraint: don't rewrite the service, so we leave the
      // checklist factory here in the router.
      const repo = (service as any).repo;
      if (!repo || typeof repo.findByLeaseId !== 'function') {
        return c.json(
          {
            success: false,
            error: {
              code: 'MOVE_OUT_REPO_UNAVAILABLE',
              message: 'Underlying move-out repository not attached.',
            },
          },
          503,
        );
      }
      const existing = await repo.findByLeaseId(leaseId, tenantId);
      if (existing) {
        return c.json({ success: true, data: existing }, 200);
      }
      const fresh = createMoveOutChecklist({
        leaseId,
        tenantId,
        currency: body.currency,
        totalDeposit: body.totalDeposit,
      });
      const saved = await repo.save(fresh);
      return c.json({ success: true, data: saved }, 201);
    } catch (err) {
      return routeCatch(c, err, {
        code: 'MOVE_OUT_CREATE_FAILED',
        status: 500,
        fallback: 'Failed to create move-out checklist',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /:leaseId/checklist — fetch items + completion status
// ---------------------------------------------------------------------------
app.get('/:leaseId/checklist', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const leaseId = c.req.param('leaseId');
  try {
    const repo = (service as any).repo;
    if (!repo?.findByLeaseId) return notConfigured(c);
    const checklist = await repo.findByLeaseId(leaseId, tenantId);
    if (!checklist) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CHECKLIST_NOT_FOUND',
            message: 'Move-out checklist has not been initialised for this lease.',
          },
        },
        404,
      );
    }
    return c.json({
      success: true,
      data: checklist,
      meta: {
        completed: service.isCompleted(checklist),
      },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'MOVE_OUT_READ_FAILED',
      status: 500,
      fallback: 'Failed to read move-out checklist',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /:leaseId/checklist/:itemId/complete — mark a step done
// ---------------------------------------------------------------------------
app.post(
  '/:leaseId/checklist/:itemId/complete',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.MAINTENANCE_STAFF,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  withSecurityEvents({ action: 'move-out.create', resource: 'move-out', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const leaseId = c.req.param('leaseId');
    const itemId = c.req.param('itemId');

    try {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }

      let result;
      switch (itemId) {
        case 'final_inspection': {
          const parsed = FinalInspectionBody.parse(body);
          result = await service.completeFinalInspection(
            leaseId,
            tenantId,
            parsed.conditionReportId,
            userId,
            parsed.notes,
          );
          break;
        }
        case 'utility_readings': {
          const parsed = UtilityReadingsBody.parse(body);
          result = await service.recordUtilityReadings(
            leaseId,
            tenantId,
            parsed.readings as any,
            userId,
          );
          break;
        }
        case 'deposit_reconciliation': {
          const parsed = DepositReconciliationBody.parse(body);
          result = await service.reconcileDeposit(
            leaseId,
            tenantId,
            parsed.totalDeductions,
            userId,
            parsed.notes,
          );
          break;
        }
        case 'residency_proof_letter': {
          const parsed = ResidencyProofBody.parse(body);
          result = await service.issueResidencyProofLetter(
            leaseId,
            tenantId,
            parsed.documentId,
            userId,
          );
          break;
        }
        default:
          return c.json(
            {
              success: false,
              error: {
                code: 'UNKNOWN_STEP',
                message: `Unknown move-out step '${itemId}'. Valid: final_inspection, utility_readings, deposit_reconciliation, residency_proof_letter.`,
              },
            },
            400,
          );
      }

      if (!result.success) {
        const status =
          result.error.code === 'CHECKLIST_NOT_FOUND'
            ? 404
            : result.error.code === 'INVALID_INPUT'
              ? 400
              : 409;
        return c.json({ success: false, error: result.error }, status);
      }
      return c.json({ success: true, data: result.data });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json(
          {
            success: false,
            error: { code: 'VALIDATION_FAILED', message: err.errors[0]?.message ?? 'Invalid body' },
          },
          400,
        );
      }
      return routeCatch(c, err, {
        code: 'MOVE_OUT_STEP_FAILED',
        status: 500,
        fallback: 'Failed to complete move-out step',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /:leaseId/finalize — final sign-off
// ---------------------------------------------------------------------------
// Requires the checklist to be fully complete. Returns the deposit-
// disposition summary (computed from `depositReconciliation` on the
// checklist) so the caller can trigger the downstream refund payout.
app.post(
  '/:leaseId/finalize',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', FinalizeBody),
  withSecurityEvents({ action: 'move-out.create', resource: 'move-out', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const leaseId = c.req.param('leaseId');
    const body = c.req.valid('json');

    try {
      const repo = (service as any).repo;
      const checklist = await repo.findByLeaseId(leaseId, tenantId);
      if (!checklist) {
        return c.json(
          {
            success: false,
            error: {
              code: 'CHECKLIST_NOT_FOUND',
              message: 'Checklist missing — create it before finalizing.',
            },
          },
          404,
        );
      }
      if (!service.isCompleted(checklist)) {
        return c.json(
          {
            success: false,
            error: {
              code: 'CHECKLIST_INCOMPLETE',
              message:
                'All four steps (final_inspection, utility_readings, deposit_reconciliation, residency_proof_letter) must be completed before finalize.',
            },
          },
          409,
        );
      }

      const recon = checklist.depositReconciliation;
      const summary = {
        leaseId,
        tenantId,
        totalDeposit: recon.totalDeposit,
        totalDeductions: recon.totalDeductions,
        refundAmount: recon.refundAmount,
        currency: recon.currency,
        refundMethod: body.refundMethod ?? null,
        refundReference: body.refundReference ?? null,
        finalizedAt: new Date().toISOString(),
      };
      return c.json({ success: true, data: summary }, 200);
    } catch (err) {
      return routeCatch(c, err, {
        code: 'MOVE_OUT_FINALIZE_FAILED',
        status: 500,
        fallback: 'Failed to finalize move-out',
      });
    }
  }),
);

export default app;

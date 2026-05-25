/**
 * Damage-Deduction API Routes (Wave 26 Agent Z2)
 *
 *   POST   /                      → file a new damage claim
 *   GET    /open                  → list open claims (claim_filed..escalated)
 *   GET    /:id                   → fetch a single claim
 *   POST   /:id/respond           → tenant counter-proposal
 *   POST   /:id/mediate           → AI mediator turn (neutral midpoint)
 *   POST   /:id/settle            → mark claim agreed + store final amount
 *   POST   /:id/evidence-bundle   → build evidence bundle (if gateway wired)
 *
 * Wired to `DamageDeductionService` via the composition root. Degrades
 * to 503 with a clear reason when DATABASE_URL is unset.
 */

// @ts-nocheck — Hono context types are open-ended by design in this project.

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
        message:
          'DamageDeductionService not configured — DATABASE_URL unset',
      },
    },
    503,
  );
}

const FileClaimSchema = z.object({
  leaseId: z.string().optional(),
  caseId: z.string().optional(),
  moveOutInspectionId: z.string().optional(),
  claimedDeductionMinor: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  rationale: z.string().min(1).max(4000),
});

const RespondSchema = z.object({
  counterProposalMinor: z.number().int().nonnegative().optional(),
  rationale: z.string().min(1).max(4000),
});

const SettleSchema = z.object({
  agreedAmountMinor: z.number().int().nonnegative(),
  notes: z.string().max(4000).optional(),
});

app.get('/', async (c: any) => {
  const repo = c.get('services')?.damageDeductions?.repo;
  if (!repo) return notConfigured(c);
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'Use GET /open for active claims or GET /:id to read a single claim.',
    },
  });
});

app.post('/', zValidator('json', FileClaimSchema), withSecurityEvents({ action: 'damage-deduction.create', resource: 'damage-deduction', severity: 'info' }, async (c: any) => {
  const service = c.get('damageDeductionService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const input = c.req.valid('json');
    const result = await service.fileClaim(tenantId, input, actor);
    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        result.error.code === 'INVALID_INPUT' ? 400 : 409,
      );
    }
    return c.json({ success: true, data: result.data }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_CLAIM_FAILED',
      status: 500,
      fallback: 'Failed to file damage claim',
    });
  }
}));

app.get('/open', async (c: any) => {
  const repo = c.get('services')?.damageDeductions?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const rows = await repo.listOpen(tenantId);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list open damage claims',
    });
  }
});

app.get('/:id', async (c: any) => {
  const repo = c.get('services')?.damageDeductions?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const row = await repo.findById(id, tenantId);
    if (!row) {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Claim not found' },
        },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_READ_FAILED',
      status: 500,
      fallback: 'Failed to read damage claim',
    });
  }
});

app.post('/:id/respond', zValidator('json', RespondSchema), withSecurityEvents({ action: 'damage-deduction.create', resource: 'damage-deduction', severity: 'info' }, async (c: any) => {
  const service = c.get('damageDeductionService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = await service.tenantRespond(id, tenantId, input, actor);
    if (!result.success) {
      const status = result.error.code === 'CLAIM_NOT_FOUND' ? 404 : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_RESPOND_FAILED',
      status: 500,
      fallback: 'Failed to record tenant response',
    });
  }
}));

app.post('/:id/mediate', withSecurityEvents({ action: 'damage-deduction.create', resource: 'damage-deduction', severity: 'info' }, async (c: any) => {
  const service = c.get('damageDeductionService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const result = await service.aiMediate(id, tenantId, actor);
    if (!result.success) {
      const status = result.error.code === 'CLAIM_NOT_FOUND' ? 404 : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_MEDIATE_FAILED',
      status: 500,
      fallback: 'Failed to run AI mediator',
    });
  }
}));

app.post('/:id/settle', zValidator('json', SettleSchema), withSecurityEvents({ action: 'damage-deduction.create', resource: 'damage-deduction', severity: 'info' }, async (c: any) => {
  const service = c.get('damageDeductionService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = await service.agreeAndSettle(id, tenantId, input, actor);
    if (!result.success) {
      const status = result.error.code === 'CLAIM_NOT_FOUND' ? 404 : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_SETTLE_FAILED',
      status: 500,
      fallback: 'Failed to settle damage claim',
    });
  }
}));

app.post('/:id/evidence-bundle', withSecurityEvents({ action: 'damage-deduction.create', resource: 'damage-deduction', severity: 'info' }, async (c: any) => {
  const service = c.get('damageDeductionService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const result = await service.buildEvidenceBundle(id, tenantId, actor);
    if (!result.success) {
      const status =
        result.error.code === 'NOT_IMPLEMENTED'
          ? 501
          : result.error.code === 'CLAIM_NOT_FOUND'
            ? 404
            : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_BUNDLE_FAILED',
      status: 500,
      fallback: 'Failed to build evidence bundle',
    });
  }
}));

export default app;

/**
 * Sublease API Routes (Wave 26 Agent Z2)
 *
 *   POST   /                 → submit a new sublease request
 *   GET    /pending          → list tenant-scoped pending requests
 *   GET    /by-lease/:leaseId → list all requests for a lease
 *   GET    /:id              → fetch a single request
 *   POST   /:id/review       → review (notes) — keeps status pending
 *   POST   /:id/approve      → approve + upsert tenant group
 *   POST   /:id/revoke       → revoke approved request
 *
 * Wired to `SubleaseService` via the composition root. Degrades to 503
 * with a clear reason when the service is unavailable.
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
        message: 'SubleaseService not configured — DATABASE_URL unset',
      },
    },
    503,
  );
}

const SubmitSchema = z.object({
  parentLeaseId: z.string().min(1),
  requestedBy: z.string().min(1),
  subtenantCandidateId: z.string().optional(),
  reason: z.string().max(2000).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  rentResponsibility: z.enum(['primary_tenant', 'subtenant', 'split']).optional(),
  splitPercent: z.record(z.string(), z.number()).optional(),
});

const ReviewSchema = z.object({
  notes: z.string().max(4000).optional(),
});

const ApproveSchema = z.object({
  approverNotes: z.string().max(4000).optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});

const RevokeSchema = z.object({
  reason: z.string().min(1).max(4000),
});

// GET / — smoke-test root: returns guidance + empty listing.
app.get('/', async (c: any) => {
  const service = c.get('subleaseService');
  if (!service) return notConfigured(c);
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'Use GET /pending, GET /by-lease/:leaseId, or GET /:id for real rows.',
    },
  });
});

app.post('/', zValidator('json', SubmitSchema), withSecurityEvents({ action: 'sublease.create', resource: 'sublease', severity: 'notice' }, async (c: any) => {
  const service = c.get('subleaseService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const input = c.req.valid('json');
    const result = await service.submit(tenantId, input, actor);
    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        result.error.code === 'INVALID_INPUT' ? 400 : 409,
      );
    }
    return c.json({ success: true, data: result.data }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_SUBMIT_FAILED',
      status: 500,
      fallback: 'Failed to submit sublease request',
    });
  }
}));

app.get('/pending', async (c: any) => {
  const service = c.get('subleaseService');
  if (!service) return notConfigured(c);
  const repo = c.get('services')?.sublease?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const rows = await repo.listPending(tenantId);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list pending sublease requests',
    });
  }
});

app.get('/by-lease/:leaseId', async (c: any) => {
  const repo = c.get('services')?.sublease?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const leaseId = c.req.param('leaseId');
    const rows = await repo.findByLease(leaseId, tenantId);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list sublease requests for lease',
    });
  }
});

app.get('/:id', async (c: any) => {
  const repo = c.get('services')?.sublease?.repo;
  if (!repo) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const row = await repo.findById(id, tenantId);
    if (!row) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Sublease request not found',
          },
        },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_READ_FAILED',
      status: 500,
      fallback: 'Failed to read sublease request',
    });
  }
});

app.post('/:id/review', zValidator('json', ReviewSchema), withSecurityEvents({ action: 'sublease.create', resource: 'sublease', severity: 'notice' }, async (c: any) => {
  const service = c.get('subleaseService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = await service.review(id, tenantId, input, actor);
    if (!result.success) {
      const status = result.error.code === 'REQUEST_NOT_FOUND' ? 404 : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_REVIEW_FAILED',
      status: 500,
      fallback: 'Failed to review sublease request',
    });
  }
}));

app.post('/:id/approve', zValidator('json', ApproveSchema), withSecurityEvents({ action: 'sublease.create', resource: 'sublease', severity: 'notice' }, async (c: any) => {
  const service = c.get('subleaseService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = await service.approve(id, tenantId, input, actor);
    if (!result.success) {
      const status = result.error.code === 'REQUEST_NOT_FOUND' ? 404 : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_APPROVE_FAILED',
      status: 500,
      fallback: 'Failed to approve sublease request',
    });
  }
}));

app.post('/:id/revoke', zValidator('json', RevokeSchema), withSecurityEvents({ action: 'sublease.create', resource: 'sublease', severity: 'notice' }, async (c: any) => {
  const service = c.get('subleaseService');
  if (!service) return notConfigured(c);
  try {
    const tenantId = c.get('tenantId');
    const actor = c.get('userId');
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const result = await service.revoke(id, tenantId, input, actor);
    if (!result.success) {
      const status =
        result.error.code === 'REQUEST_NOT_FOUND'
          ? 404
          : result.error.code === 'INVALID_INPUT'
            ? 400
            : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SUBLEASE_REVOKE_FAILED',
      status: 500,
      fallback: 'Failed to revoke sublease request',
    });
  }
}));

export default app;

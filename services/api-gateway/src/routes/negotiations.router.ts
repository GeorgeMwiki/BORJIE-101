/**
 * Negotiations API (NEW 1 — AI Price-Negotiation Engine).
 *
 * Endpoints:
 *   POST   /v1/negotiation-policies        — create policy
 *   POST   /v1/negotiations                — start negotiation (opening offer)
 *   POST   /v1/negotiations/:id/turns      — prospect/owner submits counter
 *   POST   /v1/negotiations/:id/accept     — close: accept
 *   POST   /v1/negotiations/:id/reject     — close: reject
 *   GET    /v1/negotiations/:id/audit      — replay turns
 *
 * The actual negotiation logic lives in domain-services/src/negotiation.
 * Services are resolved via `c.get('services').negotiation` which the
 * gateway bootstrap wires up. If not present, endpoints respond with
 * 503 NOT_IMPLEMENTED rather than silently succeeding.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

import { withSecurityEvents } from '@borjie/observability';
const ConcessionSchema = z.object({
  kind: z.enum([
    'free_month',
    'waived_deposit',
    'reduced_deposit',
    'payment_plan',
    'included_utilities',
    'flexible_move_in',
    'other',
  ]),
  description: z.string().min(1).max(500),
  monetaryValue: z.number().nonnegative().optional(),
  maxCount: z.number().int().positive().optional(),
});

const PolicyCreateSchema = z
  .object({
    unitId: z.string().optional(),
    propertyId: z.string().optional(),
    domain: z.enum(['lease_price', 'tender_bid']).default('lease_price'),
    listPrice: z.number().int().positive(),
    floorPrice: z.number().int().positive(),
    approvalRequiredBelow: z.number().int().positive(),
    maxDiscountPct: z.number().min(0).max(1).default(0),
    // Client resolves currency from tenant region-config; no KES default.
    currency: z.string().min(3),
    acceptableConcessions: z.array(ConcessionSchema).max(10).optional(),
    toneGuide: z.enum(['firm', 'warm', 'flexible']).default('warm'),
    autoSendCounters: z.boolean().default(false),
    expiresAt: z.string().datetime().optional(),
  })
  .refine((v) => v.unitId || v.propertyId, {
    message: 'unitId or propertyId is required',
  })
  .refine((v) => v.floorPrice <= v.listPrice, {
    message: 'floorPrice must be <= listPrice',
  })
  .refine((v) => v.approvalRequiredBelow >= v.floorPrice, {
    message: 'approvalRequiredBelow must be >= floorPrice',
  });

const NegotiationStartSchema = z.object({
  policyId: z.string().min(1),
  unitId: z.string().optional(),
  propertyId: z.string().optional(),
  prospectCustomerId: z.string().optional(),
  counterpartyId: z.string().optional(),
  listingId: z.string().optional(),
  tenderId: z.string().optional(),
  bidId: z.string().optional(),
  domain: z.enum(['lease_price', 'tender_bid']).default('lease_price'),
  openingOffer: z.number().positive(),
  openingRationale: z.string().max(2000).optional(),
  openingConcessions: z.array(ConcessionSchema).max(5).optional(),
  expiresAt: z.string().datetime().optional(),
});

const NegotiationCounterSchema = z.object({
  actor: z.enum(['prospect', 'owner', 'agent', 'vendor']),
  offer: z.number().positive(),
  concessions: z.array(ConcessionSchema).max(5).optional(),
  rationale: z.string().max(2000).optional(),
});

const NegotiationCloseSchema = z.object({
  actor: z.enum(['owner', 'agent', 'prospect']),
  agreedPrice: z.number().positive().optional(),
  reason: z.string().max(2000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function services(c: any) {
  return c.get('services') ?? {};
}

function svcOr503(c: any, key: 'negotiation') {
  const s = services(c)[key];
  if (!s) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: `Negotiation service not wired into api-gateway context`,
        },
      },
      503
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

app.post(
  '/policies',
  zValidator('json', PolicyCreateSchema),
  withSecurityEvents({ action: 'negotiation.create', resource: 'negotiation', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const svc = svcOr503(c, 'negotiation');
    if (!('createPolicy' in svc)) return svc; // 503 passthrough
    const result = await svc.createPolicy(auth.tenantId, body, auth.userId);
    return c.json({ success: true, data: result }, 201);
  })
);

// ---------------------------------------------------------------------------
// Negotiations
// ---------------------------------------------------------------------------

app.post('/', zValidator('json', NegotiationStartSchema), withSecurityEvents({ action: 'negotiation.create', resource: 'negotiation', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = svcOr503(c, 'negotiation');
  if (!('startNegotiation' in svc)) return svc;
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.startNegotiation(
    auth.tenantId,
    body,
    correlationId,
    auth.userId
  );
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      400
    );
  }
  return c.json({ success: true, data: result.value }, 201);
}));

app.post('/:id/turns', zValidator('json', NegotiationCounterSchema), withSecurityEvents({ action: 'negotiation.create', resource: 'negotiation', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = svcOr503(c, 'negotiation');
  if (!('submitCounter' in svc)) return svc;
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.submitCounter(
    auth.tenantId,
    {
      negotiationId: c.req.param('id'),
      actor: body.actor,
      actorUserId: auth.userId,
      offer: body.offer,
      concessions: body.concessions,
      rationale: body.rationale,
    },
    correlationId
  );
  if (!result.ok) {
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'ALREADY_CLOSED'
          ? 409
          : 400;
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      status
    );
  }
  return c.json({ success: true, data: result.value });
}));

app.post('/:id/accept', zValidator('json', NegotiationCloseSchema), withSecurityEvents({ action: 'negotiation.create', resource: 'negotiation', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = svcOr503(c, 'negotiation');
  if (!('acceptOffer' in svc)) return svc;
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.acceptOffer(
    auth.tenantId,
    {
      negotiationId: c.req.param('id'),
      actor: body.actor,
      actorUserId: auth.userId,
      agreedPrice: body.agreedPrice,
      reason: body.reason,
    },
    correlationId
  );
  if (!result.ok)
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      400
    );
  return c.json({ success: true, data: result.value });
}));

app.post('/:id/reject', zValidator('json', NegotiationCloseSchema), withSecurityEvents({ action: 'negotiation.create', resource: 'negotiation', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = svcOr503(c, 'negotiation');
  if (!('rejectOffer' in svc)) return svc;
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.rejectOffer(
    auth.tenantId,
    {
      negotiationId: c.req.param('id'),
      actor: body.actor,
      actorUserId: auth.userId,
      reason: body.reason,
    },
    correlationId
  );
  if (!result.ok)
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      400
    );
  return c.json({ success: true, data: result.value });
}));

app.get('/:id/audit', async (c) => {
  const auth = c.get('auth');
  const svc = svcOr503(c, 'negotiation');
  if (!('getAudit' in svc)) return svc;
  const result = await svc.getAudit(auth.tenantId, c.req.param('id'));
  if (!result.ok)
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      404
    );
  return c.json({ success: true, data: result.value });
});

export const negotiationsRouter = app;

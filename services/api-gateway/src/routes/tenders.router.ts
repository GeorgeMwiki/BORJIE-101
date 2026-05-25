/**
 * Tenders API (NEW 11 — Tenders + Bids).
 *
 *   POST /v1/tenders
 *   GET  /v1/tenders/:id
 *   POST /v1/tenders/:id/bids
 *   GET  /v1/tenders/:id/bids
 *   POST /v1/tenders/:id/award
 *   POST /v1/tenders/:id/cancel
 *   POST /v1/bids/:id/counter   (triggers AI negotiation)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

import { withSecurityEvents } from '@borjie/observability';
const PublishTenderSchema = z
  .object({
    scope: z.string().min(1).max(2000),
    details: z.string().max(4000).optional(),
    budgetRangeMin: z.number().int().positive(),
    budgetRangeMax: z.number().int().positive(),
    // Client resolves currency from tenant region-config; no KES fallback.
    currency: z.string().min(3).max(8),
    visibility: z.enum(['public', 'invite_only']).default('public'),
    invitedVendorIds: z.array(z.string()).max(100).optional(),
    workOrderId: z.string().optional(),
    aiNegotiatorEnabled: z.boolean().default(true),
    negotiationPolicyId: z.string().optional(),
    closesAt: z.string().datetime(),
  })
  .refine((v) => v.budgetRangeMin <= v.budgetRangeMax, {
    message: 'budgetRangeMin must be <= budgetRangeMax',
  });

const SubmitBidSchema = z.object({
  vendorId: z.string().min(1),
  price: z.number().int().positive(),
  currency: z.string().max(8).optional(),
  timelineDays: z.number().int().positive(),
  notes: z.string().max(4000).optional(),
  attachments: z.array(z.unknown()).max(20).optional(),
});

const AwardSchema = z.object({
  bidId: z.string().min(1),
  reason: z.string().max(1000).optional(),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const CounterBidSchema = z.object({
  offer: z.number().int().positive(),
  rationale: z.string().max(2000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function tenderService(c: any) {
  const services = c.get('services') ?? {};
  return services.marketplace?.tender;
}
function negotiationService(c: any) {
  const services = c.get('services') ?? {};
  return services.negotiation;
}
function notImplemented(c: any, what: string) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `${what} service not wired into api-gateway context`,
      },
    },
    503
  );
}

app.post('/', zValidator('json', PublishTenderSchema), withSecurityEvents({ action: 'tender.create', resource: 'tender', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = tenderService(c);
  if (!svc) return notImplemented(c, 'Tender');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.publish(
    auth.tenantId,
    body,
    auth.userId,
    correlationId
  );
  if (!result.ok)
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      400
    );
  return c.json({ success: true, data: result.value }, 201);
}));

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const svc = tenderService(c);
  if (!svc) return notImplemented(c, 'Tender');
  const tender = await svc.findTender(auth.tenantId, c.req.param('id'));
  if (!tender)
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Tender not found' } },
      404
    );
  return c.json({ success: true, data: tender });
});

app.post('/:id/bids', zValidator('json', SubmitBidSchema), withSecurityEvents({ action: 'tender.create', resource: 'tender', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = tenderService(c);
  if (!svc) return notImplemented(c, 'Tender');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.bid(
    auth.tenantId,
    { ...body, tenderId: c.req.param('id') },
    correlationId
  );
  if (!result.ok) {
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'TENDER_CLOSED'
          ? 409
          : 400;
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      status
    );
  }
  return c.json({ success: true, data: result.value }, 201);
}));

app.get('/:id/bids', async (c) => {
  const auth = c.get('auth');
  const svc = tenderService(c);
  if (!svc) return notImplemented(c, 'Tender');
  const bids = await svc.listBids(auth.tenantId, c.req.param('id'));
  return c.json({ success: true, data: bids });
});

app.post('/:id/award', zValidator('json', AwardSchema), withSecurityEvents({ action: 'tender.create', resource: 'tender', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = tenderService(c);
  if (!svc) return notImplemented(c, 'Tender');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.awardTender(
    auth.tenantId,
    {
      tenderId: c.req.param('id'),
      bidId: body.bidId,
      awardedBy: auth.userId,
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

app.post('/:id/cancel', zValidator('json', CancelSchema), withSecurityEvents({ action: 'tender.create', resource: 'tender', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = tenderService(c);
  if (!svc) return notImplemented(c, 'Tender');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.cancelTender(
    auth.tenantId,
    c.req.param('id'),
    body.reason,
    auth.userId,
    correlationId
  );
  if (!result.ok)
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      400
    );
  return c.json({ success: true, data: result.value });
}));

// Note: /v1/bids/:id/counter is mounted as a separate router entry in the
// gateway; we expose the handler here for composition.
export const tendersRouter = app;

export function mountBidCounterRoute(bidsApp: Hono) {
  bidsApp.post(
    '/:id/counter',
    zValidator('json', CounterBidSchema),
    withSecurityEvents({ action: 'tender.create', resource: 'tender', severity: 'info' }, async (c) => {
      const auth = c.get('auth');
      const body = c.req.valid('json');
      const svc = negotiationService(c);
      if (!svc)
        return c.json(
          {
            success: false,
            error: {
              code: 'NOT_IMPLEMENTED',
              message: 'Negotiation service not wired in',
            },
          },
          503
        );
      const correlationId =
        c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
      // Counter-offer on a bid resolves to negotiation.submitCounter; the
      // negotiation linked to the bid must exist (created on first counter).
      const result = await svc.submitCounter(
        auth.tenantId,
        {
          negotiationId: c.req.param('id'),
          actor: 'owner',
          actorUserId: auth.userId,
          offer: body.offer,
          rationale: body.rationale,
        },
        correlationId
      );
      if (!result.ok)
        return c.json(
          {
            success: false,
            error: { code: result.error.code, message: result.error.message },
          },
          400
        );
      return c.json({ success: true, data: result.value });
    })
  );
  return bidsApp;
}

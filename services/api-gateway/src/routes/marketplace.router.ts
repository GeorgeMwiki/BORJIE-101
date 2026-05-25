/**
 * Marketplace API (NEW 11 — Listings).
 *
 *   POST /v1/marketplace/listings
 *   GET  /v1/marketplace/listings                 (search)
 *   GET  /v1/marketplace/listings/:id
 *   PUT  /v1/marketplace/listings/:id/status
 *   POST /v1/marketplace/listings/:id/enquiries  (starts a negotiation)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

import { withSecurityEvents } from '@borjie/observability';
const MediaItemSchema = z.object({
  type: z.enum(['photo', 'video', 'floor_360', 'street_view']),
  url: z.string().url().max(2048),
  caption: z.string().max(500).optional(),
});

const PublishListingSchema = z.object({
  unitId: z.string().min(1),
  propertyId: z.string().optional(),
  listingKind: z.enum(['rent', 'lease', 'sale']),
  headlinePrice: z.number().int().positive(),
  // Currency is required. No KES default — the client resolves this
  // from the tenant's region-config.
  currency: z.string().min(3).max(8),
  negotiable: z.boolean().default(true),
  media: z.array(MediaItemSchema).max(40).optional(),
  attributes: z.record(z.unknown()).optional(),
  negotiationPolicyId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  publishImmediately: z.boolean().default(false),
});

const SearchSchema = z.object({
  status: z
    .enum(['draft', 'published', 'paused', 'closed'])
    .optional(),
  listingKind: z.enum(['rent', 'lease', 'sale']).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  propertyId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['draft', 'published', 'paused', 'closed']),
});

const EnquirySchema = z.object({
  prospectCustomerId: z.string().min(1),
  openingOffer: z.number().positive(),
  message: z.string().max(2000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function svc<T = any>(c: any, key: 'listing' | 'enquiry'): T | undefined {
  const services = c.get('services') ?? {};
  const marketplace = services.marketplace ?? {};
  return marketplace[key];
}

function notImplemented(c: any, name: string) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Marketplace ${name} service not wired into api-gateway context`,
      },
    },
    503
  );
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

app.post('/listings', zValidator('json', PublishListingSchema), withSecurityEvents({ action: 'marketplace.create', resource: 'marketplace', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const service = svc<any>(c, 'listing');
  if (!service) return notImplemented(c, 'listing');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await service.publish(
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

app.get('/listings', zValidator('query', SearchSchema), async (c) => {
  const auth = c.get('auth');
  const query = c.req.valid('query');
  const service = svc<any>(c, 'listing');
  if (!service) return notImplemented(c, 'listing');
  const result = await service.search(auth.tenantId, query);
  return c.json({
    success: true,
    data: result.items,
    meta: { total: result.total, limit: query.limit, offset: query.offset },
  });
});

app.get('/listings/:id', async (c) => {
  const auth = c.get('auth');
  const service = svc<any>(c, 'listing');
  if (!service) return notImplemented(c, 'listing');
  const listing = await service.findById(auth.tenantId, c.req.param('id'));
  if (!listing)
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Listing not found' } },
      404
    );
  return c.json({ success: true, data: listing });
});

app.put(
  '/listings/:id/status',
  zValidator('json', UpdateStatusSchema),
  withSecurityEvents({ action: 'marketplace.update', resource: 'marketplace', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const service = svc<any>(c, 'listing');
    if (!service) return notImplemented(c, 'listing');
    const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
    const result = await service.updateStatus(
      auth.tenantId,
      c.req.param('id'),
      body.status,
      auth.userId,
      correlationId
    );
    if (!result.ok)
      return c.json(
        { success: false, error: { code: result.error.code, message: result.error.message } },
        result.error.code === 'NOT_FOUND' ? 404 : 400
      );
    return c.json({ success: true, data: result.value });
  })
);

// ---------------------------------------------------------------------------
// Enquiries — creates a negotiation
// ---------------------------------------------------------------------------

app.post(
  '/listings/:id/enquiries',
  zValidator('json', EnquirySchema),
  withSecurityEvents({ action: 'marketplace.create', resource: 'marketplace', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const service = svc<any>(c, 'enquiry');
    if (!service) return notImplemented(c, 'enquiry');
    const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
    const result = await service.startEnquiry(
      auth.tenantId,
      {
        listingId: c.req.param('id'),
        prospectCustomerId: body.prospectCustomerId,
        openingOffer: body.openingOffer,
        message: body.message,
      },
      auth.userId,
      correlationId
    );
    if (!result.ok)
      return c.json(
        { success: false, error: { code: result.error.code, message: result.error.message } },
        result.error.code === 'NOT_FOUND' ? 404 : 400
      );
    return c.json({ success: true, data: result.value }, 201);
  })
);

export const marketplaceRouter = app;

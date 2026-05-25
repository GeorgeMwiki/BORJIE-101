/**
 * Waitlist API (NEW 12 — Auto-Outreach on Vacancy).
 *
 *   POST   /v1/units/:unitId/waitlist/join
 *   POST   /v1/waitlist/:id/leave
 *   GET    /v1/units/:unitId/waitlist        — owner view (active only)
 *   GET    /v1/customers/:customerId/waitlist
 *   POST   /v1/waitlist/:id/trigger-outreach — manual vacancy simulation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

const JoinSchema = z.object({
  customerId: z.string().min(1),
  listingId: z.string().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  source: z
    .enum([
      'enquiry',
      'failed_application',
      'manual_add',
      'marketplace_save',
      'ai_recommended',
    ])
    .optional(),
  preferredChannels: z
    .array(z.enum(['sms', 'whatsapp', 'email', 'push', 'in_app']))
    .max(4)
    .optional(),
  notificationPreferenceId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

const LeaveSchema = z.object({
  reason: z.string().max(1000).optional(),
});

const TriggerOutreachSchema = z.object({
  unitId: z.string().min(1),
  listingId: z.string().optional(),
  vacatedAt: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function waitlistService(c: any) {
  const services = c.get('services') ?? {};
  return services.waitlist?.service;
}
function vacancyHandler(c: any) {
  const services = c.get('services') ?? {};
  return services.waitlist?.vacancyHandler;
}
function notImplemented(c: any, name: string) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Waitlist ${name} not wired into api-gateway context`,
      },
    },
    503
  );
}

app.post('/units/:unitId/join', zValidator('json', JoinSchema), async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = waitlistService(c);
  if (!svc) return notImplemented(c, 'service');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.join(
    auth.tenantId,
    { ...body, unitId: c.req.param('unitId') },
    correlationId
  );
  if (!result.ok)
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      400
    );
  return c.json({ success: true, data: result.value }, 201);
});

app.post('/:id/leave', zValidator('json', LeaveSchema), async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const svc = waitlistService(c);
  if (!svc) return notImplemented(c, 'service');
  const correlationId = c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
  const result = await svc.leave(
    auth.tenantId,
    { waitlistId: c.req.param('id'), reason: body.reason },
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
});

app.get('/units/:unitId', async (c) => {
  const auth = c.get('auth');
  const svc = waitlistService(c);
  if (!svc) return notImplemented(c, 'service');
  const items = await svc.listForUnit(auth.tenantId, c.req.param('unitId'));
  return c.json({ success: true, data: items });
});

app.get('/customers/:customerId', async (c) => {
  const auth = c.get('auth');
  const svc = waitlistService(c);
  if (!svc) return notImplemented(c, 'service');
  const items = await svc.listForCustomer(
    auth.tenantId,
    c.req.param('customerId')
  );
  return c.json({ success: true, data: items });
});

app.post(
  '/units/:unitId/trigger-outreach',
  zValidator('json', TriggerOutreachSchema.partial()),
  async (c) => {
    const auth = c.get('auth');
    type TriggerOutreachBody = Partial<z.infer<typeof TriggerOutreachSchema>>;
    const body: TriggerOutreachBody = c.req.valid('json') ?? {};
    const handler = vacancyHandler(c);
    if (!handler) return notImplemented(c, 'vacancy handler');
    const correlationId =
      c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
    const result = await handler.handleVacancy(
      auth.tenantId,
      {
        unitId: c.req.param('unitId'),
        listingId: body.listingId ?? null,
        vacatedAt: body.vacatedAt ?? new Date().toISOString(),
        reason: body.reason,
      },
      correlationId
    );
    return c.json({ success: true, data: result });
  }
);

export const waitlistRouter = app;

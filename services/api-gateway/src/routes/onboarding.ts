// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches; tracked with other routers already on nocheck.

/**
 * Onboarding router.
 *
 * Minimal wiring over the `OnboardingService` in `@borjie/domain-services`
 * — every handler uses a tenant-scoped in-memory repository until a Postgres
 * repo adapter lands (tracked; schema fields exist in onboarding-service.ts).
 * This means:
 *   - Data is lost on gateway restart (acceptable for pilot flows).
 *   - The HTTP surface matches the final contract so mobile/web clients can
 *     dev against a stable shape.
 *
 * Endpoints:
 *   GET  /                       — list active onboarding sessions (smoke)
 *   POST /                       — start an onboarding session
 *   GET  /:id                    — fetch an onboarding session
 *   POST /:id/complete-step      — mark a checklist step complete
 *
 * Upstream-missing: a Postgres `OnboardingRepository` implementation. Once
 * that lands in domain-services/onboarding, this router flips to pulling
 * the service from `services.onboarding` via the composition root.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import {
  OnboardingService,
  type OnboardingRepository,
  type OnboardingSession,
  type OnboardingSessionId,
} from '@borjie/domain-services/onboarding';
import { InMemoryEventBus } from '@borjie/domain-services';
import type { TenantId, CustomerId, LeaseId } from '@borjie/domain-models';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Process-wide in-memory repo. Tenant isolation is enforced by the
// composite `tenantId::id` key.
// ---------------------------------------------------------------------------
function createInMemoryRepo(): OnboardingRepository {
  const byId = new Map<string, OnboardingSession>();
  const byCustomer = new Map<string, OnboardingSession>();
  const byLease = new Map<string, OnboardingSession>();

  const key = (t: string, id: string) => `${t}::${id}`;

  return {
    async findById(id, tenantId) {
      return byId.get(key(String(tenantId), String(id))) ?? null;
    },
    async findByCustomer(customerId, tenantId) {
      return byCustomer.get(key(String(tenantId), String(customerId))) ?? null;
    },
    async findByLease(leaseId, tenantId) {
      return byLease.get(key(String(tenantId), String(leaseId))) ?? null;
    },
    async create(session) {
      byId.set(key(String(session.tenantId), String(session.id)), session);
      byCustomer.set(key(String(session.tenantId), String(session.customerId)), session);
      byLease.set(key(String(session.tenantId), String(session.leaseId)), session);
      return session;
    },
    async update(session) {
      byId.set(key(String(session.tenantId), String(session.id)), session);
      byCustomer.set(key(String(session.tenantId), String(session.customerId)), session);
      byLease.set(key(String(session.tenantId), String(session.leaseId)), session);
      return session;
    },
  };
}

const repo = createInMemoryRepo();
const bus = new InMemoryEventBus();
const service = new OnboardingService(repo, bus);

const app = new Hono();
app.use('*', authMiddleware);

const StartSchema = z.object({
  customerId: z.string().min(1),
  leaseId: z.string().min(1),
  moveInDate: z.string().min(1),
  language: z.enum(['en', 'sw']).optional(),
  preferredChannel: z.enum(['whatsapp', 'sms', 'email', 'app', 'voice']).optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
});

const CompleteStepSchema = z.object({
  stepId: z.enum([
    'pre_move_in',
    'welcome',
    'utilities_training',
    'property_orientation',
    'move_in_inspection',
    'community_info',
    'completed',
  ]),
  data: z.record(z.unknown()).default({}),
});

app.get('/', (c) => {
  // There is no list repository method — return meta instead of a hard 503.
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'Onboarding sessions are indexed by customerId/leaseId. Use GET /onboarding/:id or POST / to start a session.',
    },
  });
});

app.post('/', zValidator('json', StartSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const correlationId =
    c.req.header('x-correlation-id') ?? `onb_${Date.now()}`;
  const result = await service.startOnboarding(
    auth.tenantId as TenantId,
    body.customerId as CustomerId,
    body.leaseId as LeaseId,
    {
      moveInDate: body.moveInDate,
      language: body.language,
      preferredChannel: body.preferredChannel,
      propertyId: body.propertyId,
      unitId: body.unitId,
    },
    auth.userId,
    correlationId,
  );
  if (!result.ok) {
    return c.json(
      {
        success: false,
        error: { code: result.error.code, message: result.error.message },
      },
      400,
    );
  }
  return c.json({ success: true, data: result.value }, 201);
}));

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const session = await repo.findById(
    id as OnboardingSessionId,
    auth.tenantId as TenantId,
  );
  if (!session) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Onboarding session not found' } },
      404,
    );
  }
  return c.json({ success: true, data: session });
});

app.post('/:id/complete-step', zValidator('json', CompleteStepSchema), withSecurityEvents({ action: 'onboarding.create', resource: 'onboarding', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const correlationId =
    c.req.header('x-correlation-id') ?? `onb_${Date.now()}`;
  const result = await service.completeStep(
    id as OnboardingSessionId,
    auth.tenantId as TenantId,
    body.stepId,
    body.data ?? {},
    auth.userId,
    correlationId,
  );
  if (!result.ok) {
    const status =
      result.error.code === 'SESSION_NOT_FOUND'
        ? 404
        : result.error.code === 'INVALID_STATE_TRANSITION'
          ? 409
          : 400;
    return c.json(
      {
        success: false,
        error: { code: result.error.code, message: result.error.message },
      },
      status,
    );
  }
  return c.json({ success: true, data: result.value });
}));

export const onboardingRouter = app;

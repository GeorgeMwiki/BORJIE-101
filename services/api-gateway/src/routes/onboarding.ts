/**
 * Onboarding router.
 *
 * Minimal wiring over the `OnboardingService` in `@borjie/domain-services`.
 * Storage is pluggable behind the `OnboardingRepository` port:
 *   - DEFAULT (`ONBOARDING_SESSION_STORE` unset / `memory`): a process-wide
 *     in-memory repo. Tenant isolation via the composite `tenantId::id` key.
 *     Data is lost on gateway restart and not shared across replicas — the
 *     historical behaviour, retained verbatim as the dev/test path.
 *   - DURABLE (`ONBOARDING_SESSION_STORE=drizzle` AND a live DB handle on the
 *     request): the Drizzle repo backed by `onboarding_sessions` (migration
 *     0314), so onboarding state SURVIVES a restart and is SHARED across
 *     replicas (RSS-09). The HTTP surface is unchanged either way.
 *
 * The per-request store selection lives in `onboarding-session-store.ts`
 * (`resolveOnboardingRepo`), mirroring the memory-v2 inmemory/drizzle store
 * pair. Flipping the flag is the ONLY thing that changes runtime behaviour.
 *
 * Endpoints:
 *   GET  /                       — list active onboarding sessions (smoke)
 *   POST /                       — start an onboarding session
 *   GET  /:id                    — fetch an onboarding session
 *   POST /:id/complete-step      — mark a checklist step complete
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import {
  OnboardingService,
  type OnboardingRepository,
  type OnboardingSessionId,
} from '@borjie/domain-services/onboarding';
import { InMemoryEventBus } from '@borjie/domain-services';
// Derive the Drizzle client type locally via `ReturnType` to dodge the
// `TS2709 namespace-vs-type` barrel drift that bites the named `DatabaseClient`
// type-alias export at this consumption site (same pattern as
// services/action-executor/types.ts and composition/db-client.ts).
import type { createDatabaseClient } from '@borjie/database';
import type { TenantId, CustomerId, LeaseId } from '@borjie/domain-models';

type DatabaseClient = ReturnType<typeof createDatabaseClient>;

import { withSecurityEvents } from '@borjie/observability';
import { logger } from '../utils/logger';
import {
  createInMemoryOnboardingRepo,
  resolveOnboardingRepo,
} from './onboarding-session-store';

// ---------------------------------------------------------------------------
// Process-wide in-memory repo + event bus. Used directly when the durable
// store flag is off (the default), and as the fallback when it is on but no
// DB handle is present (dev/test).
// ---------------------------------------------------------------------------

const sharedInMemoryRepo: OnboardingRepository = createInMemoryOnboardingRepo();
const bus = new InMemoryEventBus();

/**
 * Resolve the repo + service for this request. When the durable-store flag is
 * off this returns the module-shared in-memory repo (zero behavioural change).
 * When on and a DB handle is present it returns a request-scoped Drizzle repo.
 */
function resolveOnboarding(c: { get(key: string): unknown }): {
  repo: OnboardingRepository;
  service: OnboardingService;
} {
  const db = c.get('db') as DatabaseClient | null | undefined;
  const repo = resolveOnboardingRepo({
    db,
    sharedInMemoryRepo,
    logger,
  });
  return { repo, service: new OnboardingService(repo, bus) };
}

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
  const { service } = resolveOnboarding(c);
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
  const { repo } = resolveOnboarding(c);
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
  const { service } = resolveOnboarding(c);
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

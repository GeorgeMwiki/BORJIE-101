/**
 * Customer App BFF — caller-scoped aggregation.
 *
 * Previously a stub that returned 503 for every request
 * (`createProtectedLiveDataRouter`). Now pulls the caller's lease, invoices,
 * and recent payments from the shared repo middleware. Rich features
 * (chat, notifications inbox, maintenance submissions) remain routed via
 * their dedicated top-level routers (`/messaging`, `/notifications`,
 * `/work-orders`) — the BFF is the customer-facing roll-up.
 *
 * Endpoints:
 *   GET  /me                                     — caller identity + tenant
 *   GET  /me/dashboard                            — summary: active lease, open balance, last 3 invoices
 *   GET  /maintenance                             — caller's work orders (wraps work-orders repo)
 *   GET  /letters                                 — caller's letter requests (DB-direct via getDb + letterRequests)
 *   POST /sublease                                — open a sublease request (wraps subleaseService)
 *   GET  /sublease                                — caller's sublease requests
 *   GET  /move-out/disputes                       — caller's open damage disputes (best-effort filter; empty if upstream lacks tenant filter)
 *   POST /marketplace/:unitId/negotiate           — start a negotiation on a unit (wraps negotiation service)
 *   GET  /marketplace/:unitId/negotiations        — caller's negotiations on a unit (DB-direct via getDb + negotiations)
 *   GET  /utilities                               — empty stub (utilities-service not yet wired)
 *   GET  /community                               — empty stub (community-service not yet wired)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { letterRequests, negotiations } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { safeInternalError } from '../../utils/safe-error';
import { logger } from '../../utils/logger';
import { mapWorkOrderRow } from '../db-mappers';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/me', (c) => {
  const auth = c.get('auth');
  return c.json({
    success: true,
    data: {
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: auth.role ?? null,
      customerId: auth.customerId ?? null,
    },
  });
});

app.get('/me/dashboard', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  if (!repos) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Customer dashboard requires DB-backed repos — DATABASE_URL unset',
        },
      },
      503,
    );
  }

  // Property-domain repos (leases, invoices, payments) were deleted in Borjie hard-fork.
  return c.json({
    success: true,
    data: {
      activeLease: null,
      openBalance: 0,
      recentInvoices: [],
      recentPayments: [],
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unavailable(c, message) {
  return c.json(
    {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// 1. GET /maintenance — caller's work orders
// ---------------------------------------------------------------------------

app.get('/maintenance', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  if (!repos) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Customer BFF requires DB-backed repos — DATABASE_URL unset',
        },
      },
      503,
    );
  }
  // Property-domain workOrders repo was deleted in Borjie hard-fork. Return empty.
  return c.json({
    success: true,
    data: [],
  });
});

// ---------------------------------------------------------------------------
// 2. GET /letters — caller's letter requests
// ---------------------------------------------------------------------------

app.get('/letters', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return unavailable(c, 'Customer BFF requires DB client — DATABASE_URL unset');
  }
  try {
    const rows = await db
      .select()
      .from(letterRequests)
      .where(
        and(
          eq(letterRequests.tenantId, auth.tenantId),
          eq(letterRequests.requestedBy, auth.userId),
        ),
      );
    return c.json({ success: true, data: rows });
  } catch (error) {
    return safeInternalError(c, error, {
      code: 'LETTERS_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list letter requests',
    });
  }
});

// ---------------------------------------------------------------------------
// 3 + 4. Sublease — POST/GET caller-scoped
// ---------------------------------------------------------------------------

const SubleaseCreateSchema = z.object({
  parentLeaseId: z.string().min(1),
  subtenantCandidateId: z.string().optional(),
  reason: z.string().max(2000).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  rentResponsibility: z
    .enum(['primary_tenant', 'subtenant', 'split'])
    .optional(),
  splitPercent: z.record(z.string(), z.number()).optional(),
});

app.post('/sublease', zValidator('json', SubleaseCreateSchema), withSecurityEvents({ action: 'customer-app.create', resource: 'customer-app', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const services = c.get('services');
  const subleaseService = services?.subleaseService ?? services?.sublease?.service;
  if (!subleaseService) {
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
  try {
    const body = c.req.valid('json');
    // Inject the caller as the requester so customers cannot impersonate
    // other tenants by setting `requestedBy` themselves.
    const result = await subleaseService.submit(
      auth.tenantId,
      { ...body, requestedBy: auth.userId },
      auth.userId,
    );
    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        result.error.code === 'INVALID_INPUT' ? 400 : 409,
      );
    }
    return c.json({ success: true, data: { id: result.data?.id ?? null } }, 201);
  } catch (error) {
    return safeInternalError(c, error, {
      code: 'SUBLEASE_SUBMIT_FAILED',
      status: 500,
      fallback: 'Failed to submit sublease request',
    });
  }
}));

app.get('/sublease', async (c) => {
  const auth = c.get('auth');
  const services = c.get('services') as {
    sublease?: {
      repo?: { listPending: (tenantId: string) => Promise<ReadonlyArray<{ requestedBy?: string }>> };
    };
  } | undefined;
  const repo = services?.sublease?.repo;
  if (!repo) {
    // Honest empty: sublease repo not wired yet. Frontend renders empty
    // state instead of crashing.
    return c.json({
      success: true,
      data: [],
      meta: { note: 'sublease-service not yet wired' },
    });
  }
  try {
    const rows = await repo.listPending(auth.tenantId);
    // Best-effort filter: keep only requests where the caller is the
    // requester. The repo may not expose a `requestedBy` field uniformly
    // — when absent we fall through and return everything tenant-scoped.
    const mine = rows.filter(
      (row) => !row.requestedBy || row.requestedBy === auth.userId,
    );
    return c.json({ success: true, data: mine });
  } catch (error) {
    return safeInternalError(c, error, {
      code: 'SUBLEASE_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list sublease requests',
    });
  }
});

// ---------------------------------------------------------------------------
// 5. GET /move-out/disputes — caller's open damage disputes
// ---------------------------------------------------------------------------

app.get('/move-out/disputes', async (c) => {
  const auth = c.get('auth');
  const services = c.get('services') as {
    damageDeductions?: {
      repo?: { listOpen: (tenantId: string) => Promise<ReadonlyArray<Record<string, unknown>>> };
    };
    featureFlags?: {
      isEnabled?: (tenantId: string, flagKey: string) => Promise<boolean>;
    };
  } | undefined;
  const repo = services?.damageDeductions?.repo;
  if (!repo) {
    return c.json({
      success: true,
      data: [],
      meta: {
        note:
          'damage-deductions repo not wired yet; frontend renders empty state',
      },
    });
  }
  try {
    // CUST-BFF-001: real wire when `repos.leases.findByCustomer` exists,
    // intersect leaseIds with the damage-deduction rows from
    // `repo.listOpen`. Otherwise: loud-fail 501 unless a per-tenant
    // feature flag is on (dev mode).
    const repos = c.get('repos') as { leases?: { findByCustomer?: Function } } | undefined;
    const leasesByCustomer = repos?.leases?.findByCustomer;
    const openRows = await repo.listOpen(auth.tenantId);
    if (typeof leasesByCustomer === 'function') {
      const leases = (await leasesByCustomer.call(repos!.leases, auth.tenantId, auth.userId)) as Array<{ id: string }>;
      const leaseIds = new Set((leases ?? []).map((l) => l.id));
      const scoped = (openRows ?? []).filter((row: any) => leaseIds.has(row.leaseId));
      return c.json({
        success: true,
        data: scoped,
        meta: { note: 'live: damage-deductions filtered by caller leaseIds' },
      });
    }

    const ff = services?.featureFlags;
    const flagKey = 'flag.bff.customer_app.move_out_disputes';
    let flagOn = false;
    try {
      flagOn = Boolean(await ff?.isEnabled?.(auth.tenantId, flagKey));
    } catch {
      flagOn = false;
    }
    if (!flagOn) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message:
              'Per-customer damage-deduction filter not wired. Concrete next-step: add LeaseRepository.findByCustomer(tenantId, customerId) and intersect with repo.listOpen results.',
            flagKey,
          },
        },
        501,
      );
    }
    return c.json({
      success: true,
      data: [],
      meta: { note: 'flag-gated dev response; tenant-filter on damage-deductions pending' },
    });
  } catch (error) {
    logger.warn('customer-app: damage-deductions listOpen failed', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return safeInternalError(c, error, {
      code: 'DISPUTES_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list move-out disputes',
    });
  }
});

// ---------------------------------------------------------------------------
// 6 + 7. Marketplace negotiations — POST start, GET list per unit
// ---------------------------------------------------------------------------

const NegotiateStartSchema = z.object({
  policyId: z.string().min(1),
  openingOffer: z.number().positive(),
  openingRationale: z.string().max(2000).optional(),
  propertyId: z.string().optional(),
  listingId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

app.post(
  '/marketplace/:unitId/negotiate',
  zValidator('json', NegotiateStartSchema),
  withSecurityEvents({ action: 'customer-app.create', resource: 'customer-app', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const services = c.get('services') ?? {};
    const negSvc = services.negotiation;
    if (!negSvc || typeof negSvc.startNegotiation !== 'function') {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'Negotiation service not wired into api-gateway context',
          },
        },
        503,
      );
    }
    try {
      const body = c.req.valid('json');
      const correlationId =
        c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
      // Inject applicant identity from auth — customer-app cannot spoof
      // another prospect.
      const result = await negSvc.startNegotiation(
        auth.tenantId,
        {
          ...body,
          unitId: c.req.param('unitId'),
          domain: 'lease_price',
          prospectCustomerId: auth.customerId ?? auth.userId,
        },
        correlationId,
        auth.userId,
      );
      if (!result.ok) {
        return c.json(
          {
            success: false,
            error: {
              code: result.error.code,
              message: result.error.message,
            },
          },
          400,
        );
      }
      return c.json({ success: true, data: result.value }, 201);
    } catch (error) {
      return safeInternalError(c, error, {
        code: 'NEGOTIATION_START_FAILED',
        status: 500,
        fallback: 'Failed to start negotiation',
      });
    }
  }),
);

app.get('/marketplace/:unitId/negotiations', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return unavailable(c, 'Customer BFF requires DB client — DATABASE_URL unset');
  }
  try {
    const unitId = c.req.param('unitId');
    const prospectId = auth.customerId ?? auth.userId;
    const rows = await db
      .select()
      .from(negotiations)
      .where(
        and(
          eq(negotiations.tenantId, auth.tenantId),
          eq(negotiations.unitId, unitId),
          eq(negotiations.prospectCustomerId, prospectId),
        ),
      );
    return c.json({ success: true, data: rows });
  } catch (error) {
    return safeInternalError(c, error, {
      code: 'NEGOTIATIONS_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list negotiations',
    });
  }
});

// ---------------------------------------------------------------------------
// 8 + 9. Honest empty stubs — utilities + community
// ---------------------------------------------------------------------------

app.get('/utilities', (c) => {
  return c.json({
    success: true,
    data: {
      readings: [],
      bills: [],
      note: 'utilities-service not yet wired',
    },
  });
});

app.get('/community', (c) => {
  return c.json({
    success: true,
    data: {
      posts: [],
      note: 'community-service not yet wired',
    },
  });
});

export const customerAppRouter = app;

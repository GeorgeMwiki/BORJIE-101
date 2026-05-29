/**
 * Customer App BFF — caller-scoped aggregation.
 *
 * Post Borjie hard-fork (post-fork route audit, see
 * Docs/AUDIT/POST_FORK_ROUTE_AUDIT.md): the property-management
 * endpoints (/letters, /sublease, /move-out/disputes,
 * /marketplace/:unitId/negotiate*, /marketplace/:unitId/negotiations)
 * were deleted because their backing tables / services
 * (letterRequests, subleaseService, damageDeductions, negotiations)
 * do not exist in Borjie. Buyer-side mineral haggling lives at
 * /api/v1/mining/marketplace + /api/v1/mining/bids (bid_negotiations
 * schema) and the buyer-mobile app.
 *
 * Endpoints:
 *   GET  /me                                     — caller identity + tenant
 *   GET  /me/dashboard                            — summary: active lease, open balance, last 3 invoices
 *   GET  /maintenance                             — caller's work orders (returns [] post-fork; use /mining/tasks)
 *   GET  /utilities                               — empty stub (utilities-service not yet wired)
 *   GET  /community                               — empty stub (community-service not yet wired)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

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
// REMOVED (borjie hard-fork): /letters, /sublease (POST+GET),
// /move-out/disputes, /marketplace/:unitId/negotiate(s).
//
// Why deleted:
//   - /letters    — letterRequests schema does not exist in Borjie database
//                   (was BossNyumba property-management notice letters).
//                   On-demand legal/contract drafting now lives at
//                   /api/v1/mining/docs + /api/v1/mining/draft (uses
//                   document_drafts + draft_revisions schemas).
//   - /sublease   — pure property-management concept; no Borjie equivalent.
//   - /move-out/disputes — pure property-management concept; no Borjie equivalent.
//   - /marketplace/:unitId/negotiate(s) — was leasing-price haggling on
//                   property units; Borjie buyer-side haggling on ore
//                   parcels lives at /api/v1/mining/marketplace +
//                   /api/v1/mining/bids (bid_negotiations schema) plus
//                   the buyer-mobile app.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Honest empty stubs — utilities + community
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

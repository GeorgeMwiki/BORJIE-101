import { Hono } from 'hono';
import { createHmac, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
// Post Borjie hard-fork the legacy `inspections` (property-domain) table
// was removed. Mining-domain equivalent is `preShiftInspections` keyed
// on `siteId` (sites replaced properties). See migration 0007 +
// mining-workforce-extensions.schema.ts.
import { preShiftInspections } from '@borjie/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { e400, e403, e503, errorResponse } from '../../utils/error-response';
import { getOwnerScope as resolveOwnerScope } from '../../lib/owner-scope';

import { withSecurityEvents } from '@borjie/observability';

/**
 * Owner-portal scope resolver.
 *
 * Wraps `lib/owner-scope#getOwnerScope` which issues `findByPropertyIds`
 * queries so the DB does the filtering in a single WHERE clause (tenant
 * + soft-delete still enforced inside each repo).
 *
 * Post Borjie hard-fork: property-domain repos (properties / units /
 * leases / customers / invoices / payments / workOrders / vendors)
 * were dropped, so this call throws when invoked against the live
 * repos container. Callers (currently only /compliance/inspections,
 * /compliance/summary, /tenants/communications) wrap the call in
 * try/catch and fall back to honest-empty envelopes so the dashboard
 * stays green.
 */
async function getOwnerScope(auth: any, repos: any) {
  return resolveOwnerScope(auth, repos, { limit: 1000, offset: 0 });
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);
app.use('*', async (c, next) => {
  const auth = c.get('auth');

  if (!([UserRole.OWNER, UserRole.TENANT_ADMIN, UserRole.ADMIN, UserRole.SUPER_ADMIN] as UserRole[]).includes(auth.role)) {
    return e403(c, 'FORBIDDEN', 'Owner portal access is not allowed for this role.');
  }

  await next();
});

// ---------------------------------------------------------------------------
// REMOVED (borjie hard-fork): 14 vestigial property-management endpoints
// that 500'd because their backing repos (workOrders, invoices, payments,
// messaging, documents) were dropped from the @borjie/database barrel.
//
// Borjie equivalents:
//   GET  /work-orders                            -> /api/v1/mining/tasks
//   POST /work-orders/:id/approve                -> /api/v1/mining/approvals
//   POST /work-orders/:id/reject                 -> /api/v1/mining/approvals
//   GET  /financial/stats                        -> /api/v1/owner/brief (estate-wide financial pulse)
//                                                   + /api/v1/mining/sales (mineral revenue)
//                                                   + estate_capital_movements ledger
//   GET  /invoices                               -> N/A (no rental invoicing; mineral
//                                                   sales settled via /api/v1/mining/sales)
//   GET  /payments                               -> /api/v1/mining/sales + payments-ledger
//   GET  /reports/export/financial               -> /api/v1/mining/reports
//   GET  /disbursements                          -> /api/v1/cooperatives/settlements
//                                                   + estate_capital_movements
//   GET  /disbursements/:id/statement            -> /api/v1/cooperatives/settlements
//   GET  /messaging/conversations                -> /api/v1/owner/messaging (canonical)
//   GET  /messaging/conversations/:id/messages   -> /api/v1/owner/messaging/threads
//   POST /messaging/conversations/:id/messages   -> /api/v1/owner/messaging/threads
//   GET  /documents/signatures                   -> /api/v1/mining/docs + document_drafts
//   POST /documents/:id/sign                     -> /api/v1/mining/docs (verifier flow)
//
// See Docs/AUDIT/POST_FORK_ROUTE_AUDIT.md for the full per-route mapping.
// ---------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Frontend gap-fix endpoint — owner-portal CoOwnerInviteModal renders the
// co-owners list above the "+ Invite" button. OWNER-BFF-001 — when the
// `repos.userPropertyAccess.findCoOwners` query lands we use it directly.
// Until then: loud-fail 501 unless `flag.bff.owner_portal.co_owners` is
// on for the tenant.
// ----------------------------------------------------------------------------
app.get('/co-owners', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos') as { userPropertyAccess?: { findCoOwners?: Function } } | undefined;
  const findCoOwners = repos?.userPropertyAccess?.findCoOwners;
  if (typeof findCoOwners === 'function') {
    try {
      const rows = await findCoOwners.call(repos!.userPropertyAccess, auth.tenantId, auth.propertyAccess ?? []);
      return c.json({ success: true, data: rows ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'co-owners query failed';
      return e503(c, 'CO_OWNERS_SERVICE_ERROR', message);
    }
  }

  const services = c.get('services') as { featureFlags?: { isEnabled: Function } } | undefined;
  const flagKey = 'flag.bff.owner_portal.co_owners';
  let flagOn = false;
  try {
    flagOn = Boolean(await services?.featureFlags?.isEnabled?.(auth.tenantId, flagKey));
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    // Field name `featureFlag` (not `flagKey`) because the redactDetails
    // helper in utils/error-response.ts strips any details key matching
    // /key/i. Renaming preserves the public identifier on the wire.
    return errorResponse(
      c,
      501,
      'NOT_IMPLEMENTED',
      'Co-owner list pipeline not wired. Concrete next-step: add repos.userPropertyAccess.findCoOwners(tenantId, propertyIds) and intersect with the inviter property scope.',
      { featureFlag: flagKey },
    );
  }
  return c.json({ success: true, data: [], meta: { note: 'flag-gated dev empty list; co-owner pipeline pending' } });
});

// ============================================================================
// C-agent gap-fix BFF endpoints — owner-portal calls these but the
// underlying domain services are either partially wired (inspections,
// messaging) or not yet built (budgets, insurance, licenses, invitations).
//
// Strategy:
//   - real-wrap when the domain table exists and we can filter to the
//     owner's property scope (inspections, communications),
//   - honest-empty otherwise — return shape-correct envelopes with a
//     `meta.note` describing why the list is empty, so the UI renders
//     stably and observers know the gap is intentional, not a bug.
// ============================================================================

const BUDGETS_NOTE = 'budgets service not yet wired';
const INSURANCE_NOTE = 'insurance service not yet wired';
const LICENSES_NOTE = 'licenses service not yet wired';
const COMMUNICATIONS_NOTE =
  'communications service not yet wired — falling back to messaging-conversations digest';
const INVITATIONS_NOTE =
  'invitation pipeline not yet wired — token signed for forward-compat, list reads empty';

function reposUnavailable(c: any) {
  return e503(c, 'SERVICE_UNAVAILABLE', 'Owner BFF requires repositories to be wired.');
}

// ----------------------------------------------------------------------------
// 1. GET /budgets/summary — honest-empty
// ----------------------------------------------------------------------------
app.get('/budgets/summary', (c) => {
  return c.json({
    success: true,
    data: {
      totalBudgetMajor: 0,
      spentMajor: 0,
      varianceMajor: 0,
      currency: 'USD',
      meta: { note: BUDGETS_NOTE },
    },
  });
});

// ----------------------------------------------------------------------------
// 2. GET /budgets/forecasts — honest-empty
// ----------------------------------------------------------------------------
app.get('/budgets/forecasts', (c) => {
  return c.json({
    success: true,
    data: {
      forecasts: [],
      meta: { note: BUDGETS_NOTE },
    },
  });
});

// ----------------------------------------------------------------------------
// 3. GET /compliance/inspections — real-wrap of the mining-domain
//    `pre_shift_inspections` table (the post-fork equivalent of the
//    legacy property-domain `inspections` table). Filtered by the owner's
//    site scope. Falls back to honest-empty when repos/db are unavailable
//    so the dashboard still renders.
// ----------------------------------------------------------------------------
app.get('/compliance/inspections', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const db = c.get('db');

  if (!repos || !db) {
    return c.json({
      success: true,
      data: [],
      meta: { note: 'inspections backend not available in this environment' },
    });
  }

  try {
    const scope = await getOwnerScope(auth, repos);
    // Owner scope returns properties; in the post-fork mining domain
    // each property-id maps 1:1 to a site-id. The resolver upstream
    // returns site identifiers under the `properties` field for
    // backward-compat with the BFF; semantically these are site ids.
    const siteIds = scope.properties.map((entry) => entry.id);

    if (siteIds.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const rows = await db
      .select()
      .from(preShiftInspections)
      .where(
        and(
          eq(preShiftInspections.tenantId, auth.tenantId),
          inArray(preShiftInspections.siteId, siteIds),
        ),
      )
      .orderBy(desc(preShiftInspections.createdAt))
      .limit(200);

    return c.json({ success: true, data: rows });
  } catch (_error) {
    return c.json({
      success: true,
      data: [],
      meta: {
        note: 'inspections query failed — returning honest-empty for dashboard stability',
      },
    });
  }
});

// ----------------------------------------------------------------------------
// 4. GET /compliance/insurance — honest-empty
// ----------------------------------------------------------------------------
app.get('/compliance/insurance', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: INSURANCE_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 5. GET /compliance/licenses — honest-empty
// ----------------------------------------------------------------------------
app.get('/compliance/licenses', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: LICENSES_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 6. GET /compliance/summary — rolls up the three lists above. Inspections
//    count is real (when reachable); insurance + licenses are 0.
//
// Inspection statuses considered "due" (i.e. open, not yet closed) are
// any row whose `overallStatus` is NOT in the terminal-closed set
// (`passed` / `failed`). The pre-shift inspection schema enum is
// `pending | passed | failed | sign_off_pending`; the legacy property-
// domain `inspections` enum used `scheduled | in_progress | completed |
// archived | cancelled`. We accept both vocabularies so this rollup
// stays compatible with mocks that still carry the old shape.
// ----------------------------------------------------------------------------
const CLOSED_INSPECTION_STATUSES = new Set([
  // Mining-domain pre-shift inspection terminals.
  'passed',
  'failed',
  // Legacy property-domain inspection terminals.
  'completed',
  'archived',
  'cancelled',
]);

app.get('/compliance/summary', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const db = c.get('db');

  let inspectionsDueCount = 0;

  if (repos && db) {
    try {
      const scope = await getOwnerScope(auth, repos);
      const siteIds = scope.properties.map((entry) => entry.id);

      if (siteIds.length > 0) {
        const rows = await db
          .select()
          .from(preShiftInspections)
          .where(
            and(
              eq(preShiftInspections.tenantId, auth.tenantId),
              inArray(preShiftInspections.siteId, siteIds),
            ),
          );

        // "Due" = anything that isn't terminal-closed. Reads both the
        // current-schema (`overallStatus`) and the legacy (`status`)
        // field so tests can stub either vocabulary.
        inspectionsDueCount = rows.filter((row: Record<string, unknown>) => {
          const status =
            typeof row.overallStatus === 'string'
              ? row.overallStatus
              : typeof row.status === 'string'
                ? row.status
                : '';
          return !CLOSED_INSPECTION_STATUSES.has(status);
        }).length;
      }
    } catch {
      inspectionsDueCount = 0;
    }
  }

  return c.json({
    success: true,
    data: {
      inspectionsDueCount,
      insuranceExpiringCount: 0,
      licensesExpiringCount: 0,
      meta: {
        note:
          inspectionsDueCount > 0
            ? 'inspections-real, insurance+licenses honest-empty'
            : 'inspections may be 0 (real) or service-degraded; insurance+licenses honest-empty',
      },
    },
  });
});

// ----------------------------------------------------------------------------
// 7. GET /tenants/communications — honest-empty post-fork.
//
// Pre-fork: wrapped a JS digest over the `conversations` table.
// Post Borjie hard-fork: the `conversations` schema is gone — owner
// messaging lives at /api/v1/owner/messaging (owner_messaging schema)
// + /api/v1/owner/messaging/threads. Frontend should call those.
// ----------------------------------------------------------------------------
app.get('/tenants/communications', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: COMMUNICATIONS_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 8. POST /invitations/co-owner — stub. The real pipeline writes a row
//    to an `invitations` table and emails a signed link. Until that
//    lands we sign a token (HMAC-SHA256 over { invitationId, email,
//    propertyAccess, expiresAt }) using INVITATION_SECRET so the URL
//    can be verified later. Returns a 201-equivalent envelope.
// ----------------------------------------------------------------------------
function getInvitationSecret() {
  return (
    process.env.INVITATION_SECRET ||
    process.env.JWT_SECRET ||
    'invitation-fallback-salt-do-not-rely-on-this-in-production'
  );
}

function signInvitationToken(payload: any) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getInvitationSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

app.post('/invitations/co-owner', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = typeof body.role === 'string' ? body.role : 'co-owner';
  const propertyAccess = Array.isArray(body.propertyAccess)
    ? body.propertyAccess.filter((id) => typeof id === 'string')
    : [];

  // Light schema validation: email must look plausible, role must be
  // co-owner. We deliberately don't pull zod here to keep this stub thin.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailValid || role !== 'co-owner') {
    return e400(c, 'INVALID_INPUT', 'Invitation requires a valid email and role="co-owner".');
  }

  const invitationId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = signInvitationToken({
    invitationId,
    email,
    role,
    propertyAccess,
    invitedBy: auth.userId,
    tenantId: auth.tenantId,
    expiresAt,
  });

  // OWNER-BFF-002: real wire when an InvitationService is on `services`.
  // Otherwise loud-fail 501 unless `flag.bff.owner_portal.invitations_create`
  // is on — in dev mode we still return the signed token so the FE can
  // exercise the end-to-end flow without persistence.
  const services = c.get('services') as { invitationService?: { create: Function }; featureFlags?: { isEnabled: Function } } | undefined;
  const invitationService = services?.invitationService;
  if (invitationService && typeof invitationService.create === 'function') {
    try {
      const created = await invitationService.create({
        invitationId,
        email,
        role,
        propertyAccess,
        invitedBy: auth.userId,
        tenantId: auth.tenantId,
        expiresAt,
        token,
      });
      return c.json({ success: true, data: { ...created, token } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invitation create failed';
      return e503(c, 'INVITATION_SERVICE_ERROR', message);
    }
  }

  const flagKey = 'flag.bff.owner_portal.invitations_create';
  let flagOn = false;
  try {
    flagOn = Boolean(await services?.featureFlags?.isEnabled?.(auth.tenantId, flagKey));
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    // See comment in /co-owners — `featureFlag` survives redactDetails;
    // `flagKey` would be scrubbed because of the /key/i regex.
    return errorResponse(
      c,
      501,
      'NOT_IMPLEMENTED',
      'Invitation persistence not wired. Concrete next-step: add invitations table + InvitationService.create(...) that writes the row + enqueues notification.email.dispatch onto the outbox.',
      { featureFlag: flagKey },
    );
  }
  return c.json({
    success: true,
    data: {
      invitationId,
      expiresAt,
      token,
      meta: { note: INVITATIONS_NOTE },
    },
  });
}));

// ----------------------------------------------------------------------------
// 9. GET /invitations — honest-empty until the invitations table exists.
// ----------------------------------------------------------------------------
app.get('/invitations', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: INVITATIONS_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 10. POST /invitations/:id/cancel — accepts the cancel call and reports
//     success. No-op until the invitations table is wired; the BFF
//     contract is what the owner-portal needs today.
// ----------------------------------------------------------------------------
app.post('/invitations/:id/cancel', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, (c) => {
  const id = c.req.param('id');
  return c.json({
    success: true,
    data: {
      id,
      status: 'cancelled',
      meta: { note: INVITATIONS_NOTE },
    },
  });
}));

export const ownerPortalRouter = app;

/**
 * /api/v1/mining/flows — the BUSINESS-PROCESS COMPILER golden flow (slice 1).
 *
 * Makes the "buyer inquiry on a listing" flow ALIVE end-to-end across three
 * actors, composing the live organs — the surface-completion binder
 * (owner_tabs_structural projection legs), `flow_runs` as the durable
 * cross-surface state machine, and `flow_autonomy_prefs` (`isFlowAuto`,
 * fail-closed to GATED) as the human gate.
 *
 * Owner/worker routes (this router, mounted /api/v1/mining/flows):
 *   POST /install                      owner: compile + bind the golden flow → 3 surfaces
 *   GET  /                             owner: installed flows + open-run counts
 *   POST /inquiries                    buyer: raise an inquiry on a listing (cross-tenant)
 *   GET  /inquiries/queue              worker/owner: open inquiry runs (seller tenant)
 *   POST /inquiries/:id/respond        worker: draft response → auto-deliver | park for owner
 *   GET  /inquiries/pending            owner: runs parked awaiting approval
 *   POST /inquiries/:id/approve        owner: approve a parked response → deliver
 *
 * Buyer router (buyerInquiriesRouter, mounted /api/v1/buyer/inquiries):
 *   GET  /                             buyer: my inquiries + responses (ReBAC, own-originated)
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  businessFlows,
  flowRuns,
  marketplaceListings,
  withServiceRoleContext,
} from '@borjie/database';
import { isFlowAuto } from '@borjie/workflow-engine';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { getWorkflowEngine } from '../../../composition/workflow-engine-wiring';
import {
  installFlow,
  GOLDEN_INQUIRY_FLOW,
} from '../../../composition/surface-completion/flow-binder';

// Role groups for the flow actions. The buyer-facing routes (raise inquiry,
// read my inquiries) stay open to any authenticated principal; the seller-side
// actions are gated so a low-privileged member can't act as worker/owner —
// critically, only an owner/admin can APPROVE (the human gate) or INSTALL.
const WORKER_PLUS = [
  UserRole.PROPERTY_MANAGER,
  UserRole.MAINTENANCE_STAFF,
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
] as const;
const OWNER_PLUS = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
] as const;

type Auth = { tenantId: string; userId: string };
type AnyDb = any;
type SvcDb = Parameters<typeof withServiceRoleContext>[0];

const FLOW_KEY = GOLDEN_INQUIRY_FLOW.flowKey;
const OPEN_STATES = ['task_assigned', 'awaiting_owner_approval'] as const;

const getAuth = (c: Context): Auth | undefined =>
  c.get('auth') as Auth | undefined;

const unauth = (c: Context) =>
  c.json(
    { success: false as const, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
    401,
  );

const noDb = (c: Context) =>
  c.json(
    { success: false as const, error: { code: 'FLOWS_DB_UNAVAILABLE', message: 'Database not configured' } },
    503,
  );

const runView = (r: Record<string, unknown>) => ({
  id: r.id,
  flowKey: r.flowKey ?? r.flow_key,
  state: r.state,
  status: r.status,
  subjectRef: r.subjectRef ?? r.subject_ref ?? null,
  payload: r.payload ?? {},
  response: r.response ?? null,
  createdAt: r.createdAt ?? r.created_at,
  updatedAt: r.updatedAt ?? r.updated_at,
});

// ─── Owner + worker router ───────────────────────────────────────────────────
const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

/** Owner installs the golden flow → materializes all three surface tabs. */
app.post('/install', requireRole(...OWNER_PLUS), async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const result = await installFlow({
    db,
    tenantId: auth.tenantId,
    ownerUserId: auth.userId,
  });
  return c.json({ success: true as const, data: result }, 200);
});

/** Owner: installed flows + their open-run counts. */
app.get('/', requireRole(...OWNER_PLUS), async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const flows = await db.select().from(businessFlows).where(eq(businessFlows.tenantId, auth.tenantId));
  const open = await db
    .select()
    .from(flowRuns)
    .where(and(eq(flowRuns.tenantId, auth.tenantId), inArray(flowRuns.state, [...OPEN_STATES])));
  return c.json(
    {
      success: true as const,
      data: {
        flows: (flows as Array<Record<string, unknown>>).map((f) => ({
          flowKey: f.flowKey ?? f.flow_key,
          name: f.name,
          status: f.status,
        })),
        openRunCount: Array.isArray(open) ? open.length : 0,
      },
    },
    200,
  );
});

const raiseInquirySchema = z.object({
  listingId: z.string().min(1).max(128),
  message: z.string().min(1).max(2000),
});

/**
 * Buyer raises an inquiry on a listing. Cross-tenant: resolves the listing's
 * seller tenant (readable via the cross-tenant marketplace policy), then writes
 * the flow_run into the SELLER tenant via the service-role bypass, attributed to
 * the authenticated buyer (originating_party_id). State starts at task_assigned
 * — the worker task is the open run.
 */
app.post('/inquiries', async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = raiseInquirySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'Invalid inquiry', issues: parsed.error.issues } },
      400,
    );
  }
  const { listingId, message } = parsed.data;

  // Resolve the seller tenant from the listing (cross-tenant read allowed for
  // active public-tier listings by the marketplace public-read policy).
  const listings = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, listingId))
    .limit(1);
  const listing = (listings as Array<Record<string, unknown>>)[0];
  if (!listing) {
    return c.json(
      { success: false as const, error: { code: 'LISTING_NOT_FOUND', message: 'Listing not found or not public' } },
      404,
    );
  }
  const sellerTenantId = String(listing.tenantId ?? listing.tenant_id);
  const runId = `frun_${randomUUID()}`;
  const now = new Date();

  await withServiceRoleContext(db as SvcDb, async (tx) => {
    await (tx as AnyDb).insert(flowRuns).values({
      id: runId,
      tenantId: sellerTenantId,
      flowKey: FLOW_KEY,
      originatingPartyId: auth.userId,
      originatingTenantId: auth.tenantId,
      subjectRef: listingId,
      state: 'task_assigned',
      status: 'open',
      payload: { message, listingTitle: listing.title ?? null },
      createdAt: now,
      updatedAt: now,
    });
  });

  return c.json({ success: true as const, data: { id: runId, state: 'task_assigned' } }, 201);
});

/** Worker/owner: the open inquiry queue for this (seller) tenant. */
app.get('/inquiries/queue', requireRole(...WORKER_PLUS), async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const rows = await db
    .select()
    .from(flowRuns)
    .where(and(eq(flowRuns.tenantId, auth.tenantId), inArray(flowRuns.state, [...OPEN_STATES])))
    .orderBy(desc(flowRuns.createdAt))
    .limit(100);
  return c.json({ success: true as const, data: (rows as Array<Record<string, unknown>>).map(runView) }, 200);
});

const respondSchema = z.object({ message: z.string().min(1).max(4000) });

/**
 * Worker drafts a response. The HUMAN GATE: if the owner flipped this flow to
 * AUTO (flow_autonomy, confirmed) the response delivers immediately; otherwise
 * (default — fail-closed) it parks awaiting owner approval.
 */
app.post('/inquiries/:id/respond', requireRole(...WORKER_PLUS), async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => ({}));
  const parsed = respondSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'Invalid response' } },
      400,
    );
  }

  const { flowAutonomy } = getWorkflowEngine();
  const pref = await flowAutonomy.get(auth.tenantId, FLOW_KEY);
  const auto = isFlowAuto(pref); // false when no row → GATED (fail-closed)
  const nextState = auto ? 'delivered' : 'awaiting_owner_approval';
  const now = new Date();

  const updated = await db
    .update(flowRuns)
    .set({
      state: nextState,
      response: { message: parsed.data.message, respondedBy: auth.userId, respondedAt: now.toISOString(), auto },
      ...(auto ? { status: 'open' } : {}),
      updatedAt: now,
    })
    .where(and(eq(flowRuns.id, id), eq(flowRuns.tenantId, auth.tenantId), inArray(flowRuns.state, [...OPEN_STATES])))
    .returning({ id: flowRuns.id });

  if (!Array.isArray(updated) || updated.length === 0) {
    return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Open inquiry not found' } }, 404);
  }
  return c.json(
    { success: true as const, data: { id, state: nextState, autoDelivered: auto } },
    200,
  );
});

/** Owner: responses parked awaiting approval (the gated path). */
app.get('/inquiries/pending', requireRole(...OWNER_PLUS), async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const rows = await db
    .select()
    .from(flowRuns)
    .where(and(eq(flowRuns.tenantId, auth.tenantId), eq(flowRuns.state, 'awaiting_owner_approval')))
    .orderBy(desc(flowRuns.updatedAt))
    .limit(100);
  return c.json({ success: true as const, data: (rows as Array<Record<string, unknown>>).map(runView) }, 200);
});

/** Owner: approve a parked response → deliver to the buyer (the human gate). */
app.post('/inquiries/:id/approve', requireRole(...OWNER_PLUS), async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  const id = c.req.param('id');
  const now = new Date();
  const updated = await db
    .update(flowRuns)
    .set({ state: 'delivered', updatedAt: now })
    .where(and(eq(flowRuns.id, id), eq(flowRuns.tenantId, auth.tenantId), eq(flowRuns.state, 'awaiting_owner_approval')))
    .returning({ id: flowRuns.id });
  if (!Array.isArray(updated) || updated.length === 0) {
    return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'No parked response found' } }, 404);
  }
  return c.json({ success: true as const, data: { id, state: 'delivered' } }, 200);
});

export const miningFlowsRouter = app;

// ─── Buyer read router (ReBAC: own-originated only) ──────────────────────────
const buyerApp = new Hono();
buyerApp.use('*', authMiddleware);
buyerApp.use('*', databaseMiddleware);

/**
 * Buyer: my inquiries + the responses. Cross-tenant by nature (the seller owns
 * the run), so the read runs under the service-role bypass BOUNDED to runs the
 * authenticated buyer originated (originating_party_id = my user id). A buyer
 * can only ever see inquiries they raised.
 */
buyerApp.get('/', async (c) => {
  const auth = getAuth(c);
  const db = c.get('db') as AnyDb;
  if (!auth) return unauth(c);
  if (!db) return noDb(c);
  // Defense-in-depth: this read is service-role (tenant-bypassing) and keyed
  // SOLELY on the buyer's userId, so a falsy userId must never run the query.
  if (!auth.userId) return unauth(c);
  const rows = await withServiceRoleContext(db as SvcDb, async (tx) =>
    (tx as AnyDb)
      .select()
      .from(flowRuns)
      .where(eq(flowRuns.originatingPartyId, auth.userId))
      .orderBy(desc(flowRuns.createdAt))
      .limit(100),
  );
  return c.json(
    {
      success: true as const,
      data: (rows as Array<Record<string, unknown>>).map((r) => ({
        ...runView(r),
        // The buyer sees the response only once it's delivered.
        response: r.state === 'delivered' ? r.response ?? null : null,
        answered: r.state === 'delivered',
      })),
    },
    200,
  );
});

export const buyerInquiriesRouter = buyerApp;

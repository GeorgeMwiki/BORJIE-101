/**
 * /api/v1/mining/procurement-coordination — REAL procurement platform backed
 * by `@borjie/procurement-coordination` (createProcurementCoordination) over
 * the durable `procurement_*` tables (migration 0294).
 *
 * Distinct from `/mining/procurement` (junior-produced
 * `procurement_recommendations` read-only). This surface drives the genuine
 * vendor registry + budgets + requisitions + spend analytics services.
 *
 * Routes:
 *   GET  /vendors                 list the tenant's vendor registry
 *   POST /vendors                 register a vendor (package KYC-status flow)
 *   GET  /budgets                 list budgets with availability roll-up
 *   GET  /analytics/spend-by-vendor    spend per vendor (issued/closed POs)
 *   GET  /analytics/spend-by-category  spend per vendor category
 *   GET  /analytics/maverick-spend     POs that bypassed framework/RFQ
 *   POST /requisitions            create a purchase requisition (reserves
 *                                 budget + resolves an approval chain)
 *
 * Spend figures are aggregated by the package's `createSpendAnalytics` from the
 * persisted PO / invoice / vendor rows — never fabricated.
 *
 * MONEY NEUTRALITY (CLAUDE.md): every amount carries its own ISO-4217
 * `currency`; no currency literal in any code path. The tenantId is injected
 * server-side from the verified session — the client tenantId is never trusted.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; every
 * `procurement_*` table is FORCE-RLS. The data port also filters reads by
 * tenantId (defence in depth). All inputs validated with zod.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  createProcurementCoordination,
  computeAvailability,
} from '@borjie/procurement-coordination';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { UserRole } from '../../types/user-role';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { createDrizzleProcurementDataPort } from '../../composition/procurement/drizzle-data-port';
import { postBudgetEncumbrance } from '../../composition/ledger/post-sale-proceeds';

const moduleLogger = createLogger('mining-procurement-coordination');

function unavailable(c: { json: (b: unknown, s: number) => Response }): Response {
  return c.json(
    { success: false as const, error: { code: 'PROCUREMENT_DB_UNAVAILABLE' } },
    503,
  );
}

/** Build a procurement-coordination platform on the request's RLS client. */
function buildPlatform(db: unknown) {
  const dataPort = createDrizzleProcurementDataPort(db);
  return { platform: createProcurementCoordination({ dataPort }), dataPort };
}

// ── Input schemas (tenantId injected server-side, NOT taken from client) ─────

const RegisterVendorBodySchema = z.object({
  country: z.string().length(2),
  companyName: z.string().min(1).max(200),
  registrationNumber: z.string().min(1).max(80),
  taxId: z.string().min(1).max(80),
  categories: z.array(z.string()).min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().nullable().optional(),
});

const RequisitionItemBodySchema = z.object({
  sku: z.string().nullable().default(null),
  description: z.string().min(1),
  qty: z.number().positive(),
  unit: z.string().min(1),
  estimatedUnitPrice: z.number().nonnegative(),
  currency: z.string().min(1),
  subtotal: z.number().nonnegative(),
});

const CreateRequisitionBodySchema = z.object({
  requestedBy: z.string().min(1),
  department: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  items: z.array(RequisitionItemBodySchema).min(1),
  justification: z.string().min(10).max(2000),
  urgency: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
  budgetId: z.string().nullable().optional(),
  category: z.string().optional(),
});

/**
 * Accounting / ownership write tier. Creating a requisition RESERVES budget by
 * posting a balanced DR procurement_reserve / CR budget_available journal
 * through the REAL ledger (`postBudgetEncumbrance` → `LedgerService.post()`), so
 * it moves money against a budget. It is therefore restricted to the SAME
 * accounting/ownership tier the sibling money surfaces gate on
 * (cooperatives/settlements.hono.ts SETTLEMENT_WRITE_ROLES,
 * mining/bids.hono.ts SELLER_WRITE_ROLES, royalty/sales WRITE_ROLES). Without
 * this, ANY authenticated tenant member (a field worker, a self-registered
 * buyer mapped into the tenant) could create a requisition and encumber budget
 * on the ledger. Reads (vendors / budgets / analytics) stay open to members;
 * only the ledger-encumbering requisition create gates.
 */
const PROCUREMENT_WRITE_ROLES = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.SUPER_ADMIN,
] as const;

export const miningProcurementCoordinationRouter = new Hono();
miningProcurementCoordinationRouter.use('*', authMiddleware);
miningProcurementCoordinationRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /vendors — vendor registry.
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.get('/vendors', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const { dataPort } = buildPlatform(db);
    const vendors = await dataPort.listVendors(auth.tenantId);
    return c.json(
      { success: true as const, data: { vendors, count: vendors.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'procurement_vendors_failed');
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_VENDORS_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /vendors — register a vendor.
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.post('/vendors', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      400,
    );
  }
  const parsed = RegisterVendorBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    );
  }
  try {
    const { platform } = buildPlatform(db);
    const vendor = await platform.vendors.registerVendor({
      tenantId: auth.tenantId,
      country: parsed.data.country,
      companyName: parsed.data.companyName,
      registrationNumber: parsed.data.registrationNumber,
      taxId: parsed.data.taxId,
      categories: parsed.data.categories,
      contactEmail: parsed.data.contactEmail,
      ...(parsed.data.contactPhone !== undefined
        ? { contactPhone: parsed.data.contactPhone }
        : {}),
    });
    return c.json({ success: true as const, data: vendor }, 201);
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'procurement_register_vendor_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_REGISTER_VENDOR_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /budgets — budgets with availability roll-up.
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.get('/budgets', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const { platform } = buildPlatform(db);
    const budgets = await platform.budgets.listBudgets({ tenantId: auth.tenantId });
    const withAvailability = budgets.map((budget) => computeAvailability(budget));
    return c.json(
      {
        success: true as const,
        data: { budgets: withAvailability, count: withAvailability.length },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'procurement_budgets_failed');
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_BUDGETS_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/spend-by-vendor — REAL spend aggregation.
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.get('/analytics/spend-by-vendor', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const { platform } = buildPlatform(db);
    const rows = await platform.analytics.spendByVendor({ tenantId: auth.tenantId });
    return c.json(
      { success: true as const, data: { vendors: rows, count: rows.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'procurement_spend_by_vendor_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_SPEND_BY_VENDOR_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/spend-by-category — REAL spend aggregation by category.
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.get('/analytics/spend-by-category', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const { platform } = buildPlatform(db);
    const rows = await platform.analytics.spendByCategory({ tenantId: auth.tenantId });
    return c.json(
      { success: true as const, data: { categories: rows, count: rows.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'procurement_spend_by_category_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_SPEND_BY_CATEGORY_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/maverick-spend — POs that bypassed framework / RFQ.
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.get('/analytics/maverick-spend', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  try {
    const { platform } = buildPlatform(db);
    const items = await platform.analytics.detectMaverickSpend({
      tenantId: auth.tenantId,
    });
    return c.json(
      { success: true as const, data: { items, count: items.length } },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'procurement_maverick_spend_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_MAVERICK_SPEND_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /requisitions — create a requisition (reserves budget + approval chain).
// ---------------------------------------------------------------------------
miningProcurementCoordinationRouter.post(
  '/requisitions',
  requireRole(...PROCUREMENT_WRITE_ROLES),
  async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) return unavailable(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      400,
    );
  }
  const parsed = CreateRequisitionBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false as const, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    );
  }
  const tenantId = auth.tenantId;
  try {
    // Atomic money path (CLAUDE.md): create the requisition AND post its budget
    // encumbrance through the REAL ledger inside ONE db.transaction so the
    // requisition row and the balanced DR procurement_reserve / CR
    // budget_available journal commit-or-roll-back together. A failed ledger
    // post no longer leaves an un-encumbered requisition (and a failed
    // requisition write never posts a stray journal). The platform is built on
    // the tx-bound client so every data-port write also runs inside the tx.
    const { requisition, encumbrance } = await (
      db as {
        transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
      }
    ).transaction(async (tx) => {
      const { platform } = buildPlatform(tx);
      const req = await platform.requisitions.createRequisition({
        tenantId,
        requestedBy: parsed.data.requestedBy,
        ...(parsed.data.department !== undefined ? { department: parsed.data.department } : {}),
        ...(parsed.data.propertyId !== undefined ? { propertyId: parsed.data.propertyId } : {}),
        items: parsed.data.items,
        justification: parsed.data.justification,
        urgency: parsed.data.urgency,
        ...(parsed.data.budgetId !== undefined ? { budgetId: parsed.data.budgetId } : {}),
        ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      });

      const enc = await encumberRequisitionBudget(
        tx,
        tenantId,
        req as { id?: string; estimatedTotal?: number; currency?: string },
      );
      return { requisition: req, encumbrance: enc };
    });

    return c.json(
      {
        success: true as const,
        data: requisition,
        meta: encumbrance,
      },
      201,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'procurement_create_requisition_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'PROCUREMENT_CREATE_REQUISITION_FAILED' } },
      500,
    );
  }
});

/**
 * Post a single budget encumbrance through the ledger for a created
 * requisition, using the requisition's package-computed `estimatedTotal` +
 * `currency` (single-currency by construction). Runs on the SAME tx as the
 * requisition write (caller wraps both in one db.transaction), so:
 *   - the NON-committable skip cases (no id / no valid currency / non-positive
 *     amount) are NOT failures — they return a structured `budgetEncumbered:
 *     false` meta and the requisition still commits with no journal; while
 *   - a genuine LEDGER-POST failure THROWS, rolling back the whole tx (the
 *     requisition AND any partial journal), so a created requisition is never
 *     left silently un-encumbered. The fault is logged before it propagates.
 */
async function encumberRequisitionBudget(
  db: unknown,
  tenantId: string,
  requisition: { id?: string; estimatedTotal?: number; currency?: string },
): Promise<{ budgetEncumbered: boolean; reason?: string; journalId?: string }> {
  const requisitionId = requisition?.id;
  if (!requisitionId) {
    return { budgetEncumbered: false, reason: 'requisition has no id' };
  }
  const currency = (requisition.currency || '').toUpperCase();
  const amountMajor = Number(requisition.estimatedTotal ?? 0);
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { budgetEncumbered: false, reason: 'requisition has no valid currency' };
  }
  if (!(amountMajor > 0)) {
    return { budgetEncumbered: false, reason: 'non-positive committed amount' };
  }
  try {
    const post = await postBudgetEncumbrance({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      tenantId,
      requisitionId,
      amountMajor,
      currency,
    });
    return { budgetEncumbered: true, journalId: post.journalId };
  } catch (err) {
    // Inside the outer tx: a ledger failure must roll back the requisition too,
    // so re-throw (after logging) instead of swallowing it into a "deferred"
    // half-state. The route's catch maps it to the honest 500 envelope.
    moduleLogger.error(
      { err, tenantId, requisitionId },
      'procurement_budget_encumbrance_failed',
    );
    throw err;
  }
}

export default miningProcurementCoordinationRouter;

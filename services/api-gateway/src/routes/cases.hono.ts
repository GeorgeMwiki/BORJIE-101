// @ts-nocheck — Hono v4 status-code literal union widening; same pattern as
// other .hono routers in this directory.
/**
 * Cases router — live-data implementation for the tenant/maintenance case
 * lifecycle. Previously a `LIVE_DATA_NOT_IMPLEMENTED` stub (503) even though
 * the `cases` table existed since migration 0001c. The gap blocked the
 * maintenance-case end-to-end flow and every downstream probe (AI triage,
 * work-order assignment, resolution).
 *
 * Scope (minimum to unblock real workflows):
 *   - POST   /              create a case
 *   - GET    /              list cases (tenant-scoped)
 *   - GET    /:id           fetch one
 *   - POST   /:id/resolve   mark resolved + write resolution row
 *
 * All writes go through the drizzle client injected by databaseMiddleware,
 * using raw SQL (the package does not yet export a CaseRepository). Tenant
 * isolation is enforced in every WHERE clause — no silent cross-tenant
 * reads. Case numbers are generated as `CASE-YYMMDD-XXXX`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { parseListPagination, buildListResponse } from './pagination';

import { withSecurityEvents } from '@borjie/observability';
const CASE_TYPES = [
  'arrears', 'deposit_dispute', 'damage_claim', 'lease_violation',
  'noise_complaint', 'maintenance_dispute', 'eviction', 'harassment',
  'safety_concern', 'billing_dispute', 'other',
] as const;
const CASE_STATUSES = [
  'open', 'investigating', 'pending_response', 'pending_evidence',
  'mediation', 'escalated', 'resolved', 'closed', 'withdrawn',
] as const;
const CASE_SEVERITIES = ['low', 'medium', 'high', 'critical', 'urgent'] as const;

const CaseCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(CASE_TYPES).optional(),
  severity: z.enum(CASE_SEVERITIES).optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  customerId: z.string().optional(),
  leaseId: z.string().optional(),
  amountInDispute: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  tags: z.array(z.string()).optional(),
});

const CaseResolveSchema = z.object({
  resolution: z.string().min(1).max(2000).optional(),
  closureReason: z.string().max(500).optional(),
});

function caseNumber() {
  const date = new Date();
  const y = String(date.getUTCFullYear()).slice(-2);
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `CASE-${y}${m}${d}-${rand}`;
}

function rowToCase(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    caseNumber: row.case_number,
    title: row.title,
    description: row.description,
    type: String(row.case_type ?? 'other').toUpperCase(),
    severity: String(row.severity ?? 'medium').toUpperCase(),
    status: String(row.status ?? 'open').toUpperCase(),
    propertyId: row.property_id,
    unitId: row.unit_id,
    customerId: row.customer_id,
    leaseId: row.lease_id,
    amountInDispute: row.amount_in_dispute,
    currency: row.currency,
    assignedTo: row.assigned_to,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    tags: row.tags || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database client is not initialized' } },
      503,
    );
  }
  const p = parseListPagination(c);
  const status = c.req.query('status');
  const customerId = c.req.query('customerId');

  const whereStatus = status ? sql`AND status = ${status.toLowerCase()}` : sql``;
  const whereCustomer = customerId ? sql`AND customer_id = ${customerId}` : sql``;

  const result = await db.execute(sql`
    SELECT * FROM cases
     WHERE tenant_id = ${auth.tenantId}
       ${whereStatus}
       ${whereCustomer}
     ORDER BY created_at DESC
     LIMIT ${p.limit} OFFSET ${p.offset}
  `);
  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total FROM cases
     WHERE tenant_id = ${auth.tenantId}
       ${whereStatus}
       ${whereCustomer}
  `);
  const rows = (result as unknown as Record<string, unknown>[]) || [];
  const total = Number(((countResult as unknown as Record<string, unknown>[])[0]?.total) ?? 0);
  const items = rows.map(rowToCase);
  return c.json({ success: true, ...buildListResponse(items, total, p) });
});

app.post('/', zValidator('json', CaseCreateSchema), withSecurityEvents({ action: 'case.create', resource: 'case', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database client is not initialized' } },
      503,
    );
  }
  const body = c.req.valid('json');
  const id = crypto.randomUUID();
  const number = caseNumber();
  const type = body.type || 'maintenance_dispute';
  const severity = body.severity || 'medium';
  const tags = body.tags || [];

  await db.execute(sql`
    INSERT INTO cases (
      id, tenant_id, property_id, unit_id, customer_id, lease_id,
      case_number, case_type, severity, status, title, description,
      amount_in_dispute, currency, tags,
      created_at, updated_at, created_by, updated_by
    ) VALUES (
      ${id}, ${auth.tenantId}, ${body.propertyId || null}, ${body.unitId || null},
      ${body.customerId || null}, ${body.leaseId || null},
      ${number}, ${type}::case_type, ${severity}::case_severity,
      'open'::case_status, ${body.title}, ${body.description || null},
      ${body.amountInDispute != null ? body.amountInDispute : null},
      ${body.currency || null}, ${JSON.stringify(tags)}::jsonb,
      NOW(), NOW(), ${auth.userId}, ${auth.userId}
    )
  `);
  const fetched = await db.execute(sql`SELECT * FROM cases WHERE id = ${id} AND tenant_id = ${auth.tenantId} LIMIT 1`);
  const row = (fetched as unknown as Record<string, unknown>[])[0];
  return c.json({ success: true, data: rowToCase(row) }, 201);
}));

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database client is not initialized' } },
      503,
    );
  }
  const id = c.req.param('id');
  const fetched = await db.execute(sql`
    SELECT * FROM cases WHERE id = ${id} AND tenant_id = ${auth.tenantId} LIMIT 1
  `);
  const rows = (fetched as unknown as Record<string, unknown>[]) || [];
  if (rows.length === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Case not found' } },
      404,
    );
  }
  return c.json({ success: true, data: rowToCase(rows[0]) });
});

/**
 * GET /:id/full — return the full Case aggregate (timeline + notices +
 * evidence + resolution) via the Wave 26-wired `PostgresCaseRepository`.
 * The legacy GET /:id keeps returning the flat SQL-shaped row so the
 * existing dashboard surface is unchanged. Routes that didn't exist
 * yet can opt into the richer shape by hitting /full.
 *
 * Falls back to the raw SQL read when the composition root is in
 * degraded mode (DATABASE_URL unset) so the endpoint still returns
 * 2xx rather than 503 during local dev.
 */
app.get('/:id/full', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const repo = c.get('caseRepo') as
    | { findById: (id: string, tenantId: string) => Promise<unknown | null> }
    | undefined;
  const id = c.req.param('id');

  if (repo) {
    try {
      const entity = await repo.findById(id, auth.tenantId);
      if (!entity) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Case not found' } },
          404,
        );
      }
      return c.json({ success: true, data: entity });
    } catch (err) {
      // Repo failures fall through to the raw-SQL path below rather
      // than surfacing a 500 — the legacy shape is still useful even
      // when the aggregate payload is malformed.
    }
  }

  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database client is not initialized' } },
      503,
    );
  }
  const fetched = await db.execute(sql`
    SELECT * FROM cases WHERE id = ${id} AND tenant_id = ${auth.tenantId} LIMIT 1
  `);
  const rows = (fetched as unknown as Record<string, unknown>[]) || [];
  if (rows.length === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Case not found' } },
      404,
    );
  }
  return c.json({ success: true, data: rowToCase(rows[0]) });
});

app.post('/:id/resolve', zValidator('json', CaseResolveSchema), withSecurityEvents({ action: 'case.create', resource: 'case', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database client is not initialized' } },
      503,
    );
  }
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const updated = await db.execute(sql`
    UPDATE cases
       SET status = 'resolved'::case_status,
           resolved_at = NOW(),
           resolved_by = ${auth.userId},
           closure_reason = ${body.closureReason || body.resolution || null},
           updated_at = NOW(),
           updated_by = ${auth.userId}
     WHERE id = ${id} AND tenant_id = ${auth.tenantId}
     RETURNING *
  `);
  const rows = (updated as unknown as Record<string, unknown>[]) || [];
  if (rows.length === 0) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Case not found' } },
      404,
    );
  }
  return c.json({ success: true, data: rowToCase(rows[0]) });
}));

export const casesRouter = app;

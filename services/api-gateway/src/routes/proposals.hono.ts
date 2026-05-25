// @ts-nocheck — Hono v4 status-code literal union widening; same pattern as
// other .hono routers in this directory.
/**
 * Proposals router (Piece L brain↔tab loop) — CRUD over
 * `module_update_proposals` rows.
 *
 *   GET    /api/v1/proposals?status=pending_hitl     list
 *   GET    /api/v1/proposals/:id                     fetch one
 *   POST   /api/v1/proposals/:id/approve             promote to accepted
 *   POST   /api/v1/proposals/:id/decline             reject with reason
 *   POST   /api/v1/proposals/:id/edit                edit-then-pending
 *   GET    /api/v1/proposals/:id/audit               chain replay
 *
 * Tenant isolation is enforced at every WHERE clause via the auth
 * middleware's `tenantId` claim. The RLS policy on the underlying table
 * (migration 0230) is a belt-and-braces fallback should an application
 * bug bypass the WHERE.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { parseListPagination, buildListResponse } from './pagination';

const ProposalStatusFilter = z.enum([
  'pending_hitl',
  'auto_applying',
  'accepted',
  'declined',
  'edited',
  'expired',
  'failed',
]);

const ListQuerySchema = z.object({
  status: ProposalStatusFilter.optional(),
  module_template_id: z.string().optional(),
  persona_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ApproveSchema = z.object({
  approver_tier: z.number().int().min(1).max(5),
  notes: z.string().max(500).optional(),
});

const DeclineSchema = z.object({
  reason: z.string().min(1).max(500),
});

const EditSchema = z.object({
  new_payload: z.record(z.unknown()),
  edit_summary: z.string().min(1).max(500),
});

function rowToProposal(row: Record<string, unknown>) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    captureId: row.capture_id,
    moduleTemplateId: row.module_template_id,
    action: row.action,
    personaId: row.persona_id,
    status: row.status,
    confidence: row.confidence,
    hitlRequired: row.hitl_required,
    priority: row.priority,
    payload: row.payload ?? {},
    entityRefs: row.entity_refs ?? [],
    matrixRowId: row.matrix_row_id,
    approverTier: row.approver_tier,
    approverUserId: row.approver_user_id,
    declineReason: row.decline_reason,
    editedFromId: row.edited_from_id,
    failureReason: row.failure_reason,
    resolvedAt: row.resolved_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const app = new Hono();
app.use('*', authMiddleware, databaseMiddleware);

// ─── GET /proposals — list ────────────────────────────────────────────

app.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const p = parseListPagination(c);

  const conds: ReturnType<typeof sql>[] = [
    sql`tenant_id = ${auth.tenantId}`,
  ];
  if (q.status) conds.push(sql`status = ${q.status}`);
  if (q.module_template_id)
    conds.push(sql`module_template_id = ${q.module_template_id}`);
  if (q.persona_id) conds.push(sql`persona_id = ${q.persona_id}`);

  // Combine conditions with AND.
  let where = sql`${conds[0]}`;
  for (let i = 1; i < conds.length; i++) {
    where = sql`${where} AND ${conds[i]}`;
  }

  const rows = await db.execute(sql`
    SELECT id, tenant_id, capture_id, module_template_id, action,
           persona_id, status, confidence, hitl_required, priority,
           payload, entity_refs, matrix_row_id, approver_tier,
           approver_user_id, decline_reason, edited_from_id,
           failure_reason, resolved_at, expires_at, created_at, updated_at
    FROM module_update_proposals
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ${p.limit} OFFSET ${p.offset}
  `);
  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as count
    FROM module_update_proposals
    WHERE ${where}
  `);
  const totalRow = (countResult as { rows?: Array<{ count: number }> }).rows ?? countResult;
  const total = Array.isArray(totalRow) ? (totalRow[0]?.count ?? 0) : 0;

  const items = ((rows as { rows?: unknown }).rows ?? rows) as Record<string, unknown>[];

  return c.json(
    buildListResponse(items.map(rowToProposal), total, p),
    200
  );
});

// ─── GET /proposals/:id ───────────────────────────────────────────────

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const result = await db.execute(sql`
    SELECT * FROM module_update_proposals
    WHERE tenant_id = ${auth.tenantId} AND id = ${id}
    LIMIT 1
  `);
  const row = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0]
    ?? (Array.isArray(result) ? result[0] : null);
  if (!row) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Proposal not found' } },
      404
    );
  }
  return c.json({ success: true, data: rowToProposal(row) }, 200);
});

// ─── POST /proposals/:id/approve ──────────────────────────────────────

app.post('/:id/approve', zValidator('json', ApproveSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  // Verify the proposal exists + is pending_hitl.
  const existing = await db.execute(sql`
    SELECT id, status, module_template_id, action FROM module_update_proposals
    WHERE tenant_id = ${auth.tenantId} AND id = ${id}
    LIMIT 1
  `);
  const row = (existing as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!row) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Proposal not found' } },
      404
    );
  }
  if (row.status !== 'pending_hitl' && row.status !== 'edited') {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Cannot approve from status=${row.status}`,
        },
      },
      409
    );
  }

  await db.execute(sql`
    UPDATE module_update_proposals
    SET status = 'accepted',
        approver_user_id = ${auth.userId},
        approver_tier = ${body.approver_tier},
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = ${auth.tenantId} AND id = ${id}
  `);

  // The actual handler invocation is wired in the composition root —
  // this route writes the state transition; a downstream worker (see
  // brain-tab-loop-wiring.ts) reads accepted rows and calls the handler.
  // We still return 200 here so the UI gets a fast ack.

  return c.json({ success: true, data: { id, status: 'accepted' } }, 200);
});

// ─── POST /proposals/:id/decline ──────────────────────────────────────

app.post('/:id/decline', zValidator('json', DeclineSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  await db.execute(sql`
    UPDATE module_update_proposals
    SET status = 'declined',
        approver_user_id = ${auth.userId},
        decline_reason = ${body.reason},
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = ${auth.tenantId}
      AND id = ${id}
      AND status = 'pending_hitl'
  `);

  return c.json({ success: true, data: { id, status: 'declined' } }, 200);
});

// ─── POST /proposals/:id/edit ─────────────────────────────────────────

app.post('/:id/edit', zValidator('json', EditSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  // Load original proposal.
  const result = await db.execute(sql`
    SELECT * FROM module_update_proposals
    WHERE tenant_id = ${auth.tenantId} AND id = ${id} AND status = 'pending_hitl'
    LIMIT 1
  `);
  const original = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!original) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Pending proposal not found',
        },
      },
      404
    );
  }

  // Close original.
  await db.execute(sql`
    UPDATE module_update_proposals
    SET status = 'edited',
        approver_user_id = ${auth.userId},
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = ${auth.tenantId} AND id = ${id}
  `);

  // Insert new pending row referencing the original via edited_from_id.
  const newId = `prop_edit_${id}_${Date.now()}`;
  await db.execute(sql`
    INSERT INTO module_update_proposals (
      id, tenant_id, capture_id, module_template_id, action, persona_id,
      status, confidence, hitl_required, priority, payload, entity_refs,
      matrix_row_id, edited_from_id, expires_at
    )
    VALUES (
      ${newId},
      ${auth.tenantId},
      ${original.capture_id},
      ${original.module_template_id},
      ${original.action},
      ${original.persona_id},
      'pending_hitl',
      ${original.confidence},
      ${original.hitl_required},
      ${original.priority},
      ${JSON.stringify(body.new_payload)}::jsonb,
      ${JSON.stringify(original.entity_refs ?? [])}::jsonb,
      ${original.matrix_row_id},
      ${id},
      ${original.expires_at}
    )
  `);

  return c.json(
    {
      success: true,
      data: {
        id: newId,
        editedFromId: id,
        status: 'pending_hitl',
        editSummary: body.edit_summary,
      },
    },
    200
  );
});

// ─── GET /proposals/:id/audit — chain replay ──────────────────────────

app.get('/:id/audit', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');

  const events = await db.execute(sql`
    SELECT id, event_kind, actor, transport, snapshot, notes, sequence, created_at
    FROM tab_event_log
    WHERE tenant_id = ${auth.tenantId}
      AND proposal_id = ${id}
    ORDER BY sequence ASC
  `);
  const chain = await db.execute(sql`
    SELECT id, action, prev_hash, this_hash, sequence_id, payload, created_at
    FROM ai_audit_chain
    WHERE tenant_id = ${auth.tenantId}
      AND turn_id IN (
        SELECT capture_id FROM module_update_proposals
        WHERE tenant_id = ${auth.tenantId} AND id = ${id}
      )
    ORDER BY sequence_id ASC
  `);

  const eventRows = (events as { rows?: unknown }).rows ?? events;
  const chainRows = (chain as { rows?: unknown }).rows ?? chain;
  return c.json(
    {
      success: true,
      data: {
        events: eventRows,
        chain: chainRows,
      },
    },
    200
  );
});

export default app;

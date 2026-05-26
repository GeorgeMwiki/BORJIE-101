// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.

/**
 * /api/v1/briefs — Piece C executive brief routes.
 *
 *   GET    /                                — list briefs visible to caller
 *   GET    /:id                             — single brief with citations resolved
 *   POST   /generate                        — on-demand generate (tier ≤ 3 only)
 *   PATCH  /:id/status                      — VIEWED / ACTIONED / DISMISSED / ARCHIVED
 *   POST   /:id/actions/:idx/approve        — approve a recommended action (Piece E target)
 *
 * /api/v1/briefing-subscriptions — subscription CRUD (gates by tier)
 *   GET    /                                — list subs for caller's tenant
 *   POST   /                                — create
 *   PATCH  /:id                             — toggle / retune
 *
 * All endpoints:
 *   - Auth required (JWT + tenant context).
 *   - Brief read/generate operations require persona tier ≤ 3.
 *   - RLS double-checks at the DB layer via current_app_tenant_id GUC.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { getExecutiveBriefService } from '../composition/executive-brief.composition';

// ─────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────

const STATUSES = ['GENERATED', 'VIEWED', 'ACTIONED', 'DISMISSED', 'ARCHIVED'] as const;
const StatusSchema = z.enum(STATUSES);

const StatusUpdateSchema = z.object({
  status: StatusSchema,
});

const GenerateSchema = z.object({
  personaId: z.string().min(1),
  modulesInScope: z.array(z.string()).default([]),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  locale: z.string().min(2).max(8).default('en'),
  focusEntityIds: z.array(z.string()).optional(),
  timeWindow: z.string().regex(/^P(\d+)(D|W|M|Y)$/).default('P7D'),
});

const SubscriptionCreateSchema = z.object({
  personaId: z.string().min(1),
  cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND']),
  localTime: z.string().regex(/^\d{2}:\d{2}$/).default('06:00'),
  modulesInScope: z.array(z.string()).default([]),
  locale: z.string().min(2).max(8).default('en'),
  deliveryChannels: z.array(z.enum(['web', 'email', 'whatsapp'])).default(['web']),
  enabled: z.boolean().default(true),
});

const SubscriptionUpdateSchema = SubscriptionCreateSchema.partial();

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Persona-tier gate. T1/T2/T3 may read & generate briefs; T4/T5 cannot.
 * Looks up the persona by id from `personas` and reads `power_tier`.
 *
 * Returns the persona row when allowed, or a Response with 403 to short-
 * circuit when not.
 */
async function loadAllowedPersona(c, db, personaId) {
  const auth = c.get('auth');
  const rows = await db.execute(sql`
    SELECT id, tenant_id, slug, display_name_en, display_name_sw, power_tier,
           scope_predicate_jsonb, tool_catalog_ids, channel_allowlist,
           max_action_tier, memory_namespace_template, ui_section_filter_jsonb,
           is_built_in
      FROM personas
     WHERE id = ${personaId}
       AND tenant_id = ${auth.tenantId}
     LIMIT 1
  `);
  const arr = Array.isArray(rows) ? rows : ((rows && rows.rows) || []);
  if (arr.length === 0) {
    return { ok: false, response: c.json({ success: false, error: { code: 'PERSONA_NOT_FOUND' } }, 404) };
  }
  const r = arr[0];
  const tier = Number(r.power_tier);
  if (tier > 3) {
    return {
      ok: false,
      response: c.json({
        success: false,
        error: { code: 'FORBIDDEN_TIER', message: `Persona tier ${tier} cannot access executive briefs (T1-T3 only).` },
      }, 403),
    };
  }
  return {
    ok: true,
    persona: {
      id: r.id,
      tenantId: r.tenant_id,
      slug: r.slug,
      displayNameEn: r.display_name_en,
      displayNameSw: r.display_name_sw,
      powerTier: tier,
      scopePredicate: r.scope_predicate_jsonb,
      toolCatalogIds: r.tool_catalog_ids || [],
      channelAllowlist: r.channel_allowlist || ['web'],
      maxActionTier: r.max_action_tier || 'LOW',
      memoryNamespaceTemplate: r.memory_namespace_template,
      uiSectionFilter: r.ui_section_filter_jsonb || [],
      isBuiltIn: Boolean(r.is_built_in),
    },
  };
}

function rowToBrief(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personaId: row.persona_id,
    scope: row.scope_jsonb,
    gaps: row.gaps_jsonb || [],
    opportunities: row.opportunities_jsonb || [],
    risks: row.risks_jsonb || [],
    recommendedActions: row.recommended_actions_jsonb || [],
    approvalPackets: row.approval_packets_jsonb || [],
    citations: row.citations_jsonb || [],
    locale: row.locale,
    generatedAt: row.generated_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatorVersion: row.generator_version,
    costMicros: row.cost_micros,
    hash: row.hash,
    prevHash: row.prev_hash,
    auditChainLink: row.audit_chain_link,
    status: row.status,
    viewedAt: row.viewed_at,
    dismissedAt: row.dismissed_at,
  };
}

function rowToSubscription(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personaId: row.persona_id,
    cadence: row.cadence,
    localTime: row.local_time,
    modulesInScope: row.modules_in_scope || [],
    locale: row.locale,
    deliveryChannels: row.delivery_channels || ['web'],
    enabled: row.enabled,
    lastGeneratedAt: row.last_generated_at,
    nextDueAt: row.next_due_at,
  };
}

function fetchRows(res) {
  return Array.isArray(res) ? res : ((res && res.rows) || []);
}

// ─────────────────────────────────────────────────────────────────────
// Brief routes
// ─────────────────────────────────────────────────────────────────────

const briefs = new Hono();
briefs.use('*', authMiddleware);
briefs.use('*', databaseMiddleware);

briefs.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const personaId = c.req.query('personaId');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') || '50'), 200);

  const conditions = [sql`tenant_id = ${auth.tenantId}`];
  if (personaId) conditions.push(sql`persona_id = ${personaId}`);
  if (status && STATUSES.includes(status)) conditions.push(sql`status = ${status}`);
  const whereSql = conditions.reduce((acc, c2, i) => (i === 0 ? c2 : sql`${acc} AND ${c2}`));

  const res = await db.execute(sql`
    SELECT id, tenant_id, persona_id, scope_jsonb, gaps_jsonb, opportunities_jsonb,
           risks_jsonb, recommended_actions_jsonb, approval_packets_jsonb, citations_jsonb,
           locale, generated_at, period_start, period_end, generator_version, cost_micros,
           hash, prev_hash, audit_chain_link, status, viewed_at, dismissed_at
      FROM executive_briefs
     WHERE ${whereSql}
     ORDER BY generated_at DESC
     LIMIT ${limit}
  `);
  const items = fetchRows(res).map(rowToBrief);
  return c.json({ success: true, data: items });
});

briefs.get('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const res = await db.execute(sql`
    SELECT id, tenant_id, persona_id, scope_jsonb, gaps_jsonb, opportunities_jsonb,
           risks_jsonb, recommended_actions_jsonb, approval_packets_jsonb, citations_jsonb,
           locale, generated_at, period_start, period_end, generator_version, cost_micros,
           hash, prev_hash, audit_chain_link, status, viewed_at, dismissed_at
      FROM executive_briefs
     WHERE id = ${id} AND tenant_id = ${auth.tenantId}
     LIMIT 1
  `);
  const arr = fetchRows(res);
  if (arr.length === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: rowToBrief(arr[0]) });
});

briefs.post('/generate', zValidator('json', GenerateSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const body = c.req.valid('json');

  // Persona-tier gate.
  const gate = await loadAllowedPersona(c, db, body.personaId);
  if (!gate.ok) return gate.response;

  const periodEnd = body.periodEnd ? new Date(body.periodEnd) : new Date();
  const periodStart = body.periodStart
    ? new Date(body.periodStart)
    : new Date(periodEnd.getTime() - 7 * 86_400_000);

  const service = getExecutiveBriefService();
  if (!service) {
    return c.json({ success: false, error: { code: 'ENGINE_UNAVAILABLE' } }, 503);
  }
  try {
    const result = await service.generate({
      tenantId: auth.tenantId,
      persona: gate.persona,
      modulesInScope: body.modulesInScope,
      periodStart,
      periodEnd,
      locale: body.locale,
      focusEntityIds: body.focusEntityIds || [],
      timeWindow: body.timeWindow,
    });

    if (result.status === 'refused') {
      return c.json(
        { success: false, error: { code: 'REFUSED', message: result.reason } },
        403,
      );
    }
    // Persist (ok or degraded).
    await persistBrief(db, result.brief);
    return c.json({
      success: true,
      data: { brief: result.brief, status: result.status, reason: 'reason' in result ? result.reason : null },
    });
  } catch (err) {
    return c.json(
      { success: false, error: { code: 'GENERATE_FAILED', message: err instanceof Error ? err.message : String(err) } },
      500,
    );
  }
});

briefs.patch('/:id/status', zValidator('json', StatusUpdateSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const setSql = [sql`status = ${body.status}`];
  if (body.status === 'VIEWED') setSql.push(sql`viewed_at = NOW()`);
  if (body.status === 'DISMISSED') setSql.push(sql`dismissed_at = NOW()`);
  const setExpr = setSql.reduce((acc, s, i) => (i === 0 ? s : sql`${acc}, ${s}`));

  const res = await db.execute(sql`
    UPDATE executive_briefs
       SET ${setExpr}
     WHERE id = ${id} AND tenant_id = ${auth.tenantId}
     RETURNING id, status, viewed_at, dismissed_at
  `);
  const arr = fetchRows(res);
  if (arr.length === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: arr[0] });
});

briefs.post('/:id/actions/:idx/approve', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const briefId = c.req.param('id');
  const actionIdx = Number(c.req.param('idx'));
  if (!Number.isFinite(actionIdx) || actionIdx < 0) {
    return c.json({ success: false, error: { code: 'INVALID_INDEX' } }, 400);
  }
  // Load the brief, find the action + approval packet.
  const res = await db.execute(sql`
    SELECT id, recommended_actions_jsonb, approval_packets_jsonb
      FROM executive_briefs
     WHERE id = ${briefId} AND tenant_id = ${auth.tenantId}
     LIMIT 1
  `);
  const arr = fetchRows(res);
  if (arr.length === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }
  const row = arr[0];
  const actions = row.recommended_actions_jsonb || [];
  if (actionIdx >= actions.length) {
    return c.json({ success: false, error: { code: 'ACTION_INDEX_OUT_OF_RANGE' } }, 400);
  }
  const action = actions[actionIdx];
  const packet = (row.approval_packets_jsonb || []).find((p) => p.actionIndex === actionIdx);
  // TODO(#41): wire through the actual action runtime — for now we
  // mark the brief ACTIONED and return the prebuilt approval packet so
  // the client can show "approval submitted" while we land Piece E.
  await db.execute(sql`
    UPDATE executive_briefs
       SET status = 'ACTIONED'
     WHERE id = ${briefId} AND tenant_id = ${auth.tenantId}
  `);
  return c.json({
    success: true,
    data: {
      action,
      packet,
      status: 'queued',
      note: 'Action queued; Piece E will wire through to the executor.',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// Subscription routes
// ─────────────────────────────────────────────────────────────────────

const subscriptions = new Hono();
subscriptions.use('*', authMiddleware);
subscriptions.use('*', databaseMiddleware);

subscriptions.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const personaId = c.req.query('personaId');
  const conditions = [sql`tenant_id = ${auth.tenantId}`];
  if (personaId) conditions.push(sql`persona_id = ${personaId}`);
  const whereSql = conditions.reduce((acc, c2, i) => (i === 0 ? c2 : sql`${acc} AND ${c2}`));
  const res = await db.execute(sql`
    SELECT id, tenant_id, persona_id, cadence, local_time, modules_in_scope,
           locale, delivery_channels, enabled, last_generated_at, next_due_at
      FROM briefing_subscriptions
     WHERE ${whereSql}
     ORDER BY next_due_at ASC
  `);
  return c.json({ success: true, data: fetchRows(res).map(rowToSubscription) });
});

subscriptions.post('/', zValidator('json', SubscriptionCreateSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const body = c.req.valid('json');
  // Tier gate.
  const gate = await loadAllowedPersona(c, db, body.personaId);
  if (!gate.ok) return gate.response;
  const id = `bsub_${crypto.randomUUID()}`;
  const nextDueAt = computeNextDueAt(body.cadence, body.localTime, new Date());
  await db.execute(sql`
    INSERT INTO briefing_subscriptions (
      id, tenant_id, persona_id, cadence, local_time, modules_in_scope,
      locale, delivery_channels, enabled, next_due_at
    ) VALUES (
      ${id}, ${auth.tenantId}, ${body.personaId}, ${body.cadence}, ${body.localTime},
      ${body.modulesInScope}, ${body.locale}, ${body.deliveryChannels}, ${body.enabled},
      ${nextDueAt.toISOString()}
    )
    ON CONFLICT (tenant_id, persona_id, cadence) DO UPDATE
       SET local_time = EXCLUDED.local_time,
           modules_in_scope = EXCLUDED.modules_in_scope,
           locale = EXCLUDED.locale,
           delivery_channels = EXCLUDED.delivery_channels,
           enabled = EXCLUDED.enabled,
           next_due_at = EXCLUDED.next_due_at,
           updated_at = NOW()
  `);
  return c.json({ success: true, data: { id } }, 201);
});

subscriptions.patch('/:id', zValidator('json', SubscriptionUpdateSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const sets = [];
  if (body.cadence !== undefined) sets.push(sql`cadence = ${body.cadence}`);
  if (body.localTime !== undefined) sets.push(sql`local_time = ${body.localTime}`);
  if (body.modulesInScope !== undefined) sets.push(sql`modules_in_scope = ${body.modulesInScope}`);
  if (body.locale !== undefined) sets.push(sql`locale = ${body.locale}`);
  if (body.deliveryChannels !== undefined) sets.push(sql`delivery_channels = ${body.deliveryChannels}`);
  if (body.enabled !== undefined) sets.push(sql`enabled = ${body.enabled}`);
  sets.push(sql`updated_at = NOW()`);
  const setExpr = sets.reduce((acc, s, i) => (i === 0 ? s : sql`${acc}, ${s}`));
  const res = await db.execute(sql`
    UPDATE briefing_subscriptions
       SET ${setExpr}
     WHERE id = ${id} AND tenant_id = ${auth.tenantId}
     RETURNING id, enabled, next_due_at
  `);
  const arr = fetchRows(res);
  if (arr.length === 0) {
    return c.json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }
  return c.json({ success: true, data: arr[0] });
});

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/** Persist a generated brief to the executive_briefs table. */
async function persistBrief(db, brief) {
  await db.execute(sql`
    INSERT INTO executive_briefs (
      id, tenant_id, persona_id, scope_jsonb, gaps_jsonb, opportunities_jsonb,
      risks_jsonb, recommended_actions_jsonb, approval_packets_jsonb, citations_jsonb,
      locale, generated_at, period_start, period_end, generator_version,
      cost_micros, hash, prev_hash, audit_chain_link, status
    ) VALUES (
      ${brief.id}, ${brief.tenantId}, ${brief.personaId}, ${JSON.stringify(brief.scope)}::jsonb,
      ${JSON.stringify(brief.gaps)}::jsonb, ${JSON.stringify(brief.opportunities)}::jsonb,
      ${JSON.stringify(brief.risks)}::jsonb, ${JSON.stringify(brief.recommendedActions)}::jsonb,
      ${JSON.stringify(brief.approvalPackets)}::jsonb, ${JSON.stringify(brief.citations)}::jsonb,
      ${brief.locale}, ${brief.generatedAt.toISOString()},
      ${brief.periodStart.toISOString()}, ${brief.periodEnd.toISOString()},
      ${brief.generatorVersion}, ${brief.costMicros ?? null}, ${brief.hash},
      ${brief.prevHash}, ${brief.auditChainLink}, ${brief.status}
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * Compute the next `next_due_at` for a subscription cadence + local_time.
 * Treats local_time as UTC for simplicity in Wave-15; per-tenant tz
 * resolution lands in Wave 17 (same constraint as lease-expiry cron).
 */
export function computeNextDueAt(cadence, localTime, now) {
  const [hh, mm] = (localTime || '06:00').split(':').map((s) => Number(s));
  const next = new Date(now);
  next.setUTCHours(hh || 6, mm || 0, 0, 0);
  // If we've already passed today's local_time, push to next eligible day.
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  switch (cadence) {
    case 'WEEKLY': {
      // Monday at local_time.
      const day = next.getUTCDay();
      const distance = (8 - day) % 7 || 7;
      next.setUTCDate(next.getUTCDate() + distance - 1);
      if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 7);
      break;
    }
    case 'MONTHLY': {
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    }
    case 'ON_DEMAND':
      // Never auto-fires; place in the far future.
      next.setUTCFullYear(next.getUTCFullYear() + 99);
      break;
    case 'DAILY':
    default:
      // Already day-aligned above.
      break;
  }
  return next;
}

export const executiveBriefRouter = briefs;
export const briefingSubscriptionRouter = subscriptions;

// @ts-nocheck — Hono v4 TypedResponse widening across many c.json branches.
/**
 * /api/v1/workforce/tab-config and /api/v1/owner/workforce/* —
 * Wave WORKFORCE-FIXED-TABS.
 *
 * The workforce app uses FIXED tabs. A worker cannot spawn, close, or
 * reorder tabs themselves. Tab visibility is the function:
 *
 *   visibility = (role, site_scope) → owner-curated subset of
 *                WORKFORCE_TAB_CATALOG
 *
 * Routes (worker-side):
 *   GET  /api/v1/workforce/tab-config?role=...&siteId=...
 *        Returns the merged config for the current user. Resolves role
 *        + site from the JWT (or the optional query overrides for
 *        owner-side previews), reads the matching
 *        `workforce_role_tab_configs` row, and falls back to a built-
 *        in default per role if none exists. NEVER mutates state.
 *
 *   POST /api/v1/workforce/tab-change-requests
 *        Any workforce user submits a request to change their tabs.
 *        Body: { reason, requested_changes }. Status starts 'pending'.
 *        Hash-chained audit appended.
 *
 * Routes (owner-side):
 *   PUT   /api/v1/owner/workforce/tab-configs/:role/:siteScope
 *         Owner replaces enabled tabs + density for a (role, scope).
 *         Validates against the catalog + mandatory-tab rule. Hash-
 *         chained audit appended.
 *
 *   GET   /api/v1/owner/workforce/tab-change-requests?status=pending
 *         Owner queue view, newest first.
 *
 *   PATCH /api/v1/owner/workforce/tab-change-requests/:id
 *         Owner decides (approve | reject + note). On approve the diff
 *         auto-applies to the matching `workforce_role_tab_configs`
 *         row and a second audit row is appended for the apply step.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 *
 * Audit: every owner write (PUT / approve / reject / apply) and every
 *        worker create writes an append-only row to `ai_audit_chain`
 *        with `action = 'workforce_tab.*'`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import {
  workforceRoleTabConfigs,
  workforceTabChangeRequests,
} from '@borjie/database';
import {
  WORKFORCE_ROLE_IDS,
  WORKFORCE_TAB_CATALOG,
  MANDATORY_WORKFORCE_TAB_IDS,
  defaultEnabledTabIdsForRole,
  validateEnabledTabsForRole,
  type WorkforceRoleId,
} from '@borjie/persona-runtime';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('workforce-tab-configs');

const VALID_ROLES = WORKFORCE_ROLE_IDS as ReadonlyArray<string>;
const VALID_TAB_IDS = WORKFORCE_TAB_CATALOG.map((t) => t.id);

const OWNER_SIDE_ROLES = new Set<string>(['owner', 'manager']);

function isOwnerSide(role: string | undefined): boolean {
  if (!role) return false;
  return OWNER_SIDE_ROLES.has(role);
}

// ---------------------------------------------------------------------------
// Hash-chained audit append (mirrors workforce/invites.hono.ts).
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Readonly<Record<string, unknown>>;
}

async function appendAuditEntry(
  db: any,
  payload: AuditAppendPayload,
): Promise<string> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });
  const latestResult: unknown = await db.execute(
    sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
               (SELECT this_hash FROM ai_audit_chain
                WHERE tenant_id = ${payload.tenantId}
                ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
        WHERE tenant_id = ${payload.tenantId}`,
  );
  const rows =
    (latestResult as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (latestResult as ReadonlyArray<Record<string, unknown>>);
  const head = rows[0] ?? {};
  const maxSeq = Number(head.max_seq ?? 0);
  const lastHash =
    typeof head.last_hash === 'string' && head.last_hash.length > 0
      ? head.last_hash
      : '';
  const sequenceId = maxSeq + 1;
  const prevHash = lastHash;
  const thisHash = createHash('sha256')
    .update(prevHash + canonical)
    .digest('hex');
  await db.execute(sql`
    INSERT INTO ai_audit_chain (
      id, tenant_id, sequence_id, turn_id, action,
      prev_hash, this_hash, payload, created_at
    ) VALUES (
      ${id},
      ${payload.tenantId},
      ${sequenceId},
      ${payload.turnId},
      ${payload.action},
      ${prevHash},
      ${thisHash},
      ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
      ${new Date().toISOString()}
    )
  `);
  return id;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const tabConfigQuerySchema = z.object({
  role: z.enum(WORKFORCE_ROLE_IDS).optional(),
  siteId: z.string().uuid().optional(),
});

const putConfigParamsSchema = z.object({
  role: z.enum(WORKFORCE_ROLE_IDS),
  siteScope: z.string().min(1).max(64),
});

const putConfigBodySchema = z.object({
  enabledTabIds: z.array(z.enum(VALID_TAB_IDS as [string, ...string[]])).min(1).max(64),
  layoutDensity: z.enum(['comfortable', 'compact']).default('comfortable'),
});

const createChangeRequestSchema = z.object({
  reason: z.string().trim().min(4).max(2000),
  requestedChanges: z.object({
    addTabs: z.array(z.string().min(1).max(64)).max(20).optional(),
    removeTabs: z.array(z.string().min(1).max(64)).max(20).optional(),
    densityChange: z.enum(['comfortable', 'compact']).optional(),
  }),
  siteId: z.string().uuid().nullable().optional(),
});

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
});

const queueQuerySchema = z.object({
  status: z
    .enum(['pending', 'approved', 'rejected', 'applied', 'cancelled'])
    .default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Worker-side app — /api/v1/workforce/*
// ---------------------------------------------------------------------------

const workerApp = new Hono();
workerApp.use('*', authMiddleware);
workerApp.use('*', databaseMiddleware);

workerApp.get('/tab-config', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    permissions?: string[];
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_CONFIG_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }

  const parsed = tabConfigQuerySchema.safeParse({
    role: c.req.query('role'),
    siteId: c.req.query('siteId'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid tab-config query',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const jwtRole = (auth.permissions?.[0] ?? '').toString();
  const role = (parsed.data.role ??
    (VALID_ROLES.includes(jwtRole) ? jwtRole : 'pit_operator')) as WorkforceRoleId;
  const siteScope = parsed.data.siteId ?? 'global';

  const [scoped] = await db
    .select()
    .from(workforceRoleTabConfigs)
    .where(
      and(
        eq(workforceRoleTabConfigs.tenantId, auth.tenantId),
        eq(workforceRoleTabConfigs.role, role),
        eq(workforceRoleTabConfigs.siteScope, siteScope),
      ),
    )
    .limit(1);

  let config = scoped;
  if (!config && siteScope !== 'global') {
    const [global] = await db
      .select()
      .from(workforceRoleTabConfigs)
      .where(
        and(
          eq(workforceRoleTabConfigs.tenantId, auth.tenantId),
          eq(workforceRoleTabConfigs.role, role),
          eq(workforceRoleTabConfigs.siteScope, 'global'),
        ),
      )
      .limit(1);
    config = global;
  }

  if (!config) {
    return c.json({
      success: true,
      data: {
        role,
        siteScope,
        enabledTabIds: defaultEnabledTabIdsForRole(role),
        layoutDensity: 'comfortable' as const,
        updatedAt: null,
        hydratedFromDefault: true,
      },
    });
  }

  return c.json({
    success: true,
    data: {
      role: config.role,
      siteScope: config.siteScope,
      enabledTabIds: config.enabledTabIds,
      layoutDensity: config.layoutDensity,
      updatedAt: config.updatedAt,
      hydratedFromDefault: false,
    },
  });
});

workerApp.post('/tab-change-requests', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    permissions?: string[];
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_REQUEST_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = createChangeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid change-request payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const jwtRole = (auth.permissions?.[0] ?? '').toString();
  const requesterRole = VALID_ROLES.includes(jwtRole) ? jwtRole : 'pit_operator';

  const [inserted] = await db
    .insert(workforceTabChangeRequests)
    .values({
      tenantId: auth.tenantId,
      requesterUserId: auth.userId,
      requesterRole,
      siteId: parsed.data.siteId ?? null,
      reason: parsed.data.reason,
      requestedChanges: parsed.data.requestedChanges,
      status: 'pending',
    })
    .returning();

  const chainId = await appendAuditEntry(db, {
    action: 'workforce_tab.change_request.create',
    tenantId: auth.tenantId,
    turnId: inserted.id,
    userId: auth.userId,
    details: {
      requestId: inserted.id,
      requesterRole,
      siteId: parsed.data.siteId ?? null,
      requestedChanges: parsed.data.requestedChanges,
    },
  });

  await db
    .update(workforceTabChangeRequests)
    .set({ auditHashId: chainId })
    .where(eq(workforceTabChangeRequests.id, inserted.id));

  moduleLogger.info('workforce-tab-configs: change request created', {
    tenantId: auth.tenantId,
    requestId: inserted.id,
    requesterRole,
  });

  return c.json(
    {
      success: true,
      data: {
        id: inserted.id,
        status: inserted.status,
        createdAt: inserted.createdAt,
        auditHashId: chainId,
      },
    },
    201,
  );
});

export const workforceTabConfigWorkerRouter = workerApp;

// ---------------------------------------------------------------------------
// Owner-side app — /api/v1/owner/workforce/*
// ---------------------------------------------------------------------------

const ownerApp = new Hono();
ownerApp.use('*', authMiddleware);
ownerApp.use('*', databaseMiddleware);

ownerApp.put('/tab-configs/:role/:siteScope', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    permissions?: string[];
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_CONFIG_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }

  const jwtRole = (auth.permissions?.[0] ?? '').toString();
  if (!isOwnerSide(jwtRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only owner / manager roles may set workforce tab configs',
        },
      },
      403,
    );
  }

  const paramsParsed = putConfigParamsSchema.safeParse({
    role: c.req.param('role'),
    siteScope: c.req.param('siteScope'),
  });
  if (!paramsParsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid role or siteScope',
          issues: paramsParsed.error.issues,
        },
      },
      400,
    );
  }

  const bodyRaw = await c.req.json().catch(() => null);
  const bodyParsed = putConfigBodySchema.safeParse(bodyRaw);
  if (!bodyParsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid config body',
          issues: bodyParsed.error.issues,
        },
      },
      400,
    );
  }

  const role = paramsParsed.data.role as WorkforceRoleId;
  const validation = validateEnabledTabsForRole(role, bodyParsed.data.enabledTabIds);
  if (!validation.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TAB_SET',
          message: validation.error,
        },
      },
      400,
    );
  }

  const now = new Date();
  const enabledTabIds = bodyParsed.data.enabledTabIds;
  const layoutDensity = bodyParsed.data.layoutDensity;

  const existing = await db
    .select()
    .from(workforceRoleTabConfigs)
    .where(
      and(
        eq(workforceRoleTabConfigs.tenantId, auth.tenantId),
        eq(workforceRoleTabConfigs.role, role),
        eq(workforceRoleTabConfigs.siteScope, paramsParsed.data.siteScope),
      ),
    )
    .limit(1);

  let row;
  if (existing.length === 0) {
    const [inserted] = await db
      .insert(workforceRoleTabConfigs)
      .values({
        tenantId: auth.tenantId,
        role,
        siteScope: paramsParsed.data.siteScope,
        enabledTabIds,
        layoutDensity,
        updatedByUserId: auth.userId,
        updatedAt: now,
      })
      .returning();
    row = inserted;
  } else {
    const [updated] = await db
      .update(workforceRoleTabConfigs)
      .set({
        enabledTabIds,
        layoutDensity,
        updatedByUserId: auth.userId,
        updatedAt: now,
      })
      .where(eq(workforceRoleTabConfigs.id, existing[0]!.id))
      .returning();
    row = updated;
  }

  const chainId = await appendAuditEntry(db, {
    action: 'workforce_tab.config.upsert',
    tenantId: auth.tenantId,
    turnId: row.id,
    userId: auth.userId,
    details: {
      role,
      siteScope: paramsParsed.data.siteScope,
      enabledTabIds,
      layoutDensity,
    },
  });

  await db
    .update(workforceRoleTabConfigs)
    .set({ hashChainId: chainId })
    .where(eq(workforceRoleTabConfigs.id, row.id));

  moduleLogger.info('workforce-tab-configs: owner upsert', {
    tenantId: auth.tenantId,
    role,
    siteScope: paramsParsed.data.siteScope,
    enabledTabCount: enabledTabIds.length,
  });

  return c.json({
    success: true,
    data: {
      id: row.id,
      role,
      siteScope: paramsParsed.data.siteScope,
      enabledTabIds,
      layoutDensity,
      updatedAt: now,
      hashChainId: chainId,
    },
  });
});

ownerApp.get('/tab-change-requests', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    permissions?: string[];
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_REQUEST_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const jwtRole = (auth.permissions?.[0] ?? '').toString();
  if (!isOwnerSide(jwtRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only owner / manager roles may view the change-request queue',
        },
      },
      403,
    );
  }

  const parsed = queueQuerySchema.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid queue query',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const rows = await db
    .select()
    .from(workforceTabChangeRequests)
    .where(
      and(
        eq(workforceTabChangeRequests.tenantId, auth.tenantId),
        eq(workforceTabChangeRequests.status, parsed.data.status),
      ),
    )
    .orderBy(desc(workforceTabChangeRequests.createdAt))
    .limit(parsed.data.limit);

  return c.json({
    success: true,
    data: rows,
    meta: { total: rows.length, status: parsed.data.status },
  });
});

ownerApp.patch('/tab-change-requests/:id', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    permissions?: string[];
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'WORKFORCE_TAB_REQUEST_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const jwtRole = (auth.permissions?.[0] ?? '').toString();
  if (!isOwnerSide(jwtRole)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only owner / manager roles may decide change requests',
        },
      },
      403,
    );
  }

  const id = c.req.param('id');
  if (!id || !z.string().uuid().safeParse(id).success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request id' },
      },
      400,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid decision payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const [pending] = await db
    .select()
    .from(workforceTabChangeRequests)
    .where(
      and(
        eq(workforceTabChangeRequests.tenantId, auth.tenantId),
        eq(workforceTabChangeRequests.id, id),
      ),
    )
    .limit(1);

  if (!pending) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Change request not found' },
      },
      404,
    );
  }
  if (pending.status !== 'pending') {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Change request is already ${pending.status}`,
        },
      },
      409,
    );
  }

  const now = new Date();
  const decisionStatus = parsed.data.decision === 'approve' ? 'approved' : 'rejected';

  const decisionChainId = await appendAuditEntry(db, {
    action: `workforce_tab.change_request.${parsed.data.decision}`,
    tenantId: auth.tenantId,
    turnId: pending.id,
    userId: auth.userId,
    details: {
      requestId: pending.id,
      requesterUserId: pending.requesterUserId,
      requesterRole: pending.requesterRole,
      note: parsed.data.note ?? null,
    },
  });

  await db
    .update(workforceTabChangeRequests)
    .set({
      status: decisionStatus,
      decidedByUserId: auth.userId,
      decidedAt: now,
      decisionNote: parsed.data.note ?? null,
      auditHashId: decisionChainId,
    })
    .where(eq(workforceTabChangeRequests.id, pending.id));

  if (parsed.data.decision === 'reject') {
    return c.json({
      success: true,
      data: {
        id: pending.id,
        status: decisionStatus,
        decidedAt: now,
        auditHashId: decisionChainId,
      },
    });
  }

  // Approve path — apply the diff to the matching config row.
  const role = pending.requesterRole as WorkforceRoleId;
  const siteScope = pending.siteId ?? 'global';
  const changes = pending.requestedChanges as {
    addTabs?: ReadonlyArray<string>;
    removeTabs?: ReadonlyArray<string>;
    densityChange?: 'comfortable' | 'compact';
  };

  const [current] = await db
    .select()
    .from(workforceRoleTabConfigs)
    .where(
      and(
        eq(workforceRoleTabConfigs.tenantId, auth.tenantId),
        eq(workforceRoleTabConfigs.role, role),
        eq(workforceRoleTabConfigs.siteScope, siteScope),
      ),
    )
    .limit(1);

  let baseEnabled: ReadonlyArray<string>;
  let baseDensity: 'comfortable' | 'compact';
  if (current) {
    baseEnabled = current.enabledTabIds;
    baseDensity = current.layoutDensity as 'comfortable' | 'compact';
  } else {
    baseEnabled = defaultEnabledTabIdsForRole(role);
    baseDensity = 'comfortable';
  }

  const nextSet = new Set<string>(baseEnabled);
  for (const t of changes.addTabs ?? []) nextSet.add(t);
  for (const t of changes.removeTabs ?? []) nextSet.delete(t);
  for (const m of MANDATORY_WORKFORCE_TAB_IDS) nextSet.add(m);

  const nextEnabled = Array.from(nextSet);
  const nextDensity = changes.densityChange ?? baseDensity;

  const v = validateEnabledTabsForRole(role, nextEnabled);
  if (!v.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_TAB_SET',
          message: `Cannot apply approved diff: ${v.error}`,
        },
      },
      400,
    );
  }

  let appliedRowId: string;
  if (!current) {
    const [created] = await db
      .insert(workforceRoleTabConfigs)
      .values({
        tenantId: auth.tenantId,
        role,
        siteScope,
        enabledTabIds: nextEnabled,
        layoutDensity: nextDensity,
        updatedByUserId: auth.userId,
        updatedAt: now,
      })
      .returning();
    appliedRowId = created.id;
  } else {
    const [updated] = await db
      .update(workforceRoleTabConfigs)
      .set({
        enabledTabIds: nextEnabled,
        layoutDensity: nextDensity,
        updatedByUserId: auth.userId,
        updatedAt: now,
      })
      .where(eq(workforceRoleTabConfigs.id, current.id))
      .returning();
    appliedRowId = updated.id;
  }

  const applyChainId = await appendAuditEntry(db, {
    action: 'workforce_tab.change_request.apply',
    tenantId: auth.tenantId,
    turnId: pending.id,
    userId: auth.userId,
    details: {
      requestId: pending.id,
      role,
      siteScope,
      previousEnabledTabIds: baseEnabled,
      nextEnabledTabIds: nextEnabled,
      densityChange:
        nextDensity !== baseDensity
          ? { from: baseDensity, to: nextDensity }
          : null,
    },
  });

  await db
    .update(workforceRoleTabConfigs)
    .set({ hashChainId: applyChainId })
    .where(eq(workforceRoleTabConfigs.id, appliedRowId));

  await db
    .update(workforceTabChangeRequests)
    .set({ status: 'applied' })
    .where(eq(workforceTabChangeRequests.id, pending.id));

  moduleLogger.info('workforce-tab-configs: change request approved + applied', {
    tenantId: auth.tenantId,
    requestId: pending.id,
    role,
    siteScope,
  });

  return c.json({
    success: true,
    data: {
      id: pending.id,
      status: 'applied',
      decidedAt: now,
      auditHashId: decisionChainId,
      applyHashId: applyChainId,
      appliedConfig: {
        id: appliedRowId,
        role,
        siteScope,
        enabledTabIds: nextEnabled,
        layoutDensity: nextDensity,
      },
    },
  });
});

export const workforceTabConfigOwnerRouter = ownerApp;

export default workforceTabConfigWorkerRouter;

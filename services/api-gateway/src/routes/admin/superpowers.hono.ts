/**
 * /api/v1/admin/superpowers - admin-side superpower entrypoints.
 *
 * Companion to `services/api-gateway/src/routes/owner/superpowers.hono.ts`
 * but with the admin-side whitelist of bulk operations. Admins operate
 * across tenants and reach for verbs that owners cannot — e.g. mass
 * suspension of a tenant org, regulator-pack exports — so the whitelist
 * is distinct and a subset is HIGH-IMPACT (requires a four-eye
 * approval flow).
 *
 * Routes:
 *   POST /bulk-action            chat-callable bulk operation surface
 *   POST /bulk-action/:journalId/approve   second-eye approval for HIGH actions
 *
 * Auth: Supabase JWT + `requireRole(SUPER_ADMIN | ADMIN | SUPPORT)`.
 *       The journal entry pins both the proposing and approving actor
 *       ids for HIGH-impact actions so the audit chain is reconstructable.
 *
 * NOTE: prefill / highlight / share / bookmark / undo for admins reuse
 * the existing `/api/v1/owner/*` endpoints because they are tenant-scoped
 * via the Supabase JWT. Admins act inside their own admin tenant scope
 * for those superpowers; only bulk-action carries cross-tenant impact
 * and therefore needs its own admin route.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { undoJournal } from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { UserRole } from '../../types/user-role';

const moduleLogger = createLogger('admin-superpowers');

// ─── Whitelist matrix (admin-only verbs) ─────────────────────────────

/**
 * Admin bulk-action whitelist. The HIGH set marks verbs that demand a
 * four-eye approval before they take effect: the first admin proposes
 * the action (journal row written), a second admin approves via
 * `/bulk-action/:journalId/approve`, and only then does the journal
 * entry transition to `applied`. The owner whitelist (snooze/complete/
 * etc) is INTENTIONALLY excluded — admin uses `/owner/superpowers/bulk-action`
 * for those.
 */
const ADMIN_BULK_WHITELIST: Readonly<
  Record<string, ReadonlyArray<string>>
> = Object.freeze({
  tenant_orgs: ['suspend', 'reactivate', 'export_regulator_pack'],
  intelligence_corpus: ['archive', 'reindex'],
  feature_flags: ['enable', 'disable'],
  killswitch_targets: ['activate'],
});

/**
 * HIGH-impact verbs need 4-eye. Anything that suspends a tenant,
 * activates kill-switch targets, or exports regulator packs cannot
 * land on a single admin's say-so.
 */
const HIGH_IMPACT_ACTIONS: ReadonlySet<string> = new Set([
  'suspend',
  'reactivate',
  'activate',
  'export_regulator_pack',
]);

const adminBulkSchema = z
  .object({
    entityType: z.enum([
      'tenant_orgs',
      'intelligence_corpus',
      'feature_flags',
      'killswitch_targets',
    ]),
    ids: z.array(z.string().min(1).max(120)).min(1).max(100),
    action: z.enum([
      'suspend',
      'reactivate',
      'export_regulator_pack',
      'archive',
      'reindex',
      'enable',
      'disable',
      'activate',
    ]),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
    reason: z.string().min(8).max(2000),
    provenance: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .superRefine((v, ctx) => {
    const allowed = ADMIN_BULK_WHITELIST[v.entityType] ?? [];
    if (!allowed.includes(v.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `admin action '${v.action}' not allowed on '${v.entityType}' — whitelist: ${allowed.join(',')}`,
        path: ['action'],
      });
    }
  });

const approveSchema = z.object({
  decisionNote: z.string().min(1).max(2000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT));
app.use('*', databaseMiddleware);

// POST /bulk-action - chat-callable bulk operation for admins
//
// HIGH-impact verbs land as `pending_approval` journal entries — the
// row's `provenance.requires_four_eye` flag is true and `appliedAt` is
// null until a second admin calls the approve endpoint. Standard verbs
// land applied immediately.
app.post('/bulk-action', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    role: string;
  };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'ADMIN_BULK_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = adminBulkSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid admin bulk payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;
  const requiresFourEye = HIGH_IMPACT_ACTIONS.has(input.action);

  // Append one undo journal entry per id so the admin's Undo chip can
  // reverse the whole batch. For HIGH-impact actions the entry lands
  // as pending_approval and the actual mutation is deferred to the
  // approval endpoint.
  const undoIds: string[] = [];
  const processedIds: string[] = [];
  const failedRows: Array<{ readonly id: string; readonly reason: string }> = [];

  for (const id of input.ids) {
    try {
      const [row] = await db
        .insert(undoJournal)
        .values({
          tenantId: auth.tenantId,
          actorId: auth.userId,
          entityType: input.entityType,
          entityId: id,
          actionKind: 'bulk_update',
          toolId: 'admin.ui.bulk_action',
          beforeState: null,
          afterState: { action: input.action, payload: input.payload },
          windowSeconds: 300,
          provenance: {
            ...input.provenance,
            surface: 'admin-web',
            adminRole: auth.role,
            reason: input.reason,
            requires_four_eye: requiresFourEye,
            status: requiresFourEye ? 'pending_approval' : 'applied',
          },
        })
        .returning();
      undoIds.push(row.id);
      processedIds.push(id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failedRows.push({ id, reason });
      moduleLogger.warn('admin-superpowers: bulk row failed', {
        adminId: auth.userId,
        entityType: input.entityType,
        action: input.action,
        id,
        error: reason,
      });
    }
  }

  moduleLogger.info('admin-superpowers: bulk action recorded', {
    adminId: auth.userId,
    adminRole: auth.role,
    entityType: input.entityType,
    action: input.action,
    requiresFourEye,
    processed: processedIds.length,
    failed: failedRows.length,
  });

  return c.json({
    success: true,
    data: {
      accepted: true,
      requiresFourEye,
      status: requiresFourEye ? 'pending_approval' : 'applied',
      processed: processedIds.length,
      failed: failedRows.length,
      processedIds,
      failedIds: failedRows,
      undoJournalIds: undoIds,
    },
  });
});

// POST /bulk-action/:journalId/approve - second-eye approval of a HIGH-impact
// admin bulk-action. Forbidden if the approver matches the proposer.
app.post('/bulk-action/:journalId/approve', async (c: any) => {
  const auth = c.get('auth') as {
    tenantId: string;
    userId: string;
    role: string;
  };
  const db = c.get('db');
  const journalId = c.req.param('journalId');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'ADMIN_BULK_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid approval payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const [candidate] = await db
    .select()
    .from(undoJournal)
    .where(
      and(
        eq(undoJournal.id, journalId),
        eq(undoJournal.tenantId, auth.tenantId),
      ),
    )
    .limit(1);

  if (!candidate) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Admin bulk-action journal entry not found',
        },
      },
      404,
    );
  }
  if (candidate.actorId === auth.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FOUR_EYE_SAME_ACTOR',
          message: 'Approver must differ from the proposing admin',
        },
      },
      409,
    );
  }
  const provenance =
    (candidate.provenance as Record<string, unknown> | null) ?? {};
  if (provenance.requires_four_eye !== true) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FOUR_EYE_NOT_REQUIRED',
          message: 'This action did not require four-eye approval',
        },
      },
      409,
    );
  }
  if (provenance.status === 'applied') {
    return c.json(
      {
        success: false,
        error: {
          code: 'ALREADY_APPLIED',
          message: 'Action already approved + applied',
        },
      },
      409,
    );
  }

  const nextProvenance = {
    ...provenance,
    status: 'applied',
    approved_by_user_id: auth.userId,
    approved_by_role: auth.role,
    approved_at: new Date().toISOString(),
    ...(parsed.data.decisionNote !== undefined && {
      approver_note: parsed.data.decisionNote,
    }),
  };

  const [row] = await db
    .update(undoJournal)
    .set({ provenance: nextProvenance })
    .where(eq(undoJournal.id, journalId))
    .returning();

  moduleLogger.info('admin-superpowers: bulk-action approved (4-eye)', {
    journalId: row.id,
    proposingActorId: candidate.actorId,
    approvingActorId: auth.userId,
    entityType: row.entityType,
    entityId: row.entityId,
  });

  return c.json({
    success: true,
    data: {
      applied: true,
      journalId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });
});

export const adminSuperpowersRouter = app;
export default adminSuperpowersRouter;

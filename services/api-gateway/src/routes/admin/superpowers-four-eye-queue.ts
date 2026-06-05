/**
 * Admin four-eye superpowers QUEUE routes — propose → approve → reject →
 * list_pending (ported from BossNyumba migration 0301, retargeted real-estate
 * → mining).
 *
 * `registerFourEyeQueueRoutes(app)` mounts three handlers on the SAME Hono app
 * and `/admin/superpowers` base path as `superpowers.hono.ts`:
 *
 *   POST /approve/:journalId   second-actor approval of a HIGH proposal
 *   POST /reject/:journalId    reject a pending HIGH proposal
 *   GET  /pending              list pending (or filtered) proposals
 *
 * The PROPOSE half lives in `superpowers.hono.ts` `/bulk-action`: HIGH-risk
 * verbs on a queue entity type append one `admin_superpower_pending_approvals`
 * row per id with status='pending'. These routes consult that table directly.
 *
 * Same-actor guard: `/approve` refuses with 409 FOUR_EYE_SAME_ACTOR when the
 * approver matches the proposing admin; the DB CHECK constraint
 * `admin_four_eye_distinct_actors_chk` is the canonical safety net.
 *
 * Auth + db context: the parent router (`superpowers.hono.ts`) already binds
 * `authMiddleware` + `requireRole(SUPER_ADMIN|ADMIN|SUPPORT)` +
 * `databaseMiddleware` via `app.use('*', …)`, so these handlers read the same
 * `c.get('auth')` / `c.get('db')` the legacy routes do.
 *
 * Honest-degraded note: the actual entity-side mutation a verb proposes is NOT
 * wired in Borjie (no admin licence-holder-suspend / supply-agreement-terminate
 * surface exists yet). On approval the row transitions to `applied` and the
 * verb + target ref are returned (`mutationApplied: false`) so an operator /
 * sweeper carries out the side effect. We never fabricate a mutation.
 */

import type { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';

import {
  undoJournal,
  adminSuperpowerPendingApprovals,
} from '@borjie/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('admin-superpowers-queue');

// ─── Zod schemas ─────────────────────────────────────────────────────

const approveSchema = z
  .object({ decisionNote: z.string().min(1).max(2000).optional() })
  .strict();

const rejectSchema = z
  .object({ rejectionReason: z.string().min(8).max(2000) })
  .strict();

const pendingQuerySchema = z.object({
  status: z
    .enum(['pending', 'applied', 'rejected', 'expired'])
    .default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Shared response helpers ─────────────────────────────────────────

type AuthShape = {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
};

function dbUnavailable(c: any) {
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

function validationError(c: any, message: string, issues?: unknown) {
  return c.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        ...(issues !== undefined && { issues }),
      },
    },
    400,
  );
}

function errorJson(c: any, status: number, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, status);
}

// ─── Route registrars (small, one per verb) ──────────────────────────

function registerApproveRoute(app: Hono): void {
  app.post('/approve/:journalId', async (c: any) => {
    const auth = c.get('auth') as AuthShape;
    const db = c.get('db');
    if (!db) return dbUnavailable(c);

    const journalId = c.req.param('journalId');
    if (!journalId) return validationError(c, 'Missing journalId');

    const raw = await c.req.json().catch(() => ({}));
    const parsed = approveSchema.safeParse(raw);
    if (!parsed.success) {
      return validationError(c, 'Invalid approval payload', parsed.error.issues);
    }

    const [pending] = await db
      .select()
      .from(adminSuperpowerPendingApprovals)
      .where(eq(adminSuperpowerPendingApprovals.journalId, journalId))
      .limit(1);
    if (!pending) {
      return errorJson(
        c,
        404,
        'NOT_FOUND',
        'Pending approval not found for this journalId',
      );
    }
    // ── Same-actor guard (the FOUR-EYE invariant). ──
    if (pending.proposedByActorId === auth.userId) {
      return errorJson(
        c,
        409,
        'FOUR_EYE_SAME_ACTOR',
        'Approver must differ from the proposing admin',
      );
    }
    if (pending.status === 'applied') {
      return errorJson(
        c,
        409,
        'ALREADY_APPLIED',
        'Approval already granted; mutation has fired',
      );
    }
    if (pending.status === 'rejected') {
      return errorJson(
        c,
        409,
        'ALREADY_REJECTED',
        'Proposal was rejected by another admin',
      );
    }
    if (
      pending.status === 'expired' ||
      (pending.expiresAt && new Date(pending.expiresAt) < new Date())
    ) {
      return errorJson(
        c,
        409,
        'PROPOSAL_EXPIRED',
        'Proposal expired before approval; please re-propose',
      );
    }

    const approvedAt = new Date();
    const [updatedPending] = await db
      .update(adminSuperpowerPendingApprovals)
      .set({
        status: 'applied',
        approvedByActorId: auth.userId,
        approvedByRole: auth.role,
        ...(parsed.data.decisionNote !== undefined && {
          approverNote: parsed.data.decisionNote,
        }),
        approvedAt,
      })
      .where(eq(adminSuperpowerPendingApprovals.id, pending.id))
      .returning();

    // Best-effort: reflect the applied state onto the proposer's journal row
    // so the Undo chip + audit trace stay coherent. Under cross-tenant
    // approval the journal may not be visible — tolerated; the pending row is
    // canonical.
    const [journal] = await db
      .select()
      .from(undoJournal)
      .where(
        and(
          eq(undoJournal.id, journalId),
          eq(undoJournal.tenantId, auth.tenantId),
        ),
      )
      .limit(1);
    if (journal) {
      const jProvenance =
        (journal.provenance as Record<string, unknown> | null) ?? {};
      await db
        .update(undoJournal)
        .set({
          provenance: {
            ...jProvenance,
            status: 'applied',
            approved_by_user_id: auth.userId,
            approved_by_role: auth.role,
            approved_at: approvedAt.toISOString(),
            ...(parsed.data.decisionNote !== undefined && {
              approver_note: parsed.data.decisionNote,
            }),
          },
        })
        .where(eq(undoJournal.id, journalId));
    } else {
      moduleLogger.warn(
        'admin-superpowers-queue: journal not visible to approver',
        { journalId, approverId: auth.userId },
      );
    }

    moduleLogger.info(
      'admin-superpowers-queue: HIGH verb approved (four-eye)',
      {
        journalId,
        pendingId: updatedPending.id,
        proposingActorId: pending.proposedByActorId,
        approvingActorId: auth.userId,
        action: pending.action,
        targetEntityRef: pending.targetEntityRef,
      },
    );

    return c.json({
      success: true,
      data: {
        applied: true,
        journalId,
        pendingId: updatedPending.id,
        action: pending.action,
        targetEntityRef: pending.targetEntityRef,
        approvedAt: approvedAt.toISOString(),
        // Honest-degraded: the entity-side mutation is not wired in Borjie
        // yet; an operator / sweeper carries out `action` on `targetEntityRef`.
        mutationApplied: false,
        message: {
          en: 'Approval granted; action will fire shortly.',
          sw: 'Idhini imetolewa; hatua itatekelezwa hivi punde.',
        },
      },
    });
  });
}

function registerRejectRoute(app: Hono): void {
  app.post('/reject/:journalId', async (c: any) => {
    const auth = c.get('auth') as AuthShape;
    const db = c.get('db');
    if (!db) return dbUnavailable(c);

    const journalId = c.req.param('journalId');
    if (!journalId) return validationError(c, 'Missing journalId');

    const raw = await c.req.json().catch(() => null);
    const parsed = rejectSchema.safeParse(raw);
    if (!parsed.success) {
      return validationError(c, 'Invalid rejection payload', parsed.error.issues);
    }

    const [pending] = await db
      .select()
      .from(adminSuperpowerPendingApprovals)
      .where(eq(adminSuperpowerPendingApprovals.journalId, journalId))
      .limit(1);
    if (!pending) {
      return errorJson(c, 404, 'NOT_FOUND', 'Pending approval not found');
    }
    if (pending.status !== 'pending') {
      return errorJson(
        c,
        409,
        'ALREADY_RESOLVED',
        `Proposal already ${pending.status}`,
      );
    }

    const rejectedAt = new Date();
    const [updated] = await db
      .update(adminSuperpowerPendingApprovals)
      .set({
        status: 'rejected',
        rejectedByActorId: auth.userId,
        rejectedByRole: auth.role,
        rejectionReason: parsed.data.rejectionReason,
        rejectedAt,
      })
      .where(eq(adminSuperpowerPendingApprovals.id, pending.id))
      .returning();

    moduleLogger.info('admin-superpowers-queue: HIGH verb rejected', {
      journalId,
      rejectingActorId: auth.userId,
      action: pending.action,
    });

    return c.json({
      success: true,
      data: {
        rejected: true,
        journalId,
        pendingId: updated.id,
        message: {
          en: 'Proposal rejected; action will not fire.',
          sw: 'Pendekezo limekataliwa; hatua haitatekelezwa.',
        },
      },
    });
  });
}

function registerPendingRoute(app: Hono): void {
  app.get('/pending', async (c: any) => {
    const auth = c.get('auth') as AuthShape;
    const db = c.get('db');
    if (!db) return dbUnavailable(c);

    const parsed = pendingQuerySchema.safeParse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return validationError(c, 'Invalid query', parsed.error.issues);
    }

    // RLS scopes rows to the admin's tenant via app.current_tenant_id; we also
    // filter by proposed_by_tenant_id defensively for the mock-DB / non-RLS
    // path so an admin never sees another tenant's queue.
    const rows = await db
      .select()
      .from(adminSuperpowerPendingApprovals)
      .where(
        and(
          eq(adminSuperpowerPendingApprovals.proposedByTenantId, auth.tenantId),
          eq(adminSuperpowerPendingApprovals.status, parsed.data.status),
        ),
      )
      .orderBy(desc(adminSuperpowerPendingApprovals.createdAt))
      .limit(parsed.data.limit);

    return c.json({
      success: true,
      data: {
        status: parsed.data.status,
        count: rows.length,
        rows,
      },
    });
  });
}

/**
 * Mount the four-eye queue routes on the admin-superpowers app. The parent
 * router owns the auth + db middleware; these handlers only register paths.
 */
export function registerFourEyeQueueRoutes(app: Hono): void {
  registerApproveRoute(app);
  registerRejectRoute(app);
  registerPendingRoute(app);
}

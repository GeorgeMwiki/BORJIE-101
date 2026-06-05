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
 *   POST /bulk-action                       chat-callable bulk surface
 *   POST /bulk-action/:journalId/approve    LEGACY second-eye approval
 *   POST /approve/:journalId                queue second-eye approval (HIGH)
 *   POST /reject/:journalId                 reject a pending HIGH proposal
 *   GET  /pending                           list pending approvals
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
 *
 * FOUR-EYE QUEUE (ported from BossNyumba migration 0301, retargeted real-
 * estate → mining). The legacy `/bulk-action/:journalId/approve` path
 * stamped `provenance.requires_four_eye` on `undo_journal` only, with no
 * reject / list-pending surface and no DB-level same-actor guard. This file
 * now ALSO records every HIGH-risk proposal in
 * `admin_superpower_pending_approvals` and exposes the generic
 * propose → approve → reject → list_pending queue
 * (`/approve/:journalId`, `/reject/:journalId`, `/pending`). The mining
 * verbs (suspend_licence_holder / reactivate_licence_holder /
 * export_regulator_pack / force_supply_agreement_termination /
 * force_password_reset / bulk_archive_inspection_cases) join the legacy
 * platform verbs in the whitelist; the same-actor guard refuses approval
 * by the proposing admin with a 409 FOUR_EYE_SAME_ACTOR (the
 * `admin_four_eye_distinct_actors_chk` CHECK constraint is the DB safety
 * net).
 *
 * Honest-degraded note: the actual entity-side mutation a queue verb
 * proposes (e.g. the real licence-holder suspension write) is NOT wired —
 * Borjie does not yet expose those admin mutation surfaces. On approval the
 * pending row transitions to `applied` and the verb + target ref are
 * returned (`mutationApplied: false`) so an operator / sweeper carries out
 * the side effect. The legacy `export_regulator_pack` path DOES still build
 * its verifiable bundle on `/bulk-action/:journalId/approve` (below). We
 * never fabricate a mutation that does not exist.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import {
  undoJournal,
  adminSuperpowerPendingApprovals,
  ADMIN_HIGH_RISK_ACTIONS,
  ADMIN_ALL_ACTIONS,
  ADMIN_BULK_ARCHIVE_HIGH_THRESHOLD,
} from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { UserRole } from '../../types/user-role';
import { buildRegulatorPack } from './regulator-pack';
import { fetchRegulatorPackSources } from './regulator-pack-fetch';
import { resolveRegulatorPackSigningSecret } from './regulator-pack-secret';
import { registerFourEyeQueueRoutes } from './superpowers-four-eye-queue';

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
  // ── Legacy admin-platform verbs (provenance-flag flow on undo_journal). ──
  tenant_orgs: ['suspend', 'reactivate', 'export_regulator_pack'],
  intelligence_corpus: ['archive', 'reindex'],
  feature_flags: ['enable', 'disable'],
  killswitch_targets: ['activate'],
  // ── Four-eye QUEUE verbs (ported from BN 0301, retargeted real-estate →
  // mining; recorded in admin_superpower_pending_approvals). ──
  licence_holder: [
    'suspend_licence_holder',
    'reactivate_licence_holder',
    'export_regulator_pack',
  ],
  supply_agreement: ['force_supply_agreement_termination'],
  user: ['force_password_reset'],
  inspection_case: ['bulk_archive_inspection_cases'],
  royalty_invoice: ['bulk_archive_old_royalty_invoices'],
  site: ['bulk_re_tag_sites'],
  announcement_target: ['bulk_send_announcement'],
});

/**
 * Entity types whose HIGH-risk proposals are recorded in the four-eye
 * QUEUE table (`admin_superpower_pending_approvals`) and approved via
 * `/approve/:journalId`. The legacy platform entity types keep their
 * provenance-flag flow and the legacy `/bulk-action/:journalId/approve`
 * path (which still builds the regulator pack on approval).
 */
const QUEUE_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'licence_holder',
  'supply_agreement',
  'user',
  'inspection_case',
  'royalty_invoice',
  'site',
  'announcement_target',
]);

/**
 * HIGH-impact verbs need 4-eye. The legacy platform verbs (suspend /
 * reactivate / activate / export_regulator_pack) plus every mining queue
 * HIGH verb (ADMIN_HIGH_RISK_ACTIONS) cannot land on a single admin's
 * say-so.
 */
const HIGH_IMPACT_ACTIONS: ReadonlySet<string> = new Set<string>([
  'suspend',
  'reactivate',
  'activate',
  'export_regulator_pack',
  ...ADMIN_HIGH_RISK_ACTIONS,
]);

/**
 * Auto-elevate a MEDIUM queue verb to HIGH on volume:
 * bulk_archive_inspection_cases >50 rows is HIGH because mass archival of
 * inspection evidence has a regulator-disclosure impact.
 */
function requiresFourEyeFor(
  action: string,
  ids: ReadonlyArray<string>,
): boolean {
  if (HIGH_IMPACT_ACTIONS.has(action)) return true;
  if (
    action === 'bulk_archive_inspection_cases' &&
    ids.length > ADMIN_BULK_ARCHIVE_HIGH_THRESHOLD
  ) {
    return true;
  }
  return false;
}

const adminBulkSchema = z
  .object({
    entityType: z.enum([
      'tenant_orgs',
      'intelligence_corpus',
      'feature_flags',
      'killswitch_targets',
      'licence_holder',
      'supply_agreement',
      'user',
      'inspection_case',
      'royalty_invoice',
      'site',
      'announcement_target',
    ]),
    ids: z.array(z.string().min(1).max(200)).min(1).max(500),
    action: z.enum([
      // Legacy platform verbs.
      'suspend',
      'reactivate',
      'export_regulator_pack',
      'archive',
      'reindex',
      'enable',
      'disable',
      'activate',
      // Mining queue verbs.
      ...(ADMIN_ALL_ACTIONS as readonly [string, ...string[]]),
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
  const requiresFourEye = requiresFourEyeFor(input.action, input.ids);
  // Queue-entity HIGH proposals ALSO land a row in the four-eye queue table
  // so they can be approved via /approve/:journalId, rejected, and listed.
  const recordsInQueue =
    requiresFourEye && QUEUE_ENTITY_TYPES.has(input.entityType);

  // Append one undo journal entry per id so the admin's Undo chip can
  // reverse the whole batch. For HIGH-impact actions the entry lands
  // as pending_approval and the actual mutation is deferred to the
  // approval endpoint.
  const undoIds: string[] = [];
  const pendingIds: string[] = [];
  const processedIds: string[] = [];
  const failedRows: Array<{ readonly id: string; readonly reason: string }> = [];

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const targetTenantId =
    ((input.payload as Record<string, unknown> | undefined)
      ?.targetTenantId as string | undefined) ?? null;

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
            target_tenant_id: targetTenantId,
          },
        })
        .returning();
      undoIds.push(row.id);
      processedIds.push(id);

      if (recordsInQueue) {
        const [pendingRow] = await db
          .insert(adminSuperpowerPendingApprovals)
          .values({
            journalId: row.id,
            proposedByTenantId: auth.tenantId,
            targetTenantId,
            targetEntityRef: `${input.entityType}:${id}`,
            action: input.action,
            payload: input.payload,
            reason: input.reason,
            status: 'pending',
            proposedByActorId: auth.userId,
            proposedByRole: auth.role,
            expiresAt,
            auditChainIds: [],
          })
          .returning();
        pendingIds.push(pendingRow.id);
      }
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
    queued: recordsInQueue,
    processed: processedIds.length,
    pending: pendingIds.length,
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
      pendingApprovalIds: pendingIds,
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

  // ─── export_regulator_pack — build the verifiable bundle on approval ───
  // The action is stamped in afterState by the bulk-action proposer. When it
  // is the regulator-pack export, the SECOND-eye approval is where we actually
  // assemble + return the artifact (audit bundle + compliance filings +
  // evidence chain), hash-stamped + HMAC-signed. The target tenant is the
  // journal row's entityId (the tenant_orgs id from the bulk payload).
  const afterState =
    (candidate.afterState as Record<string, unknown> | null) ?? {};
  const approvedAction = String(afterState.action ?? '');
  let regulatorPack: ReturnType<typeof buildRegulatorPack> | undefined;
  if (approvedAction === 'export_regulator_pack') {
    try {
      regulatorPack = await buildRegulatorPackForApproval(
        c,
        candidate,
        provenance,
        auth.userId,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      moduleLogger.error('admin-superpowers: regulator-pack build failed', {
        journalId,
        targetTenantId: candidate.entityId,
        approverId: auth.userId,
        error: message,
      });
      // FAIL-CLOSED: do not flip the journal to applied if the regulator
      // artifact could not be produced — the approver must know the export
      // did not happen.
      return c.json(
        {
          success: false,
          error: { code: 'REGULATOR_PACK_FAILED', message },
        },
        500,
      );
    }
  }

  const nextProvenance = {
    ...provenance,
    status: 'applied',
    approved_by_user_id: auth.userId,
    approved_by_role: auth.role,
    approved_at: new Date().toISOString(),
    ...(regulatorPack !== undefined && {
      regulator_pack_hash: regulatorPack.bundleHash,
      regulator_pack_signed: regulatorPack.bundleSignature !== null,
    }),
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
    regulatorPackExported: regulatorPack !== undefined,
  });

  return c.json({
    success: true,
    data: {
      applied: true,
      journalId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      ...(regulatorPack !== undefined && { regulatorPack }),
    },
  });
});

/**
 * Build a regulator pack for an approved `export_regulator_pack` journal row.
 * Resolves the export window (defaults to the trailing 12 months ending now
 * when the proposer did not pin one in provenance), fetches the four corpora
 * for the TARGET tenant (RLS re-bound to that tenant), and returns the
 * hash-stamped + signed bundle.
 */
async function buildRegulatorPackForApproval(
  c: any,
  candidate: { readonly entityId: string; readonly actorId: string },
  provenance: Record<string, unknown>,
  approverUserId: string,
): Promise<ReturnType<typeof buildRegulatorPack>> {
  const db = c.get('db');
  const targetTenantId = candidate.entityId;
  const now = new Date();
  const period = resolveExportPeriod(provenance, now);
  const sources = await fetchRegulatorPackSources(db, targetTenantId, period);
  const signingSecret = resolveRegulatorPackSigningSecret();
  return buildRegulatorPack(
    sources,
    {
      tenantId: targetTenantId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      generatedAt: now.toISOString(),
      requestedBy: candidate.actorId,
      approvedBy: approverUserId,
    },
    signingSecret,
  );
}

/**
 * Resolve the export window from provenance (`period_start` / `period_end`
 * ISO strings stamped by the proposer) or default to the trailing 12 months.
 */
function resolveExportPeriod(
  provenance: Record<string, unknown>,
  now: Date,
): { readonly start: Date; readonly end: Date } {
  const end = parseIsoOr(provenance.period_end, now);
  const defaultStart = new Date(end.getTime());
  defaultStart.setFullYear(defaultStart.getFullYear() - 1);
  const start = parseIsoOr(provenance.period_start, defaultStart);
  return { start, end };
}

function parseIsoOr(value: unknown, fallback: Date): Date {
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

// Register the four-eye QUEUE routes (/approve/:journalId, /reject/:journalId,
// /pending) on the SAME app + base path. Extracted to a sibling module to keep
// this file under the 800-line ceiling; the routes read the same auth + db
// context this router's middleware binds.
registerFourEyeQueueRoutes(app);

export const adminSuperpowersRouter = app;
export default adminSuperpowersRouter;

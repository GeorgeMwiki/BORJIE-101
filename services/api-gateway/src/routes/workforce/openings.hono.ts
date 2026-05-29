/**
 * /api/v1/workforce/openings — HR onboarding chain L-A (issue #193).
 *
 * Workflow:
 *
 *   1. Owner POSTs a job opening (title, description_md, role_required,
 *      count_needed, expires_at, optional siteId).
 *   2. Owner / Mwikila drafts an invitation FROM the opening row via
 *      POST /:id/invitations -> creates a `workforce_invitations` row
 *      with `opening_id` set. The existing invitation activation flow
 *      (workforce/invites.hono.ts -> /activate) takes over.
 *   3. Manager opens the onboarding queue + reviews each activated
 *      candidate. POST /:id/candidates/:userId/review with
 *      `decision = approve | reject` -> flips users.workforce_status
 *      AND decrements the opening's count_needed.
 *   4. When count_needed reaches 0, the opening auto-flips to 'filled'
 *      and the owner cockpit receives a `workforce.shift_event`-shaped
 *      pulse (we re-use that kind for onboarding-fill since the cockpit
 *      already renders it; a dedicated kind is overkill for v1).
 *
 * Tenant isolation: RLS FORCE on workforce_openings + downstream
 * tables (migration 0134). The api-gateway databaseMiddleware sets
 * `app.current_tenant_id` from the JWT.
 *
 * Bilingual: SMS body + push titles are bilingual sw/en per CLAUDE.md.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import {
  users,
  workforceOpenings,
  workforceInvitations,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import {
  reviewCandidate,
  canReviewCandidates,
  describeReviewDecision,
  type CandidateDecision,
} from '../../services/workforce-onboarding/recorder';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('workforce-openings');

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ROLES = ['employee', 'manager'] as const;
const STATUSES = ['open', 'filled', 'closed', 'expired'] as const;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const createOpeningSchema = z.object({
  title: z.string().min(1).max(200),
  descriptionMd: z.string().min(1).max(8000),
  roleRequired: z.enum(ROLES),
  countNeeded: z.number().int().min(1).max(500).default(1),
  assignedSiteId: z.string().uuid().nullish(),
  expiresAt: z.string().datetime().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Audit-chain helper — mirror of routes/workforce/invites.hono.ts
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
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
// Router factory
// ---------------------------------------------------------------------------

export function createWorkforceOpeningsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // ----------------------------------------------------------------
  // POST / — create opening (owner / admin only)
  // ----------------------------------------------------------------
  app.post('/', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !canReviewCandidates(auth.role)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only owners / admins / managers may create openings',
          },
        },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'OPENINGS_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createOpeningSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid body',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const input = parsed.data;

    try {
      const expiresAt = input.expiresAt
        ? new Date(input.expiresAt)
        : new Date(Date.now() + DEFAULT_TTL_MS);

      const [row] = await db
        .insert(workforceOpenings)
        .values({
          tenantId: auth.tenantId,
          createdByUserId: auth.userId,
          title: input.title,
          descriptionMd: input.descriptionMd,
          roleRequired: input.roleRequired,
          countNeeded: input.countNeeded,
          assignedSiteId: input.assignedSiteId ?? null,
          expiresAt,
          status: 'open',
        })
        .returning();

      const chainId = await appendAuditEntry(db, {
        action: 'workforce.opening.create',
        tenantId: auth.tenantId,
        turnId: row.id,
        userId: auth.userId,
        details: {
          openingId: row.id,
          title: row.title,
          roleRequired: row.roleRequired,
          countNeeded: row.countNeeded,
        },
      });

      moduleLogger.info('workforce opening created', {
        evt: 'workforce_opening_created',
        tenantId: auth.tenantId,
        openingId: row.id,
        chainId,
      });

      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'opening create failed';
      moduleLogger.error('workforce opening create failed', {
        evt: 'workforce_opening_create_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'OPENING_CREATE_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // GET / — list openings for the current tenant
  // ----------------------------------------------------------------
  app.get('/', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !canReviewCandidates(auth.role)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'OPENINGS_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    const parsed = listQuerySchema.safeParse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }

    const { status, limit } = parsed.data;
    const conds = [eq(workforceOpenings.tenantId, auth.tenantId)];
    if (status) conds.push(eq(workforceOpenings.status, status));

    try {
      const rows = await db
        .select()
        .from(workforceOpenings)
        .where(and(...conds))
        .orderBy(desc(workforceOpenings.createdAt))
        .limit(Math.min(limit ?? 100, 500));
      return c.json({ success: true, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      moduleLogger.error('workforce opening list failed', {
        evt: 'workforce_opening_list_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'OPENING_LIST_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // POST /:id/candidates/:userId/review — manager approve / reject
  // ----------------------------------------------------------------
  app.post('/:id/candidates/:userId/review', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !canReviewCandidates(auth.role)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'OPENINGS_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }
    const openingId = c.req.param('id');
    const candidateUserId = c.req.param('userId');
    const body = await c.req.json().catch(() => null);
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid body',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const decision: CandidateDecision = parsed.data.decision;

    try {
      const [opening] = await db
        .select()
        .from(workforceOpenings)
        .where(
          and(
            eq(workforceOpenings.tenantId, auth.tenantId),
            eq(workforceOpenings.id, openingId),
          ),
        )
        .limit(1);
      if (!opening) {
        return c.json(
          {
            success: false,
            error: {
              code: 'OPENING_NOT_FOUND',
              message: 'Opening not found',
            },
          },
          404,
        );
      }

      const decisionResult = reviewCandidate({
        currentOpeningStatus: opening.status as
          | 'open'
          | 'filled'
          | 'closed'
          | 'expired',
        currentCountNeeded: opening.countNeeded,
        decision,
      });

      // Flip the user.
      const [updatedUser] = await db
        .update(users)
        .set({ workforceStatus: decisionResult.newUserWorkforceStatus })
        .where(
          and(
            eq(users.tenantId, auth.tenantId),
            eq(users.id, candidateUserId),
          ),
        )
        .returning();

      if (!updatedUser) {
        return c.json(
          {
            success: false,
            error: {
              code: 'CANDIDATE_NOT_FOUND',
              message: 'Candidate user not found in this tenant',
            },
          },
          404,
        );
      }

      // Persist opening transition.
      const [updatedOpening] = await db
        .update(workforceOpenings)
        .set({
          countNeeded: decisionResult.newCountNeeded,
          status: decisionResult.newOpeningStatus,
          closedAt:
            decisionResult.openingFilled ? new Date() : opening.closedAt,
        })
        .where(eq(workforceOpenings.id, openingId))
        .returning();

      const summary = describeReviewDecision(decision);
      const chainId = await appendAuditEntry(db, {
        action: `workforce.candidate.${decision}`,
        tenantId: auth.tenantId,
        turnId: openingId,
        userId: auth.userId,
        details: {
          openingId,
          candidateUserId,
          decision,
          summarySw: summary.sw,
          summaryEn: summary.en,
          newOpeningStatus: decisionResult.newOpeningStatus,
          openingFilled: decisionResult.openingFilled,
          notes: parsed.data.notes ?? null,
        },
      });

      // Owner cockpit pulse on every approve/reject — drives the
      // RT-1 'manager.approved' tile so the owner sees onboarding
      // decisions land in real time.
      publishCockpitEvent({
        kind: 'manager.approved',
        tenantId: auth.tenantId,
        emittedAt: new Date().toISOString(),
        approvalId: chainId,
        subject: `onboarding:${openingId}`,
        approvedBy: auth.userId,
        decision: decision === 'approve' ? 'approve' : 'reject',
      });

      moduleLogger.info('workforce candidate reviewed', {
        evt: 'workforce_candidate_reviewed',
        tenantId: auth.tenantId,
        openingId,
        candidateUserId,
        decision,
        chainId,
        openingFilled: decisionResult.openingFilled,
      });

      return c.json(
        {
          success: true,
          data: {
            opening: updatedOpening,
            candidate: {
              id: updatedUser.id,
              workforceStatus: updatedUser.workforceStatus,
            },
            openingFilled: decisionResult.openingFilled,
            summary,
          },
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'review failed';
      moduleLogger.error('workforce candidate review failed', {
        evt: 'workforce_candidate_review_failed',
        tenantId: auth.tenantId,
        openingId,
        candidateUserId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'CANDIDATE_REVIEW_FAILED', message },
        },
        500,
      );
    }
  });

  return app;
}

export const workforceOpeningsRouter = createWorkforceOpeningsRouter();

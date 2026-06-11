/**
 * /api/v1/owner/org-loop-approvals — the HITL APPROVAL CONSUMER for the
 * self-running-org spine (org-loop).
 *
 * WHY THIS EXISTS
 * ---------------
 * `proposeForApproval` PARKS a HIGH/sovereign run at stage 'report' and
 * briefs the owner through the gated proposal sink — but nothing consumed
 * the owner's decision, so the spine had a one-way HITL gate. This route is
 * the other half: the owner's APPROVE executes the dispatch leg for the
 * already-chosen employee; DISMISS closes the run (status 'closed', stage
 * 'reloop') with a dismissal note. (The sweep-side nag-storm kill lives in
 * the orchestrator: a parked run is skipped with 'awaiting_approval'.)
 *
 * Routes (tenant-scoped via JWT; OWNER / platform-admin only):
 *   POST /:runId/approve  → resume the parked run (assign → deliver → brief)
 *   POST /:runId/dismiss  → close the run with a note (body: { note? })
 *
 * MOUNT (main agent — services/api-gateway/src/index.ts):
 *   import {
 *     orgLoopApprovalsRouter,
 *     registerOrgLoopApprovalActions,
 *   } from './routes/owner/org-loop-approvals.hono';
 *   app.route('/api/v1/owner/org-loop-approvals', orgLoopApprovalsRouter);
 *   // …and inside the org-loop composition block, right after
 *   // `orgLoopOrchestrator = createOrgLoopOrchestrator({...})`:
 *   registerOrgLoopApprovalActions(orgLoopOrchestrator);
 *
 * The stable router resolves the orchestrator PER REQUEST through the
 * registration slot (the spine composes asynchronously after boot) and
 * answers 503 honestly until it is registered. The factory accepts an
 * explicit getter for tests.
 *
 * The dismissal-note default is a locale-neutral TOKEN (never EN prose) so
 * the single-language rule holds on every surface that renders the run.
 * Error messages are generic (no internal reason leak); the precise reason
 * is logged. No `console.*` (pino logger only). Immutable response shaping.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { isPlatformAdmin, UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';
import {
  RESUME_REASON_RUN_NOT_FOUND,
  type OrgLoopDismissOutcome,
  type OrgLoopThreadOutcome,
} from '../../composition/org-loop/org-loop-types';

const moduleLogger = createLogger('owner-org-loop-approvals');

/** Locale-neutral default dismissal token (client renders its own copy). */
const DEFAULT_DISMISS_NOTE = 'dismissed_by_owner';

const DismissBodySchema = z
  .object({ note: z.string().trim().min(1).max(2000).optional() })
  .optional();

// ---------------------------------------------------------------------------
// The minimal action surface the route needs (structural — the composed
// OrgLoopOrchestrator satisfies it; tests inject a stub).
// ---------------------------------------------------------------------------

export interface OrgLoopApprovalActions {
  resumeApprovedRun(
    tenantId: string,
    runId: string,
  ): Promise<OrgLoopThreadOutcome>;
  dismissParkedRun(
    tenantId: string,
    runId: string,
    note: string,
  ): Promise<OrgLoopDismissOutcome>;
}

export interface OrgLoopApprovalsRouterDeps {
  /** Resolve the live orchestrator (null until the spine is composed → 503). */
  readonly getOrchestrator: () => OrgLoopApprovalActions | null;
}

// ---------------------------------------------------------------------------
// Scope guard + uniform error shapes (commitment-governance pattern).
// ---------------------------------------------------------------------------

function isAllowed(role: UserRole): boolean {
  return isPlatformAdmin(role) || role === UserRole.OWNER;
}

type JsonCtx = { json: (b: unknown, s: number) => Response };

function forbidden(c: JsonCtx): Response {
  return c.json(
    {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Org-loop approvals are owner / platform-admin only',
      },
    },
    403,
  );
}

function spineUnavailable(c: JsonCtx): Response {
  return c.json(
    {
      success: false,
      error: {
        code: 'ORG_LOOP_UNAVAILABLE',
        message: 'The org-loop spine is not composed yet',
      },
    },
    503,
  );
}

function runNotFound(c: JsonCtx): Response {
  return c.json(
    {
      success: false,
      error: {
        code: 'RUN_NOT_FOUND',
        message: 'No open org-loop run with that id in your tenant',
      },
    },
    404,
  );
}

function notAwaitingApproval(c: JsonCtx, reason: string): Response {
  return c.json(
    {
      success: false,
      error: {
        code: 'RUN_NOT_AWAITING_APPROVAL',
        message: 'The run is not parked awaiting your approval',
        reason,
      },
    },
    409,
  );
}

function internalError(c: JsonCtx, op: string, detail: string): Response {
  moduleLogger.error('org-loop approval action failed', { op, detail });
  return c.json(
    {
      success: false,
      error: {
        code: 'ORG_LOOP_APPROVAL_FAILED',
        message: 'Could not complete the approval action right now',
      },
    },
    500,
  );
}

// ---------------------------------------------------------------------------
// Router factory.
// ---------------------------------------------------------------------------

export function createOrgLoopApprovalsRouter(
  deps: OrgLoopApprovalsRouterDeps,
): Hono {
  const router = new Hono();
  router.use('*', authMiddleware);

  // ── POST /:runId/approve — execute the parked run's dispatch leg ─────────
  router.post('/:runId/approve', async (c) => {
    const auth = c.get('auth');
    if (!isAllowed(auth.role)) return forbidden(c);
    const orchestrator = deps.getOrchestrator();
    if (!orchestrator) return spineUnavailable(c);
    const runId = c.req.param('runId');
    try {
      const outcome = await orchestrator.resumeApprovedRun(
        auth.tenantId,
        runId,
      );
      if (outcome.kind === 'dispatched') {
        return c.json({
          success: true,
          data: {
            outcome: 'dispatched',
            runId: outcome.runId,
            taskId: outcome.taskId,
            chosenEmployeeId: outcome.chosenEmployeeId,
          },
        });
      }
      if (outcome.kind === 'skipped') {
        return outcome.reason === RESUME_REASON_RUN_NOT_FOUND
          ? runNotFound(c)
          : notAwaitingApproval(c, outcome.reason);
      }
      // 'failed' (the orchestrator never throws) — generic message, log detail.
      const detail = outcome.kind === 'failed' ? outcome.reason : outcome.kind;
      return internalError(c, 'approve', detail);
    } catch (err) {
      return internalError(
        c,
        'approve',
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  // ── POST /:runId/dismiss — close the parked run with a note ──────────────
  router.post('/:runId/dismiss', async (c) => {
    const auth = c.get('auth');
    if (!isAllowed(auth.role)) return forbidden(c);
    const orchestrator = deps.getOrchestrator();
    if (!orchestrator) return spineUnavailable(c);
    const runId = c.req.param('runId');

    // The body is OPTIONAL ({ note? }); a present-but-invalid body is a 400.
    let note = DEFAULT_DISMISS_NOTE;
    const raw = await c.req.text();
    if (raw.trim().length > 0) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_BODY', message: 'Body must be JSON' },
          },
          400,
        );
      }
      const parsed = DismissBodySchema.safeParse(parsedJson);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_BODY', message: 'Invalid dismissal note' },
          },
          400,
        );
      }
      if (parsed.data?.note) note = parsed.data.note;
    }

    try {
      const outcome = await orchestrator.dismissParkedRun(
        auth.tenantId,
        runId,
        note,
      );
      if (outcome.kind === 'dismissed') {
        return c.json({
          success: true,
          data: { outcome: 'dismissed', runId: outcome.runId },
        });
      }
      return outcome.reason === RESUME_REASON_RUN_NOT_FOUND
        ? runNotFound(c)
        : notAwaitingApproval(c, outcome.reason);
    } catch (err) {
      return internalError(
        c,
        'dismiss',
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Late-binding registration + the stable router the index seam mounts
// (living-plan pattern). The spine composes asynchronously after boot, so the
// index registers the orchestrator once it exists; until then → 503.
// ---------------------------------------------------------------------------

let registeredActions: OrgLoopApprovalActions | null = null;

/** Register (or clear) the live orchestrator for the stable router. */
export function registerOrgLoopApprovalActions(
  actions: OrgLoopApprovalActions | null,
): void {
  registeredActions = actions;
}

/** Stable export the index seam mounts at /owner/org-loop-approvals. */
export const orgLoopApprovalsRouter = createOrgLoopApprovalsRouter({
  getOrchestrator: () => registeredActions,
});

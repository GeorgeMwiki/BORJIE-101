/**
 * /api/v1/mining/assignment-planner — assignment-plan preview (Piece M).
 *
 * Wraps the REAL pure-compute `@borjie/workforce-orchestrator` package —
 * specifically `planAssignment()`, which composes the orchestrator's own
 * kernel functions (`deriveRiskTier` + `pickCadence` +
 * `buildFollowupSchedule`) into a side-effect-free preview. NO new tables,
 * NO migrations — the planner is a stateless solver over the request body.
 *
 * WHY THIS ROUTE EXISTS (anti-duplication note):
 *   The orchestrator package held genuinely richer dispatch logic
 *   (risk-tier escalation, HITL gating, follow-up cadence scheduling) that
 *   had ZERO importers — it was built-but-disconnected. This route turns
 *   the lights on for the read-only half of that engine without standing
 *   up the full Drizzle-backed `WorkforceStore` composition that the write
 *   path `assignTask()` requires.
 *
 *   It does NOT duplicate `tasks-suggest.hono.ts`. Those are complementary:
 *     - `tasks-suggest`  : "WHO should I assign this task to?" (ranks
 *                          candidate employees against cert / shift /
 *                          site / fatigue signals).
 *     - `assignment-planner` : "Given a chosen task, WHAT risk tier / HITL
 *                          gate / follow-up cadence applies?" (the dispatch
 *                          plan the orchestrator would commit).
 *   `assignTask()` in the package remains the canonical *write* path; this
 *   surfaces the canonical *preview* path, calling the same kernel
 *   functions so the preview matches the eventual write exactly.
 *
 * Routes:
 *   POST /plan   derive { riskTier, hitlRequired, cadenceKinds, followups,
 *                rationale } from a proposed task (title / description /
 *                priority / riskHint / dueAt / optional cadence override).
 *
 * EVIDENCE / LOCALE: the rationale is returned as strictly single-language
 * EN and SW strings (the caller renders exactly one per active locale — no
 * EN/SW mixing). No currency is rendered by this route.
 *
 * RLS: authMiddleware + databaseMiddleware bind app.current_tenant_id. This
 * route performs NO tenant-table reads (the planner is pure compute over
 * the request body), but it still runs behind auth so only a signed-in
 * tenant member can use the solver, keeping it consistent with every other
 * mining route.
 */

import { Hono } from 'hono';

import {
  PlanAssignmentInputSchema,
  planAssignment,
} from '@borjie/workforce-orchestrator';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-assignment-planner');

export const miningAssignmentPlannerRouter = new Hono();
miningAssignmentPlannerRouter.use('*', authMiddleware);
miningAssignmentPlannerRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /plan — preview the dispatch plan for a proposed assignment.
// ---------------------------------------------------------------------------
miningAssignmentPlannerRouter.post('/plan', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'ASSIGNMENT_PLAN_UNAUTHENTICATED' },
      },
      401,
    );
  }

  const raw = await c.req.json().catch(() => ({}));
  const parsed = PlanAssignmentInputSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }

  try {
    const plan = planAssignment(parsed.data);
    return c.json({ success: true as const, data: { plan } }, 200);
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'assignment_plan_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'ASSIGNMENT_PLAN_FAILED' } },
      500,
    );
  }
});

export default miningAssignmentPlannerRouter;

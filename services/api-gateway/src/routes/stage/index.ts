// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * Stage advisor router — mounted at `/api/v1/stage`.
 *
 * Surfaces the stage-aware capability advisor over HTTP so the SPA +
 * the brain can ask "what stage is this tenant at, what's their
 * playbook, what nudges should fire". Tenant-scoped + audit-logged.
 *
 * Routes:
 *   GET  /current               — current stage + evidence + confidence
 *   GET  /history               — past stage transitions (most recent first)
 *   GET  /playbook              — current playbook with incomplete tasks
 *   GET  /nudges                — active nudges
 *   POST /nudges/:id/dismiss    — dismiss a nudge
 *
 * Wiring: the gateway populates `c.set('services', { stageAdvisor })`
 * once at boot. When the service is unwired (local dev without a db),
 * the routes return a degraded "service unavailable" payload so the
 * SPA can render a graceful empty state.
 */

import { Hono } from 'hono';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { safeInternalError } from '../../utils/safe-error.js';
import type { StageAdvisor } from '@borjie/stage-advisor';

type AnyCtx = any;

function getServices(c: AnyCtx): { stageAdvisor?: StageAdvisor } {
  return (c.get('services') as { stageAdvisor?: StageAdvisor } | undefined) ?? {};
}

function unavailable(c: AnyCtx, reason: string) {
  return c.json(
    {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: reason },
    },
    503,
  );
}

function badRequest(c: AnyCtx, message: string) {
  return c.json(
    { success: false, error: { code: 'BAD_REQUEST', message } },
    400,
  );
}

function missingTenant(c: AnyCtx) {
  return c.json(
    {
      success: false,
      error: { code: 'MISSING_TENANT', message: 'tenantId required' },
    },
    400,
  );
}

export const stageRouter = new Hono();
stageRouter.use('*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────
// GET /current — current stage card with evidence + confidence.
// ─────────────────────────────────────────────────────────────────────

stageRouter.get(
  '/current',
  withSecurityEvents(
    {
      action: 'stage.current',
      resource: 'stage-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const tenantId = c.get('tenantId');
      if (!tenantId) return missingTenant(c);
      const svc = getServices(c).stageAdvisor;
      if (!svc) return unavailable(c, 'stage-advisor not wired');
      try {
        const ctx = await svc.port.getCurrentStage(tenantId);
        if (!ctx) {
          return c.json({
            success: true,
            data: {
              stage: null,
              confidence: 0,
              evidence: [],
              focusAreas: [],
              capabilitiesUnlocked: [],
            },
          });
        }
        return c.json({ success: true, data: ctx });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'STAGE_ERROR',
          fallback: 'stage-advisor failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// GET /history — past stage transitions.
// ─────────────────────────────────────────────────────────────────────

stageRouter.get(
  '/history',
  withSecurityEvents(
    {
      action: 'stage.history',
      resource: 'stage-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const tenantId = c.get('tenantId');
      if (!tenantId) return missingTenant(c);
      const svc = getServices(c).stageAdvisor;
      if (!svc) return unavailable(c, 'stage-advisor not wired');
      try {
        const history = await svc.getHistory(tenantId);
        return c.json({
          success: true,
          data: history,
          meta: { total: history.length },
        });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'STAGE_ERROR',
          fallback: 'stage-advisor failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// GET /playbook — current playbook + next-incomplete tasks.
// ─────────────────────────────────────────────────────────────────────

stageRouter.get(
  '/playbook',
  withSecurityEvents(
    {
      action: 'stage.playbook',
      resource: 'stage-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const tenantId = c.get('tenantId');
      if (!tenantId) return missingTenant(c);
      const svc = getServices(c).stageAdvisor;
      if (!svc) return unavailable(c, 'stage-advisor not wired');
      try {
        const view = await svc.getPlaybookView(tenantId);
        if (!view) {
          return c.json({
            success: true,
            data: {
              stage: null,
              card: null,
              evaluation: null,
            },
          });
        }
        // Strip non-serialisable `completionPredicate` fns out of the
        // playbook before sending. We send the structured eval result
        // (completed bool per task) instead — that's all the UI needs.
        const serialisable = {
          stage: view.stage,
          card: {
            name: view.card.name,
            displayName: view.card.displayName,
            range: view.card.range,
            focusAreas: view.card.focusAreas,
            capabilitiesUnlocked: view.card.capabilitiesUnlocked,
            capabilitiesHidden: view.card.capabilitiesHidden,
            recommendedTabs: view.card.recommendedTabs,
            recommendedReports: view.card.recommendedReports,
            recommendedAdvisors: view.card.recommendedAdvisors,
          },
          evaluation: {
            stage: view.evaluation.stage,
            totalTasks: view.evaluation.totalTasks,
            completedTasks: view.evaluation.completedTasks,
            completionRatio: view.evaluation.completionRatio,
            evaluations: view.evaluation.evaluations.map((e) => ({
              objectiveId: e.objective.id,
              objectiveName: e.objective.name,
              taskId: e.task.id,
              taskName: e.task.name,
              description: e.task.description,
              requiredCapability: e.task.requiredCapability,
              completed: e.completed,
            })),
            nextIncompleteTasks: view.evaluation.nextIncompleteTasks.map(
              (e) => ({
                objectiveId: e.objective.id,
                taskId: e.task.id,
                taskName: e.task.name,
                description: e.task.description,
                requiredCapability: e.task.requiredCapability,
              }),
            ),
          },
        };
        return c.json({ success: true, data: serialisable });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'STAGE_ERROR',
          fallback: 'stage-advisor failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// GET /nudges — active (non-dismissed, within lookback) nudges.
// ─────────────────────────────────────────────────────────────────────

stageRouter.get(
  '/nudges',
  withSecurityEvents(
    {
      action: 'stage.nudges',
      resource: 'stage-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const tenantId = c.get('tenantId');
      if (!tenantId) return missingTenant(c);
      const svc = getServices(c).stageAdvisor;
      if (!svc) return unavailable(c, 'stage-advisor not wired');
      try {
        const lookbackRaw = c.req.query('lookbackDays');
        const lookbackDays =
          lookbackRaw !== undefined && lookbackRaw !== ''
            ? Number(lookbackRaw)
            : undefined;
        if (lookbackDays !== undefined && !Number.isFinite(lookbackDays)) {
          return badRequest(c, 'lookbackDays must be a number');
        }
        const nudges = await svc.generateNudges({
          tenantId,
          ...(lookbackDays !== undefined ? { lookbackDays } : {}),
        });
        return c.json({
          success: true,
          data: nudges,
          meta: { total: nudges.length },
        });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'STAGE_ERROR',
          fallback: 'stage-advisor failed',
        });
      }
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────
// POST /nudges/:id/dismiss — suppress a nudge permanently.
// ─────────────────────────────────────────────────────────────────────

stageRouter.post(
  '/nudges/:id/dismiss',
  withSecurityEvents(
    {
      action: 'stage.nudges.dismiss',
      resource: 'stage-advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const tenantId = c.get('tenantId');
      if (!tenantId) return missingTenant(c);
      const svc = getServices(c).stageAdvisor;
      if (!svc) return unavailable(c, 'stage-advisor not wired');
      const nudgeId = c.req.param('id');
      if (!nudgeId) return badRequest(c, 'nudge id required');
      try {
        await svc.dismissNudge({ tenantId, nudgeId });
        return c.json({ success: true, data: { dismissed: nudgeId } });
      } catch (e) {
        return safeInternalError(c, e, {
          code: 'STAGE_ERROR',
          fallback: 'stage-advisor failed',
        });
      }
    },
  ),
);

export default stageRouter;

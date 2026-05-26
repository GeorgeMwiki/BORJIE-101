/**
 * Interactive Reports API Routes (NEW 17)
 *
 *   GET  /                                       → list versions for the tenant
 *   GET  /:id/interactive                        → latest interactive version
 *                                                  for a report instance id
 *   POST /:id/action-plans/:aid/ack              → acknowledge an action plan
 *                                                  (requires InteractiveReportService
 *                                                  to be bound)
 *
 * GET paths read `interactive_report_versions` directly via the
 * composition-root Drizzle client so they return real rows without
 * requiring the full `InteractiveReportService` (which needs storage +
 * html-generator + action-plan handler) to be wired.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import {
  interactiveReportVersions,
  interactiveReportActionAcks,
} from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

const AckBodySchema = z.object({
  actionKind: z
    .enum([
      'create_work_order',
      'create_approval_request',
      'acknowledge',
      'external_link',
    ])
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error:
        'Interactive reports database not configured — DATABASE_URL unset',
    },
    503
  );
}

// GET / — list all interactive-report versions for the tenant.
app.get('/', async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const rows = await db
    .select()
    .from(interactiveReportVersions)
    .where(eq(interactiveReportVersions.tenantId, tenantId))
    .orderBy(desc(interactiveReportVersions.generatedAt))
    .limit(100);
  return c.json({ success: true, data: rows });
});

// GET /:id/interactive — latest version for a report instance
app.get('/:id/interactive', async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const reportInstanceId = c.req.param('id');
  const rows = await db
    .select()
    .from(interactiveReportVersions)
    .where(
      and(
        eq(interactiveReportVersions.tenantId, tenantId),
        eq(interactiveReportVersions.reportInstanceId, reportInstanceId)
      )
    )
    .orderBy(desc(interactiveReportVersions.version))
    .limit(1);
  if (!rows[0]) {
    return c.json(
      { success: false, error: 'No interactive report version found' },
      404
    );
  }
  return c.json({ success: true, data: rows[0] });
});

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * POST /:id/action-plans/:aid/ack
 *
 * Acknowledge an action plan on an interactive report. When the full
 * `InteractiveReportService` is bound we delegate so its action-plan
 * handler (which maps plan.action.kind → create_work_order, etc.) runs.
 * Otherwise we fall back to persisting the ack directly + emitting an
 * `ActionPlanAcknowledged` event so a downstream subscriber can create
 * the work order / approval request asynchronously.
 */
app.post(
  '/:id/action-plans/:aid/ack',
  zValidator('json', AckBodySchema),
  withSecurityEvents({ action: 'interactive-report.create', resource: 'interactive-report', severity: 'info' }, async (c: any) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const interactiveReportVersionId = c.req.param('id');
    const actionPlanId = c.req.param('aid');
    const body = c.req.valid('json');
    const service = c.get('interactiveReportService');
    const services = c.get('services');
    const db = services?.db;

    // Prefer the rich service when bound.
    if (service) {
      try {
        const result = await service.acknowledge({
          tenantId,
          interactiveReportVersionId,
          actionPlanId,
          acknowledgedBy: userId,
          metadata: body.metadata ?? {},
        });
        return c.json({ success: true, data: result });
      } catch (error: any) {
        const message =
          error instanceof Error ? error.message : 'Acknowledgement failed';
        const code = error?.code ?? 'ACK_FAILED';
        const status = code === 'NOT_FOUND' ? 404 : 400;
        return c.json({ success: false, error: { code, message } }, status);
      }
    }

    // Fallback: write the ack row + emit the event.
    if (!db) {
      return c.json(
        {
          success: false,
          error:
            'Interactive reports database not configured — DATABASE_URL unset',
        },
        503
      );
    }

    // Load the version (enforces tenant isolation).
    const [version] = await db
      .select()
      .from(interactiveReportVersions)
      .where(
        and(
          eq(interactiveReportVersions.id, interactiveReportVersionId),
          eq(interactiveReportVersions.tenantId, tenantId)
        )
      )
      .limit(1);
    if (!version) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Interactive report version not found',
          },
        },
        404
      );
    }

    // Validate the action plan exists on the version. actionPlans is jsonb
    // so the shape is structurally-typed, not FK-enforced.
    const plans = Array.isArray(version.actionPlans)
      ? (version.actionPlans as any[])
      : [];
    const plan = plans.find((p: any) => p?.id === actionPlanId);
    if (!plan) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ACTION_PLAN_NOT_FOUND',
            message: 'Action plan not found on this report version',
          },
        },
        404
      );
    }

    // Determine resolution from plan.action.kind (falls back to 'acknowledge').
    const actionKind: string =
      body.actionKind ||
      plan?.action?.kind ||
      (plan?.createsWorkOrder ? 'create_work_order' : 'acknowledge');
    const resolution =
      actionKind === 'create_work_order'
        ? 'work_order_pending'
        : actionKind === 'create_approval_request'
        ? 'approval_pending'
        : 'acknowledged';

    const now = new Date();
    const ackId = newId('ack');
    try {
      await db.insert(interactiveReportActionAcks).values({
        id: ackId,
        tenantId,
        interactiveReportVersionId: version.id,
        actionPlanId,
        resolution,
        resolutionRefId: null,
        acknowledgedBy: userId,
        acknowledgedAt: now,
        metadata: body.metadata ?? {},
      });
    } catch (error) {
      return routeCatch(c, error, {
        code: 'PERSIST_FAILED',
        status: 500,
        fallback: 'Persist failed',
      });
    }

    // Emit the event so a subscriber can handle work-order creation.
    try {
      await services.eventBus?.publish({
        event: {
          eventId: newId('evt'),
          eventType: 'ActionPlanAcknowledged',
          timestamp: now.toISOString(),
          tenantId,
          correlationId: newId('cor'),
          causationId: null,
          metadata: {},
          payload: {
            ackId,
            interactiveReportVersionId: version.id,
            actionPlanId,
            actionKind,
            plan,
            acknowledgedBy: userId,
            createsWorkOrder: Boolean(plan?.createsWorkOrder || actionKind === 'create_work_order'),
          },
        } as any,
        version: 1,
        aggregateId: version.id,
        aggregateType: 'InteractiveReportVersion',
      });
    } catch (_e) {
      // Event publish is never allowed to break the ack response.
    }

    return c.json(
      {
        success: true,
        data: {
          ackId,
          resolution,
          resolutionRefId: null,
          workerWillProcess: resolution !== 'acknowledged',
        },
      },
      202
    );
  })
);

export default app;

/**
 * Organizational Awareness router.
 *
 * Mounted at `/api/v1/org`. Every endpoint is tenant-scoped via the shared
 * `authMiddleware`; admin-only endpoints gate on TENANT_ADMIN / SUPER_ADMIN.
 *
 *   GET  /org/process-stats/:kind         — stats for a process kind
 *   GET  /org/bottlenecks                 — current open bottlenecks
 *   GET  /org/improvements                — improvement report (baseline diff)
 *   POST /org/snapshot                    — manually trigger a metric snapshot
 *   POST /org/query                       — "talk to your organization"
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { safeInternalError } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
type AnyCtx = any;

function getOrg(c: AnyCtx) {
  const services = c.get('services') ?? {};
  return services.orgAwareness ?? null;
}

function notImplemented(c: AnyCtx) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Org-awareness not wired into api-gateway context',
      },
    },
    503,
  );
}

function badRequest(c: AnyCtx, message: string) {
  return c.json(
    {
      success: false,
      error: { code: 'BAD_REQUEST', message },
    },
    400,
  );
}

function internalError(c: AnyCtx, err: unknown) {
  // Wave 19 Agent H+I: scrub raw messages in prod; dev keeps detail.
  return safeInternalError(c, err, {
    code: 'INTERNAL_ERROR',
    fallback: 'Internal server error',
  });
}

const SNAPSHOT_METRICS = [
  'occupancy_rate',
  'arrears_ratio',
  'avg_days_to_collect',
  'avg_maintenance_resolution_hours',
  'renewal_rate',
  'avg_vacancy_duration_days',
  'compliance_breach_count',
  'avg_lease_drafting_hours',
  'operator_hours_saved_estimate',
] as const;

const SnapshotInputSchema = z.object({
  metric: z.enum(SNAPSHOT_METRICS),
  periodKind: z.enum(['weekly', 'monthly']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  value: z.number().finite(),
  sampleSize: z.number().int().nonnegative().optional(),
  confidenceLow: z.number().finite().optional(),
  confidenceHigh: z.number().finite().optional(),
  isBaseline: z.boolean().optional(),
  evidence: z.record(z.unknown()).optional(),
});

const QueryInputSchema = z.object({
  question: z.string().min(1).max(500),
});

const VALID_PROCESS_KINDS = new Set([
  'maintenance_case',
  'lease_renewal',
  'arrears_case',
  'payment_reconcile',
  'approval_decision',
  'tender_bid',
  'inspection',
  'letter_generation',
  'training_completion',
]);

const app = new Hono();
app.use('*', authMiddleware);

app.get('/process-stats/:kind', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const org = getOrg(c);
  if (!org) return notImplemented(c);
  const kind = c.req.param('kind');
  if (!VALID_PROCESS_KINDS.has(kind)) {
    return badRequest(c, `Unknown process kind: ${kind}`);
  }
  try {
    const stats = await org.miner.getProcessStats(auth.tenantId, kind);
    return c.json({ success: true, data: stats });
  } catch (e) {
    return internalError(c, e);
  }
});

app.get('/bottlenecks', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const org = getOrg(c);
  if (!org) return notImplemented(c);
  try {
    const rows = await org.bottleneckStore.listOpen(auth.tenantId);
    return c.json({ success: true, data: rows });
  } catch (e) {
    return internalError(c, e);
  }
});

app.get('/improvements', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const org = getOrg(c);
  if (!org) return notImplemented(c);
  const baselineParam = c.req.query('baseline');
  const baseline =
    baselineParam === 'borjie_start'
      ? 'borjie_start'
      : baselineParam === 'oldest'
        ? 'oldest'
        : undefined;
  try {
    const report = await org.improvementTracker.getImprovementReport(
      auth.tenantId,
      baseline ? { baseline } : {},
    );
    return c.json({ success: true, data: report });
  } catch (e) {
    return internalError(c, e);
  }
});

app.post(
  '/snapshot',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  withSecurityEvents({ action: 'org-awareness.create', resource: 'org-awareness', severity: 'info' }, async (c: AnyCtx) => {
    const auth = c.get('auth');
    const org = getOrg(c);
    if (!org) return notImplemented(c);
    const body = await c.req.json().catch(() => ({}));
    const parsed = SnapshotInputSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(c, parsed.error.message);
    }
    try {
      const saved = await org.improvementTracker.recordSnapshot({
        tenantId: auth.tenantId,
        metric: parsed.data.metric,
        periodKind: parsed.data.periodKind,
        periodStart: new Date(parsed.data.periodStart),
        periodEnd: new Date(parsed.data.periodEnd),
        value: parsed.data.value,
        sampleSize: parsed.data.sampleSize,
        confidenceLow: parsed.data.confidenceLow,
        confidenceHigh: parsed.data.confidenceHigh,
        isBaseline: parsed.data.isBaseline,
        evidence: parsed.data.evidence,
      });
      return c.json({ success: true, data: saved }, 201);
    } catch (e) {
      return internalError(c, e);
    }
  }),
);

app.post(
  '/query',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  withSecurityEvents({ action: 'org-awareness.create', resource: 'org-awareness', severity: 'info' }, async (c: AnyCtx) => {
    const auth = c.get('auth');
    const org = getOrg(c);
    if (!org) return notImplemented(c);
    const body = await c.req.json().catch(() => ({}));
    const parsed = QueryInputSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(c, parsed.error.message);
    }
    try {
      const answer = await org.queryService.answer({
        tenantId: auth.tenantId,
        question: parsed.data.question,
      });
      return c.json({ success: true, data: answer });
    } catch (e) {
      return internalError(c, e);
    }
  }),
);

export default app;

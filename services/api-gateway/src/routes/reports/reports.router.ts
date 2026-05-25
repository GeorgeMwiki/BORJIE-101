// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * `/api/v1/strategic-reports` — PhD-grade strategic report API.
 *
 * Routes:
 *   POST /v1/strategic-reports                  — start a report job; returns
 *                                                 { jobId, status, estimatedSeconds }
 *   GET  /v1/strategic-reports/:jobId            — status + result + download
 *   GET  /v1/strategic-reports                   — list past reports for the org
 *                                                 (?orgId=&type=&since=&until=&limit=)
 *   POST /v1/strategic-reports/:jobId/regenerate — re-run with same spec
 *
 * Auth: required on every route. Tenant + actor are pulled from the
 * JWT — never from the body — so a client cannot generate a report
 * "on behalf of" another tenant by smuggling an `actorId` field.
 *
 * Wrapping: every state-changing route is wrapped in `withSecurityEvents`
 * (Hono variant, per ask.router.ts) for the SOC 2 CC7.2 audit trail.
 *
 * Rate limiting: 5 req/min per (user, endpoint). Renders are expensive
 * so the ceiling is tighter than the universal-ask 10/min ceiling.
 *
 * Concurrent-agent boundaries — we DO NOT touch:
 *   - `routes/reports.hono.ts`  (legacy monthly-report endpoints
 *     mounted at `/reports/financial`, `/reports/occupancy`, etc.)
 *   - any other route owned by other in-flight phases (see brief).
 *
 * Path choice: we mount at `/strategic-reports` to avoid colliding with
 * the existing `/reports/financial` / `/reports/occupancy` legacy
 * surface. Spec calls for `/v1/reports` — the legacy surface owns
 * that prefix today, and the parent index.ts can rename later when
 * the legacy router is retired.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import { ReportSpecSchema, type ReportSpec, type ReportType, type PersistedReport } from '@borjie/strategic-reports';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { getEngine } from './engine-wiring.js';
import { reportsRateLimit } from './reports-rate-limit.js';

type AnyCtx = any;

const StartReportBodySchema = z.object({
  spec: ReportSpecSchema.partial({ actorId: true }),
});

const ListQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  until: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// In-memory job index — production wiring routes through the
// strategic_report_history table + a worker queue. For the API
// boundary we keep a tiny in-memory index so the GET /:jobId path
// works without a DB.
interface JobRecord {
  readonly jobId: string;
  readonly orgId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly type: ReportType;
  readonly spec: ReportSpec;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  result?: PersistedReport;
  warnings?: ReadonlyArray<string>;
  createdAtIso: string;
}

const jobIndex = new Map<string, JobRecord>();

/** Reset for tests — drops every in-memory job entry. */
export function _resetJobIndexForTests(): void {
  jobIndex.clear();
}

const router = new Hono();

// Auth gate on every route.
router.use('*', authMiddleware);

// ─── helpers ────────────────────────────────────────────────────────
function engineNotConfigured(c: AnyCtx) {
  return c.json(
    {
      success: false,
      error: {
        code: 'ENGINE_NOT_CONFIGURED',
        message: 'Strategic-report engine is not wired in this environment.',
      },
    },
    503,
  );
}

function newJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Run a job INLINE (the production path enqueues to a worker).
 * Inline execution keeps the API contract honest in tests + dev
 * without forcing the test harness to spin up a worker.
 */
async function runInline(jobId: string): Promise<void> {
  const job = jobIndex.get(jobId);
  if (!job) return;
  const engine = getEngine();
  if (!engine) {
    job.status = 'failed';
    job.errorCode = 'ENGINE_NOT_CONFIGURED';
    job.errorMessage = 'Strategic-report engine is not wired.';
    return;
  }
  job.status = 'rendering';
  const result = await engine.generateReport(job.spec);
  if (!result.ok) {
    job.status = 'failed';
    job.errorCode = result.error.code;
    job.errorMessage = result.error.message;
    return;
  }
  job.status = 'completed';
  job.result = result.value.persisted;
  job.warnings = result.value.warnings;
}

// ─── POST / — start a report job ────────────────────────────────────
router.post(
  '/',
  reportsRateLimit({ endpoint: 'reports.start', maxPerMinute: 5 }),
  withSecurityEvents(
    {
      action: 'strategic-reports.start',
      resource: 'strategic-reports',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) {
        return c.json(
          { success: false, error: { code: 'UNAUTHORIZED', message: 'missing auth context' } },
          401,
        );
      }
      const engine = getEngine();
      if (!engine) return engineNotConfigured(c);

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          { success: false, error: { code: 'INVALID_JSON', message: 'invalid JSON body' } },
          400,
        );
      }
      const parsed = StartReportBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } },
          400,
        );
      }
      // Force the actor to the JWT identity — never trust the body.
      const spec: ReportSpec = {
        ...parsed.data.spec,
        actorId: auth.userId,
      } as ReportSpec;

      // Re-validate after the forced actorId injection.
      const reparsed = ReportSpecSchema.safeParse(spec);
      if (!reparsed.success) {
        return c.json(
          { success: false, error: { code: 'BAD_REQUEST', message: reparsed.error.message } },
          400,
        );
      }

      // Tenant-scope enforcement: the spec's orgId must match the
      // caller's tenantId. We allow the same JWT to render reports
      // for any property/deal/tenant inside its tenant, but not
      // across tenants.
      const specOrgId = orgIdFromSpec(reparsed.data);
      if (specOrgId !== auth.tenantId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'spec.scope.orgId does not match caller tenant',
            },
          },
          403,
        );
      }

      const jobId = newJobId();
      const record: JobRecord = {
        jobId,
        orgId: specOrgId,
        tenantId: auth.tenantId,
        actorId: auth.userId,
        type: reparsed.data.type,
        spec: reparsed.data,
        status: 'queued',
        createdAtIso: new Date().toISOString(),
      };
      jobIndex.set(jobId, record);
      // Inline execution — the production path enqueues. For the API
      // contract surface we run synchronously inside the handler so the
      // very next GET /:jobId reflects the final status. This keeps the
      // 202-style API honest without coupling the test harness to a
      // worker.
      await runInline(jobId);
      return c.json(
        {
          success: true,
          data: {
            jobId,
            status: record.status,
            estimatedSeconds: 30,
          },
        },
        202,
      );
    },
  ),
);

// ─── GET /:jobId — fetch status + result ────────────────────────────
router.get('/:jobId', async (c: AnyCtx) => {
  const auth = c.get('auth');
  if (!auth?.tenantId) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'missing auth context' } },
      401,
    );
  }
  const jobId = c.req.param('jobId');
  const job = jobIndex.get(jobId);
  if (!job) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'job not found' } },
      404,
    );
  }
  if (job.tenantId !== auth.tenantId) {
    // Hide the existence of cross-tenant jobs — 404, not 403.
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'job not found' } },
      404,
    );
  }
  const downloadUrl =
    job.result && job.result.artifacts.length > 0
      ? `/api/v1/strategic-reports/${jobId}/download`
      : null;
  return c.json({
    success: true,
    data: {
      jobId: job.jobId,
      status: job.status,
      type: job.type,
      createdAtIso: job.createdAtIso,
      ...(job.errorCode ? { errorCode: job.errorCode } : {}),
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      ...(job.warnings ? { warnings: job.warnings } : {}),
      ...(job.result
        ? {
            report: {
              reportId: job.result.reportId,
              type: job.result.type,
              title: job.result.report.title,
              executiveSummary: job.result.report.executiveSummary,
              sectionCount: job.result.report.sections.length,
              citationCount: job.result.report.citations.length,
              actionPlanCount: job.result.report.actionPlan.length,
            },
            downloadUrl,
          }
        : {}),
    },
  });
});

// ─── GET / — list past reports for the org ──────────────────────────
router.get('/', async (c: AnyCtx) => {
  const auth = c.get('auth');
  if (!auth?.tenantId) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'missing auth context' } },
      401,
    );
  }
  const parsed = ListQuerySchema.safeParse({
    orgId: c.req.query('orgId'),
    type: c.req.query('type'),
    since: c.req.query('since'),
    until: c.req.query('until'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } },
      400,
    );
  }
  // Tenant-scope enforcement: ignore the body's orgId and use the JWT's
  // tenantId. The query orgId is accepted for symmetry with future
  // multi-org clients but must match the caller's tenantId.
  const orgIdFilter = parsed.data.orgId ?? auth.tenantId;
  if (orgIdFilter !== auth.tenantId) {
    return c.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'cannot list across tenants' } },
      403,
    );
  }
  const since = parsed.data.since ? new Date(parsed.data.since).getTime() : 0;
  const until = parsed.data.until ? new Date(parsed.data.until).getTime() : Number.POSITIVE_INFINITY;
  const items = Array.from(jobIndex.values())
    .filter((j) => j.tenantId === auth.tenantId)
    .filter((j) => (parsed.data.type ? j.type === parsed.data.type : true))
    .filter((j) => {
      const t = new Date(j.createdAtIso).getTime();
      return t >= since && t <= until;
    })
    .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
    .slice(0, parsed.data.limit ?? 50)
    .map((j) => ({
      jobId: j.jobId,
      type: j.type,
      status: j.status,
      createdAtIso: j.createdAtIso,
      ...(j.result
        ? {
            reportId: j.result.reportId,
            title: j.result.report.title,
          }
        : {}),
    }));
  return c.json({ success: true, data: { items, total: items.length } });
});

// ─── POST /:jobId/regenerate — re-run with the same spec ────────────
router.post(
  '/:jobId/regenerate',
  reportsRateLimit({ endpoint: 'reports.regenerate', maxPerMinute: 5 }),
  withSecurityEvents(
    {
      action: 'strategic-reports.regenerate',
      resource: 'strategic-reports',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) {
        return c.json(
          { success: false, error: { code: 'UNAUTHORIZED', message: 'missing auth context' } },
          401,
        );
      }
      const engine = getEngine();
      if (!engine) return engineNotConfigured(c);

      const sourceJobId = c.req.param('jobId');
      const source = jobIndex.get(sourceJobId);
      if (!source) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'source job not found' } },
          404,
        );
      }
      if (source.tenantId !== auth.tenantId) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'source job not found' } },
          404,
        );
      }
      const jobId = newJobId();
      // The regenerate path keeps the original spec but re-stamps the
      // actor to the regenerator (audit-trail truthfulness).
      const spec: ReportSpec = { ...source.spec, actorId: auth.userId };
      const record: JobRecord = {
        jobId,
        orgId: source.orgId,
        tenantId: source.tenantId,
        actorId: auth.userId,
        type: source.type,
        spec,
        status: 'queued',
        createdAtIso: new Date().toISOString(),
      };
      jobIndex.set(jobId, record);
      await runInline(jobId);
      return c.json(
        {
          success: true,
          data: {
            jobId,
            sourceJobId,
            status: record.status,
            estimatedSeconds: 30,
          },
        },
        202,
      );
    },
  ),
);

function orgIdFromSpec(spec: ReportSpec): string {
  switch (spec.scope.kind) {
    case 'tenant':
    case 'property':
    case 'deal':
    case 'portfolio':
      return spec.scope.orgId;
  }
}

export default router;

/**
 * DSAR (Data-Subject Access Request) HTTP surface.
 *
 * GDPR Art. 20 + Tanzania PDPA s.27 implementation. Mounted at
 * `/api/v1/dsar`. Three endpoints:
 *
 *   GET  /api/v1/dsar/:subjectId/export   — download bundle (attachment)
 *   GET  /api/v1/dsar/:subjectId/preview  — admin review (inline JSON)
 *   POST /api/v1/dsar/:subjectId/rtbf     — schedule right-to-be-forgotten
 *
 * Authorisation
 * ─────────────
 * Admin roles (SUPER_ADMIN / ADMIN / TENANT_ADMIN) can request any
 * subject's bundle inside their tenant. A non-admin caller MAY request
 * THEIR OWN bundle (subject-self) iff the JWT email or userId matches
 * the :subjectId path param. Cross-subject reads by non-admins are 403.
 *
 * Rate limiting
 * ─────────────
 * Per-tenant in-memory bucket: 3 exports / hour. RTBF + preview are
 * NOT rate-limited (preview is the read-mostly admin path; RTBF is a
 * legal channel that shouldn't be rate-limited at all). Distributed
 * deployments should swap the in-memory bucket for the Redis limiter
 * in a follow-up (tracked in #33).
 *
 * Audit
 * ─────
 * Every export, preview, and RTBF emits a `dsar.*` audit event via
 * the shared event bus so the audit-trail surface (Wave 27 Agent C)
 * picks it up.
 */

// head-briefing / tenant-branding routers).

import { Hono } from 'hono';
import {
  compileDsar,
  createEmptyDsarDataSource,
  createNoopClassificationLookup,
  type DsarBundle,
  type DsarDataSource,
  type DsarClassificationLookup,
  type DsarRtbfExecutor,
  type RtbfExecutionReport,
} from '@borjie/ai-copilot';
import { authMiddleware } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import {
  rateLimiter as sharedRateLimiter,
  rateLimitStore as sharedRateLimitStore,
} from '../middleware/rate-limiter';

import { withSecurityEvents } from '@borjie/observability';
// ─────────────────────────────────────────────────────────────────────
// Rate-limit bucket — 3 exports per tenant per hour. Bug fix
// A-BUG-DEEP #2: previously held in a router-local Map; now backed by
// the shared `rateLimiter` (same store as `perUserRateLimit`) so the
// Redis adapter swap-in lands in one place.
// ─────────────────────────────────────────────────────────────────────

const EXPORT_RATE_LIMIT = Object.freeze({
  windowMs: 60 * 60 * 1000,
  maxRequests: 3,
});

const EXPORT_RATE_CONFIG = {
  maxRequests: EXPORT_RATE_LIMIT.maxRequests,
  windowSizeSeconds: Math.floor(EXPORT_RATE_LIMIT.windowMs / 1000),
} as const;

function exportRateKey(tenantId: string): string {
  return `dsar:export:${tenantId}`;
}

function rateLimitExport(tenantId: string): {
  ok: boolean;
  remaining: number;
  resetAt: number;
} {
  const result = sharedRateLimiter.check(exportRateKey(tenantId), EXPORT_RATE_CONFIG);
  return {
    ok: result.allowed,
    remaining: result.remaining,
    resetAt: result.reset,
  };
}

/** Test seam — empties the bucket between tests. */
export function _resetExportRateBucketForTests(): void {
  // The shared store is keyed; clear our slice rather than the whole map.
  // Iterate over store keys via the delete API to avoid leaking access
  // to unrelated test fixtures.
  // We don't have a prefix-scan; rely on the well-known key shape.
  // Tests only ever rate-limit one or two tenants per case.
  // The `_storeForTests` accessor isn't exported, so we just delete the
  // common test tenants we know about + a wildcard clear via internal API:
  (sharedRateLimitStore as unknown as { store: Map<string, unknown> }).store.forEach(
    (_value, key) => {
      if (key.startsWith('dsar:export:')) {
        (sharedRateLimitStore as unknown as { store: Map<string, unknown> }).store.delete(key);
      }
    },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Authorization helpers — admin OR matching subject.
// ─────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TENANT_ADMIN,
]);

function isAdminRole(role: UserRole | undefined): boolean {
  if (!role) return false;
  return ADMIN_ROLES.has(role);
}

/**
 * RTBF is more restrictive than export: TENANT_ADMIN can NOT trigger
 * erasure. Only platform admins (SUPER_ADMIN / ADMIN) may invoke it.
 * The legal reasoning — tenant admins might be the data controller
 * but the platform is the data processor, and erasure of financial /
 * audit records needs platform-level review. Subjects themselves
 * CANNOT trigger their own RTBF (per legal-team guidance) — admins
 * must approve.
 */
const RTBF_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

function isRtbfAdminRole(role: UserRole | undefined): boolean {
  if (!role) return false;
  return RTBF_ADMIN_ROLES.has(role);
}

function isSubjectSelf(
  auth: { userId?: string; tenantId?: string; email?: string },
  subjectId: string,
  jwtEmail: string | undefined,
): boolean {
  if (!subjectId) return false;
  if (auth.userId && auth.userId === subjectId) return true;
  if (jwtEmail && jwtEmail === subjectId) return true;
  return false;
}

function forbidden(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this subject',
      },
    },
    403,
  );
}

function badRequest(c: any, message: string) {
  return c.json(
    {
      success: false,
      error: { code: 'VALIDATION', message },
    },
    400,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dependency resolution — pull data source + classification lookup from
// the service registry. Each is optional; we degrade to the compiler's
// safe defaults when a slot is missing so the bundle is at least shaped.
// ─────────────────────────────────────────────────────────────────────

function resolveDeps(c: any): {
  dataSource: DsarDataSource;
  classifications: DsarClassificationLookup;
} {
  const services = (c.get('services') ?? {}) as {
    dsarDataSource?: DsarDataSource;
    dsarClassifications?: DsarClassificationLookup;
  };
  return {
    dataSource: services.dsarDataSource ?? createEmptyDsarDataSource(),
    classifications:
      services.dsarClassifications ?? createNoopClassificationLookup(),
  };
}

function resolveRtbfExecutor(c: any): DsarRtbfExecutor | null {
  const services = (c.get('services') ?? {}) as {
    dsarRtbfExecutor?: DsarRtbfExecutor | null;
  };
  return services.dsarRtbfExecutor ?? null;
}

async function emitAudit(
  c: any,
  eventType: 'dsar.export' | 'dsar.preview' | 'dsar.rtbf' | 'dsar.rtbf.executed',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const services = (c.get('services') ?? {}) as {
      eventBus?: {
        publish: (envelope: unknown) => Promise<void> | void;
      };
    };
    const bus = services.eventBus;
    if (!bus || typeof bus.publish !== 'function') return;
    // Bug fix A-BUG-DEEP #11: prefer crypto.randomUUID for event IDs.
    const safeId = (() => {
      const cryptoApi =
        (typeof globalThis !== 'undefined' &&
          (globalThis as { crypto?: { randomUUID?: () => string } }).crypto) ||
        undefined;
      if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
      // eslint-disable-next-line no-restricted-syntax
      return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    })();
    await bus.publish({
      event: {
        eventId: `dsar_${safeId}`,
        eventType,
        timestamp: new Date().toISOString(),
        tenantId: payload.tenantId ?? 'unknown',
        correlationId: c.get('requestId') ?? `dsar_${Date.now()}`,
        causationId: null,
        metadata: {},
        payload,
      },
      version: 1,
      aggregateId: String(payload.subjectId ?? 'unknown'),
      aggregateType: 'DataSubjectAccessRequest',
    });
  } catch {
    // Audit emission is non-fatal — never break the user request.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

export interface CreateDsarRouterOptions {
  /** Optional injected clock — used by tests for deterministic timestamps. */
  readonly now?: () => Date;
}

export function createDsarRouter(opts: CreateDsarRouterOptions = {}): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  const compileForRequest = async (
    c: any,
    subjectId: string,
  ): Promise<DsarBundle> => {
    const { dataSource, classifications } = resolveDeps(c);
    return compileDsar(
      { subjectId },
      {
        dataSource,
        classifications,
        ...(opts.now ? { now: opts.now } : {}),
      },
    );
  };

  // ───────────────────────────────────────────────────────────────────
  // GET /:subjectId/export — download bundle as JSON attachment
  // ───────────────────────────────────────────────────────────────────
  app.get('/:subjectId/export', async (c: any) => {
    const subjectId = c.req.param('subjectId');
    if (!subjectId || subjectId.trim().length === 0) {
      return badRequest(c, 'subjectId is required');
    }
    const auth = c.get('auth') ?? {};
    const jwtEmail = (auth as { email?: string }).email;

    const admin = isAdminRole(auth.role);
    const self = isSubjectSelf(auth, subjectId, jwtEmail);
    if (!admin && !self) return forbidden(c);

    // Rate-limit per tenant. Admin OR subject-self both consume the
    // same bucket so a tenant can't bypass via subject-self runs.
    const tenantId = auth.tenantId ?? 'unknown';
    const limit = rateLimitExport(tenantId);
    if (!limit.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `DSAR exports limited to ${EXPORT_RATE_LIMIT.maxRequests} per hour per tenant`,
            retryAfter: Math.max(0, Math.ceil((limit.resetAt - Date.now()) / 1000)),
          },
        },
        429,
      );
    }

    try {
      const bundle = await compileForRequest(c, subjectId);
      const tableCount = Object.keys(bundle.tables).length;
      await emitAudit(c, 'dsar.export', {
        subjectId,
        requestedBy: auth.userId,
        tenantId,
        tableCount,
      });
      const filename = `dsar-${subjectId.replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}.json`;
      return c.body(JSON.stringify(bundle, null, 2), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-RateLimit-Remaining': String(limit.remaining),
      });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'DSAR_EXPORT_FAILED',
        status: 500,
        fallback: 'Failed to compile DSAR bundle',
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /:subjectId/preview — admin review, inline JSON (no download)
  // ───────────────────────────────────────────────────────────────────
  app.get('/:subjectId/preview', async (c: any) => {
    const subjectId = c.req.param('subjectId');
    if (!subjectId || subjectId.trim().length === 0) {
      return badRequest(c, 'subjectId is required');
    }
    const auth = c.get('auth') ?? {};
    const jwtEmail = (auth as { email?: string }).email;

    const admin = isAdminRole(auth.role);
    const self = isSubjectSelf(auth, subjectId, jwtEmail);
    if (!admin && !self) return forbidden(c);

    try {
      const bundle = await compileForRequest(c, subjectId);
      await emitAudit(c, 'dsar.preview', {
        subjectId,
        requestedBy: auth.userId,
        tenantId: auth.tenantId ?? 'unknown',
        tableCount: Object.keys(bundle.tables).length,
      });
      return c.json({ success: true, data: bundle });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'DSAR_PREVIEW_FAILED',
        status: 500,
        fallback: 'Failed to compile DSAR preview',
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /:subjectId/rtbf — execute right-to-be-forgotten
  //
  // Wave-K Final Zero: replaced the previous {accepted, scheduledAt}
  // stub with a real call into `DsarRtbfExecutor`. The executor walks
  // every DSAR table inside a Drizzle transaction and applies the
  // per-table policy (ANONYMIZE / HARD_DELETE / RETAIN). Returns the
  // full execution report so legal can verify exactly which rows were
  // touched.
  //
  // Authorization: SUPER_ADMIN + ADMIN only. TENANT_ADMIN is excluded
  // (platform-level review required for financial/audit retention).
  // Subjects cannot trigger their own RTBF — must go through admin.
  //
  // Query params:
  //   ?dryRun=true  — preview which rows WOULD be touched, no writes.
  // ───────────────────────────────────────────────────────────────────
  app.post('/:subjectId/rtbf', withSecurityEvents({ action: 'dsar.create', resource: 'dsar', severity: 'info' }, async (c: any) => {
    const subjectId = c.req.param('subjectId');
    if (!subjectId || subjectId.trim().length === 0) {
      return badRequest(c, 'subjectId is required');
    }
    const auth = c.get('auth') ?? {};
    if (!isRtbfAdminRole(auth.role)) return forbidden(c);

    const dryRunQuery = c.req.query('dryRun');
    const dryRun = dryRunQuery === 'true' || dryRunQuery === '1';

    const executor = resolveRtbfExecutor(c);
    const tenantId = auth.tenantId ?? 'unknown';

    if (!executor) {
      // Degraded mode — no DB-backed executor. Emit audit so legal can
      // still see the request, but signal the unavailable state to
      // the caller with 503 rather than the prior {accepted: true} lie.
      await emitAudit(c, 'dsar.rtbf', {
        subjectId,
        requestedBy: auth.userId,
        tenantId,
        dryRun,
        unavailable: true,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'RTBF_EXECUTOR_UNAVAILABLE',
            message:
              'RTBF executor is not wired in this deployment; cannot perform erasure.',
          },
        },
        503,
      );
    }

    try {
      const report: RtbfExecutionReport = await executor.executeRtbf({
        subjectId,
        subjectKind: 'auto',
        requestedBy: auth.userId ?? 'unknown',
        dryRun,
      });

      await emitAudit(c, 'dsar.rtbf.executed', {
        subjectId,
        requestedBy: auth.userId,
        tenantId,
        dryRun,
        totalRowsAffected: report.totalRowsAffected,
        partialErrorCount: report.partialErrors.length,
        executedAt: report.executedAt,
        // Snapshot the per-table action breakdown so the audit row is
        // self-contained — auditors don't need a separate report fetch.
        tableActions: report.tablesProcessed.map((t) => ({
          table: t.table,
          action: t.action,
          rowsAffected: t.rowsAffected,
        })),
      });

      return c.json({ success: true, data: report });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'DSAR_RTBF_FAILED',
        status: 500,
        fallback: 'Failed to execute RTBF request',
      });
    }
  }));

  return app;
}

export default createDsarRouter;

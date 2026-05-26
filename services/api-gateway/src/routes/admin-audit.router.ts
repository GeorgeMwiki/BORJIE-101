/**
 * Admin audit + emergency purge router — Agent V (deep-audit 2026-05-20).
 *
 * Mounted at `/api/v1/admin`. Two distinct surfaces live here:
 *
 *   GET  /api/v1/admin/audit/log              — paginated audit log read-back
 *   POST /api/v1/admin/tenants/:id/purge-now  — emergency immediate purge
 *
 * Both are platform-level surfaces; we keep them in one router because they
 * share an "admin-only + structured audit-emit on every call" pattern and
 * the file would otherwise be a 30-line stub per endpoint.
 *
 * Audit log read-back
 * ───────────────────
 * GDPR Art. 5(2) and TZ PDPA s.13 require demonstrable accountability for
 * data-protection actions. The platform writes audit events on every
 * sensitive mutation (we have an extensive audit-trail-v2 surface in
 * `audit-trail.router.ts`) but until this PR there was no *read-back*
 * surface scoped to GDPR/PDPA review — auditors had to query the DB
 * directly. This endpoint exposes the audit log filtered by actor / action
 * / time-range with cursor pagination so regulators see the proof of
 * compliance in a self-service manner.
 *
 * Scope: platform admins see all tenants; tenant admins see only their own
 * tenant (filter is applied even if they omit the `tenantId` query param —
 * we hard-code their JWT tenantId into the filter to prevent enumeration).
 *
 * Purge-now
 * ─────────
 * The tenant-deletion soft-delete (in `tenants-admin.router.ts`) defaults
 * to a 30-day grace window. For platform emergencies — abuse customer,
 * regulator order, compromised account — operators need a fast-path that
 * skips the grace and purges immediately. This is the most destructive
 * surface in the gateway: requires SUPER_ADMIN role AND a body field that
 * literally retypes the tenant's name as a destructive-action confirmation
 * (same idiom GitHub uses for repo deletion).
 *
 * Every purge call emits a SECURITY-severity audit event so the breadcrumb
 * is preserved even if the underlying data is gone.
 */


import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import {
  e400,
  e401,
  e403,
  e404,
  e500,
} from '../utils/error-response';

// ────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────

const AuditLogQuerySchema = z
  .object({
    actor: z.string().min(1).max(200).optional(),
    action: z.string().min(1).max(200).optional(),
    since: z.string().min(1).optional(),
    until: z.string().min(1).optional(),
    tenantId: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    cursor: z.string().min(1).max(500).optional(),
  })
  .partial()
  .strict();

const PurgeNowBodySchema = z
  .object({
    confirmTenantName: z.string().min(1).max(200),
  })
  .strict();

// ────────────────────────────────────────────────────────────────────────
// Service resolution helpers — both surfaces degrade gracefully when the
// backend service is unwired (returns empty list / 503-style envelope).
// ────────────────────────────────────────────────────────────────────────

interface AuditLogQueryServiceLike {
  query(args: {
    tenantId?: string;
    actor?: string;
    action?: string;
    since?: string;
    until?: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: ReadonlyArray<{
      id: string;
      event: string;
      action?: string;
      actor: string;
      tenantId?: string;
      timestamp: string;
      payload?: Record<string, unknown>;
    }>;
    nextCursor?: string | null;
  }>;
}

interface TenantPurgeServiceLike {
  purgeTenantNow(args: {
    tenantId: string;
    requestedBy: string;
  }): Promise<{
    purgedAt: string;
    redactedRowCount: number;
    tenantName?: string;
  }>;
  getTenantName(tenantId: string): Promise<string | null>;
}

function resolveAuditSvc(c: any): AuditLogQueryServiceLike | null {
  const services = (c.get('services') ?? {}) as {
    auditLogQuery?: AuditLogQueryServiceLike;
  };
  return services.auditLogQuery ?? null;
}

function resolveTenantPurgeSvc(c: any): TenantPurgeServiceLike | null {
  const services = (c.get('services') ?? {}) as {
    tenantPurge?: TenantPurgeServiceLike;
  };
  return services.tenantPurge ?? null;
}

async function emitAudit(
  c: any,
  eventType:
    | 'admin.audit.log.read'
    | 'admin.tenant.purge-now'
    | 'admin.tenant.purge-now.denied',
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
    await bus.publish({
      event: {
        eventId: `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventType,
        timestamp: new Date().toISOString(),
        tenantId: payload.tenantId ?? 'unknown',
        correlationId: c.get('requestId') ?? `adm_${Date.now()}`,
        causationId: null,
        metadata: {
          severity: eventType.includes('purge') ? 'critical' : 'info',
        },
        payload,
      },
      version: 1,
      aggregateId: String(payload.tenantId ?? 'platform'),
      aggregateType: 'AdminAudit',
    });
  } catch {
    // Audit emission is non-fatal.
  }
}

// ────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────

const ADMIN_AUDIT_READ_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TENANT_ADMIN,
]);

export function createAdminAuditRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  // ─────────────────────────────────────────────────────────────────────
  // GET /audit/log — paginated audit log read-back
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    '/audit/log',
    zValidator('query', AuditLogQuerySchema.optional()),
    async (c: any) => {
      const auth = c.get('auth') ?? {};
      if (!auth.userId) {
        return e401(c, 'UNAUTHENTICATED', 'Audit log access requires auth');
      }
      const role = auth.role as UserRole | undefined;
      if (!role || !ADMIN_AUDIT_READ_ROLES.has(role)) {
        return e403(
          c,
          'FORBIDDEN',
          'Audit log read-back is restricted to administrators',
        );
      }

      const q = (c.req.valid('query') ?? {}) as z.infer<
        typeof AuditLogQuerySchema
      >;
      const isPlatformAdmin =
        role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

      // Tenant admins are hard-pinned to their own tenant — they can't
      // pass a different tenantId to enumerate other tenants' audit log.
      // Platform admins may omit the filter or target a specific tenant.
      const effectiveTenantId = isPlatformAdmin
        ? q.tenantId
        : auth.tenantId;

      const svc = resolveAuditSvc(c);
      const limit = q.limit ?? 50;

      let items: ReadonlyArray<unknown> = [];
      let nextCursor: string | null = null;

      if (svc) {
        try {
          const result = await svc.query({
            ...(effectiveTenantId !== undefined
              ? { tenantId: effectiveTenantId }
              : {}),
            ...(q.actor !== undefined ? { actor: q.actor } : {}),
            ...(q.action !== undefined ? { action: q.action } : {}),
            ...(q.since !== undefined ? { since: q.since } : {}),
            ...(q.until !== undefined ? { until: q.until } : {}),
            limit,
            ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
          });
          items = result.items;
          nextCursor = result.nextCursor ?? null;
        } catch (err) {
          return e500(
            c,
            'AUDIT_LOG_QUERY_FAILED',
            err instanceof Error
              ? err.message
              : 'Failed to query audit log',
          );
        }
      }

      await emitAudit(c, 'admin.audit.log.read', {
        actor: auth.userId,
        tenantId: effectiveTenantId ?? 'platform',
        filters: {
          actor: q.actor ?? null,
          action: q.action ?? null,
          since: q.since ?? null,
          until: q.until ?? null,
        },
        returnedCount: items.length,
      });

      // DA2 cleanup: dropped legacy `items` alias. Canonical ApiResponse
      // shape is `{ success, data, meta }` — clients must read `data`.
      return c.json({
        success: true,
        data: items,
        meta: {
          limit,
          nextCursor,
        },
      });
    },
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /tenants/:id/purge-now — emergency immediate purge
  //
  // SUPER_ADMIN only. Body MUST include `confirmTenantName` matching the
  // tenant's display name verbatim — the GitHub "type the name" idiom.
  // No kill-switch guard here on purpose: kill-switches block routine
  // deletion paths; the platform-admin emergency surface must remain
  // usable even when the routine path is paused.
  // ─────────────────────────────────────────────────────────────────────
  app.post(
    '/tenants/:id/purge-now',
    requireRole(UserRole.SUPER_ADMIN),
    zValidator('json', PurgeNowBodySchema),
    async (c: any) => {
      const auth = c.get('auth') ?? {};
      if (!auth.userId) {
        return e401(c, 'UNAUTHENTICATED', 'Purge requires auth');
      }
      const targetTenantId = c.req.param('id');
      if (!targetTenantId || targetTenantId.trim().length === 0) {
        return e400(c, 'VALIDATION_ERROR', 'tenant id is required');
      }
      const body = c.req.valid('json') as z.infer<typeof PurgeNowBodySchema>;

      const svc = resolveTenantPurgeSvc(c);
      if (!svc) {
        return e500(
          c,
          'TENANT_PURGE_UNAVAILABLE',
          'Tenant purge service is not wired in this deployment',
        );
      }

      // Confirmation check — fetch the tenant's current name and require
      // the caller to retype it. Names are tenant-mutable so a stale
      // confirmation in a saved curl will fail safely.
      let tenantName: string | null = null;
      try {
        tenantName = await svc.getTenantName(targetTenantId);
      } catch (err) {
        return e500(
          c,
          'TENANT_LOOKUP_FAILED',
          err instanceof Error ? err.message : 'Failed to verify tenant',
        );
      }
      if (!tenantName) {
        return e404(c, 'TENANT_NOT_FOUND', 'Tenant not found');
      }
      if (body.confirmTenantName !== tenantName) {
        await emitAudit(c, 'admin.tenant.purge-now.denied', {
          tenantId: targetTenantId,
          actor: auth.userId,
          reason: 'confirmTenantName mismatch',
        });
        return e400(
          c,
          'CONFIRMATION_MISMATCH',
          "confirmTenantName must exactly match the tenant's current display name",
        );
      }

      let purgedAt = new Date().toISOString();
      let redactedRowCount = 0;
      try {
        const result = await svc.purgeTenantNow({
          tenantId: targetTenantId,
          requestedBy: auth.userId,
        });
        purgedAt = result.purgedAt ?? purgedAt;
        redactedRowCount = result.redactedRowCount ?? 0;
      } catch (err) {
        return e500(
          c,
          'TENANT_PURGE_FAILED',
          err instanceof Error ? err.message : 'Failed to purge tenant',
        );
      }

      await emitAudit(c, 'admin.tenant.purge-now', {
        tenantId: targetTenantId,
        tenantName,
        actor: auth.userId,
        purgedAt,
        redactedRowCount,
      });

      return c.json(
        {
          success: true,
          data: {
            tenantId: targetTenantId,
            purgedAt,
            redactedRowCount,
          },
        },
        200,
      );
    },
  );

  return app;
}

export default createAdminAuditRouter;

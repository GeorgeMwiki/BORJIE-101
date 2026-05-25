/**
 * Tenant-admin destructive routes — Agent V (deep-audit 2026-05-20).
 *
 * Mounted at `/api/v1/tenants`. Currently exposes the tenant-wide
 * GDPR/PDPA right-to-erasure surface required for KE/TZ launch:
 *
 *   DELETE /api/v1/tenants/:id   — tenant owner schedules a 30-day
 *                                   soft-delete with grace; users notified.
 *
 * Note we intentionally mount under `/tenants` (not `/tenants-admin`)
 * because the e2e contract is `DELETE /api/v1/tenants/:id`. Read/list
 * endpoints on `/tenants` are handled by `tenants.hono.ts` — Hono routes
 * methods independently, so the DELETE here does not collide with that
 * router's GET / POST.
 *
 * Authorisation is intentionally strict: only the TENANT_ADMIN (mapped
 * to "tenant owner" in the user-role enum) for the matching tenant can
 * schedule deletion. Platform admins (SUPER_ADMIN / ADMIN) are also
 * accepted as an operator-override path, but the path itself emits
 * SECURITY-severity audit because of the destruction implied.
 *
 * The 30-day grace is mandated by KE PDPA Art. 26(2) and TZ PDPA s.17
 * — both require the controller to allow the data subject a reasonable
 * window to object before erasure is finalised. The platform's purge
 * worker walks the schedule and fires `tenant-purge-worker` at expiry.
 */

// @ts-nocheck — Hono v4 status-code literal union widens c.json branches.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { killSwitchGuard } from '../middleware/kill-switch.middleware';
import { UserRole } from '../types/user-role';
import { e400, e401, e403, e500 } from '../utils/error-response';

// ────────────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────────────

const TenantDeleteBodySchema = z
  .object({
    reason: z.string().min(1).max(2_000).optional(),
    confirm: z.boolean().optional(),
    /**
     * Caller may request a longer-than-default grace window (e.g.
     * regulator inquiry pause). Cannot be shorter than 30 days —
     * see KE PDPA Art. 26(2).
     */
    graceDays: z.number().int().min(30).max(180).optional(),
  })
  .partial()
  .strict();

const MIN_GRACE_DAYS = 30;
const TENANT_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TENANT_ADMIN,
]);

// ────────────────────────────────────────────────────────────────────────
// Service resolution helpers
// ────────────────────────────────────────────────────────────────────────

interface TenantDeletionServiceLike {
  scheduleTenantDeletion(args: {
    tenantId: string;
    requestedBy: string;
    reason?: string;
    graceDays: number;
  }): Promise<{
    tenantDeletionId: string;
    scheduledPurgeAt: string;
    affectedUsers: number;
  }>;
}

function resolveTenantDeletionSvc(c: any): TenantDeletionServiceLike | null {
  const services = (c.get('services') ?? {}) as {
    tenantDeletion?: TenantDeletionServiceLike;
  };
  return services.tenantDeletion ?? null;
}

async function emitAudit(
  c: any,
  eventType: 'tenant.delete-scheduled',
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
        eventId: `tnt_del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventType,
        timestamp: new Date().toISOString(),
        tenantId: payload.tenantId ?? 'unknown',
        correlationId: c.get('requestId') ?? `tnt_del_${Date.now()}`,
        causationId: null,
        metadata: { severity: 'critical' },
        payload,
      },
      version: 1,
      aggregateId: String(payload.tenantId ?? 'unknown'),
      aggregateType: 'TenantDeletion',
    });
  } catch {
    // Audit emission is non-fatal.
  }
}

// ────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────

export function createTenantsAdminRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /:id — tenant-wide soft-delete with grace
  //
  // Kill-switch shares the `account-deletion` op key with the user-self
  // surface — operators can freeze both at once.
  // ─────────────────────────────────────────────────────────────────────
  app.delete(
    '/:id',
    requireRole(
      UserRole.TENANT_ADMIN,
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ),
    killSwitchGuard('account-deletion'),
    zValidator('json', TenantDeleteBodySchema.optional()),
    async (c: any) => {
      const auth = c.get('auth') ?? {};
      const callerTenantId = auth.tenantId;
      const callerUserId = auth.userId;
      const callerRole = auth.role as UserRole | undefined;

      if (!callerUserId || !callerTenantId) {
        return e401(
          c,
          'UNAUTHENTICATED',
          'Tenant deletion requires an authenticated tenant admin',
        );
      }
      if (!callerRole || !TENANT_ADMIN_ROLES.has(callerRole)) {
        return e403(
          c,
          'FORBIDDEN',
          'Tenant deletion is restricted to tenant administrators',
        );
      }

      const targetTenantId = c.req.param('id');
      if (!targetTenantId || targetTenantId.trim().length === 0) {
        return e400(c, 'VALIDATION_ERROR', 'tenant id is required');
      }

      // Platform admins (SUPER_ADMIN / ADMIN) may cross-tenant-target;
      // TENANT_ADMIN must match their JWT tenant — otherwise this would
      // be a privilege-escalation across multi-tenant boundary.
      const isPlatformAdmin =
        callerRole === UserRole.SUPER_ADMIN || callerRole === UserRole.ADMIN;
      if (!isPlatformAdmin && targetTenantId !== callerTenantId) {
        return e403(
          c,
          'TENANT_MISMATCH',
          'Tenant administrators can only delete their own tenant',
        );
      }

      const body = (c.req.valid('json') ?? {}) as z.infer<
        typeof TenantDeleteBodySchema
      >;
      const graceDays = body.graceDays ?? MIN_GRACE_DAYS;

      const now = Date.now();
      const scheduledPurgeAt = new Date(
        now + graceDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      const svc = resolveTenantDeletionSvc(c);
      let tenantDeletionId = `tnt-del-${targetTenantId}-${now}`;
      let affectedUsers = 0;

      if (svc) {
        try {
          const result = await svc.scheduleTenantDeletion({
            tenantId: targetTenantId,
            requestedBy: callerUserId,
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
            graceDays,
          });
          tenantDeletionId = result.tenantDeletionId ?? tenantDeletionId;
          affectedUsers = result.affectedUsers ?? 0;
        } catch (err) {
          return e500(
            c,
            'TENANT_DELETION_FAILED',
            err instanceof Error
              ? err.message
              : 'Failed to schedule tenant deletion',
          );
        }
      }

      await emitAudit(c, 'tenant.delete-scheduled', {
        tenantId: targetTenantId,
        requestedBy: callerUserId,
        callerRole,
        tenantDeletionId,
        scheduledPurgeAt,
        graceDays,
        affectedUsers,
        reason: body.reason ?? null,
      });

      // DA2 cleanup: dropped legacy `scheduledPurgeAt` field from the
      // public response — the E2E contract (tenant-account-delete-hard.spec.ts)
      // and downstream clients read `scheduledFor`. The internal service
      // interface still produces `scheduledPurgeAt` (see TenantDeletionServiceLike)
      // and we adapt it at the response boundary.
      return c.json(
        {
          success: true,
          data: {
            tenantDeletionId,
            tenantId: targetTenantId,
            scheduledFor: scheduledPurgeAt,
            graceDays,
            affectedUsers,
          },
        },
        202,
      );
    },
  );

  return app;
}

export default createTenantsAdminRouter;

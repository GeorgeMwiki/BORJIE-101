/**
 * /api/v1/mining/internal/audit-pack — HQ regulator audit-pack issuer
 * (I-W-17).
 *
 * SUPER_ADMIN / ADMIN only. Backed by the REAL `audit_packs` table
 * (migration 0300):
 *
 *   GET  /       list issued packs (newest first, cross-tenant fleet view).
 *   POST /mint   create an `audit_packs` row for a target tenant.
 *
 * SIGNED-URL HONESTY (task hard rule): a pack's downloadable bundle (the
 * zipped evidence set) is produced by a separate bundling step that is not
 * yet wired. We therefore create the row with `status='pending'` and
 * `signed_url = NULL` — we NEVER fabricate a URL. When object storage is
 * configured (Supabase service-role env present) the response notes that
 * the pack is queued for bundling + presign; when it is absent the same
 * honest 'pending' row is returned with `storageConfigured:false`. The
 * later bundling worker fills `signed_url` + `expires_at` + flips status to
 * 'ready'. No fake/placeholder URL is ever written or returned.
 *
 * SCOPE: `audit_packs` is tenant-scoped + FORCE-RLS on the canonical
 * `app.current_tenant_id` GUC (the defence for ordinary tenant sessions).
 * This HQ surface is platform-admin (no tenant context), so — exactly like
 * `daily-brief-overview.hono.ts` — it reads/writes across tenants via the
 * gateway DB role; each minted row carries the explicit target `tenantId`.
 *
 * Per CLAUDE.md: Drizzle only, zod-validated body, immutability, no
 * `console.log` (Pino via createLogger), never a hard-coded currency.
 *
 * Mounted at `/api/v1/mining/internal/audit-pack`.
 */

import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { auditPacks } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { createLogger } from '../../../utils/logger';

const moduleLogger = createLogger('admin-audit-pack');

const MintSchema = z.object({
  tenantId: z.string().min(1).max(200),
  regulator: z.string().min(1).max(300),
});

interface AuditPackRowOut {
  readonly id: string;
  readonly tenantId: string;
  readonly regulator: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly signedUrl: string | null;
  readonly status: string;
  readonly createdBy: string | null;
}

function isoOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function projectRow(row: Record<string, unknown>): AuditPackRowOut {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenantId ?? row.tenant_id ?? ''),
    regulator: String(row.regulator ?? ''),
    issuedAt: isoOf(row.issuedAt ?? row.issued_at) ?? new Date(0).toISOString(),
    expiresAt: isoOf(row.expiresAt ?? row.expires_at),
    // signed_url is NULL until the bundling worker presigns a real object.
    signedUrl:
      row.signedUrl != null
        ? String(row.signedUrl)
        : row.signed_url != null
          ? String(row.signed_url)
          : null,
    status: String(row.status ?? 'pending'),
    createdBy:
      row.createdBy != null
        ? String(row.createdBy)
        : row.created_by != null
          ? String(row.created_by)
          : null,
  };
}

/**
 * Whether object storage is wired (Supabase service-role env present).
 * Used ONLY to annotate the mint response so the operator knows whether a
 * presign will eventually succeed — it NEVER causes a URL to be fabricated.
 */
function storageConfigured(): boolean {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(url && key);
}

export function createMiningInternalAuditPackRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  // ── GET / — issued packs (newest first, cross-tenant) ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get('/', async (c: any) => {
    const db = c.get('db');
    if (!db) return unavailable(c);
    try {
      const rows = await db
        .select()
        .from(auditPacks)
        .orderBy(desc(auditPacks.issuedAt))
        .limit(200);
      const data = (rows as ReadonlyArray<Record<string, unknown>>).map(
        projectRow,
      );
      return c.json(
        { success: true as const, data, meta: { count: data.length } },
        200,
      );
    } catch (err) {
      return failure(c, err, 'list');
    }
  });

  // ── POST /mint — create a pending pack row (NO fabricated URL) ─────
  app.post(
    '/mint',
    withSecurityEvents(
      {
        action: 'platform.audit_pack.mint',
        resource: 'audit.pack',
        severity: 'notice',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (c: any) => {
        const db = c.get('db');
        if (!db) return unavailable(c);
        const { userId } = c.get('auth') as { userId?: string };

        const raw = await c.req.json().catch(() => null);
        const parsed = MintSchema.safeParse(raw);
        if (!parsed.success) {
          return c.json(
            {
              success: false as const,
              error: { code: 'BAD_REQUEST', message: parsed.error.message },
            },
            400,
          );
        }
        const input = parsed.data;

        try {
          const [row] = await db
            .insert(auditPacks)
            .values({
              tenantId: input.tenantId,
              regulator: input.regulator,
              issuedAt: new Date(),
              // Honest: NO signed_url, NO expiry — status pending until a
              // real bundle is presigned by the downstream worker.
              signedUrl: null,
              expiresAt: null,
              status: 'pending',
              metadata: {},
              createdBy: userId ?? null,
            })
            .returning();
          return c.json(
            {
              success: true as const,
              data: projectRow(row as Record<string, unknown>),
              meta: {
                storageConfigured: storageConfigured(),
                note: storageConfigured()
                  ? 'Pack queued for bundling; signed URL is minted once the evidence bundle is built.'
                  : 'Object storage is not configured; pack is recorded as pending. No signed URL will be issued until storage is wired.',
              },
            },
            201,
          );
        } catch (err) {
          return failure(c, err, 'mint');
        }
      },
    ),
  );

  return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unavailable(c: any): Response {
  return c.json(
    {
      success: false as const,
      error: {
        code: 'AUDIT_PACK_UNAVAILABLE',
        message: 'database is not configured on this gateway',
      },
    },
    503,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failure(c: any, err: unknown, scope: string): Response {
  const reason = err instanceof Error ? err.message : String(err);
  moduleLogger.error('audit-pack operation failed', {
    evt: 'admin_audit_pack_failed',
    scope,
    reason,
  });
  return c.json(
    {
      success: false as const,
      error: { code: 'AUDIT_PACK_FAILED', message: reason },
    },
    500,
  );
}

export const miningInternalAuditPackRouter =
  createMiningInternalAuditPackRouter();
export default miningInternalAuditPackRouter;

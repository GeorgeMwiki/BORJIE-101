/**
 * /api/v1/mining/internal/marketplace — HQ marketplace moderation (AD-3).
 *
 * SUPER_ADMIN / ADMIN only. Borjie HQ moderates the cross-tenant mineral
 * marketplace by flipping a listing's `status` on the REAL
 * `marketplace_listings` table:
 *
 *   GET   /                 list listings for the moderation queue
 *   POST  /{id}/hide        active|paused → removed   (take down)
 *   POST  /{id}/restore     removed       → active    (reinstate)
 *
 * This is a fleet-metadata surface (HQ acts across every tenant), so it
 * mirrors `tenants.hono.ts` / `daily-brief-overview.hono.ts`: it requires
 * a platform-admin role and operates on rows regardless of the single
 * caller tenant. Every mutation is wrapped in `withSecurityEvents` for the
 * SOC 2 audit trail.
 *
 * Why no fabricated data: `marketplace_listings` is a real, migrated table
 * (packages/database/src/schemas/marketplace.schema.ts). The admin-web
 * `internal/marketplace` page currently renders a hardcoded fixture; this
 * route is what lets it switch to live data + working hide/restore.
 *
 * Per CLAUDE.md: Drizzle only, zod validation, immutability, no
 * `console.log` (Pino via createLogger), never hard-code a currency.
 */

import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { marketplaceListings } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { createLogger } from '../../../utils/logger';

const moduleLogger = createLogger('admin-marketplace-moderation');

const IdParamSchema = z.object({ id: z.string().min(1).max(200) });

const HIDDEN_STATUS = 'removed' as const;
const ACTIVE_STATUS = 'active' as const;

interface ModerationListingRow {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly category: string;
  readonly status: string;
  readonly visibility: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function projectRow(row: Record<string, unknown>): ModerationListingRow {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenantId ?? row.tenant_id ?? ''),
    title: String(row.title ?? ''),
    category: String(row.category ?? ''),
    status: String(row.status ?? ''),
    visibility: String(row.visibility ?? ''),
    createdAt: isoOf(row.createdAt ?? row.created_at),
    updatedAt: isoOf(row.updatedAt ?? row.updated_at),
  };
}

export function createMiningInternalMarketplaceRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  // ── GET / — moderation queue (cross-tenant) ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get('/', async (c: any) => {
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'MARKETPLACE_MODERATION_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }
    const rows = await db
      .select()
      .from(marketplaceListings)
      .orderBy(desc(marketplaceListings.createdAt))
      .limit(200);
    const data = (rows as ReadonlyArray<Record<string, unknown>>).map(
      projectRow,
    );
    return c.json(
      { success: true as const, data, meta: { count: data.length } },
      200,
    );
  });

  // ── POST /:id/hide — take a listing down ──────────────────────────
  app.post(
    '/:id/hide',
    withSecurityEvents(
      {
        action: 'platform.marketplace.listing.hide',
        resource: 'marketplace.listing',
        severity: 'warn',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (c: any) => transitionStatus(c, HIDDEN_STATUS),
    ),
  );

  // ── POST /:id/restore — reinstate a removed listing ───────────────
  app.post(
    '/:id/restore',
    withSecurityEvents(
      {
        action: 'platform.marketplace.listing.restore',
        resource: 'marketplace.listing',
        severity: 'notice',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (c: any) => transitionStatus(c, ACTIVE_STATUS),
    ),
  );

  return app;
}

/**
 * Shared status-flip handler for hide/restore. Validates the id param,
 * confirms the listing exists, and writes the new status on the real
 * table. Returns the updated row so the UI can re-render without a refetch.
 */
async function transitionStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  nextStatus: typeof HIDDEN_STATUS | typeof ACTIVE_STATUS,
): Promise<Response> {
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'MARKETPLACE_MODERATION_UNAVAILABLE',
          message: 'database is not configured on this gateway',
        },
      },
      503,
    );
  }
  const parsed = IdParamSchema.safeParse({ id: c.req.param('id') });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      },
      400,
    );
  }
  const id = parsed.data.id;

  try {
    const [row] = await db
      .update(marketplaceListings)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(marketplaceListings.id, id))
      .returning();
    if (!row) {
      return c.json(
        {
          success: false as const,
          error: { code: 'NOT_FOUND', message: 'Listing not found' },
        },
        404,
      );
    }
    return c.json(
      { success: true as const, data: projectRow(row as Record<string, unknown>) },
      200,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    moduleLogger.error('marketplace moderation transition failed', {
      evt: 'admin_marketplace_moderation_failed',
      listingId: id,
      nextStatus,
      reason,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'MARKETPLACE_MODERATION_FAILED', message: reason },
      },
      500,
    );
  }
}

export const miningInternalMarketplaceRouter =
  createMiningInternalMarketplaceRouter();
export default miningInternalMarketplaceRouter;

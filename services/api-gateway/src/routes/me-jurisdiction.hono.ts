/**
 * /api/v1/me/jurisdiction — JA-7 owner-facing endpoint.
 *
 * Returns the resolved jurisdiction snapshot for the authenticated
 * owner's active tenant. Backs the owner-web settings page so the
 * owner can see exactly which country / regulators / currency /
 * language / time zone their account currently runs under.
 *
 * NOTE: this route is READ-only. Permanent jurisdiction changes go
 * through the Borjie internal admin surface (JC-7) — the settings
 * page surfaces a "Request a change" link that opens a support
 * ticket, NOT a self-service mutate path. tenant.jurisdiction is
 * LOCKED at signup per migration 0149.
 */

import { Hono } from 'hono';

import { authMiddleware } from '../middleware/hono-auth.js';
import { databaseMiddleware } from '../middleware/database.js';
import { createJurisdictionResolver } from '../services/jurisdiction-resolver/resolver.js';
import { createDrizzleTenantConfigService } from '../services/tenant-config/service.js';

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

export const meJurisdictionRouter = new Hono();
meJurisdictionRouter.use('*', authMiddleware);
meJurisdictionRouter.use('*', databaseMiddleware);

meJurisdictionRouter.get('/', async (c) => {
  const auth = c.get('auth') as { tenantId: string } | undefined;
  const db = c.get('db') as DbExec | null;
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401,
    );
  }
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }

  try {
    const tenantConfig = createDrizzleTenantConfigService(db);
    const resolver = createJurisdictionResolver({ tenantConfig });
    const resolved = await resolver.resolve(auth.tenantId);
    return c.json(
      {
        success: true as const,
        data: {
          country: resolved.country,
          countryName: resolved.countryName,
          currency: resolved.currency,
          defaultLanguage: resolved.defaultLanguage,
          locale: resolved.locale,
          timeZone: resolved.timeZone,
          regulators: {
            mineral: resolved.mineralAuthorities.mineralAuthority,
            environmental: resolved.environmentalAuthority,
            transparency: resolved.transparencyInitiative,
            audit: resolved.auditAuthority,
          },
          source: resolved.source,
          locked: true,
          // The brain's per-turn override is a separate signal — this
          // endpoint only reports the LOCKED tenant default. The owner
          // can still ask Mr. Mwikila about other jurisdictions for
          // individual conversations.
        },
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'RESOLVE_FAILED',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to resolve tenant jurisdiction',
        },
      },
      500,
    );
  }
});

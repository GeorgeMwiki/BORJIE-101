/**
 * Jurisdiction promotion route — the governed "unlock a new market" surface.
 *
 * Turns "which countries users may select" from a code deploy into a governed
 * data action against the `enabled_countries` registry (migration 0337). Seeded
 * with TZ only; promoting a new market (e.g. US) is an admin/MD action AFTER
 * Mr. Mwikila has learned the jurisdiction (discover() + ingested compliance
 * corpus). Backs the MD brain-tool `mwikila.jurisdiction.promote`.
 *
 *   GET  /admin/jurisdictions                 → list enabled countries
 *   POST /admin/jurisdictions/:code/enable    → promote a country (platform-admin)
 *   POST /admin/jurisdictions/:code/disable   → soft-disable a country
 *
 * Auth: platform-admin only (SUPER_ADMIN | ADMIN). Promotion is HIGH-risk — the
 * MD path additionally flows through the autonomy gate + R7 shadow-certify
 * before reaching here.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { createEnabledJurisdictionsService } from '@borjie/database';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

const EnableInput = z.object({
  name: z.string().min(1),
  currencyCode: z.string().min(3).max(3).optional(),
  learnedFromCorpus: z.boolean().optional(),
  evidence: z.string().optional(),
});

const CODE_RX = /^[A-Za-z]{2,3}$/;

export function createJurisdictionPromotionRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  function isPlatformAdmin(c: any): boolean {
    const role = (c.get('auth') ?? {}).role as UserRole | undefined;
    return role !== undefined && PLATFORM_ADMIN_ROLES.has(role);
  }

  // GET /admin/jurisdictions — the live launch market.
  app.get('/', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const svc = createEnabledJurisdictionsService(c.get('db'));
    const rows = await svc.listEnabledRows();
    return c.json({ success: true, data: { countries: rows } }, 200);
  });

  // POST /admin/jurisdictions/:code/enable — promote a learned country.
  app.post('/:code/enable', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const code = c.req.param('code');
    if (!CODE_RX.test(code ?? '')) {
      return c.json({ success: false, error: { code: 'BAD_CODE', message: 'ISO-3166-1 alpha-2 required' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: { code: 'BAD_JSON', message: 'body must be JSON' } }, 400);
    }
    const parsed = EnableInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? 'invalid' } }, 400);
    }
    const auth = c.get('auth') ?? {};
    const svc = createEnabledJurisdictionsService(c.get('db'));
    const row = await svc.enableCountry({
      code,
      name: parsed.data.name,
      ...(parsed.data.currencyCode ? { currencyCode: parsed.data.currencyCode } : {}),
      ...(auth.userId ? { enabledByAdminId: auth.userId as string } : {}),
      ...(parsed.data.learnedFromCorpus !== undefined ? { learnedFromCorpus: parsed.data.learnedFromCorpus } : {}),
      metadata: parsed.data.evidence ? { evidence: parsed.data.evidence } : {},
    });
    return c.json({ success: true, data: { enabled: true, country: row } }, 200);
  });

  // POST /admin/jurisdictions/:code/disable — soft-disable.
  app.post('/:code/disable', async (c: any) => {
    if (!isPlatformAdmin(c)) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'platform-admin only' } }, 403);
    }
    const code = c.req.param('code');
    if (!CODE_RX.test(code ?? '')) {
      return c.json({ success: false, error: { code: 'BAD_CODE', message: 'ISO-3166-1 alpha-2 required' } }, 400);
    }
    const svc = createEnabledJurisdictionsService(c.get('db'));
    await svc.disableCountry(code);
    return c.json({ success: true, data: { disabled: true, code: code.toUpperCase() } }, 200);
  });

  return app;
}

export default createJurisdictionPromotionRouter;

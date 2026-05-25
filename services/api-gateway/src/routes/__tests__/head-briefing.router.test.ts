/**
 * head-briefing router smoke tests (Wave 28).
 *
 * Verifies:
 *   - every endpoint requires auth (401 without bearer)
 *   - the router is null-tolerant: when the composer slot is missing
 *     (`services.headBriefing` undefined or `composer === null`) the
 *     surface returns 503 HEAD_BRIEFING_UNAVAILABLE rather than 5xx.
 *   - happy path returns the composed BriefingDocument when a composer
 *     is bound on the Hono context.
 *
 * Decision-path tests for `compose` itself live in the
 * `@borjie/ai-copilot` package; this file only confirms the gateway
 * router is mounted, gates auth, and degrades gracefully.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret BEFORE importing any router so all middlewares that
// capture the secret at module init agree. Mirrors role-gate.test.ts.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import headBriefingRouter from '../head-briefing.router.js';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/head/briefing', headBriefingRouter);
  return app;
}

function bearer(role: UserRole): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

describe('head-briefing router — auth gates', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('rejects GET / without a token', async () => {
    const res = await mount().request('/head/briefing');
    expect(res.status).toBe(401);
  });

  it('rejects GET /markdown without a token', async () => {
    const res = await mount().request('/head/briefing/markdown');
    expect(res.status).toBe(401);
  });

  it('rejects GET /voice-narration without a token', async () => {
    const res = await mount().request('/head/briefing/voice-narration');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin role with 401/403', async () => {
    const auth = bearer(UserRole.RESIDENT);
    const res = await mount().request('/head/briefing', {
      headers: { Authorization: auth },
    });
    expect([401, 403]).toContain(res.status);
  });
});

describe('head-briefing router — degraded mode tolerates missing composer', () => {
  it('returns 503 HEAD_BRIEFING_UNAVAILABLE when no services bound', async () => {
    const auth = bearer(UserRole.ADMIN);
    const res = await mount().request('/head/briefing', {
      headers: { Authorization: auth },
    });
    // No composition middleware mounted, so `c.get('services')` is
    // undefined and the router degrades cleanly rather than 5xx.
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('HEAD_BRIEFING_UNAVAILABLE');
  });

  it('markdown surface degrades cleanly when composer missing', async () => {
    const auth = bearer(UserRole.ADMIN);
    const res = await mount().request('/head/briefing/markdown', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(503);
  });

  it('voice surface degrades cleanly when composer missing', async () => {
    const auth = bearer(UserRole.ADMIN);
    const res = await mount().request('/head/briefing/voice-narration', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(503);
  });

  it('returns 503 even when services exist but composer is null', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      // @ts-expect-error — services slot is augmented elsewhere; tests
      // populate it directly to exercise the null-composer branch.
      c.set('services', { headBriefing: { composer: null } });
      await next();
    });
    app.route('/head/briefing', headBriefingRouter);

    const auth = bearer(UserRole.ADMIN);
    const res = await app.request('/head/briefing', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(503);
  });
});

describe('head-briefing router — happy path with stub composer', () => {
  it('returns the composed BriefingDocument when a composer is bound', async () => {
    const stubComposer = {
      compose: async (tenantId: string) => ({
        tenantId,
        generatedAt: '2026-01-01T07:00:00Z',
        headline: 'A quiet start.',
        overnight: {
          totalAutonomousActions: 0,
          byDomain: {},
          notableActions: [],
        },
        pendingApprovals: { count: 0, items: [] },
        escalations: {
          count: 0,
          byPriority: { P1: 0, P2: 0, P3: 0 },
          items: [],
        },
        kpiDeltas: {
          occupancyPct: { value: 96, delta7d: 0 },
          collectionsRate: { value: 97, delta7d: 0 },
          arrearsDays: { value: 12, delta7d: 0 },
          maintenanceSLA: { value: 88, delta7d: 0 },
          tenantSatisfaction: { value: 0.81, delta30d: 0 },
          noi: { value: 4_820_000, delta30d: 0 },
        },
        recommendations: [],
        anomalies: [],
      }),
    };

    const app = new Hono();
    app.use('*', async (c, next) => {
      // @ts-expect-error — services slot is augmented elsewhere; tests
      // populate it directly to exercise the happy path.
      c.set('services', { headBriefing: { composer: stubComposer } });
      await next();
    });
    app.route('/head/briefing', headBriefingRouter);

    const auth = bearer(UserRole.ADMIN);
    const res = await app.request('/head/briefing', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { tenantId: string; headline: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe('tnt-test');
    expect(body.data.headline).toBe('A quiet start.');
  });
});

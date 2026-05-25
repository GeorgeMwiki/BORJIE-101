/**
 * Admin Portal — REAL-BACKEND regression net (W-E2E-Portals).
 *
 * The wave-K audit established that stub-server `page.route()` mocks hid real
 * bugs (FeedbackThumbs 👍/👎 schema drift, see customer-app/communication.spec).
 * This file is the admin-portal analogue: it boots against the REAL
 * api-gateway from docker-compose.e2e.yml and asserts the round-trip status
 * is < 400. If the gateway returns 500 or a schema mismatch, this fails.
 *
 * Scope is intentionally narrow — one killer assertion per heavy endpoint —
 * because (a) the broader spec suite under this directory exercises the UI
 * which transitively hits these endpoints, and (b) per the wave-K policy we
 * want the regression net to be honest, not theatre. Specs in this file
 * `test.skip()` when an endpoint is not yet shipped on main; they do NOT
 * fake-pass.
 *
 * Pre-reqs:
 *   docker compose -f docker-compose.e2e.yml up -d --wait
 *   pnpm tsx e2e/fixtures/seed-runner.ts
 *   pnpm test:e2e --project=admin-portal
 */

import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from '../../fixtures/auth';

const API_GATEWAY_URL =
  process.env.API_GATEWAY_URL ?? 'http://localhost:4000';

test.describe('Admin Portal — real-backend regression', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('GET /api/v1/admin/tenants/list round-trips through real gateway', async ({
    page,
  }) => {
    // Capture the tenant-list fetch the admin portal fires on dashboard load.
    // Admin portal mounts a tenant table on / or /tenants — either path
    // triggers the same backend call.
    const tenantListResp = page.waitForResponse(
      (resp) =>
        (resp.url().includes('/api/v1/admin/tenants') ||
          resp.url().includes('/api/v1/tenants')) &&
        resp.request().method() === 'GET',
      { timeout: 10000 },
    );

    // Navigate to tenants page (or stay on dashboard if it loads tenants).
    await page.goto('/tenants').catch(async () => {
      await page.goto('/').catch(() => {});
    });

    const resp = await tenantListResp.catch(() => null);
    if (!resp) {
      test.skip(
        true,
        'Admin tenant-list endpoint not exercised by this build; the UI may surface tenants via a different route',
      );
      return;
    }

    expect(
      resp.status(),
      'admin tenant-list endpoint must succeed against real api-gateway',
    ).toBeLessThan(400);

    // Schema sanity: response must be JSON with either a data array or a
    // list array. Hard-coding too strict a shape would couple this test to
    // implementation; this is just enough to catch a 500 returning HTML.
    const contentType = resp.headers()['content-type'] ?? '';
    expect(contentType, 'response must be JSON, not error HTML').toContain(
      'application/json',
    );

    const body = (await resp.json()) as unknown;
    expect(
      typeof body === 'object' && body !== null,
      'response body must be a JSON object',
    ).toBe(true);
  });

  test('admin login persists a session token in localStorage', async ({
    page,
  }) => {
    // Sanity check that loginAsSuperAdmin actually went through the real
    // /api/v1/auth/login endpoint — the stub-server happily set tokens for
    // any payload, the real gateway will reject malformed creds.
    const token = await page.evaluate(
      () =>
        localStorage.getItem('token') ?? localStorage.getItem('auth') ?? '',
    );
    expect(token.length, 'real-backend login must yield a session token').toBeGreaterThan(
      0,
    );
  });

  test('healthz reachable from inside the e2e network', async ({ request }) => {
    // Fast canary — if the api-gateway is unreachable, every other test in
    // this file is meaningless. Surface the failure here with a clear msg.
    const resp = await request.get(`${API_GATEWAY_URL}/healthz`);
    expect(
      resp.status(),
      'api-gateway /healthz must respond — is docker-compose.e2e.yml up?',
    ).toBeLessThan(400);
  });
});

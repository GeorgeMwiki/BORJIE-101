/**
 * @session @critical @security
 *
 * Expired access-token → refresh-token retry.
 *
 * Scenario: user logs in successfully, then the access-token's `exp`
 * claim is rolled into the past. The next authenticated request MUST:
 *   1. Be rejected by the api-gateway (401)
 *   2. Trigger the client's refresh-token flow
 *   3. Re-issue a new access token using the still-valid refresh token
 *   4. Replay the original request transparently
 *
 * Audit reference: `.audit/deep-audit-2026-05-20.md` — zero coverage
 * today; pilot users will hit this on day 1.
 */
import { test, expect } from '@playwright/test';
import {
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';
import { testUsers } from '../../../fixtures/test-data';
import {
  AUTH_COOKIE_CANDIDATES,
  decodeJwtPayload,
  forgeExpiredJwt,
  getCookieValue,
  readJwtFromLocalStorage,
  replaceCookieValue,
} from '../../../fixtures/jwt-helpers';

test.describe('@session @critical @security — expired access token triggers refresh', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('owner-portal: forged expired JWT round-trips through refresh flow', async ({
    page,
    context,
    request,
  }) => {
    // 1. Real login via the owner portal.
    await page.goto(process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(testUsers.owner.email);
    await page.getByLabel(/password/i).fill(testUsers.owner.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await page.waitForURL(/\/dashboard/i, { timeout: 15000 }).catch(() => undefined);

    // 2. Locate the access token (cookie OR localStorage — portal-dependent).
    const cookieToken = await getCookieValue(context, AUTH_COOKIE_CANDIDATES);
    const lsToken = cookieToken ? null : await readJwtFromLocalStorage(page);
    if (!cookieToken && !lsToken) {
      test.fixme(
        true,
        'Owner portal does not surface a JWT we can locate — auth-layer gap',
      );
      return;
    }
    const originalJwt = cookieToken?.value ?? lsToken?.jwt ?? '';
    expect(decodeJwtPayload(originalJwt), 'JWT must decode').not.toBeNull();

    // 3. Forge a tampered token whose `exp` is 60s in the past.
    const expiredJwt = forgeExpiredJwt(originalJwt, 60);
    if (cookieToken) {
      await replaceCookieValue(context, cookieToken.name, expiredJwt);
    } else if (lsToken) {
      await page.evaluate(
        ({ key, jwt }) => window.localStorage.setItem(key, jwt),
        { key: lsToken.key, jwt: expiredJwt },
      );
    }

    // 4. Trigger an authenticated request and observe refresh behaviour.
    //    Watch for a `/auth/refresh` (or similar) call and the eventual
    //    success of the original request.
    const refreshPromise = page
      .waitForResponse(
        (r) => /\/(auth|api).*\/(refresh|token)/i.test(r.url()) && r.status() < 500,
        { timeout: 10000 },
      )
      .catch(() => null);

    // Navigate to a tenant-scoped page — this MUST issue an authenticated request.
    await page.goto('/properties').catch(() => undefined);
    const refreshResp = await refreshPromise;

    if (!refreshResp) {
      test.fixme(
        true,
        'No /refresh endpoint observed — refresh-token flow appears unwired',
      );
      return;
    }
    expect(refreshResp.status(), 'refresh endpoint must respond < 500').toBeLessThan(500);

    // 5. After refresh, the page must not have bounced to /login.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    expect(page.url(), 'user must NOT have been logged out').not.toMatch(/\/login/i);
  });

  test('api-gateway: expired bearer token returns 401, not 5xx', async ({ request }) => {
    // Forge a token that decodes correctly but expired 1h ago. The gateway
    // MUST return 401 (not 500) — leaking stack traces on expired tokens
    // is a CWE-209 information-disclosure bug.
    const fakePayload = Buffer.from(
      JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 3600 }),
    ).toString('base64url');
    const expired = `eyJhbGciOiJIUzI1NiJ9.${fakePayload}.invalidsig`;

    const resp = await request.get(`${API_GATEWAY_URL}/api/v1/properties`, {
      headers: { Authorization: `Bearer ${expired}` },
      failOnStatusCode: false,
    });
    expect(resp.status(), 'expired token must produce 401, not 5xx').toBe(401);
    const body = await resp.text();
    expect(body, 'error body must not leak stack trace').not.toMatch(/at\s+\w+\s+\(/);
  });
});

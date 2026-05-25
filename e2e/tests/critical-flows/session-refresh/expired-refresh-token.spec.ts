/**
 * @session @critical @security
 *
 * Both tokens expired → forced logout (no refresh-loop).
 *
 * Scenario: user has been away long enough that BOTH the access token
 * and the refresh token have expired. The next authenticated request
 * MUST:
 *   1. Receive 401 from the access-token validation
 *   2. Attempt one refresh
 *   3. Receive 401 from the refresh endpoint too
 *   4. Redirect the user to /login (NO infinite refresh loop)
 *   5. Clear all session storage (cookies + localStorage)
 *
 * Audit reference: `.audit/deep-audit-2026-05-20.md` — zero coverage
 * for the all-tokens-expired edge case. An infinite refresh-loop here
 * would burn battery on mobile and hammer the gateway.
 */
import { test, expect } from '@playwright/test';
import { REAL_BACKEND_ENABLED } from '../../../fixtures/dual-tenant-fixtures';
import { testUsers } from '../../../fixtures/test-data';
import {
  AUTH_COOKIE_CANDIDATES,
  REFRESH_COOKIE_CANDIDATES,
  forgeExpiredJwt,
  getCookieValue,
  readJwtFromLocalStorage,
  replaceCookieValue,
} from '../../../fixtures/jwt-helpers';

test.describe('@session @critical @security — both tokens expired forces logout', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('owner-portal: dual expiry redirects to /login without refresh loop', async ({
    page,
    context,
  }) => {
    // 1. Login.
    await page.goto(process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(testUsers.owner.email);
    await page.getByLabel(/password/i).fill(testUsers.owner.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await page.waitForURL(/\/dashboard/i, { timeout: 15000 }).catch(() => undefined);

    // 2. Locate and expire BOTH tokens.
    const accessCookie = await getCookieValue(context, AUTH_COOKIE_CANDIDATES);
    const refreshCookie = await getCookieValue(context, REFRESH_COOKIE_CANDIDATES);
    const lsToken = accessCookie ? null : await readJwtFromLocalStorage(page);

    if (!accessCookie && !lsToken) {
      test.fixme(true, 'No access token surface to tamper with');
      return;
    }

    if (accessCookie) {
      await replaceCookieValue(context, accessCookie.name, forgeExpiredJwt(accessCookie.value, 7200));
    } else if (lsToken) {
      await page.evaluate(
        ({ key, jwt }) => window.localStorage.setItem(key, jwt),
        { key: lsToken.key, jwt: forgeExpiredJwt(lsToken.jwt, 7200) },
      );
    }
    if (refreshCookie) {
      await replaceCookieValue(
        context,
        refreshCookie.name,
        forgeExpiredJwt(refreshCookie.value, 86400),
      );
    }

    // 3. Count refresh attempts — there MUST be at most one.
    let refreshAttempts = 0;
    page.on('request', (req) => {
      if (/\/(auth|api).*\/(refresh|token)/i.test(req.url())) refreshAttempts += 1;
    });

    // 4. Trigger an authenticated nav.
    await page.goto('/properties').catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    // Brief settle so any stray refresh retries can fire & be counted.
    await page.waitForTimeout(2000);

    // 5. Should be on /login, no infinite refresh loop.
    expect(page.url(), 'must be redirected to /login').toMatch(/\/login/i);
    expect(refreshAttempts, 'no refresh-loop: at most 1 attempt').toBeLessThanOrEqual(1);

    // 6. Session storage must be cleared.
    const remainingAuthLs = await page.evaluate((keys) => {
      for (const k of keys) {
        const v = window.localStorage.getItem(k);
        if (v && v.length > 0) return { key: k, hasValue: true };
      }
      return null;
    }, ['token', 'auth', 'access_token', 'refreshToken', 'user', 'session']);
    expect(
      remainingAuthLs,
      `auth state must be cleared on dual expiry (found ${remainingAuthLs?.key ?? 'none'})`,
    ).toBeNull();

    const remainingCookies = (await context.cookies()).filter((c) =>
      [...AUTH_COOKIE_CANDIDATES, ...REFRESH_COOKIE_CANDIDATES].includes(c.name as never),
    );
    expect(
      remainingCookies.filter((c) => c.value.length > 0),
      'auth cookies must be cleared on dual expiry',
    ).toHaveLength(0);
  });
});

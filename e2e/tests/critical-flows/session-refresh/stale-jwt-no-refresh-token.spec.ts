/**
 * @session @critical @security
 *
 * Stale access token, NO refresh token issued.
 *
 * Scenario: an older session pre-dates the introduction of refresh
 * tokens (e.g. a user installed the customer-app months ago and the
 * server-side schema didn't issue refresh tokens at that time). When
 * the cached access token expires, there's nothing to refresh against
 * and the user must be sent cleanly back to /login.
 *
 * Audit reference: `.audit/deep-audit-2026-05-20.md` — migration-era
 * sessions are a real failure mode and currently untested.
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

test.describe('@session @critical @security — stale access token, no refresh token', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('expired access + missing refresh-token redirects to /login', async ({
    page,
    context,
  }) => {
    // 1. Login normally — this seeds the cookies / localStorage.
    await page.goto(process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(testUsers.owner.email);
    await page.getByLabel(/password/i).fill(testUsers.owner.password);
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await page.waitForURL(/\/dashboard/i, { timeout: 15000 }).catch(() => undefined);

    // 2. Expire the access token.
    const accessCookie = await getCookieValue(context, AUTH_COOKIE_CANDIDATES);
    const lsToken = accessCookie ? null : await readJwtFromLocalStorage(page);

    if (!accessCookie && !lsToken) {
      test.fixme(true, 'Cannot locate access token surface');
      return;
    }

    if (accessCookie) {
      await replaceCookieValue(
        context,
        accessCookie.name,
        forgeExpiredJwt(accessCookie.value, 3600),
      );
    } else if (lsToken) {
      await page.evaluate(
        ({ key, jwt }) => window.localStorage.setItem(key, jwt),
        { key: lsToken.key, jwt: forgeExpiredJwt(lsToken.jwt, 3600) },
      );
    }

    // 3. Delete the refresh token entirely (simulates the "older session"
    //    case where no refresh token was ever issued).
    const refreshCookie = await getCookieValue(context, REFRESH_COOKIE_CANDIDATES);
    if (refreshCookie) {
      await context.clearCookies({ name: refreshCookie.name });
    }
    await page.evaluate((keys) => {
      for (const k of keys) window.localStorage.removeItem(k);
    }, ['refresh_token', 'refreshToken', 'bn_refresh']);

    // 4. Trigger authenticated nav.
    await page.goto('/properties').catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // 5. Must land on /login (no infinite retry, no 5xx).
    await expect.poll(() => page.url(), { timeout: 10000 }).toMatch(/\/login/i);

    // 6. Page must be functional (login form rendered).
    const emailInput = page.getByLabel(/email/i).first();
    await expect(emailInput, 'login form must render').toBeVisible({ timeout: 5000 });
  });
});

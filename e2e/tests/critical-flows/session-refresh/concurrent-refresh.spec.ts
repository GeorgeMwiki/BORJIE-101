/**
 * @session @critical @security
 *
 * Concurrent refresh coordination across tabs.
 *
 * Scenario: user has BORJIE open in 3 tabs (e.g. dashboard,
 * properties, leases). The access token expires. All 3 tabs notice
 * and want to refresh. A correctly-implemented client uses BroadcastChannel
 * or storage events so ONLY ONE refresh request hits the server; the
 * other tabs pick up the new token from local-storage propagation.
 *
 * Without this coordination the gateway is hammered with N parallel
 * refresh calls every time a token cycles, and only one can succeed
 * (refresh tokens are usually single-use) — the others log the user out.
 *
 * Audit reference: `.audit/deep-audit-2026-05-20.md`. DA4 promotion:
 * the previous version of this spec fixme'd when zero refresh calls
 * were observed (silent gap). Zero refreshes means the client doesn't
 * even try to refresh — a launch blocker, not a "future work" item.
 * We now FAIL on `refreshCalls === 0` so the gap is loud.
 */
import { test, expect } from '@playwright/test';
import { REAL_BACKEND_ENABLED } from '../../../fixtures/dual-tenant-fixtures';
import { testUsers } from '../../../fixtures/test-data';
import {
  AUTH_COOKIE_CANDIDATES,
  forgeExpiredJwt,
  getCookieValue,
  readJwtFromLocalStorage,
  replaceCookieValue,
} from '../../../fixtures/jwt-helpers';

test.describe('@session @critical @security — concurrent refresh across tabs', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('3 tabs with expired token → max 1 refresh hits the server', async ({
    browser,
  }) => {
    // Shared context so all 3 tabs share cookies AND localStorage.
    const context = await browser.newContext({
      baseURL: process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000',
    });

    // Count refresh calls across the whole context.
    let refreshCalls = 0;
    context.on('request', (req) => {
      if (/\/(auth|api).*\/(refresh|token)/i.test(req.url())) refreshCalls += 1;
    });

    try {
      // 1. Login on tab A.
      const tabA = await context.newPage();
      await tabA.goto('/login');
      await tabA.getByLabel(/email/i).fill(testUsers.owner.email);
      await tabA.getByLabel(/password/i).fill(testUsers.owner.password);
      await tabA.getByRole('button', { name: /sign in|login/i }).click();
      await tabA.waitForURL(/\/dashboard/i, { timeout: 15000 }).catch(() => undefined);

      // 2. Open two more tabs — they should pick up the session.
      const tabB = await context.newPage();
      await tabB.goto('/dashboard');
      const tabC = await context.newPage();
      await tabC.goto('/dashboard');

      // 3. Expire the shared access token (cookie OR localStorage).
      const accessCookie = await getCookieValue(context, AUTH_COOKIE_CANDIDATES);
      const lsToken = accessCookie ? null : await readJwtFromLocalStorage(tabA);

      if (!accessCookie && !lsToken) {
        test.fixme(true, 'No access token surface to expire');
        return;
      }

      if (accessCookie) {
        await replaceCookieValue(
          context,
          accessCookie.name,
          forgeExpiredJwt(accessCookie.value, 120),
        );
      } else if (lsToken) {
        await tabA.evaluate(
          ({ key, jwt }) => window.localStorage.setItem(key, jwt),
          { key: lsToken.key, jwt: forgeExpiredJwt(lsToken.jwt, 120) },
        );
      }

      // 4. Trigger an authenticated request in all 3 tabs simultaneously.
      await Promise.all([
        tabA.goto('/properties').catch(() => undefined),
        tabB.goto('/leases').catch(() => undefined),
        tabC.goto('/maintenance').catch(() => undefined),
      ]);
      await Promise.all([
        tabA.waitForLoadState('networkidle').catch(() => undefined),
        tabB.waitForLoadState('networkidle').catch(() => undefined),
        tabC.waitForLoadState('networkidle').catch(() => undefined),
      ]);
      // Settle window — coordination should be done within 3s.
      await tabA.waitForTimeout(3000);

      // 5. DA4 strengthening: refresh MUST be observed at least once. The
      //    previous fixme'd path silently passed when the client didn't
      //    even attempt a refresh — which is a launch-blocker bug
      //    (users get logged out instantly on token expiry), not a gap.
      //    And coordination must keep the call count ≤ 1 so single-use
      //    refresh tokens don't invalidate sibling tabs.
      expect(
        refreshCalls,
        `at least one tab must refresh the expired token (got ${refreshCalls}) — ` +
          'if zero, the client never tries to refresh and users are logged out',
      ).toBeGreaterThan(0);
      expect(
        refreshCalls,
        `tabs must coordinate: expected ≤1 refresh call, got ${refreshCalls} — ` +
          'multiple parallel refreshes will invalidate each other on single-use tokens',
      ).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
});

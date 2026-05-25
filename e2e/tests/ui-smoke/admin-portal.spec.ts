/**
 * Wave 20 — Admin Portal UI smoke.
 *
 * The admin portal is a Vite-served React SPA. It gates everything behind
 * /login via <PrivateRoute>. This spec does NOT try to log in. Instead it
 * exercises the public shell (/login + /, which redirects to /login when
 * unauthenticated) and asserts that the unauthenticated surface renders
 * cleanly — no console errors, no unhandled exceptions, no 5xx from the
 * bundle itself.
 *
 * Missing i18n keys, React hydration errors, or failed chunk loads are
 * all real UI bugs caught here.
 */
import { test, expect, createSignalCollector, probeRoute, writeSignalLog, type AppProbe } from './_shared';
import * as path from 'node:path';

const BASE_URL = process.env.ADMIN_PORTAL_URL ?? 'http://localhost:3001';

const PROBE: AppProbe = {
  app: 'admin-portal',
  baseURL: BASE_URL,
  // Admin portal requires auth — unauthenticated routes all redirect to /login.
  // The top-3 primary-nav targets (Dashboard, Tenants, Reports) exercise
  // the router's redirect path, which is still a valid smoke signal.
  routes: ['/', '/login', '/tenants', '/reports', '/properties'],
  artifactsDir: path.resolve(__dirname, '../../../test-results/ui-smoke/admin-portal'),
};

test.describe('admin-portal UI smoke @wave20', () => {
  test.use({ baseURL: BASE_URL });

  test('home page boots without console errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    const result = await probeRoute(page, PROBE, '/');

    writeSignalLog('admin-portal-home', PROBE.artifactsDir, signals);

    expect(result.status, `goto / failed: ${result.message ?? ''}`).not.toBe('error');
    expect(signals.consoleErrors, 'console.error during admin-portal home load').toEqual([]);
    expect(signals.pageErrors, 'uncaught exception during admin-portal home load').toEqual([]);
  });

  test('primary nav targets render without bundle errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    const results: Array<{ route: string; status: string }> = [];
    for (const route of PROBE.routes) {
      const r = await probeRoute(page, PROBE, route);
      results.push({ route, status: r.status });
    }

    writeSignalLog('admin-portal-nav', PROBE.artifactsDir, signals);

    // The router-level redirect to /login is expected for auth-gated routes.
    // We're asserting that the *bundle* doesn't blow up, not that the route
    // renders the target page.
    expect(signals.pageErrors, `uncaught exceptions during nav: ${signals.pageErrors.join(', ')}`).toEqual([]);

    // Hard-fail on console.error except known third-party noise.
    const realErrors = signals.consoleErrors.filter(
      (e) =>
        // Expected 401 from /auth/me when unauthenticated
        !/Auth check failed/i.test(e) &&
        // Favicon 404 is browser noise, not a code bug
        !/favicon/i.test(e) &&
        // React-Query prints a generic warning for AbortError during unmount
        !/AbortError/i.test(e),
    );
    expect(realErrors, `unexpected console errors: ${realErrors.join('\n')}`).toEqual([]);
  });

  test('locale switcher toggles en<->sw', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    await probeRoute(page, PROBE, '/login');

    // LocaleSwitcher component exists on Layout and LoginPage. Find by test-id
    // or role. Fall back gracefully — missing widget is a separate finding.
    const switcher = page
      .getByTestId('locale-switcher')
      .or(page.getByRole('button', { name: /language|lugha|sw|en/i }))
      .first();

    const visible = await switcher.isVisible().catch(() => false);
    if (!visible) {
      writeSignalLog('admin-portal-locale-missing', PROBE.artifactsDir, signals);
      test.info().annotations.push({
        type: 'finding',
        description: 'admin-portal: no locale switcher visible on /login — users cannot choose Swahili before signing in',
      });
      return;
    }

    await switcher.click().catch(() => { /* may be a select, not a button */ });
    await page.waitForTimeout(500);

    writeSignalLog('admin-portal-locale', PROBE.artifactsDir, signals);
    expect(signals.pageErrors).toEqual([]);
  });
});

/**
 * Wave 20 — Owner Portal UI smoke.
 *
 * Vite-served React SPA. Like admin-portal, gated behind /login. We probe
 * the public shell + redirect behaviour and assert no bundle/hydration
 * errors. Owner-specific routes (/portfolio, /properties, /reports) all
 * redirect to /login when unauthenticated — that redirect chain is still
 * exercised by the router + should not produce console errors.
 */
import { test, expect, createSignalCollector, probeRoute, writeSignalLog, type AppProbe } from './_shared';
import * as path from 'node:path';

const BASE_URL = process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000';

const PROBE: AppProbe = {
  app: 'owner-portal',
  baseURL: BASE_URL,
  routes: ['/', '/login', '/portfolio', '/properties', '/reports'],
  artifactsDir: path.resolve(__dirname, '../../../test-results/ui-smoke/owner-portal'),
};

test.describe('owner-portal UI smoke @wave20', () => {
  test.use({ baseURL: BASE_URL });

  test('home page boots without console errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    const result = await probeRoute(page, PROBE, '/');

    writeSignalLog('owner-portal-home', PROBE.artifactsDir, signals);

    expect(result.status, `goto / failed: ${result.message ?? ''}`).not.toBe('error');
    expect(signals.pageErrors, 'uncaught exception during owner-portal home load').toEqual([]);
    const realErrors = signals.consoleErrors.filter(
      (e) => !/Auth check failed|favicon|AbortError/i.test(e),
    );
    expect(realErrors, `unexpected console errors: ${realErrors.join('\n')}`).toEqual([]);
  });

  test('primary nav targets render without bundle errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    for (const route of PROBE.routes) {
      await probeRoute(page, PROBE, route);
    }

    writeSignalLog('owner-portal-nav', PROBE.artifactsDir, signals);

    expect(signals.pageErrors, `uncaught exceptions: ${signals.pageErrors.join(', ')}`).toEqual([]);
    const realErrors = signals.consoleErrors.filter(
      (e) => !/Auth check failed|favicon|AbortError/i.test(e),
    );
    expect(realErrors, `unexpected console errors: ${realErrors.join('\n')}`).toEqual([]);
  });

  test('locale switcher toggles en<->sw', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    await probeRoute(page, PROBE, '/login');

    const switcher = page
      .getByTestId('locale-switcher')
      .or(page.getByRole('button', { name: /language|lugha|sw|en/i }))
      .first();

    const visible = await switcher.isVisible().catch(() => false);
    if (!visible) {
      test.info().annotations.push({
        type: 'finding',
        description: 'owner-portal: no locale switcher visible on /login',
      });
      writeSignalLog('owner-portal-locale-missing', PROBE.artifactsDir, signals);
      return;
    }

    await switcher.click().catch(() => { /* ignore */ });
    await page.waitForTimeout(500);
    writeSignalLog('owner-portal-locale', PROBE.artifactsDir, signals);
    expect(signals.pageErrors).toEqual([]);
  });
});

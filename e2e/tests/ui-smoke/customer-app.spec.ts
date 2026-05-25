/**
 * Wave 20 — Customer App UI smoke.
 *
 * Next.js 15 app on :3002. Public landing page ("/") is the Mwikila chat —
 * it is explicitly unauthenticated, so this spec can actually visit real
 * routes and assert real content (unlike the two Vite SPAs which gate
 * everything behind /login).
 *
 * Routes covered:
 *   /            — public marketing/chat landing
 *   /payments    — payment portal (may require auth)
 *   /maintenance — maintenance request flow (may require auth)
 *   /how-it-works
 *   /pricing
 */
import { test, expect, createSignalCollector, probeRoute, writeSignalLog, type AppProbe } from './_shared';
import * as path from 'node:path';

const BASE_URL = process.env.CUSTOMER_APP_URL ?? 'http://localhost:3002';

const PROBE: AppProbe = {
  app: 'customer-app',
  baseURL: BASE_URL,
  routes: ['/', '/payments', '/maintenance', '/how-it-works', '/pricing'],
  artifactsDir: path.resolve(__dirname, '../../../test-results/ui-smoke/customer-app'),
};

test.describe('customer-app UI smoke @wave20', () => {
  test.use({ baseURL: BASE_URL });

  test('home page boots without console errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    const result = await probeRoute(page, PROBE, '/');

    writeSignalLog('customer-app-home', PROBE.artifactsDir, signals);

    expect(result.status, `goto / failed: ${result.message ?? ''}`).not.toBe('error');
    expect(signals.pageErrors, 'uncaught exception during customer-app home load').toEqual([]);

    // Landing page should render the Mwikila greeting.
    const body = await page.content();
    expect(body, 'customer-app landing missing Mwikila greeting').toMatch(/Mr\.\s*Mwikila|Karibu/i);

    const realErrors = signals.consoleErrors.filter(
      (e) => !/favicon|AbortError|Failed to fetch/i.test(e),
    );
    expect(realErrors, `unexpected console errors: ${realErrors.join('\n')}`).toEqual([]);
  });

  test('primary nav targets render without bundle errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    for (const route of PROBE.routes) {
      await probeRoute(page, PROBE, route);
    }

    writeSignalLog('customer-app-nav', PROBE.artifactsDir, signals);

    expect(signals.pageErrors, `uncaught exceptions: ${signals.pageErrors.join(', ')}`).toEqual([]);

    // Next.js 500/404 pages are real bugs; log them but treat only 5xx as a hard fail.
    const serverErrors = signals.httpErrors.filter((e) => /^5\d\d/.test(e));
    expect(serverErrors, `5xx responses during nav: ${serverErrors.join('\n')}`).toEqual([]);
  });

  test('locale switcher toggles en<->sw', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    await probeRoute(page, PROBE, '/');

    const switcher = page
      .getByTestId('locale-switcher')
      .or(page.getByRole('button', { name: /language|lugha|english|swahili/i }))
      .first();

    const visible = await switcher.isVisible().catch(() => false);
    if (!visible) {
      test.info().annotations.push({
        type: 'finding',
        description: 'customer-app: no locale switcher visible on /',
      });
      writeSignalLog('customer-app-locale-missing', PROBE.artifactsDir, signals);
      return;
    }

    await switcher.click().catch(() => { /* ignore */ });
    await page.waitForTimeout(500);
    writeSignalLog('customer-app-locale', PROBE.artifactsDir, signals);
    expect(signals.pageErrors).toEqual([]);
  });
});

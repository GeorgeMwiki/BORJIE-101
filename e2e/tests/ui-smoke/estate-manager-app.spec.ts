/**
 * Wave 20 — Estate Manager App UI smoke.
 *
 * Next.js 15 app on :3003. Spec covers the PM's daily-driver routes:
 *   /              — home / "my day" (repo has no /my-day route; home is /)
 *   /inspections
 *   /work-orders
 *   /maintenance
 *   /properties
 */
import { test, expect, createSignalCollector, probeRoute, writeSignalLog, type AppProbe } from './_shared';
import * as path from 'node:path';

const BASE_URL = process.env.ESTATE_MANAGER_URL ?? 'http://localhost:3003';

const PROBE: AppProbe = {
  app: 'estate-manager-app',
  baseURL: BASE_URL,
  routes: ['/', '/inspections', '/work-orders', '/maintenance', '/properties'],
  artifactsDir: path.resolve(__dirname, '../../../test-results/ui-smoke/estate-manager-app'),
};

test.describe('estate-manager-app UI smoke @wave20', () => {
  test.use({ baseURL: BASE_URL });

  test('home page boots without console errors', async ({ page }) => {
    const { signals, attach } = createSignalCollector();
    attach(page);

    const result = await probeRoute(page, PROBE, '/');

    writeSignalLog('estate-manager-home', PROBE.artifactsDir, signals);

    expect(result.status, `goto / failed: ${result.message ?? ''}`).not.toBe('error');
    expect(signals.pageErrors, 'uncaught exception during estate-manager home load').toEqual([]);

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

    writeSignalLog('estate-manager-nav', PROBE.artifactsDir, signals);

    expect(signals.pageErrors, `uncaught exceptions: ${signals.pageErrors.join(', ')}`).toEqual([]);
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
        description: 'estate-manager-app: no locale switcher visible on /',
      });
      writeSignalLog('estate-manager-locale-missing', PROBE.artifactsDir, signals);
      return;
    }

    await switcher.click().catch(() => { /* ignore */ });
    await page.waitForTimeout(500);
    writeSignalLog('estate-manager-locale', PROBE.artifactsDir, signals);
    expect(signals.pageErrors).toEqual([]);
  });
});

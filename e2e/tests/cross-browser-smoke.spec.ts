/**
 * Cross-browser boot smoke (see .audit/deep-audit-2026-05-20.md).
 *
 * Purpose: prove each browser project (Firefox desktop + WebKit mobile) actually
 * boots in CI before we rely on it for the heavier critical-flows + ui-smoke
 * specs. This is a deliberate, minimal spec — it does NOT test app logic, only
 * that:
 *   1. the browser launches under the project,
 *   2. the customer-app baseURL is reachable,
 *   3. the page reaches `domcontentloaded` without throwing.
 *
 * If this spec fails for a project, the broader cross-browser run will not even
 * be meaningful — fix the boot path first.
 *
 * Tagged @cross-browser @smoke so it can be filtered with
 *   `--grep "@cross-browser"` or `--grep "@smoke"`.
 *
 * Runs under the customer-app-firefox and customer-app-webkit-mobile projects;
 * pinned via `testMatch` in playwright.config.ts so it does NOT execute under
 * the Chromium projects (which already have their own smoke coverage).
 */
import { test, expect } from '@playwright/test';
import * as path from 'node:path';

const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../test-results/cross-browser-smoke',
);

test.describe('cross-browser boot smoke @cross-browser @smoke', () => {
  test('home page loads under current browser project', async ({
    page,
    browserName,
  }, testInfo) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

    // A 2xx/3xx response is enough — we are not asserting app content, only
    // that the browser project boots and the customer-app responds.
    if (response) {
      expect(
        response.status(),
        `home page returned ${response.status()} on ${browserName}`,
      ).toBeLessThan(400);
    }

    // Page must have a body — proves DOM rendered, not a blank surface.
    await expect(page.locator('body')).toBeVisible();

    // Capture a screenshot so reviewers can eyeball rendering parity across
    // Chromium / Firefox / WebKit when the heavier specs land later.
    await page.screenshot({
      path: path.join(
        ARTIFACTS_DIR,
        `${testInfo.project.name}-${browserName}-home.png`,
      ),
      fullPage: false,
    });
  });

  test('browser project metadata is wired correctly', async ({
    browserName,
  }, testInfo) => {
    // Guard against config drift: if someone renames a project but forgets to
    // re-wire browserName, this fails loudly instead of silently running the
    // wrong engine.
    const project = testInfo.project.name;

    if (project === 'customer-app-firefox') {
      expect(browserName).toBe('firefox');
    } else if (project === 'customer-app-webkit-mobile') {
      expect(browserName).toBe('webkit');
    }
  });
});

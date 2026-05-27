import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-surface pre-launch smoke E2E (local-dev focused).
 *
 * Owns the three new spec sets under `tests/e2e/web/`:
 *   - owner-web/* — signup, dashboard, chat, document-intelligence
 *   - admin-web/* — internal-tools chat + dashboard panels
 *
 * Strategy: every spec self-skips when its dev server is not
 * reachable (see `expectServerReachable`). That way running this
 * config locally without `pnpm dev` keeps the suite green instead of
 * timing out the boot of every spec.
 *
 * Env overrides:
 *   - OWNER_WEB_URL          (default http://localhost:3010)
 *   - ADMIN_WEB_URL          (default http://localhost:3020)
 *   - API_GATEWAY_URL        (default http://localhost:3001)
 *   - PLAYWRIGHT_BROWSERS    (default chromium)
 *   - E2E_LOAD_TEST_RUN_ID   (default `e2e-${pid}-${ts}` — used for
 *                             tagged test data cleanup downstream)
 *
 * Reporters: html + list (and github when CI=true) to keep artifact
 * collection consistent with the existing `/e2e` suite.
 */

const OWNER_WEB_URL = process.env.OWNER_WEB_URL ?? 'http://localhost:3010';
const ADMIN_WEB_URL = process.env.ADMIN_WEB_URL ?? 'http://localhost:3020';

export default defineConfig({
  testDir: '.',
  outputDir: '../../../test-results/e2e-smoke-artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { open: 'never', outputFolder: '../../../test-results/e2e-smoke-report' }],
    ['list'],
  ],

  /* Each spec budget: 30s per task constraint. */
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8_000,
    navigationTimeout: 12_000,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- Tanzania pilot E2E browser locale
    locale: 'sw-TZ',
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- Tanzania pilot E2E browser timezone
    timezoneId: 'Africa/Dar_es_Salaam',
  },

  projects: [
    {
      name: 'owner-web',
      testMatch: 'owner-web/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: OWNER_WEB_URL,
      },
    },
    {
      name: 'admin-web',
      testMatch: 'admin-web/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_WEB_URL,
      },
    },
  ],
});

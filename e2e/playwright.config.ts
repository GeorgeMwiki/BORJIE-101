import { defineConfig, devices } from '@playwright/test';

/**
 * BORJIE Platform E2E Configuration
 *
 * Real-backend mode (default — production-faithful, used by CI):
 *   - Start the stack with `docker compose -f docker-compose.e2e.yml up -d --wait`
 *     (or `pnpm test:e2e:local`) which boots postgres + api-gateway + customer-app.
 *   - Specs hit the real api-gateway. `page.route()` mocks of internal endpoints
 *     are FORBIDDEN — they hid the FeedbackThumbs 👍/👎 schema mismatch the
 *     wave-K audit caught. Third-party connectors (M-Pesa STK) MAY be mocked at
 *     the network level, but the api-gateway itself never is.
 *
 * Legacy stub-server mode (opt-in only):
 *   - Set `E2E_USE_STUB=1` to boot the lightweight HTML stub on ports 3000-3003.
 *     Specs that use `page.route()` still pass, but THIS PATH CAN HIDE BUGS.
 *     Reserved for local iteration on UI selectors, never the default.
 *
 * Environment overrides (CI / staging): OWNER_PORTAL_URL, ADMIN_PORTAL_URL,
 * CUSTOMER_APP_URL, ESTATE_MANAGER_URL, API_GATEWAY_URL, E2E_TEST_* creds.
 * @see https://playwright.dev/docs/test-configuration
 */

const USE_STUB = process.env.E2E_USE_STUB === '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { open: 'never', outputFolder: 'e2e-report' }],
    ['list'],
    ...(process.env.CI ? [['github'] as const] : []),
  ],

  /* Global timeout for each test */
  timeout: 60000,

  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3003',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,

    /* Viewport size */
    viewport: { width: 1280, height: 720 },

    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: true,

    /* Locale and timezone — Kenya pilot E2E browser context */
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test browser locale
    locale: 'en-KE',
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test browser timezone
    timezoneId: 'Africa/Nairobi',
  },

  /*
   * Project scoping.
   *
   *   - Each project pins `testMatch` to its own subdirectory under tests/ so
   *     `--project=customer-app` no longer accidentally runs admin-portal or
   *     estate-manager specs (the wave-K audit found control-tower.spec.ts
   *     timing out under the customer-app project because it had no testMatch).
   *
   *   - The default `testDir: './tests'` plus per-project `testMatch` means a
   *     run with no project filter still discovers every spec; a run with
   *     `--project=customer-app` enumerates ONLY customer-app/**.
   */
  projects: [
    /* Setup project for authentication state */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    /* Estate Manager Portal */
    {
      name: 'estate-manager',
      testMatch: 'estate-manager-app/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ESTATE_MANAGER_URL ?? 'http://localhost:3003',
      },
    },

    /* Customer Mobile App / PWA */
    {
      name: 'customer-app',
      testMatch: 'customer-app/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.CUSTOMER_APP_URL ?? 'http://localhost:3002',
      },
    },

    /* Customer App - Mobile viewport */
    {
      name: 'customer-app-mobile',
      testMatch: 'customer-app/**/*.spec.ts',
      use: {
        ...devices['iPhone 13'],
        baseURL: process.env.CUSTOMER_APP_URL ?? 'http://localhost:3002',
      },
    },

    /* Owner Portal */
    {
      name: 'owner-portal',
      testMatch: 'owner-portal/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000',
      },
    },

    /* Admin Portal (Internal) */
    {
      name: 'admin-portal',
      testMatch: 'admin-portal/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_PORTAL_URL ?? 'http://localhost:3001',
      },
    },

    /*
     * Borjie golden-path smoke (admin-web 3020 + owner-web 3010 + Expo
     * mobile static checks + api-gateway 3001). Each spec self-skips
     * when its target isn't reachable so a broken dev server never
     * fails this project on PR runs.
     */
    {
      name: 'borjie',
      testMatch: /borjie\/[^/]+\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    /*
     * Phase F.5 owner-live journey suite — 10 specs covering critical
     * owner workflows (signup → maintenance → arrears → KRA → briefing →
     * plan-mode → Skills → slash-commands). Each spec self-skips when
     * USE_REAL_SERVERS is unset so the project stays green on PR runs
     * that don't boot the docker-compose stack.
     */
    {
      name: 'owner-live-journeys',
      testMatch: 'journeys/owner-live-tests/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000',
      },
    },
  ],

  /*
   * Local dev servers.
   *
   * Real-backend mode (default): `webServer` is undefined — the operator runs
   * `docker compose -f docker-compose.e2e.yml up -d --wait` BEFORE
   * `pnpm test:e2e`. That way the api-gateway, customer-app, and postgres all
   * boot from the production-faithful Dockerfiles, real auth/feedback/payment
   * flows execute, and specs cannot accidentally mock internal endpoints.
   *
   * Stub-server mode (`E2E_USE_STUB=1`): boot the legacy node HTML stubs for
   * fast local iteration. Kept for backwards compat — DO NOT USE IN CI.
   */
  webServer: USE_STUB
    ? [
        {
          command: 'PORT=3002 node stub-server/stub.mjs',
          url: 'http://localhost:3002/__stub_ready',
          reuseExistingServer: !process.env.CI,
          timeout: 15000,
        },
        {
          command: 'PORT=3003 node stub-server/stub.mjs',
          url: 'http://localhost:3003/__stub_ready',
          reuseExistingServer: !process.env.CI,
          timeout: 15000,
        },
        {
          command: 'PORT=3000 node stub-server/stub.mjs',
          url: 'http://localhost:3000/__stub_ready',
          reuseExistingServer: !process.env.CI,
          timeout: 15000,
        },
        {
          command: 'PORT=3001 node stub-server/stub.mjs',
          url: 'http://localhost:3001/__stub_ready',
          reuseExistingServer: !process.env.CI,
          timeout: 15000,
        },
      ]
    : undefined,
});

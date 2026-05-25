import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `pnpm live-test` config — happy-path E2E against the new Supabase
 * project + api-gateway. Distinct from `e2e/playwright.config.ts`:
 *
 *   - testDir scoped to this directory only — never picks up the wider
 *     `e2e/tests` suite. The 10 specs are numbered (01..10) and run
 *     sequentially because each builds on prior state (tenant → property
 *     → lease → payment → ticket → brain → deny → cleanup).
 *
 *   - `fullyParallel: false` + `workers: 1` — sequential is essential.
 *
 *   - Longer per-step timeout (60s) — payment + brain calls hit live
 *     services and are slower than the stub-server suite.
 *
 *   - `globalSetup` validates env + caches tokens. `globalTeardown`
 *     deletes the test tenant defensively.
 *
 *   - No `webServer` — operator boots the api-gateway + frontends with
 *     `pnpm --filter @borjie/api-gateway dev` (etc) before running
 *     the suite. See Docs/RUNBOOKS/live-test.md for the exact sequence.
 */
export default defineConfig({
  testDir: resolve(__dirname),
  testMatch: /\d{2}-.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,

  /* Each step (single API or UI assertion) gets 60s — payment + brain
   * calls hit the real LLM and can take 20-30s end-to-end. */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  globalSetup: resolve(__dirname, 'global-setup.ts'),
  globalTeardown: resolve(__dirname, 'global-teardown.ts'),

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: resolve(__dirname, 'report') }],
    ...(process.env.CI ? [['github'] as const] : []),
  ],

  use: {
    baseURL: process.env.API_GATEWAY_URL ?? 'http://localhost:4000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test browser locale
    locale: 'en-KE',
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test browser timezone
    timezoneId: 'Africa/Nairobi',
    viewport: { width: 1280, height: 800 },
    ...devices['Desktop Chrome'],
  },

  projects: [
    {
      name: 'live-test',
    },
  ],

  /* No webServer — boot api-gateway + Supabase yourself. */
  webServer: undefined,
});

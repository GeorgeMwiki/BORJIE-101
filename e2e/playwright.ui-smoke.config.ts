import { defineConfig, devices } from '@playwright/test';

/**
 * Wave 20 — UI smoke config.
 *
 * Unlike the main playwright.config.ts, this config:
 *   - Does NOT boot the HTML stub server. It talks to whatever is already
 *     listening on the target ports (real dev servers started out-of-band).
 *   - Uses only Chromium.
 *   - Points each spec at its corresponding real app port.
 *   - Does NOT mock network traffic — we want real-UI signal.
 */
export default defineConfig({
  testDir: './tests/ui-smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/ui-smoke/results.json' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test browser locale
    locale: 'en-KE',
    // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test browser timezone
    timezoneId: 'Africa/Nairobi',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'chromium' },
  ],
  // Explicitly empty — we manage dev servers ourselves in this wave.
  webServer: undefined,
});

import type { Page, APIRequestContext } from '@playwright/test';

/**
 * Shared helpers for the cross-surface pre-launch smoke suite.
 *
 * Every spec MUST gate on `serverReachable` so a missing dev server
 * surfaces as a clean `test.skip(...)` rather than a 12-second
 * navigation timeout. The `loadTestRunId` constant tags every seeded
 * row so the cleanup job (`scripts/cleanup-loadtest.ts`) can purge
 * test data without touching real tenants.
 */

export const OWNER_WEB_URL =
  process.env['OWNER_WEB_URL'] ?? 'http://localhost:3010';

export const ADMIN_WEB_URL =
  process.env['ADMIN_WEB_URL'] ?? 'http://localhost:3020';

export const API_GATEWAY_URL =
  process.env['API_GATEWAY_URL'] ?? 'http://localhost:3001';

export const LOAD_TEST_RUN_ID =
  process.env['E2E_LOAD_TEST_RUN_ID'] ??
  `e2e-${process.pid}-${Date.now().toString(36)}`;

export async function serverReachable(
  request: APIRequestContext,
  url: string,
  path = '/',
): Promise<boolean> {
  try {
    const response = await request.get(`${url}${path}`, { timeout: 4_000 });
    return response.status() < 500;
  } catch {
    return false;
  }
}

export async function waitForChatHydrated(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-chat-root"]', {
    timeout: 8_000,
  });
  await page
    .locator('[data-testid="home-chat-hydrating"]')
    .waitFor({ state: 'detached', timeout: 6_000 })
    .catch(() => {
      /* hydration marker not always present — that's fine */
    });
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}+${LOAD_TEST_RUN_ID}@e2e.borjie.local`;
}

export function uniquePhoneE164(): string {
  /* Tanzania format placeholder — RLS will reject if a real signup
   * attempts to use this prefix in production seed data. */
  const tail = Math.floor(Math.random() * 90_000_000 + 10_000_000);
  return `+25571${tail}`;
}

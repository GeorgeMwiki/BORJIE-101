/**
 * Wave-2 deep-scrub journey:
 *   - customer-app /settings currency selection persists across navigations
 *   - customer-app /notifications shows retry-on-error and recovers after
 *     the gateway returns 200 on the second attempt
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  fulfillJson,
  ok,
  fail,
  seedCustomerAuth,
  screenshotCheckpoint,
} from './_helpers';

const CUSTOMER_BASE_URL = process.env.CUSTOMER_APP_URL ?? 'http://localhost:3002';

test.describe('customer-app settings & notifications @journeys', () => {
  test.use({ baseURL: CUSTOMER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real customer-app dev server (USE_REAL_SERVERS=1).');

  test.beforeEach(async ({ page }) => {
    await seedCustomerAuth(page);
  });

  test('changing currency persists in localStorage and survives reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    const currencySelect = page.getByLabel(/currency display|currency/i);
    await expect(currencySelect).toBeVisible();
    await currencySelect.selectOption('USD');

    // The page persists to localStorage synchronously.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('customer_display_currency'),
    );
    expect(stored).toBe('USD');

    // Reload — the new value is read from localStorage on mount.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByLabel(/currency display|currency/i)).toHaveValue('USD');

    // Reset to KES and confirm round-trip works in the other direction.
    await page.getByLabel(/currency display|currency/i).selectOption('KES');
    await page.reload();
    await expect(page.getByLabel(/currency display|currency/i)).toHaveValue('KES');
  });

  test('notification toggles persist across reload', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    // SMS is off by default in DEFAULT_PREFS — flip it on.
    const smsSwitch = page.getByRole('switch').nth(2);
    await expect(smsSwitch).toHaveAttribute('aria-checked', 'false');
    await smsSwitch.click();
    await expect(smsSwitch).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await expect(page.getByRole('switch').nth(2)).toHaveAttribute('aria-checked', 'true');

    // Cleanup: flip back.
    await page.getByRole('switch').nth(2).click();
    await expect(page.getByRole('switch').nth(2)).toHaveAttribute('aria-checked', 'false');
  });

  test('notifications page retries on error and recovers', async ({ page }) => {
    let attempt = 0;
    await page.route('**/api/v1/notifications**', async (route) => {
      attempt += 1;
      if (attempt === 1) {
        return fulfillJson(route, fail('Upstream timeout', 'E_TIMEOUT'), 504);
      }
      return fulfillJson(
        route,
        ok([
          {
            id: 'n1',
            title: 'Rent due Friday',
            body: '15,000 KES due on 2026-05-12',
            category: 'PAYMENT',
            createdAt: new Date().toISOString(),
            read: false,
            actionUrl: '/payments',
          },
        ]),
      );
    });

    await page.goto('/notifications');
    await expect(page.getByRole('alert')).toBeVisible();
    await screenshotCheckpoint(page, 'notifications-error-state');

    await page.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(page.getByText('Rent due Friday')).toBeVisible();
    await expect(page.getByText('PAYMENT')).toBeVisible();
    expect(attempt).toBe(2);
  });

  test('notifications page renders the empty state when the feed is empty', async ({ page }) => {
    await page.route('**/api/v1/notifications**', async (route) => {
      await fulfillJson(route, ok([]));
    });
    await page.goto('/notifications');
    // The empty-state message comes from notificationsList.empty: "You are all caught up."
    await expect(page.getByText(/all caught up/i)).toBeVisible();
  });
});

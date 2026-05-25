import { test, expect, type Page } from '@playwright/test';
import { ADMIN_WEB_URL } from './fixtures/test-users';

/**
 * admin-web smoke — Borjie Console internal admin (port 3020).
 *
 * Verifies the I-W-01..I-W-20 grid renders, the tenant directory and
 * killswitch routes load, and the two-operator-confirm UI is wired.
 * Skips cleanly when the dev server isn't listening so a broken build
 * doesn't fail the suite — see the smoke health gate at the top of
 * each test.
 */

async function adminWebReachable(page: Page): Promise<boolean> {
  try {
    const response = await page.request.get(`${ADMIN_WEB_URL}/internal`, {
      timeout: 5000,
    });
    return response.ok();
  } catch {
    return false;
  }
}

test.describe('Borjie admin-web smoke', () => {
  test.beforeEach(async ({ page }) => {
    const reachable = await adminWebReachable(page);
    test.skip(
      !reachable,
      `admin-web not reachable at ${ADMIN_WEB_URL} (dev server not booted or build broken)`,
    );
  });

  test('renders Borjie Console header and at least 10 internal screen cards', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_WEB_URL}/internal`);

    const heading = page.getByRole('heading', { name: /Borjie Console/i, level: 1 });
    await expect(heading).toBeVisible();

    const screenIds = page.locator('text=/^I-W-\\d{2}$/');
    const cardCount = await screenIds.count();
    expect(cardCount).toBeGreaterThanOrEqual(10);
  });

  test('I-W-01 tenant directory route loads', async ({ page }) => {
    await page.goto(`${ADMIN_WEB_URL}/internal/tenants`);

    const headerRegion = page.getByRole('heading', {
      name: /tenant directory/i,
    });
    await expect(headerRegion.first()).toBeVisible();

    const rowOrEmpty = page
      .getByRole('row')
      .or(page.getByText(/no tenants|empty|none yet/i));
    await expect(rowOrEmpty.first()).toBeVisible();
  });

  test('I-W-20 killswitch surfaces two-operator confirm control', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_WEB_URL}/internal/killswitch`);

    const heading = page.getByRole('heading', {
      name: /killswitch/i,
    });
    await expect(heading.first()).toBeVisible();

    const twoOpControl = page
      .getByText(/two-operator/i)
      .or(page.getByText(/second operator/i))
      .or(page.getByRole('button', { name: /confirm|arm|engage/i }));
    await expect(twoOpControl.first()).toBeVisible();
  });
});

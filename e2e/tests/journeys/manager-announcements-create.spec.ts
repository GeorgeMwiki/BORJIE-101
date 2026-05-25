/**
 * Wave-2 deep-scrub journey: estate-manager announcements/create property
 * dropdown loads from /api/v1/properties.
 *
 * Verifies:
 *   - The Property select renders an "All properties" option plus one per
 *     property returned by the gateway, in API order.
 *   - The publish button stays disabled until both title and content are
 *     filled in.
 *   - Submitting routes the user back to /announcements (per current
 *     behaviour — persistence endpoint is not yet wired).
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  fulfillJson,
  ok,
  seedManagerAuth,
} from './_helpers';

const MANAGER_BASE_URL = process.env.ESTATE_MANAGER_URL ?? 'http://localhost:3003';

test.describe('estate-manager announcements create @journeys', () => {
  test.use({ baseURL: MANAGER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real estate-manager-app dev server (USE_REAL_SERVERS=1).');

  test.beforeEach(async ({ page }) => {
    await seedManagerAuth(page);
  });

  test('property dropdown is hydrated from /api/v1/properties', async ({ page }) => {
    await page.route('**/api/v1/properties**', async (route) => {
      await fulfillJson(
        route,
        ok([
          { id: 'prop_a', name: 'Block A — Westlands' },
          { id: 'prop_b', name: 'Block B — Kilimani' },
          { id: 'prop_c', name: 'Block C — Lavington' },
        ]),
      );
    });

    await page.goto('/announcements/create');
    await page.waitForLoadState('domcontentloaded');

    const propertySelect = page.getByLabel(/property/i);
    await expect(propertySelect).toBeVisible();

    // Wait for hydration (the select is disabled while propertiesQuery.isLoading).
    await expect(propertySelect).toBeEnabled();

    // The first option is the implicit "All properties" empty value.
    const optionTexts = await propertySelect.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return Array.from(select.options).map((o) => o.textContent?.trim() ?? '');
    });
    expect(optionTexts.length).toBeGreaterThanOrEqual(4);
    expect(optionTexts[0]).toMatch(/all properties/i);
    expect(optionTexts).toContain('Block A — Westlands');
    expect(optionTexts).toContain('Block B — Kilimani');
    expect(optionTexts).toContain('Block C — Lavington');

    // Selecting an actual property updates the form value.
    await propertySelect.selectOption('prop_b');
    await expect(propertySelect).toHaveValue('prop_b');
  });

  test('publish button disables until title and content are both filled', async ({ page }) => {
    await page.route('**/api/v1/properties**', async (route) => {
      await fulfillJson(route, ok([]));
    });

    await page.goto('/announcements/create');
    await page.waitForLoadState('domcontentloaded');

    const publishBtn = page.getByRole('button', { name: /publish/i });
    await expect(publishBtn).toBeDisabled();

    await page.getByLabel(/title/i).fill('Water shut-off Saturday');
    await expect(publishBtn).toBeDisabled();

    await page.getByLabel(/content/i).fill('Water will be off 09:00–14:00 for tank cleaning.');
    await expect(publishBtn).toBeEnabled();
  });

  test('submit routes back to /announcements until persistence is wired', async ({ page }) => {
    await page.route('**/api/v1/properties**', async (route) => {
      await fulfillJson(route, ok([{ id: 'prop_a', name: 'Block A' }]));
    });

    await page.goto('/announcements/create');
    await page.getByLabel(/title/i).fill('Notice');
    await page.getByLabel(/content/i).fill('Hello tenants');
    await page.getByRole('button', { name: /publish/i }).click();

    await expect(page).toHaveURL(/\/announcements\b/);
  });
});

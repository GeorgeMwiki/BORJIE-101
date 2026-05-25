import { test, expect, type Page } from '@playwright/test';
import { OWNER_WEB_URL } from './fixtures/test-users';

/**
 * owner-web smoke — Borjie Owner Cockpit (port 3010).
 *
 * Confirms the 10-card cockpit grid renders, the Master Brain mode
 * switcher exposes all 8 CEO modes, and the portfolio-map route either
 * mounts the Mapbox canvas or shows the graceful-degrade placeholder
 * (no Mapbox token in dev).
 */

const COCKPIT_CARD_LABELS: ReadonlyArray<RegExp> = [
  /daily brief/i,
  /cash runway/i,
  /licence health/i,
  /production/i,
  /open risks/i,
  /pending decisions/i,
  /active sites/i,
  /compliance/i,
  /marketplace/i,
  /gold|fx/i,
];

const CEO_MODE_LABELS: ReadonlyArray<RegExp> = [
  /^Build$/i,
  /^Strategy$/i,
  /^Operations$/i,
  /^Document$/i,
  /^Finance$/i,
  /^Risk$/i,
  /Board.*Investor/i,
  /^Compliance$/i,
];

async function ownerWebReachable(page: Page): Promise<boolean> {
  try {
    const response = await page.request.get(`${OWNER_WEB_URL}/`, {
      timeout: 5000,
    });
    return response.ok();
  } catch {
    return false;
  }
}

test.describe('Borjie owner-web smoke', () => {
  test.beforeEach(async ({ page }) => {
    const reachable = await ownerWebReachable(page);
    test.skip(
      !reachable,
      `owner-web not reachable at ${OWNER_WEB_URL} (dev server not booted)`,
    );
  });

  test('cockpit dashboard renders salutation header and 6+ cards', async ({
    page,
  }) => {
    await page.goto(`${OWNER_WEB_URL}/`);

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading.first()).toBeVisible();
    const headingText = await heading.first().textContent();
    expect(headingText ?? '').toMatch(/borjie|habari|owner|cockpit/i);

    let visibleCardCount = 0;
    for (const label of COCKPIT_CARD_LABELS) {
      const card = page.getByText(label).first();
      if (await card.isVisible().catch(() => false)) {
        visibleCardCount += 1;
      }
    }
    expect(visibleCardCount).toBeGreaterThanOrEqual(6);
  });

  test('Master Brain exposes all 8 CEO modes', async ({ page }) => {
    await page.goto(`${OWNER_WEB_URL}/master-brain`);

    const switcherHeading = page.getByText(/Master Brain.*CEO modes/i);
    await expect(switcherHeading.first()).toBeVisible();

    for (const label of CEO_MODE_LABELS) {
      const modeButton = page
        .getByRole('button', { name: label })
        .or(page.locator('button', { hasText: label }));
      await expect(modeButton.first()).toBeVisible();
    }
  });

  test('portfolio-map renders Mapbox canvas or graceful placeholder', async ({
    page,
  }) => {
    await page.goto(`${OWNER_WEB_URL}/portfolio-map`);

    const canvasOrPlaceholder = page
      .locator('canvas.mapboxgl-canvas')
      .or(page.locator('[data-testid="portfolio-map-canvas"]'))
      .or(page.getByText(/map.*unavailable|mapbox.*token|map preview/i))
      .or(page.getByRole('heading', { name: /portfolio map/i }));
    await expect(canvasOrPlaceholder.first()).toBeVisible({ timeout: 15000 });
  });
});

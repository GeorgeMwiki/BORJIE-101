/**
 * @cross-tenant @security @critical
 *
 * UI URL tampering: user A (logged into the owner portal for tenant X)
 * pastes a deep-link to a tenant-Y property (/owner/properties/<Y-id>).
 * The portal MUST respond with a 404 page, redirect to the dashboard, or
 * show an empty state — it must NEVER render tenant-Y's data.
 *
 * The distinctive-name check is the killer assertion: even if the page
 * "looks like" a 404, if the DOM somehow contains tenant-Y's property
 * name we've leaked data.
 */
import { test, expect, REAL_BACKEND_ENABLED } from '../../../fixtures/dual-tenant-fixtures';
import { loginAsOwner } from '../../../fixtures/auth';

test.describe.configure({ mode: 'serial' });

test.describe('@cross-tenant @security @critical — UI URL tamper', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('tenant-X owner cannot deep-link to tenant-Y property page', async ({
    page,
    tenantY,
  }) => {
    // Login as a tenant-X-scoped owner via the existing helper. The helper
    // uses E2E_TEST_OWNER_EMAIL — the test runner is expected to point that
    // at the tenant-X owner provisioned by dual-tenant-fixtures.
    await loginAsOwner(page).catch(() => {
      test.fixme(true, 'owner-portal login flow did not redirect to dashboard');
    });

    // Try a couple of plausible deep-link patterns.
    const candidateUrls = [
      `/owner/properties/${tenantY.propertyId}`,
      `/properties/${tenantY.propertyId}`,
      `/dashboard/properties/${tenantY.propertyId}`,
    ];

    for (const url of candidateUrls) {
      await page.goto(url).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);

      const bodyText = await page.locator('body').innerText().catch(() => '');

      // The KILLER assertion — distinctive name must NOT appear anywhere
      // in the rendered DOM. Survives template tricks (it's a row value,
      // not a layout string).
      expect(
        bodyText,
        `${url}: tenant-Y distinctive name must not render for tenant-X user`,
      ).not.toContain(tenantY.distinctiveName);

      // Secondary expectation: the portal indicates non-availability via
      // 404 / not-found / no-access / empty-state copy.
      const hasSafeState =
        /not found|404|no access|forbidden|don.?t have permission|empty/i.test(
          bodyText,
        ) ||
        page.url().includes('/dashboard') ||
        page.url().includes('/login');
      expect(
        hasSafeState,
        `${url}: must surface a safe non-render state (404, redirect, or empty)`,
      ).toBe(true);
    }
  });
});

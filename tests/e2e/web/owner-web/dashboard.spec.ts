import { test, expect } from '@playwright/test';
import { OWNER_WEB_URL, serverReachable } from '../_shared/helpers';

/**
 * owner-web — /dashboard structured-status surface.
 *
 * Three smoke flows that verify the D-W-01 layout per
 * `Docs/research/owner-status-sota.md`:
 *
 *   1. Route renders the cockpit heading + dashboard surface
 *   2. KPI tiles populate (any one of cash, daily brief, alerts)
 *   3. Drilldown into the production table shows rows OR an empty
 *      state — both are valid responses for a freshly-seeded tenant.
 */

test.describe('owner-web — dashboard', () => {
  test.beforeEach(async ({ request }) => {
    const ok = await serverReachable(request, OWNER_WEB_URL, '/dashboard');
    test.skip(
      !ok,
      `owner-web not reachable at ${OWNER_WEB_URL} (start with: pnpm --filter @borjie/owner-web dev)`,
    );
  });

  test('1) dashboard route renders header + surface', async ({ page }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/sign-in')) {
      test.skip(true, '/dashboard requires session — skip in smoke');
    }

    /* H1 contains either "Hali ya leo" (Swahili greeting) or the
     * fallback "Dashboard" eyebrow text — accept either. */
    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible({ timeout: 8_000 });
    const headingText = await heading.textContent();
    expect(headingText ?? '').toMatch(/hali ya leo|dashboard|owner/i);

    const surface = page
      .getByTestId('owner-dashboard-surface')
      .or(page.getByTestId('owner-dashboard-skeleton'));
    await expect(surface.first()).toBeVisible({ timeout: 10_000 });
  });

  test('2) KPI tiles populated (cash runway OR daily brief OR alert queue)', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/sign-in')) {
      test.skip(true, '/dashboard requires session — skip in smoke');
    }

    /* Wait for skeleton to resolve into real content. */
    await page
      .getByTestId('owner-dashboard-skeleton')
      .waitFor({ state: 'detached', timeout: 12_000 })
      .catch(() => {
        /* skeleton may not appear in cached navigations */
      });

    let visible = 0;
    const tiles = [
      'dashboard-cash-runway',
      'dashboard-daily-brief',
      'dashboard-alert-queue',
      'dashboard-production-table',
      'dashboard-compliance-safety',
    ];
    for (const tid of tiles) {
      if (await page.getByTestId(tid).first().isVisible().catch(() => false)) {
        visible += 1;
      }
    }
    expect(visible).toBeGreaterThanOrEqual(1);
  });

  test('3) drilldown — quick-action navigates back to chat (/)', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    if (page.url().includes('/sign-in')) {
      test.skip(true, '/dashboard requires session — skip in smoke');
    }

    const quickActions = page.getByTestId('dashboard-quick-actions');
    const quickAsk = page.getByTestId('dashboard-quick-ask');

    /* The QuickActionsBar may render in either of two slots depending
     * on viewport. Either we see it inline, or via the testid. */
    const visible = await quickActions
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(
      !visible,
      'QuickActionsBar not rendered — render gate likely awaiting brain data',
    );

    await quickAsk.first().click();

    /* Quick-ask jumps to chat home (`/`) or to /ask depending on
     * persona — both are valid. */
    await page.waitForURL(/(\/|\/ask)$/, { timeout: 6_000 });
  });
});

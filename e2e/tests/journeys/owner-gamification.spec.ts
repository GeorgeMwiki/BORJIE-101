/**
 * Wave-2 deep-scrub journey: owner-portal gamification toggle.
 *
 * The GamificationDashboard component fetches
 *   GET /api/v1/owner/gamification/config
 *   GET /api/v1/owner/gamification/stats
 * and toggles the `enabled` flag with
 *   PATCH /api/v1/owner/gamification/config
 *
 * The component implements optimistic UI with rollback on failure — these
 * specs cover both the happy path and the rollback.
 *
 * Like the damage-deductions spec, this assumes a `/gamification` route
 * mounting the component; the specs are `.fixme`'d until that page lands.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  captureRequest,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_helpers';

const OWNER_BASE_URL = process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000';

const CONFIG_DISABLED = {
  enabled: false,
  onTimeRentPoints: 50,
  referralPoints: 100,
  reviewPoints: 25,
};

const STATS = {
  activeParticipants: 14,
  totalPointsIssued: 4_250,
  topTenants: [
    { tenantId: 't1', name: 'Asha Mwangi', points: 540 },
    { tenantId: 't2', name: 'Brian Otieno', points: 420 },
  ],
};

test.describe('owner-portal gamification @journeys', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real owner-portal dev server (USE_REAL_SERVERS=1).');

  // Wired in commit C4 (wave-3): /gamification route mounts
  // GamificationPage which renders the GamificationDashboard feature
  // component inside the existing PrivateRoute > Layout wrap.

  test.beforeEach(async ({ page }) => {
    await seedOwnerAuth(page);
  });

  test('toggling enabled fires PATCH and surfaces server result', async ({ page }) => {
    let config = { ...CONFIG_DISABLED };
    const patch = captureRequest(ok({ ...config, enabled: true }));

    await page.route('**/api/v1/owner/gamification/**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      if (/\/config$/.test(url) && method === 'PATCH') {
        const body = request.postDataJSON() as typeof CONFIG_DISABLED;
        config = { ...config, ...body };
        return patch.handler(route, request);
      }
      if (/\/config$/.test(url)) return fulfillJson(route, ok(config));
      if (/\/stats$/.test(url)) return fulfillJson(route, ok(STATS));
      return route.fallback();
    });

    await page.goto('/gamification');
    await page.waitForLoadState('domcontentloaded');

    // Initial state — disabled, button reads "Enable".
    const enableBtn = page.getByRole('button', { name: /enable/i });
    await expect(enableBtn).toBeVisible();

    await enableBtn.click();

    // The PATCH fired with enabled=true.
    await expect.poll(() => patch.getRequest()?.method() ?? null).toBe('PATCH');
    const sent = patch.getRequest()?.postDataJSON() as { enabled: boolean };
    expect(sent.enabled).toBe(true);

    // Optimistic UI flips the button to "Disable".
    await expect(page.getByRole('button', { name: /disable/i })).toBeVisible();

    // Stats are rendered.
    await expect(page.getByText('14')).toBeVisible(); // activeParticipants
    await expect(page.getByText('Asha Mwangi')).toBeVisible();
  });

  test('rolls back the optimistic toggle when the PATCH fails', async ({ page }) => {
    await page.route('**/api/v1/owner/gamification/**', async (route, request) => {
      const url = request.url();
      const method = request.method();
      if (/\/config$/.test(url) && method === 'PATCH') {
        return fulfillJson(
          route,
          { success: false, error: { code: 'E_QUOTA', message: 'Plan does not include gamification' } },
          402,
        );
      }
      if (/\/config$/.test(url)) return fulfillJson(route, ok(CONFIG_DISABLED));
      if (/\/stats$/.test(url)) return fulfillJson(route, ok(STATS));
      return route.fallback();
    });

    await page.goto('/gamification');
    await page.getByRole('button', { name: /enable/i }).click();

    // Error surfaces in the alert; button rolls back to "Enable".
    await expect(page.getByText(/plan does not include gamification/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /enable/i })).toBeVisible();
  });

  test('shows a retry control when the initial load fails', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/v1/owner/gamification/**', async (route) => {
      calls += 1;
      const url = route.request().url();
      if (/\/stats$/.test(url)) return fulfillJson(route, ok(STATS));
      if (calls < 3) {
        return fulfillJson(
          route,
          { success: false, error: { code: 'E_500', message: 'Upstream down' } },
          500,
        );
      }
      return fulfillJson(route, ok(CONFIG_DISABLED));
    });

    await page.goto('/gamification');
    await expect(page.getByText(/upstream down|failed to load/i).first()).toBeVisible();
    await page.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByRole('button', { name: /enable/i })).toBeVisible();
  });
});

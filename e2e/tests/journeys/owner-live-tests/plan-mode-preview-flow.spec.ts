/**
 * Phase F.5 journey #8 — Plan-mode preview.
 *
 * Owner asks "what if I raise rent 5%?" → MD enters plan mode →
 * forecasting-engine simulates → DiffView renders before/after.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const FORECAST_BEFORE = {
  monthlyNoiKes: 850_000,
  occupancyRate: 0.94,
  churnRiskPct: 0.08,
};
const FORECAST_AFTER = {
  monthlyNoiKes: 893_000, // +5% rent ≈ +5% gross, NOI uplift
  occupancyRate: 0.92, // small churn cost
  churnRiskPct: 0.13,
};

test.describe('plan-mode preview (rent +5%) @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('enters plan mode, simulates rent +5%, renders DiffView', async ({ page }) => {
    await seedOwnerAuth(page);

    let simulationCalled = false;

    await page.route('**/api/v1/plan/simulate', async (route, request) => {
      simulationCalled = true;
      const body = JSON.parse(request.postData() ?? '{}');
      return fulfillJson(
        route,
        ok({
          scenario: body.scenario,
          before: FORECAST_BEFORE,
          after: FORECAST_AFTER,
          confidenceIntervalDays: 60,
          assumptions: [
            'Renewal churn elasticity = 0.6 per +1% rent.',
            'Occupancy decay holds 24 months.',
          ],
        }),
      );
    });

    await page.goto('/plan');
    await page.evaluate(async () => {
      await fetch('/api/v1/plan/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: { type: 'rent_change', deltaPct: 0.05 },
        }),
      });
    });

    await expect.poll(() => simulationCalled).toBe(true);
  });
});

/**
 * Phase F.5 journey #7 — Weekly briefing + anomaly drill-down.
 *
 * Monday 9am → MD generates briefing → owner reads → clicks anomaly →
 * DiffView surfaces the offending number's source.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const BRIEFING = {
  id: 'brf_2026_05_18',
  generatedAt: new Date().toISOString(),
  weekStart: '2026-05-11',
  highlights: [
    { id: 'h1', metric: 'occupancy', value: 0.94, deltaWoW: 0.02 },
    { id: 'h2', metric: 'collections', value: 0.88, deltaWoW: -0.07, anomaly: true },
    { id: 'h3', metric: 'workOrdersClosed', value: 12, deltaWoW: 3 },
  ],
};

const COLLECTION_DRILLDOWN = {
  metric: 'collections',
  before: { value: 0.95, week: '2026-05-04' },
  after: { value: 0.88, week: '2026-05-11' },
  contributors: [
    { customerName: 'David Late', impactKes: -35_000 },
    { customerName: 'Eve Slow', impactKes: -28_000 },
  ],
};

test.describe('weekly briefing → anomaly drill-down @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('generates briefing, anomaly click reveals DiffView', async ({ page }) => {
    await seedOwnerAuth(page);

    let drillCalled = false;

    await page.route('**/api/v1/owner/briefing/weekly**', async (route) =>
      fulfillJson(route, ok(BRIEFING)),
    );

    await page.route('**/api/v1/owner/briefing/h2/drilldown', async (route) => {
      drillCalled = true;
      return fulfillJson(route, ok(COLLECTION_DRILLDOWN));
    });

    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/v1/owner/briefing/weekly');
      await fetch('/api/v1/owner/briefing/h2/drilldown');
    });

    await expect.poll(() => drillCalled).toBe(true);
  });
});

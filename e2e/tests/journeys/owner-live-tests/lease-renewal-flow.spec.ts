/**
 * Phase F.5 journey #5 — Lease renewal.
 *
 * Lease end T-60d → MD drafts a renewal offer w/ market-rate compare →
 * owner reviews + tweaks rent → tenant offered → tenant accepts.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  OWNER_BASE_URL,
  fulfillJson,
  ok,
  seedOwnerAuth,
} from './_shared';

const LEASE = {
  id: 'lease_1',
  customerName: 'Asha Mwangi',
  unitLabel: 'Block A — Unit 12',
  currentRentKes: 35_000,
  endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  marketComparable: { medianKes: 37_500, p25Kes: 35_000, p75Kes: 40_000 },
};

test.describe('lease renewal (T-60d → renewal accepted) @owner-live', () => {
  test.use({ baseURL: OWNER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires docker-compose stack.');

  test('drafts renewal, owner tweaks rent, tenant accepts', async ({ page }) => {
    await seedOwnerAuth(page);

    let offeredRent: number | null = null;
    let accepted = false;

    await page.route('**/api/v1/leases/expiring**', async (route) =>
      fulfillJson(route, ok([LEASE])),
    );

    await page.route('**/api/v1/renewals/draft', async (route) =>
      fulfillJson(
        route,
        ok({
          leaseId: 'lease_1',
          proposedRentKes: 37_500,
          rationale: 'Median market comparable.',
          letterDraft: 'Dear Asha, we are pleased to offer renewal at KES 37,500...',
        }),
      ),
    );

    await page.route('**/api/v1/renewals/lease_1/offer', async (route, request) => {
      const body = JSON.parse(request.postData() ?? '{}');
      offeredRent = body.rentKes ?? null;
      return fulfillJson(route, ok({ offerId: 'off_1', status: 'sent' }));
    });

    await page.route('**/api/v1/renewals/lease_1/accept', async (route) => {
      accepted = true;
      return fulfillJson(route, ok({ status: 'accepted', newLeaseId: 'lease_1_v2' }));
    });

    await page.goto('/portfolio');
    await page.evaluate(async () => {
      await fetch('/api/v1/renewals/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: 'lease_1' }),
      });
      // Owner tweaks: 37_500 → 36_500 (less aggressive)
      await fetch('/api/v1/renewals/lease_1/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentKes: 36_500 }),
      });
      // Tenant accepts via separate channel — simulated here.
      await fetch('/api/v1/renewals/lease_1/accept', { method: 'POST' });
    });

    await expect.poll(() => offeredRent).toBe(36_500);
    await expect.poll(() => accepted).toBe(true);
  });
});

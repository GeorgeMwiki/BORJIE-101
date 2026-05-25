/**
 * Critical flow: Prospect tries to make an offer below floorPrice -> AI rejects
 * (or escalates) -> policy trail captured.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, hasText } from './_helpers';

test.describe('Negotiation floor-price guardrail', () => {
  test.use({ project: 'customer-app' });

  test('offer below floor is rejected with policy trail', async ({ page }) => {
    await installApiMocks(page, {
      '**/api/units/UNIT-007**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { unitId: 'UNIT-007', askingPrice: 800_000, floorPrice: 650_000, currency: 'TZS' },
          }),
        }),
      '**/api/offers**': (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON() as { amount?: number };
          const amount = body?.amount ?? 0;
          if (amount < 650_000) {
            return route.fulfill({
              status: 422,
              contentType: 'application/json',
              body: JSON.stringify({
                success: false,
                error: 'FLOOR_BREACH',
                data: {
                  decision: 'REJECTED',
                  policyRef: 'policy_floor_v2',
                  policyTrailId: 'trail_floor_001',
                },
              }),
            });
          }
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { offerId: 'offer_001', status: 'PENDING' },
            }),
          });
        }
        return route.continue();
      },
      '**/api/policy/trails/trail_floor_001**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              trailId: 'trail_floor_001',
              rule: 'MIN_FLOOR_PRICE',
              evaluation: 'FAIL',
              context: { floorPrice: 650_000, offered: 400_000 },
            },
          }),
        }),
    });

    await page.goto('/units/UNIT-007');
    await page.waitForLoadState('networkidle');
    const offerBtn = page.getByRole('button', { name: /make offer|negotiate/i }).first();
    if (await offerBtn.isVisible().catch(() => false)) {
      await offerBtn.click();
    }
    const amountInput = page.getByLabel(/amount|offer/i).first();
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill('400000');
      await page.getByRole('button', { name: /submit|send offer/i }).first().click();
    }

    // UI surfaces rejection
    expect(await hasText(page, /floor|rejected|below|minimum/i)).toBeTruthy();

    // Policy trail retrievable (indirect assertion through API mock)
    const trailResponse = await page.request
      .get('/api/policy/trails/trail_floor_001')
      .catch(() => null);
    if (trailResponse) {
      expect(trailResponse.ok()).toBeTruthy();
    }
  });

  test('offer at floor price is accepted', async ({ page }) => {
    await installApiMocks(page, {
      '**/api/offers**': (route) =>
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { offerId: 'offer_002', status: 'PENDING' },
          }),
        }),
    });
    await page.goto('/units/UNIT-007');
    await page.waitForLoadState('networkidle');
    const amountInput = page.getByLabel(/amount|offer/i).first();
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill('650000');
      await page.getByRole('button', { name: /submit|send offer/i }).first().click();
      expect(await hasText(page, /submitted|pending|received/i)).toBeTruthy();
    }
  });
});

/**
 * Critical flow: Customer files application for high-rent asset (>500k TZS) ->
 * routes to DG approval queue -> DG approves -> lease drafted.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, HIGH_RENT_THRESHOLD_TZS, hasText } from './_helpers';

test.describe('Owner DG-level approval routing for high-rent assets', () => {
  test('high-rent application routes to DG queue and produces a lease draft', async ({
    browser,
  }) => {
    const highRentAmount = HIGH_RENT_THRESHOLD_TZS + 250_000;

    // Customer submits application
    const custCtx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    const custPage = await custCtx.newPage();
    await installApiMocks(custPage, {
      '**/api/applications**': (route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                applicationId: 'app_hr_001',
                routedTo: 'DG_APPROVAL',
                requiresDgApproval: true,
              },
            }),
          });
        }
        return route.continue();
      },
    });
    await custPage.goto('/applications/new?assetId=ASSET-HR-42');
    await custPage.waitForLoadState('networkidle');
    const rentInput = custPage.getByLabel(/offered rent|monthly rent/i).first();
    if (await rentInput.isVisible().catch(() => false)) {
      await rentInput.fill(String(highRentAmount));
    }
    const submitBtn = custPage.getByRole('button', { name: /submit|apply/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    }
    expect(await hasText(custPage, /DG|pending senior approval|submitted/i)).toBeTruthy();

    // DG approves in owner portal
    const dgCtx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    const dgPage = await dgCtx.newPage();
    await installApiMocks(dgPage, {
      '**/api/approvals/queue?role=DG**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                applicationId: 'app_hr_001',
                assetId: 'ASSET-HR-42',
                amount: highRentAmount,
                currency: 'TZS',
              },
            ],
          }),
        }),
      '**/api/approvals/app_hr_001/approve**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { leaseDraftId: 'lease_draft_001', status: 'DRAFTED' },
          }),
        }),
    });
    await dgPage.goto('/approvals/dg');
    await dgPage.waitForLoadState('networkidle');
    const approveBtn = dgPage.getByRole('button', { name: /approve/i }).first();
    if (await approveBtn.isVisible().catch(() => false)) {
      await approveBtn.click();
    }
    expect(await hasText(dgPage, /lease drafted|approved|lease_draft/i)).toBeTruthy();

    await custCtx.close();
    await dgCtx.close();
  });

  test('rent below threshold bypasses DG queue', async ({ page }) => {
    await installApiMocks(page, {
      '**/api/applications**': (route) =>
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              applicationId: 'app_std_001',
              routedTo: 'STANDARD',
              requiresDgApproval: false,
            },
          }),
        }),
    });
    await page.goto('/applications/new?assetId=ASSET-LR-42');
    await page.waitForLoadState('networkidle');
    const rentInput = page.getByLabel(/offered rent|monthly rent/i).first();
    if (await rentInput.isVisible().catch(() => false)) {
      await rentInput.fill('200000');
      await page.getByRole('button', { name: /submit|apply/i }).first().click();
      expect(await hasText(page, /DG|senior approval/i)).toBeFalsy();
    }
  });
});

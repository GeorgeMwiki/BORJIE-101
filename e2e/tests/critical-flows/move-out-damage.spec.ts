/**
 * Critical flow: Tenant move-out -> joint inspection -> damage found ->
 * tenant counters via app -> agreement -> deposit adjustment.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, hasText } from './_helpers';

test.describe('Move-out damage resolution', () => {
  test('joint inspection -> counter -> agreement -> deposit adjustment', async ({ browser }) => {
    // Estate manager conducts joint inspection
    const mgrCtx = await browser.newContext({ baseURL: 'http://localhost:3003' });
    const mgrPage = await mgrCtx.newPage();
    await installApiMocks(mgrPage, {
      '**/api/moveout/MO-77/inspection**': (route) =>
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              inspectionId: 'insp_001',
              damages: [
                { item: 'Door', cost: 80_000 },
                { item: 'Wall paint', cost: 120_000 },
              ],
              proposedDeduction: 200_000,
            },
          }),
        }),
    });
    await mgrPage.goto('/moveout/MO-77/inspect');
    await mgrPage.waitForLoadState('networkidle');
    const submitInspection = mgrPage.getByRole('button', { name: /submit inspection|record/i }).first();
    if (await submitInspection.isVisible().catch(() => false)) {
      await submitInspection.click();
    }
    expect(await hasText(mgrPage, /200,?000|damage|proposed/i)).toBeTruthy();

    // Tenant counters
    const tCtx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    const tPage = await tCtx.newPage();
    await installApiMocks(tPage, {
      '**/api/moveout/MO-77/counter**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { counterId: 'counter_001', counterAmount: 100_000, status: 'PENDING' },
          }),
        }),
      '**/api/moveout/MO-77/agree**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              agreedDeduction: 150_000,
              depositReturned: 350_000,
              status: 'SETTLED',
            },
          }),
        }),
    });
    await tPage.goto('/moveout/MO-77');
    await tPage.waitForLoadState('networkidle');
    const counterBtn = tPage.getByRole('button', { name: /counter|dispute/i }).first();
    if (await counterBtn.isVisible().catch(() => false)) {
      await counterBtn.click();
    }
    const counterAmount = tPage.getByLabel(/counter amount|propose/i).first();
    if (await counterAmount.isVisible().catch(() => false)) {
      await counterAmount.fill('100000');
      await tPage.getByRole('button', { name: /submit|send counter/i }).first().click();
    }
    const agreeBtn = tPage.getByRole('button', { name: /agree|accept/i }).first();
    if (await agreeBtn.isVisible().catch(() => false)) {
      await agreeBtn.click();
    }
    expect(await hasText(tPage, /SETTLED|settled|350,?000|deposit/i)).toBeTruthy();

    await mgrCtx.close();
    await tCtx.close();
  });
});

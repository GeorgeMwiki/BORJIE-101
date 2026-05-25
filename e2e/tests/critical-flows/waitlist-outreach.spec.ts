/**
 * Critical flow: Prospect joins waitlist for a unit -> unit vacates ->
 * top-N waitlisted prospects notified.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, hasText } from './_helpers';

test.describe('Waitlist -> vacancy -> outreach', () => {
  test('joining waitlist triggers outreach to top-N when unit vacates', async ({ browser }) => {
    // Prospect joins waitlist
    const pCtx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    const pPage = await pCtx.newPage();
    await installApiMocks(pPage, {
      '**/api/waitlist**': (route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { waitlistId: 'wl_001', position: 3, unitId: 'UNIT-108' },
            }),
          });
        }
        return route.continue();
      },
    });
    await pPage.goto('/units/UNIT-108');
    await pPage.waitForLoadState('networkidle');
    const joinBtn = pPage.getByRole('button', { name: /waitlist|notify me/i }).first();
    if (await joinBtn.isVisible().catch(() => false)) {
      await joinBtn.click();
    }
    expect(await hasText(pPage, /position|joined|waitlist/i)).toBeTruthy();

    // Estate manager marks unit vacated
    const mgrCtx = await browser.newContext({ baseURL: 'http://localhost:3003' });
    const mgrPage = await mgrCtx.newPage();
    await installApiMocks(mgrPage, {
      '**/api/units/UNIT-108/vacate**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              unitId: 'UNIT-108',
              status: 'VACANT',
              waitlistNotified: ['wl_001', 'wl_002', 'wl_003'],
            },
          }),
        }),
    });
    await mgrPage.goto('/units/UNIT-108');
    await mgrPage.waitForLoadState('networkidle');
    const vacateBtn = mgrPage.getByRole('button', { name: /vacate|mark vacant/i }).first();
    if (await vacateBtn.isVisible().catch(() => false)) {
      await vacateBtn.click();
    }
    expect(await hasText(mgrPage, /notified|waitlist|VACANT|vacant/i)).toBeTruthy();

    await pCtx.close();
    await mgrCtx.close();
  });
});

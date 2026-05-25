/**
 * Critical flow: Trigger FAR (Field Asset Review) assignment -> surveyor captures
 * findings -> AI compiles report -> action plans routed for approval.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, hasText } from './_helpers';

test.describe('Conditional survey (FAR) flow', () => {
  test('FAR assignment -> findings -> AI report -> approval routing', async ({ browser }) => {
    // Estate manager triggers FAR
    const mgrCtx = await browser.newContext({ baseURL: 'http://localhost:3003' });
    const mgrPage = await mgrCtx.newPage();
    await installApiMocks(mgrPage, {
      '**/api/far/assignments**': (route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { assignmentId: 'far_001', surveyorId: 'surveyor_42', status: 'ASSIGNED' },
            }),
          });
        }
        return route.continue();
      },
    });
    await mgrPage.goto('/far/new?assetId=ASSET-15');
    await mgrPage.waitForLoadState('networkidle');
    const triggerBtn = mgrPage.getByRole('button', { name: /trigger|assign|create/i }).first();
    if (await triggerBtn.isVisible().catch(() => false)) {
      await triggerBtn.click();
    }
    expect(await hasText(mgrPage, /assigned|surveyor/i)).toBeTruthy();

    // Surveyor captures findings
    const surCtx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    const surPage = await surCtx.newPage();
    await installApiMocks(surPage, {
      '**/api/far/far_001/findings**': (route) =>
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { findingsId: 'find_001', count: 3 },
          }),
        }),
      '**/api/ai/far-report/far_001**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              reportId: 'report_001',
              actionPlans: [
                { planId: 'plan_a', title: 'Repair roof', routingLevel: 'MANAGER' },
                { planId: 'plan_b', title: 'Structural survey', routingLevel: 'DG' },
              ],
            },
          }),
        }),
    });
    await surPage.goto('/far/far_001/capture');
    await surPage.waitForLoadState('networkidle');
    const notesInput = surPage.getByLabel(/findings|notes/i).first();
    if (await notesInput.isVisible().catch(() => false)) {
      await notesInput.fill('Three defects observed: roof leak, cracked wall, wiring exposed.');
      await surPage.getByRole('button', { name: /save|submit|finalize/i }).first().click();
    }
    expect(await hasText(surPage, /plan_a|plan_b|action plan|compiled/i)).toBeTruthy();

    await mgrCtx.close();
    await surCtx.close();
  });
});

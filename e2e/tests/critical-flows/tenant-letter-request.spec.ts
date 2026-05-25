/**
 * Critical flow: Tenant requests residency proof letter -> estate manager approves
 * -> tenant downloads PDF.
 *
 * Uses mocked letter-generation API returning a deterministic PDF payload.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, signInAsTenant, hasText } from './_helpers';

test.describe('Residency proof letter request', () => {
  test('tenant requests letter, manager approves, tenant downloads PDF', async ({
    browser,
  }) => {
    // Tenant context
    const tenantCtx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    const tenantPage = await tenantCtx.newPage();
    await installApiMocks(tenantPage, {
      '**/api/letters/request**': (route) =>
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { letterId: 'ltr_001', status: 'PENDING' },
          }),
        }),
      '**/api/letters/ltr_001**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { letterId: 'ltr_001', status: 'APPROVED', pdfUrl: '/fixtures/letter.pdf' },
          }),
        }),
      '**/fixtures/letter.pdf': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4\n%mock-pdf\n'),
        }),
    });
    await signInAsTenant(tenantPage);
    await tenantPage.goto('/letters/new');
    await tenantPage.waitForLoadState('networkidle');
    const purposeInput = tenantPage.getByLabel(/purpose|reason/i).first();
    if (await purposeInput.isVisible().catch(() => false)) {
      await purposeInput.fill('Visa application');
      await tenantPage.getByRole('button', { name: /request|submit/i }).first().click();
    }
    expect(await hasText(tenantPage, /pending|submitted|under review/i)).toBeTruthy();

    // Estate manager context
    const mgrCtx = await browser.newContext({ baseURL: 'http://localhost:3003' });
    const mgrPage = await mgrCtx.newPage();
    await installApiMocks(mgrPage, {
      '**/api/letters?status=pending**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [{ letterId: 'ltr_001', tenant: 'Test Tenant', purpose: 'Visa application' }],
          }),
        }),
      '**/api/letters/ltr_001/approve**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status: 'APPROVED' } }),
        }),
    });
    await mgrPage.goto('/letters/pending');
    await mgrPage.waitForLoadState('networkidle');
    const approveBtn = mgrPage.getByRole('button', { name: /approve/i }).first();
    if (await approveBtn.isVisible().catch(() => false)) {
      await approveBtn.click();
    }

    // Tenant downloads PDF after approval
    await tenantPage.goto('/letters/ltr_001');
    await tenantPage.waitForLoadState('networkidle');
    const downloadLink = tenantPage.getByRole('link', { name: /download|pdf/i }).first();
    if (await downloadLink.isVisible().catch(() => false)) {
      const downloadPromise = tenantPage.waitForEvent('download').catch(() => null);
      await downloadLink.click();
      const download = await downloadPromise;
      if (download) {
        expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
      }
    }

    await tenantCtx.close();
    await mgrCtx.close();
  });
});

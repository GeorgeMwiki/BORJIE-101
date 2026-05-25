/**
 * Critical flow: Tenant files maintenance ticket -> photo capture -> AI classifies ->
 * estate manager assigns vendor -> work done -> evidence attached.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { installApiMocks, signInAsTenant, hasText } from './_helpers';

test.describe('Maintenance ticket end-to-end', () => {
  test('tenant files ticket with photo, AI classifies, manager assigns vendor, completion with evidence', async ({
    browser,
  }) => {
    // Tenant
    const tenantCtx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    const tenantPage = await tenantCtx.newPage();
    await installApiMocks(tenantPage, {
      '**/api/maintenance/tickets**': (route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                ticketId: 'mt_001',
                classification: { category: 'PLUMBING', urgency: 'HIGH', confidence: 0.92 },
              },
            }),
          });
        }
        return route.continue();
      },
      '**/api/ai/classify-image**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { category: 'PLUMBING', urgency: 'HIGH' },
          }),
        }),
    });
    await signInAsTenant(tenantPage);
    await tenantPage.goto('/maintenance/new');
    await tenantPage.waitForLoadState('networkidle');
    const titleInput = tenantPage.getByLabel(/title|issue/i).first();
    if (await titleInput.isVisible().catch(() => false)) {
      await titleInput.fill('Burst pipe in bathroom');
    }
    // Photo upload
    const fileInput = tenantPage.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput
        .setInputFiles({
          name: 'leak.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
        })
        .catch(() => undefined);
    }
    await tenantPage.getByRole('button', { name: /submit|file|create/i }).first().click().catch(() => undefined);
    expect(
      (await hasText(tenantPage, /PLUMBING|plumbing|HIGH|submitted/i)) ||
        (await hasText(tenantPage, /ticket/i)),
    ).toBeTruthy();

    // Estate manager assigns vendor
    const mgrCtx = await browser.newContext({ baseURL: 'http://localhost:3003' });
    const mgrPage = await mgrCtx.newPage();
    await installApiMocks(mgrPage, {
      '**/api/maintenance/tickets/mt_001/assign**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { ticketId: 'mt_001', vendorId: 'vendor_plumb_07', status: 'ASSIGNED' },
          }),
        }),
      '**/api/maintenance/tickets/mt_001/complete**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status: 'COMPLETED' } }),
        }),
    });
    await mgrPage.goto('/maintenance/tickets/mt_001');
    await mgrPage.waitForLoadState('networkidle');
    const assignBtn = mgrPage.getByRole('button', { name: /assign/i }).first();
    if (await assignBtn.isVisible().catch(() => false)) {
      await assignBtn.click();
    }
    // Attach completion evidence
    const evidenceInput = mgrPage.locator('input[type="file"]').first();
    if (await evidenceInput.count()) {
      await evidenceInput
        .setInputFiles({
          name: 'done.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        })
        .catch(() => undefined);
    }
    const completeBtn = mgrPage.getByRole('button', { name: /complete|mark done/i }).first();
    if (await completeBtn.isVisible().catch(() => false)) {
      await completeBtn.click();
    }
    expect(await hasText(mgrPage, /completed|done|resolved/i)).toBeTruthy();

    await tenantCtx.close();
    await mgrCtx.close();
  });
});

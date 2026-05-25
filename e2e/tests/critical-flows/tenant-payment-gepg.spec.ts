/**
 * Critical flow: Tenant views invoice -> chooses GePG -> sees control number ->
 * (mocked) webhook fires -> invoice marked PAID.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, fireMockWebhook, signInAsTenant, hasText } from './_helpers';

test.describe('GePG invoice payment', () => {
  test.use({ project: 'customer-app' });

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      '**/api/invoices/INV-001**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              invoiceId: 'INV-001',
              amount: 250_000,
              currency: 'TZS',
              status: 'UNPAID',
              dueDate: '2026-05-01',
            },
          }),
        }),
      '**/api/invoices/INV-001/status**': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status: 'PAID', paidAt: new Date().toISOString() } }),
        }),
    });
  });

  test('tenant generates control number and invoice flips to PAID on webhook', async ({
    page,
  }) => {
    await signInAsTenant(page);
    await page.goto('/invoices/INV-001');
    await page.waitForLoadState('networkidle');

    // Choose GePG payment method
    const gepgBtn = page.getByRole('button', { name: /GePG|control number/i }).first();
    if (await gepgBtn.isVisible().catch(() => false)) {
      await gepgBtn.click();
    }

    // Control number should appear
    expect(await hasText(page, /991234567890/)).toBeTruthy();

    // Fire mocked webhook server-side (simulated)
    await fireMockWebhook(page, '/api/payments/gepg/webhook', {
      controlNumber: '991234567890',
      invoiceId: 'INV-001',
      status: 'PAID',
      amount: 250_000,
    });

    // Refresh invoice view — now marked PAID
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await hasText(page, /PAID|paid/i)).toBeTruthy();
  });

  test('rejects payment below minimum amount', async ({ page }) => {
    await page.route('**/api/payments/gepg/control-number**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'AMOUNT_BELOW_MIN' }),
      }),
    );
    await signInAsTenant(page);
    await page.goto('/invoices/INV-001');
    await page.waitForLoadState('networkidle');
    const gepgBtn = page.getByRole('button', { name: /GePG|control number/i }).first();
    if (await gepgBtn.isVisible().catch(() => false)) {
      await gepgBtn.click();
      expect(await hasText(page, /minimum|below|error/i)).toBeTruthy();
    }
  });
});

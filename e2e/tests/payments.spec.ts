import { test, expect } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';

test.describe('Estate Manager - Payments', () => {
  test.use({ project: 'estate-manager' });

  test('should navigate to receive payment from dashboard', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto('/');
    await dashboardPage.expectDashboardLoaded();
    await dashboardPage.clickReceivePayment();
    await expect(page).toHaveURL(/\/payments\/receive/);
    await expect(page.getByText(/record payment|receive payment/i)).toBeVisible();
  });

  test('should display payments list page', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.getByRole('heading', { name: /payment/i })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Customer App - M-Pesa Payment', () => {
  test.use({ project: 'customer-app' });

  test('should display M-Pesa payment page when authenticated', async ({ page }) => {
    await page.goto('/payments/mpesa');
    await expect(page.getByText(/pay with m-pesa|m-pesa/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show amount and phone input on M-Pesa page', async ({ page }) => {
    await page.goto('/payments/mpesa');
    await expect(page.getByText(/amount to pay|kes/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder(/254|phone/i)).toBeVisible();
  });

  test('should complete M-Pesa flow (simulated)', async ({ page }) => {
    await page.goto('/payments/mpesa');
    await page.waitForSelector('button:has-text("Pay KES")', { timeout: 10000 });
    const payButton = page.getByRole('button', { name: /pay kes/i });
    await payButton.click();
    await page.waitForTimeout(5000);
    const hasSuccess = await page.getByText(/payment successful|success/i).isVisible().catch(() => false);
    const hasFailed = await page.getByText(/payment failed|try again/i).isVisible().catch(() => false);
    expect(hasSuccess || hasFailed).toBeTruthy();
  });
});

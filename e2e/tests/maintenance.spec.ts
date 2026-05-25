import { test, expect } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';
import { testData } from '../fixtures/data.fixture';

test.describe('Estate Manager - Maintenance / Work Orders', () => {
  test.use({ project: 'estate-manager' });

  test('should navigate to create work order from dashboard', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto('/');
    await dashboardPage.expectDashboardLoaded();
    await dashboardPage.clickCreateWorkOrder();
    await expect(page).toHaveURL(/\/work-orders\/new/);
  });

  test('should display work order form with required fields', async ({ page }) => {
    await page.goto('/work-orders/new');
    await expect(page.getByText(/create work order/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('select').first()).toBeVisible();
    await expect(page.getByPlaceholder(/brief description/i)).toBeVisible();
  });

  test('should create work order with full flow', async ({ page }) => {
    await page.goto('/work-orders/new');
    await page.waitForSelector('select', { timeout: 10000 });

    await page.locator('select').first().selectOption({ index: 1 });
    await page.waitForTimeout(300);
    await page.locator('select').nth(1).selectOption({ index: 1 });
    await page.locator('select').nth(2).selectOption('plumbing');
    await page.getByRole('button', { name: /medium/i }).click();
    await page.getByPlaceholder(/brief description/i).fill(testData.workOrder.title());

    await page.getByRole('button', { name: /create work order/i }).click();
    await expect(page).toHaveURL(/\/work-orders/, { timeout: 10000 });
  });

  test('should display work orders list', async ({ page }) => {
    await page.goto('/work-orders');
    await expect(page.getByRole('heading', { name: /work order/i })).toBeVisible({ timeout: 10000 });
  });
});

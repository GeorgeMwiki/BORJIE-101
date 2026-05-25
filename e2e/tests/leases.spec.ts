import { test, expect } from '@playwright/test';
import { LeasesPage } from '../pages/LeasesPage';
import { DashboardPage } from '../pages/DashboardPage';

test.describe('Estate Manager - Leases', () => {
  test.use({ project: 'estate-manager' });

  test('should display leases page from dashboard', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto('/');
    await dashboardPage.expectDashboardLoaded();
    await dashboardPage.clickLeases();
    await expect(page).toHaveURL(/\/leases/);
    const leasesPage = new LeasesPage(page);
    await leasesPage.expectLoaded();
  });

  test('should show leases list or empty state', async ({ page }) => {
    const leasesPage = new LeasesPage(page);
    await leasesPage.goto();
    await leasesPage.expectLoaded();
    const hasLeases = (await leasesPage.getLeaseCount()) > 0;
    const hasEmptyState = await leasesPage.emptyState.isVisible().catch(() => false);
    expect(hasLeases || hasEmptyState).toBeTruthy();
  });

  test('should have search and status filter', async ({ page }) => {
    const leasesPage = new LeasesPage(page);
    await leasesPage.goto();
    await leasesPage.expectLoaded();
    await expect(leasesPage.searchInput).toBeVisible();
    await expect(leasesPage.statusFilter).toBeVisible();
  });

  test('should navigate to new lease form', async ({ page }) => {
    const leasesPage = new LeasesPage(page);
    await leasesPage.goto();
    await leasesPage.expectLoaded();
    await leasesPage.clickNewLease();
    await expect(page).toHaveURL(/\/leases\/new/);
  });

  test('should filter leases by status', async ({ page }) => {
    const leasesPage = new LeasesPage(page);
    await leasesPage.goto();
    await leasesPage.expectLoaded();
    await leasesPage.filterByStatus('active');
    await page.waitForTimeout(500);
    await leasesPage.expectLoaded();
  });
});

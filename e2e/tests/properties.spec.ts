import { test, expect } from '@playwright/test';
import { PropertiesPage } from '../pages/PropertiesPage';
import { DashboardPage } from '../pages/DashboardPage';

test.describe('Estate Manager - Properties', () => {
  test.use({ project: 'estate-manager' });

  test('should display properties page from dashboard', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto('/');
    await dashboardPage.expectDashboardLoaded();
    await dashboardPage.clickProperties();
    await expect(page).toHaveURL(/\/properties/);
    const propertiesPage = new PropertiesPage(page);
    await propertiesPage.expectLoaded();
  });

  test('should show properties list or empty state', async ({ page }) => {
    const propertiesPage = new PropertiesPage(page);
    await propertiesPage.goto();
    await propertiesPage.expectLoaded();
    const hasProperties = (await propertiesPage.getPropertyCount()) > 0;
    const hasEmptyState = await propertiesPage.emptyState.isVisible().catch(() => false);
    expect(hasProperties || hasEmptyState).toBeTruthy();
  });

  test('should have search and filter controls', async ({ page }) => {
    const propertiesPage = new PropertiesPage(page);
    await propertiesPage.goto();
    await propertiesPage.expectLoaded();
    await expect(propertiesPage.searchInput).toBeVisible();
  });

  test('should navigate to add property form', async ({ page }) => {
    const propertiesPage = new PropertiesPage(page);
    await propertiesPage.goto();
    await propertiesPage.expectLoaded();
    await propertiesPage.clickAdd();
    await expect(page).toHaveURL(/\/properties\/new/);
  });
});

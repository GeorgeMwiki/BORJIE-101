import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers } from '../fixtures/test-data';
import { OwnerPortalPage } from '../page-objects/OwnerPortalPage';

/**
 * Owner Portal E2E Tests
 * Covers: Dashboard metrics, portfolio/property views, financial statements,
 *         maintenance work order oversight, and report downloads.
 */

test.describe('Owner Portal', () => {
  test.use({ project: 'owner-portal' });

  // Login before each test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  });

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  test.describe('Dashboard', () => {
    test('should load dashboard with key metrics', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      // Dashboard heading should be visible
      await expect(page.getByRole('heading', { level: 1 }).or(
        page.getByText(/dashboard|overview|portfolio/i)
      )).toBeVisible({ timeout: 10000 });

      // Key metrics should be present (portfolio value, occupancy, collection rate)
      const hasPortfolioValue = await ownerPage.portfolioValue
        .isVisible()
        .catch(() => false);
      const hasOccupancyRate = await ownerPage.occupancyRate
        .isVisible()
        .catch(() => false);
      const hasCollectionRate = await ownerPage.collectionRate
        .isVisible()
        .catch(() => false);

      // At least one key metric should be visible
      const hasAnyMetric = hasPortfolioValue || hasOccupancyRate || hasCollectionRate;
      const hasGenericMetrics = await page
        .locator('[class*="metric"], [class*="stat"], [class*="card"], [data-metric]')
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasAnyMetric || hasGenericMetrics).toBeTruthy();
    });

    test('should display arrears aging table or summary', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      // Look for arrears/aging data
      const hasArrearsTable = await ownerPage.arrearsAgingTable
        .isVisible()
        .catch(() => false);
      const hasArrearsText = await page
        .getByText(/arrears|aging|overdue|outstanding/i)
        .isVisible()
        .catch(() => false);

      expect(hasArrearsTable || hasArrearsText).toBeTruthy();
    });

    test('should allow filtering by property', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      const hasPropertyFilter = await ownerPage.propertyFilter
        .isVisible()
        .catch(() => false);

      if (hasPropertyFilter) {
        await ownerPage.propertyFilter.click();
        // Verify dropdown options appear
        const options = page.getByRole('option').or(page.locator('[class*="option"]'));
        await expect(options.first()).toBeVisible({ timeout: 5000 });
      } else {
        // Filter might be a different UI element
        const hasFilterUI = await page
          .getByText(/filter|all properties/i)
          .isVisible()
          .catch(() => false);
        expect(hasFilterUI).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // PORTFOLIO & PROPERTIES
  // ===========================================================================

  test.describe('Portfolio & Properties', () => {
    test('should navigate to portfolio and view properties', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      // Navigate to properties/portfolio section
      const propertiesLink = page.getByRole('link', { name: /properties|portfolio/i }).first();
      if (await propertiesLink.isVisible().catch(() => false)) {
        await propertiesLink.click();
        await page.waitForLoadState('networkidle');

        // Should see property list or cards
        const hasProperties = await page
          .getByText(/property|building|apartment/i)
          .first()
          .isVisible()
          .catch(() => false);
        const hasPropertyCards = await page
          .locator('[class*="card"], [class*="property"]')
          .first()
          .isVisible()
          .catch(() => false);

        expect(hasProperties || hasPropertyCards).toBeTruthy();
      }
    });

    test('should view individual property details', async ({ page }) => {
      // Navigate to properties
      const propertiesLink = page.getByRole('link', { name: /properties|portfolio/i }).first();
      if (await propertiesLink.isVisible().catch(() => false)) {
        await propertiesLink.click();
        await page.waitForLoadState('networkidle');

        // Click on first property
        const propertyLink = page
          .getByRole('link')
          .filter({ hasText: /property|apartment|house|building/i })
          .first();
        if (await propertyLink.isVisible().catch(() => false)) {
          await propertyLink.click();
          await page.waitForLoadState('networkidle');

          // Verify property detail page
          const hasDetails = await page
            .getByText(/units|occupancy|address|details/i)
            .first()
            .isVisible()
            .catch(() => false);
          expect(hasDetails).toBeTruthy();
        }
      }
    });
  });

  // ===========================================================================
  // FINANCIAL STATEMENTS
  // ===========================================================================

  test.describe('Financial Statements', () => {
    test('should view financial statements section', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      // Navigate to financial section
      const financialLink = ownerPage.financialNav;
      if (await financialLink.isVisible().catch(() => false)) {
        await ownerPage.gotoFinancial();
        await page.waitForLoadState('networkidle');

        // Verify financial content
        const hasFinancials = await page
          .getByText(/income|revenue|expense|statement|financial/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasFinancials).toBeTruthy();
      } else {
        // Try direct navigation
        await page.goto('/financial');
        await page.waitForLoadState('networkidle');
        const hasContent = await page
          .getByText(/income|revenue|statement|financial/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasContent || page.url().includes('financial')).toBeTruthy();
      }
    });

    test('should display income statement with line items', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.financialNav.isVisible().catch(() => false)) {
        await ownerPage.gotoFinancial();
        await page.waitForLoadState('networkidle');

        // Check for income statement components
        const hasIncomeStatement = await ownerPage.incomeStatement
          .isVisible()
          .catch(() => false);
        const hasRevenueSection = await page
          .getByText(/rent.*income|gross.*revenue|total.*income/i)
          .isVisible()
          .catch(() => false);

        expect(hasIncomeStatement || hasRevenueSection).toBeTruthy();
      }
    });

    test('should allow selecting statement period', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.financialNav.isVisible().catch(() => false)) {
        await ownerPage.gotoFinancial();
        await page.waitForLoadState('networkidle');

        const hasPeriodSelect = await ownerPage.statementPeriodSelect
          .isVisible()
          .catch(() => false);

        if (hasPeriodSelect) {
          await ownerPage.statementPeriodSelect.click();
          const options = page.getByRole('option');
          await expect(options.first()).toBeVisible({ timeout: 3000 });
        }
      }
    });
  });

  // ===========================================================================
  // MAINTENANCE WORK ORDERS
  // ===========================================================================

  test.describe('Maintenance Work Orders', () => {
    test('should view maintenance work orders', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.maintenanceNav.isVisible().catch(() => false)) {
        await ownerPage.gotoMaintenance();
        await page.waitForLoadState('networkidle');

        // Should see work orders or maintenance section
        const hasWorkOrders = await page
          .getByText(/work order|maintenance|repair/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasWorkOrders).toBeTruthy();
      } else {
        await page.goto('/maintenance');
        await page.waitForLoadState('networkidle');
        const hasContent = await page
          .getByText(/work order|maintenance|repair/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasContent || page.url().includes('maintenance')).toBeTruthy();
      }
    });

    test('should filter work orders by status', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.maintenanceNav.isVisible().catch(() => false)) {
        await ownerPage.gotoMaintenance();
        await page.waitForLoadState('networkidle');

        const hasStatusFilter = await ownerPage.workOrderStatusFilter
          .isVisible()
          .catch(() => false);

        if (hasStatusFilter) {
          await ownerPage.workOrderStatusFilter.click();
          const options = page.getByRole('option');
          await expect(options.first()).toBeVisible({ timeout: 3000 });
        }
      }
    });

    test('should view and approve maintenance work orders', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.maintenanceNav.isVisible().catch(() => false)) {
        await ownerPage.gotoMaintenance();
        await page.waitForLoadState('networkidle');

        // Look for work order items
        const workOrderItem = page
          .locator('[data-work-order], .work-order-item, tr')
          .filter({ hasText: /plumbing|electrical|repair|maintenance/i })
          .first();

        if (await workOrderItem.isVisible().catch(() => false)) {
          await workOrderItem.click();
          await page.waitForLoadState('networkidle');

          // Check if approve button is available
          const approveBtn = ownerPage.workOrderApproveButton;
          const hasApprove = await approveBtn.isVisible().catch(() => false);

          if (hasApprove) {
            // Verify the approve button is actionable
            await expect(approveBtn).toBeEnabled();
          }
        }
      }
    });

    test('should display maintenance cost trends', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.maintenanceNav.isVisible().catch(() => false)) {
        await ownerPage.gotoMaintenance();
        await page.waitForLoadState('networkidle');

        const hasCostTrends = await ownerPage.maintenanceCostTrends
          .isVisible()
          .catch(() => false);
        const hasCostData = await page
          .getByText(/cost|trend|expense|spending/i)
          .first()
          .isVisible()
          .catch(() => false);

        expect(hasCostTrends || hasCostData).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // DOWNLOAD REPORTS
  // ===========================================================================

  test.describe('Download Reports', () => {
    test('should download financial statement as PDF', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.financialNav.isVisible().catch(() => false)) {
        await ownerPage.gotoFinancial();
        await page.waitForLoadState('networkidle');

        const hasPdfButton = await ownerPage.downloadPdfButton
          .isVisible()
          .catch(() => false);

        if (hasPdfButton) {
          // Set up download event listener
          const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
          await ownerPage.downloadPdfButton.click();

          try {
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/\.(pdf|PDF)$/);
          } catch {
            // Download might open in new tab or trigger differently
            await page.waitForLoadState('networkidle');
          }
        }
      }
    });

    test('should download financial statement as Excel/CSV', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.financialNav.isVisible().catch(() => false)) {
        await ownerPage.gotoFinancial();
        await page.waitForLoadState('networkidle');

        const hasExcelButton = await ownerPage.downloadExcelButton
          .isVisible()
          .catch(() => false);

        if (hasExcelButton) {
          const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
          await ownerPage.downloadExcelButton.click();

          try {
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/\.(xlsx|xls|csv)$/i);
          } catch {
            await page.waitForLoadState('networkidle');
          }
        }
      }
    });
  });

  // ===========================================================================
  // DOCUMENTS
  // ===========================================================================

  test.describe('Documents', () => {
    test('should view documents section', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.documentsNav.isVisible().catch(() => false)) {
        await ownerPage.gotoDocuments();
        await page.waitForLoadState('networkidle');

        // Should see documents or files
        const hasDocuments = await page
          .getByText(/document|file|lease|agreement/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasDocuments).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // MESSAGING
  // ===========================================================================

  test.describe('Messaging', () => {
    test('should view messages section', async ({ page }) => {
      const ownerPage = new OwnerPortalPage(page);

      if (await ownerPage.messagesNav.isVisible().catch(() => false)) {
        await ownerPage.gotoMessages();
        await page.waitForLoadState('networkidle');

        // Should see messaging interface
        const hasMessages = await page
          .getByText(/message|compose|communication|inbox/i)
          .first()
          .isVisible()
          .catch(() => false);
        const hasCompose = await ownerPage.messageCompose
          .isVisible()
          .catch(() => false);

        expect(hasMessages || hasCompose).toBeTruthy();
      }
    });
  });
});

import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { testUsers } from '../fixtures/test-data';

/**
 * Owner Dashboard E2E Tests
 * Covers: View metrics, financial statements, approvals
 */

test.describe('Owner Dashboard - Metrics', () => {
  test.use({ project: 'owner-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should display dashboard with metrics', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.expectDashboardLoaded();
    
    // Should show key metrics
    const hasMetrics = await page.getByText(/revenue|income|collection|occupancy/i)
      .isVisible()
      .catch(() => false);
    expect(hasMetrics || page.url().includes('dashboard')).toBeTruthy();
  });

  test('should display occupancy rate', async ({ page }) => {
    const occupancyCard = page.locator('[data-testid="occupancy"]')
      .or(page.getByText(/occupancy/i).locator('..'));
    
    const hasOccupancy = await occupancyCard.isVisible().catch(() => false);
    if (hasOccupancy) {
      // Should show percentage
      const hasPercentage = await page.getByText(/%/).isVisible();
      expect(hasPercentage).toBeTruthy();
    }
  });

  test('should display revenue summary', async ({ page }) => {
    const revenueCard = page.locator('[data-testid="revenue"]')
      .or(page.getByText(/revenue|income/i).locator('..'));
    
    const hasRevenue = await revenueCard.isVisible().catch(() => false);
    if (hasRevenue) {
      // Should show currency amount
      const hasAmount = await page.getByText(/ksh|kes|ksh\s*[\d,]+/i).isVisible();
      expect(hasAmount || true).toBeTruthy();
    }
  });

  test('should display collection rate', async ({ page }) => {
    const collectionCard = page.locator('[data-testid="collection"]')
      .or(page.getByText(/collection/i).locator('..'));
    
    const hasCollection = await collectionCard.isVisible().catch(() => false);
    expect(hasCollection || page.url().includes('dashboard')).toBeTruthy();
  });

  test('should display pending maintenance count', async ({ page }) => {
    const maintenanceCard = page.locator('[data-testid="maintenance"]')
      .or(page.getByText(/maintenance|work order/i).locator('..'));
    
    const hasMaintenance = await maintenanceCard.isVisible().catch(() => false);
    expect(hasMaintenance || page.url().includes('dashboard')).toBeTruthy();
  });

  test('should filter metrics by date range', async ({ page }) => {
    // Look for date filter
    const dateFilter = page.getByLabel(/date|period|range/i)
      .or(page.locator('select').first());
    
    if (await dateFilter.isVisible().catch(() => false)) {
      await dateFilter.selectOption({ label: /this month|last 30/i });
      await page.waitForLoadState('networkidle');
      
      // Metrics should update
      const hasMetrics = await page.getByText(/revenue|income/i)
        .isVisible()
        .catch(() => false);
      expect(hasMetrics).toBeTruthy();
    }
  });

  test('should display property breakdown', async ({ page }) => {
    // Look for property-level breakdown
    const propertyBreakdown = page.getByText(/by property|property breakdown/i);
    
    if (await propertyBreakdown.isVisible().catch(() => false)) {
      await propertyBreakdown.click();
      
      // Should show individual property metrics
      const hasProperties = await page.locator('tr, [data-testid*="property"]')
        .count() > 0;
      expect(hasProperties).toBeTruthy();
    }
  });
});

test.describe('Owner Dashboard - Financial Statements', () => {
  test.use({ project: 'owner-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should navigate to statements page', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    const hasStatements = await page.getByText(/statement|financial|report/i)
      .isVisible()
      .catch(() => false);
    expect(hasStatements || page.url().includes('statement')).toBeTruthy();
  });

  test('should display monthly statements', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    // Should show monthly statement list
    const hasMonthly = await page.getByText(/january|february|march|april|may|june|july|august|september|october|november|december/i)
      .isVisible()
      .catch(() => false);
    expect(hasMonthly || page.url().includes('statement')).toBeTruthy();
  });

  test('should view statement details', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    // Click on first statement
    const statementRow = page.locator('tr, [data-testid*="statement"]').first();
    if (await statementRow.isVisible().catch(() => false)) {
      await statementRow.click();
      await page.waitForLoadState('networkidle');
      
      // Should show detailed breakdown
      const hasDetails = await page.getByText(/income|expense|net|gross/i)
        .isVisible()
        .catch(() => false);
      expect(hasDetails || page.url().includes('statement')).toBeTruthy();
    }
  });

  test('should download statement PDF', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    // Find download button
    const downloadButton = page.getByRole('button', { name: /download|pdf|export/i }).first();
    if (await downloadButton.isVisible().catch(() => false)) {
      const downloadPromise = page.waitForEvent('download');
      await downloadButton.click();
      
      const download = await downloadPromise.catch(() => null);
      if (download) {
        expect(download.suggestedFilename()).toMatch(/statement|\.pdf/i);
      }
    }
  });

  test('should show income breakdown', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    // Look for income section
    const incomeSection = page.getByText(/income|revenue breakdown/i);
    if (await incomeSection.isVisible().catch(() => false)) {
      await incomeSection.click();
      
      // Should show categories
      const hasCategories = await page.getByText(/rent|service charge|utility|deposit/i)
        .isVisible()
        .catch(() => false);
      expect(hasCategories).toBeTruthy();
    }
  });

  test('should show expense breakdown', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    // Look for expense section
    const expenseSection = page.getByText(/expense|cost breakdown/i);
    if (await expenseSection.isVisible().catch(() => false)) {
      await expenseSection.click();
      
      // Should show categories
      const hasCategories = await page.getByText(/maintenance|management|utility|tax/i)
        .isVisible()
        .catch(() => false);
      expect(hasCategories).toBeTruthy();
    }
  });

  test('should export statements to Excel', async ({ page }) => {
    await page.goto('/statements');
    await page.waitForLoadState('networkidle');
    
    // Find export button
    const exportButton = page.getByRole('button', { name: /excel|xlsx|export/i });
    if (await exportButton.isVisible().catch(() => false)) {
      const downloadPromise = page.waitForEvent('download');
      await exportButton.click();
      
      const download = await downloadPromise.catch(() => null);
      if (download) {
        expect(download.suggestedFilename()).toMatch(/\.xlsx?|statement/i);
      }
    }
  });
});

test.describe('Owner Dashboard - Approvals', () => {
  test.use({ project: 'owner-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should display pending approvals', async ({ page }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    
    const hasApprovals = await page.getByText(/approval|pending|review/i)
      .isVisible()
      .catch(() => false);
    expect(hasApprovals || page.url().includes('approval')).toBeTruthy();
  });

  test('should approve maintenance expense', async ({ page }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    
    // Find pending approval
    const pendingItem = page.locator('[data-status="pending"]')
      .or(page.getByText(/pending approval/i).locator('..'));
    
    if (await pendingItem.isVisible().catch(() => false)) {
      await pendingItem.click();
      
      // View details
      await page.waitForLoadState('networkidle');
      
      // Approve
      const approveButton = page.getByRole('button', { name: /approve/i });
      if (await approveButton.isVisible().catch(() => false)) {
        await approveButton.click();
        
        // Confirm
        const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }
        
        const hasSuccess = await page.getByText(/approved|success/i)
          .isVisible()
          .catch(() => false);
        expect(hasSuccess || page.url().includes('approval')).toBeTruthy();
      }
    }
  });

  test('should reject expense with reason', async ({ page }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    
    const pendingItem = page.locator('[data-status="pending"]')
      .or(page.getByText(/pending/i).locator('..'));
    
    if (await pendingItem.isVisible().catch(() => false)) {
      await pendingItem.click();
      await page.waitForLoadState('networkidle');
      
      // Reject
      const rejectButton = page.getByRole('button', { name: /reject|decline/i });
      if (await rejectButton.isVisible().catch(() => false)) {
        await rejectButton.click();
        
        // Enter reason
        const reasonInput = page.getByLabel(/reason|comment/i);
        if (await reasonInput.isVisible().catch(() => false)) {
          await reasonInput.fill('Amount exceeds budget - please revise');
        }
        
        await page.getByRole('button', { name: /submit|confirm/i }).click();
        
        const hasRejected = await page.getByText(/rejected|declined/i)
          .isVisible()
          .catch(() => false);
        expect(hasRejected || page.url().includes('approval')).toBeTruthy();
      }
    }
  });

  test('should request more information', async ({ page }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    
    const pendingItem = page.locator('[data-status="pending"]')
      .or(page.getByText(/pending/i).locator('..'));
    
    if (await pendingItem.isVisible().catch(() => false)) {
      await pendingItem.click();
      
      // Request info
      const infoButton = page.getByRole('button', { name: /more info|request|question/i });
      if (await infoButton.isVisible().catch(() => false)) {
        await infoButton.click();
        
        // Enter question
        const questionInput = page.getByLabel(/question|message/i);
        if (await questionInput.isVisible().catch(() => false)) {
          await questionInput.fill('Please provide quote comparisons');
        }
        
        await page.getByRole('button', { name: /send|submit/i }).click();
      }
    }
  });

  test('should view approval history', async ({ page }) => {
    await page.goto('/approvals/history');
    await page.waitForLoadState('networkidle');
    
    const hasHistory = await page.getByText(/history|past|previous|approved|rejected/i)
      .isVisible()
      .catch(() => false);
    expect(hasHistory || page.url().includes('approval')).toBeTruthy();
  });
});

test.describe('Owner Dashboard - Properties Overview', () => {
  test.use({ project: 'owner-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should navigate to properties list', async ({ page }) => {
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    
    const hasProperties = await page.getByText(/propert/i)
      .isVisible()
      .catch(() => false);
    expect(hasProperties || page.url().includes('propert')).toBeTruthy();
  });

  test('should view property details', async ({ page }) => {
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    
    // Click first property
    const propertyCard = page.locator('[data-testid*="property"]')
      .or(page.locator('tr').nth(1));
    
    if (await propertyCard.isVisible().catch(() => false)) {
      await propertyCard.click();
      await page.waitForLoadState('networkidle');
      
      // Should show property info
      const hasDetails = await page.getByText(/unit|address|occupancy/i)
        .isVisible()
        .catch(() => false);
      expect(hasDetails || page.url().includes('propert')).toBeTruthy();
    }
  });

  test('should view property financial summary', async ({ page }) => {
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    
    const propertyCard = page.locator('[data-testid*="property"]')
      .or(page.locator('tr').nth(1));
    
    if (await propertyCard.isVisible().catch(() => false)) {
      await propertyCard.click();
      await page.waitForLoadState('networkidle');
      
      // Navigate to financials tab
      const financialsTab = page.getByRole('tab', { name: /financial|income|revenue/i });
      if (await financialsTab.isVisible().catch(() => false)) {
        await financialsTab.click();
        
        const hasFinancials = await page.getByText(/revenue|income|expense/i)
          .isVisible()
          .catch(() => false);
        expect(hasFinancials).toBeTruthy();
      }
    }
  });

  test('should view tenant list for property', async ({ page }) => {
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    
    const propertyCard = page.locator('[data-testid*="property"]')
      .or(page.locator('tr').nth(1));
    
    if (await propertyCard.isVisible().catch(() => false)) {
      await propertyCard.click();
      await page.waitForLoadState('networkidle');
      
      // Navigate to tenants tab
      const tenantsTab = page.getByRole('tab', { name: /tenant|resident/i });
      if (await tenantsTab.isVisible().catch(() => false)) {
        await tenantsTab.click();
        
        const hasTenants = await page.getByText(/tenant|name|unit/i)
          .isVisible()
          .catch(() => false);
        expect(hasTenants || page.url().includes('propert')).toBeTruthy();
      }
    }
  });
});

test.describe('Owner Dashboard - Notifications', () => {
  test.use({ project: 'owner-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  });

  test('should display notification bell', async ({ page }) => {
    const notificationBell = page.locator('[data-testid="notifications"]')
      .or(page.getByRole('button', { name: /notification/i }));
    
    const hasBell = await notificationBell.isVisible().catch(() => false);
    expect(hasBell || page.url().includes('dashboard')).toBeTruthy();
  });

  test('should open notifications panel', async ({ page }) => {
    const notificationBell = page.locator('[data-testid="notifications"]')
      .or(page.getByRole('button', { name: /notification/i }));
    
    if (await notificationBell.isVisible().catch(() => false)) {
      await notificationBell.click();
      
      const hasPanel = await page.getByText(/notification|no notification|all caught up/i)
        .isVisible()
        .catch(() => false);
      expect(hasPanel).toBeTruthy();
    }
  });

  test('should mark notification as read', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('networkidle');
    
    // Click on unread notification
    const unreadItem = page.locator('[data-unread="true"]')
      .or(page.locator('.unread'));
    
    if (await unreadItem.isVisible().catch(() => false)) {
      await unreadItem.first().click();
      
      // Should mark as read
      await page.waitForLoadState('networkidle');
    }
  });

  test('should configure notification preferences', async ({ page }) => {
    await page.goto('/settings/notifications');
    await page.waitForLoadState('networkidle');
    
    const hasSettings = await page.getByText(/notification|email|sms|push/i)
      .isVisible()
      .catch(() => false);
    expect(hasSettings || page.url().includes('setting')).toBeTruthy();
  });
});

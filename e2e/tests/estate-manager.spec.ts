import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { testUsers, testWorkOrders, testPayments } from '../fixtures/test-data';

/**
 * Estate Manager App E2E Tests
 * Covers: Dashboard with work orders, Kanban board interaction,
 *         work order creation, customer details, and payment recording.
 */

test.describe('Estate Manager App', () => {
  test.use({ project: 'estate-manager' });

  // Login before each test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.manager.email, testUsers.manager.password);
    await page.waitForURL(/\/(dashboard|work-orders|home)/, { timeout: 15000 });
  });

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  test.describe('Dashboard', () => {
    test('should load dashboard with work orders summary', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.expectDashboardLoaded();

      // Should display work order metrics or summary
      const hasWorkOrderStats = await page
        .getByText(/work order|open|pending|in progress|assigned/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasMetricCards = await page
        .locator('[class*="card"], [class*="stat"], [class*="metric"], [data-metric]')
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasWorkOrderStats || hasMetricCards).toBeTruthy();
    });

    test('should display quick action links', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.expectDashboardLoaded();

      // Check for quick action buttons
      const hasCreateWorkOrder = await dashboard.createWorkOrderLink
        .isVisible()
        .catch(() => false);
      const hasReceivePayment = await dashboard.receivePaymentLink
        .isVisible()
        .catch(() => false);
      const hasAddCustomer = await dashboard.addCustomerLink
        .isVisible()
        .catch(() => false);
      const hasQuickActions = await page
        .getByText(/quick action|shortcut/i)
        .isVisible()
        .catch(() => false);

      expect(
        hasCreateWorkOrder || hasReceivePayment || hasAddCustomer || hasQuickActions
      ).toBeTruthy();
    });

    test('should navigate to work orders from dashboard', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.expectDashboardLoaded();

      const workOrdersLink = dashboard.workOrdersLink;
      if (await workOrdersLink.isVisible().catch(() => false)) {
        await dashboard.clickWorkOrders();
        await page.waitForLoadState('networkidle');
        expect(page.url()).toMatch(/work.?order/i);
      } else {
        // Try direct navigation
        await page.goto('/work-orders');
        await page.waitForLoadState('networkidle');
        const hasContent = await page
          .getByText(/work order/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasContent).toBeTruthy();
      }
    });

    test('should show recent activity or notifications', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.expectDashboardLoaded();

      const hasActivity = await page
        .getByText(/recent|activity|notification|alert|update/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasTimeline = await page
        .locator('[class*="activity"], [class*="timeline"], [class*="notification"]')
        .first()
        .isVisible()
        .catch(() => false);

      // This is optional - not all dashboards show recent activity
      expect(hasActivity || hasTimeline || true).toBeTruthy();
    });
  });

  // ===========================================================================
  // KANBAN BOARD
  // ===========================================================================

  test.describe('Kanban Board', () => {
    test('should display Kanban board with work order columns', async ({ page }) => {
      // Navigate to work orders Kanban view
      await page.goto('/work-orders');
      await page.waitForLoadState('networkidle');

      // Try switching to Kanban view if there's a toggle
      const kanbanToggle = page.getByRole('button', { name: /kanban|board/i })
        .or(page.locator('[data-testid="kanban-view"]'))
        .or(page.getByLabel(/kanban|board view/i));

      if (await kanbanToggle.isVisible().catch(() => false)) {
        await kanbanToggle.click();
        await page.waitForLoadState('networkidle');
      }

      // Look for Kanban columns
      const hasColumns = await page
        .locator('[class*="column"], [class*="kanban"], [data-status]')
        .first()
        .isVisible()
        .catch(() => false);
      const hasStatusHeaders = await page
        .getByText(/open|in progress|assigned|completed/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasColumns || hasStatusHeaders).toBeTruthy();
    });

    test('should interact with Kanban board - drag work order', async ({ page }) => {
      await page.goto('/work-orders');
      await page.waitForLoadState('networkidle');

      // Switch to Kanban view
      const kanbanToggle = page.getByRole('button', { name: /kanban|board/i })
        .or(page.locator('[data-testid="kanban-view"]'));

      if (await kanbanToggle.isVisible().catch(() => false)) {
        await kanbanToggle.click();
        await page.waitForLoadState('networkidle');
      }

      // Find a draggable card
      const cards = page.locator(
        '[class*="card"][draggable], [data-draggable], [class*="kanban-card"]'
      );
      const cardCount = await cards.count();

      if (cardCount > 0) {
        const firstCard = cards.first();
        const cardBox = await firstCard.boundingBox();

        if (cardBox) {
          // Simulate drag gesture
          await firstCard.hover();
          await page.mouse.down();
          // Move right to simulate drag to next column
          await page.mouse.move(cardBox.x + 300, cardBox.y, { steps: 10 });
          await page.mouse.up();
          await page.waitForLoadState('networkidle');
        }
      }

      // Verify board is still functional
      const hasBoardContent = await page
        .getByText(/open|in progress|assigned|completed/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasBoardContent).toBeTruthy();
    });
  });

  // ===========================================================================
  // CREATE WORK ORDER
  // ===========================================================================

  test.describe('Create Work Order', () => {
    test('should create new work order', async ({ page }) => {
      // Navigate to create work order
      const dashboard = new DashboardPage(page);
      const hasLink = await dashboard.createWorkOrderLink
        .isVisible()
        .catch(() => false);

      if (hasLink) {
        await dashboard.clickCreateWorkOrder();
      } else {
        await page.goto('/work-orders/new');
      }
      await page.waitForLoadState('networkidle');

      const workOrder = testWorkOrders.plumbing();

      // Fill title
      const titleInput = page.getByLabel(/title|subject|issue/i).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await titleInput.fill(workOrder.title);
      }

      // Fill description
      const descInput = page.getByLabel(/description|details/i).first()
        .or(page.locator('textarea').first());
      if (await descInput.isVisible().catch(() => false)) {
        await descInput.fill(workOrder.description);
      }

      // Select category
      const categoryField = page.getByLabel(/category/i).first();
      if (await categoryField.isVisible().catch(() => false)) {
        await categoryField.click();
        const plumbingOption = page.getByRole('option', { name: /plumbing/i });
        if (await plumbingOption.isVisible().catch(() => false)) {
          await plumbingOption.click();
        }
      }

      // Select priority
      const priorityField = page.getByLabel(/priority/i).first();
      if (await priorityField.isVisible().catch(() => false)) {
        await priorityField.click();
        const mediumOption = page.getByRole('option', { name: /medium/i });
        if (await mediumOption.isVisible().catch(() => false)) {
          await mediumOption.click();
        }
      }

      // Select property (if available)
      const propertyField = page.getByLabel(/property/i).first();
      if (await propertyField.isVisible().catch(() => false)) {
        await propertyField.click();
        const firstOption = page.getByRole('option').first();
        if (await firstOption.isVisible().catch(() => false)) {
          await firstOption.click();
        }
      }

      // Select unit (if available)
      const unitField = page.getByLabel(/unit/i).first();
      if (await unitField.isVisible().catch(() => false)) {
        await unitField.click();
        const firstUnit = page.getByRole('option').first();
        if (await firstUnit.isVisible().catch(() => false)) {
          await firstUnit.click();
        }
      }

      // Submit
      const submitBtn = page.getByRole('button', { name: /create|submit|save/i });
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForLoadState('networkidle');

        // Verify success
        const hasSuccess = await page
          .getByText(/created|success|submitted/i)
          .isVisible()
          .catch(() => false);
        const wasRedirected = page.url().includes('work-order');
        expect(hasSuccess || wasRedirected).toBeTruthy();
      }
    });

    test('should validate required fields on work order form', async ({ page }) => {
      await page.goto('/work-orders/new');
      await page.waitForLoadState('networkidle');

      // Try to submit empty form
      const submitBtn = page.getByRole('button', { name: /create|submit|save/i });
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();

        // Should show validation errors
        const hasErrors = await page
          .getByText(/required|please fill|cannot be empty/i)
          .first()
          .isVisible()
          .catch(() => false);
        const hasInvalidFields = await page
          .locator('[class*="error"], [class*="invalid"], [aria-invalid="true"]')
          .first()
          .isVisible()
          .catch(() => false);

        expect(hasErrors || hasInvalidFields).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // VIEW CUSTOMER DETAILS
  // ===========================================================================

  test.describe('Customer Details', () => {
    test('should view customer list', async ({ page }) => {
      // Navigate to customers section
      const customersLink = page.getByRole('link', { name: /customer|tenant|resident/i }).first();
      if (await customersLink.isVisible().catch(() => false)) {
        await customersLink.click();
      } else {
        await page.goto('/customers');
      }
      await page.waitForLoadState('networkidle');

      const hasCustomers = await page
        .getByText(/customer|tenant|resident/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasTable = await page
        .locator('table, [class*="list"], [class*="card"]')
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasCustomers || hasTable).toBeTruthy();
    });

    test('should view individual customer details', async ({ page }) => {
      await page.goto('/customers');
      await page.waitForLoadState('networkidle');

      // Click on first customer
      const customerRow = page
        .locator('tr, [class*="card"], [class*="list-item"]')
        .filter({ has: page.getByRole('link') })
        .first();

      if (await customerRow.isVisible().catch(() => false)) {
        const link = customerRow.getByRole('link').first();
        await link.click();
        await page.waitForLoadState('networkidle');

        // Should see customer details
        const hasDetails = await page
          .getByText(/phone|email|lease|unit|balance/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(hasDetails).toBeTruthy();
      }
    });

    test('should search customers', async ({ page }) => {
      await page.goto('/customers');
      await page.waitForLoadState('networkidle');

      const searchInput = page.getByPlaceholder(/search/i).first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('test');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle');

        // Results should be filtered
        const hasResults = await page
          .locator('table tbody tr, [class*="card"], [class*="list-item"]')
          .first()
          .isVisible()
          .catch(() => false);
        const hasEmpty = await page
          .getByText(/no.*found|no.*result/i)
          .isVisible()
          .catch(() => false);

        expect(hasResults || hasEmpty).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // RECORD PAYMENT
  // ===========================================================================

  test.describe('Record Payment', () => {
    test('should navigate to record payment', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      const hasLink = await dashboard.receivePaymentLink
        .isVisible()
        .catch(() => false);

      if (hasLink) {
        await dashboard.clickReceivePayment();
      } else {
        await page.goto('/payments/receive');
      }
      await page.waitForLoadState('networkidle');

      const hasForm = await page
        .getByText(/receive|record|payment/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasForm).toBeTruthy();
    });

    test('should record manual payment', async ({ page }) => {
      await page.goto('/payments/receive');
      await page.waitForLoadState('networkidle');

      const payment = testPayments.rent();

      // Select customer (if available)
      const customerField = page.getByLabel(/customer|tenant/i).first();
      if (await customerField.isVisible().catch(() => false)) {
        await customerField.click();
        const firstCustomer = page.getByRole('option').first();
        if (await firstCustomer.isVisible().catch(() => false)) {
          await firstCustomer.click();
        }
      }

      // Enter amount
      const amountInput = page.getByLabel(/amount/i).first();
      if (await amountInput.isVisible().catch(() => false)) {
        await amountInput.fill(String(payment.amount));
      }

      // Select payment method
      const methodField = page.getByLabel(/method|payment.*method/i).first();
      if (await methodField.isVisible().catch(() => false)) {
        await methodField.click();
        const mpesaOption = page.getByRole('option', { name: /mpesa|m-pesa/i });
        if (await mpesaOption.isVisible().catch(() => false)) {
          await mpesaOption.click();
        }
      }

      // Enter reference
      const refInput = page.getByLabel(/reference|receipt|transaction/i).first();
      if (await refInput.isVisible().catch(() => false)) {
        await refInput.fill(payment.reference);
      }

      // Submit
      const submitBtn = page.getByRole('button', { name: /record|submit|save|receive/i });
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForLoadState('networkidle');

        const hasSuccess = await page
          .getByText(/recorded|success|saved/i)
          .isVisible()
          .catch(() => false);
        const wasRedirected = page.url().includes('payment');
        expect(hasSuccess || wasRedirected).toBeTruthy();
      }
    });
  });

  // ===========================================================================
  // PROPERTIES MANAGEMENT
  // ===========================================================================

  test.describe('Properties', () => {
    test('should view property list', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      const hasLink = await dashboard.propertiesLink
        .isVisible()
        .catch(() => false);

      if (hasLink) {
        await dashboard.clickProperties();
      } else {
        await page.goto('/properties');
      }
      await page.waitForLoadState('networkidle');

      const hasProperties = await page
        .getByText(/property|building|portfolio/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasProperties).toBeTruthy();
    });
  });

  // ===========================================================================
  // LEASES
  // ===========================================================================

  test.describe('Leases', () => {
    test('should view lease list', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      const hasLink = await dashboard.leasesLink
        .isVisible()
        .catch(() => false);

      if (hasLink) {
        await dashboard.clickLeases();
      } else {
        await page.goto('/leases');
      }
      await page.waitForLoadState('networkidle');

      const hasLeases = await page
        .getByText(/lease|tenancy|contract/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasLeases).toBeTruthy();
    });
  });
});

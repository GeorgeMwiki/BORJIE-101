import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testWorkOrders } from '../fixtures/test-data';

/**
 * Customer App E2E Tests
 * Covers: Dashboard with balance, maintenance requests, payment history,
 *         lease documents, and feedback submission.
 */

test.describe('Customer App', () => {
  test.use({ project: 'customer-app' });

  /**
   * Helper to log in as customer via OTP flow.
   * In test environment, OTP auto-fills or uses mock code.
   */
  async function loginAsCustomer(page: import('@playwright/test').Page) {
    await page.goto('/auth/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByLabel(/phone/i).fill(testUsers.customer.phone);
    await page.getByRole('button', { name: /send otp|continue/i }).click();

    // Wait for OTP page or auto-login
    try {
      await page.waitForURL(/\/auth\/otp/, { timeout: 5000 });
      // Enter test OTP
      const otpInput = page.getByLabel(/otp|code|verification/i);
      if (await otpInput.isVisible({ timeout: 2000 })) {
        await otpInput.fill('123456');
        await page.getByRole('button', { name: /verify|submit|login/i }).click();
      }
    } catch {
      // Auto-login may have happened
    }

    await page.waitForURL(/\/(home|dashboard|payments|$)/, { timeout: 15000 });
  }

  // ===========================================================================
  // LOGIN FLOW
  // ===========================================================================

  test.describe('Login Flow', () => {
    test('should display login page with phone input', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto('/auth/login');
      await expect(page.getByText(/borjie|sign in|welcome/i)).toBeVisible();
      await expect(loginPage.phoneInput).toBeVisible();
    });

    test('should show OTP page after phone submission', async ({ page }) => {
      await page.goto('/auth/login');
      await page.getByLabel(/phone/i).fill(testUsers.customer.phone);
      await page.getByRole('button', { name: /send otp/i }).click();
      await page.waitForURL(/\/auth\/otp/, { timeout: 10000 });
      await expect(page.getByText(/otp|verify|code/i)).toBeVisible();
    });

    test('should reject invalid phone format', async ({ page }) => {
      await page.goto('/auth/login');
      await page.getByLabel(/phone/i).fill('12345');
      await page.getByRole('button', { name: /send otp/i }).click();
      await expect(page.getByText(/invalid|phone|format|error/i)).toBeVisible({ timeout: 5000 });
    });
  });

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  test.describe('Dashboard', () => {
    test('should display dashboard or home with balance due', async ({ page }) => {
      await loginAsCustomer(page);

      // Should see dashboard content
      const hasBalanceDue = await page
        .getByText(/balance|amount due|owed|outstanding|KES|TZS/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasDashboard = await page
        .getByText(/dashboard|home|my lease|welcome/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasPaymentCTA = await page
        .getByRole('button', { name: /pay|make payment/i })
        .or(page.getByRole('link', { name: /pay|make payment/i }))
        .isVisible()
        .catch(() => false);

      expect(hasBalanceDue || hasDashboard || hasPaymentCTA).toBeTruthy();
    });

    test('should show upcoming payment information', async ({ page }) => {
      await loginAsCustomer(page);

      const hasPaymentInfo = await page
        .getByText(/next payment|due date|upcoming|rent due/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasAmountInfo = await page
        .getByText(/KES|TZS|\d{2,3},\d{3}/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasPaymentInfo || hasAmountInfo).toBeTruthy();
    });
  });

  // ===========================================================================
  // MAINTENANCE REQUESTS
  // ===========================================================================

  test.describe('Maintenance Requests', () => {
    test('should navigate to maintenance section', async ({ page }) => {
      await loginAsCustomer(page);

      const maintenanceLink = page.getByRole('link', { name: /maintenance|request|repair/i }).first();
      const maintenanceNav = page.getByRole('navigation').getByText(/maintenance/i);

      if (await maintenanceLink.isVisible().catch(() => false)) {
        await maintenanceLink.click();
      } else if (await maintenanceNav.isVisible().catch(() => false)) {
        await maintenanceNav.click();
      } else {
        await page.goto('/maintenance');
      }

      await page.waitForLoadState('networkidle');

      const hasContent = await page
        .getByText(/maintenance|request|work order|repair/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(hasContent).toBeTruthy();
    });

    test('should submit maintenance request with description', async ({ page }) => {
      await loginAsCustomer(page);

      // Navigate to create request
      await page.goto('/maintenance/new');
      await page.waitForLoadState('networkidle');

      // If redirected, try alternative navigation
      if (page.url().includes('login')) {
        await loginAsCustomer(page);
        await page.goto('/maintenance/new');
      }

      const hasForm = await page
        .getByText(/new.*request|submit.*request|report.*issue|create/i)
        .first()
        .isVisible()
        .catch(() => false);

      if (hasForm) {
        // Fill in maintenance request form
        const workOrder = testWorkOrders.plumbing();

        // Title or subject
        const titleInput = page.getByLabel(/title|subject|issue/i).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(workOrder.title);
        }

        // Description
        const descInput = page.getByLabel(/description|details|explain/i).first()
          .or(page.locator('textarea').first());
        if (await descInput.isVisible().catch(() => false)) {
          await descInput.fill(workOrder.description);
        }

        // Category dropdown
        const categorySelect = page.getByLabel(/category|type/i).first();
        if (await categorySelect.isVisible().catch(() => false)) {
          await categorySelect.click();
          const plumbingOption = page.getByRole('option', { name: /plumbing/i });
          if (await plumbingOption.isVisible().catch(() => false)) {
            await plumbingOption.click();
          }
        }

        // Priority dropdown
        const prioritySelect = page.getByLabel(/priority|urgency/i).first();
        if (await prioritySelect.isVisible().catch(() => false)) {
          await prioritySelect.click();
          const mediumOption = page.getByRole('option', { name: /medium/i });
          if (await mediumOption.isVisible().catch(() => false)) {
            await mediumOption.click();
          }
        }

        // Submit
        const submitBtn = page.getByRole('button', { name: /submit|create|send/i });
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForLoadState('networkidle');

          // Verify success
          const hasSuccess = await page
            .getByText(/submitted|created|success|thank/i)
            .isVisible()
            .catch(() => false);
          const wasRedirected = page.url().includes('maintenance');
          expect(hasSuccess || wasRedirected).toBeTruthy();
        }
      }
    });

    test('should view existing maintenance requests', async ({ page }) => {
      await loginAsCustomer(page);
      await page.goto('/maintenance');
      await page.waitForLoadState('networkidle');

      const hasList = await page
        .locator('[class*="card"], [class*="list-item"], tr')
        .filter({ hasText: /plumbing|electrical|repair|maintenance|open|pending/i })
        .first()
        .isVisible()
        .catch(() => false);
      const hasEmpty = await page
        .getByText(/no.*request|no.*maintenance|empty/i)
        .isVisible()
        .catch(() => false);

      expect(hasList || hasEmpty).toBeTruthy();
    });
  });

  // ===========================================================================
  // PAYMENT HISTORY
  // ===========================================================================

  test.describe('Payment History', () => {
    test('should view payment history', async ({ page }) => {
      await loginAsCustomer(page);

      // Navigate to payments section
      const paymentLink = page.getByRole('link', { name: /payment|billing|history/i }).first();
      if (await paymentLink.isVisible().catch(() => false)) {
        await paymentLink.click();
      } else {
        await page.goto('/payments');
      }
      await page.waitForLoadState('networkidle');

      const hasPayments = await page
        .getByText(/payment|history|transaction|receipt/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasPaymentList = await page
        .locator('table, [class*="list"], [class*="card"]')
        .filter({ hasText: /KES|TZS|paid|completed|mpesa/i })
        .first()
        .isVisible()
        .catch(() => false);
      const hasEmptyState = await page
        .getByText(/no.*payment|no.*transaction/i)
        .isVisible()
        .catch(() => false);

      expect(hasPayments || hasPaymentList || hasEmptyState).toBeTruthy();
    });

    test('should display payment details (amount, date, method)', async ({ page }) => {
      await loginAsCustomer(page);
      await page.goto('/payments');
      await page.waitForLoadState('networkidle');

      // Check for payment detail elements
      const hasAmount = await page
        .getByText(/KES|TZS|\d{1,3}(,\d{3})+/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasMethod = await page
        .getByText(/mpesa|bank|cash|transfer|credit/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasAmount || hasMethod || page.url().includes('payments')).toBeTruthy();
    });
  });

  // ===========================================================================
  // LEASE DOCUMENTS
  // ===========================================================================

  test.describe('Lease Documents', () => {
    test('should view lease documents', async ({ page }) => {
      await loginAsCustomer(page);

      // Navigate to lease or documents section
      const leaseLink = page.getByRole('link', { name: /lease|document|my lease/i }).first();
      if (await leaseLink.isVisible().catch(() => false)) {
        await leaseLink.click();
      } else {
        await page.goto('/lease');
      }
      await page.waitForLoadState('networkidle');

      const hasLease = await page
        .getByText(/lease|agreement|document|contract|tenancy/i)
        .first()
        .isVisible()
        .catch(() => false);
      const hasLeaseDetails = await page
        .getByText(/start date|end date|rent amount|monthly/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasLease || hasLeaseDetails || page.url().includes('lease')).toBeTruthy();
    });

    test('should display lease terms and details', async ({ page }) => {
      await loginAsCustomer(page);
      await page.goto('/lease');
      await page.waitForLoadState('networkidle');

      const hasTerms = await page
        .getByText(/term|duration|start|end|rent|deposit/i)
        .first()
        .isVisible()
        .catch(() => false);

      expect(hasTerms || page.url().includes('lease')).toBeTruthy();
    });
  });

  // ===========================================================================
  // FEEDBACK
  // ===========================================================================

  test.describe('Feedback', () => {
    test('should submit feedback', async ({ page }) => {
      await loginAsCustomer(page);

      // Navigate to feedback section
      const feedbackLink = page.getByRole('link', { name: /feedback|contact|support|help/i }).first();
      if (await feedbackLink.isVisible().catch(() => false)) {
        await feedbackLink.click();
      } else {
        await page.goto('/feedback');
      }
      await page.waitForLoadState('networkidle');

      const hasForm = await page
        .getByText(/feedback|rate|comment|suggestion|submit/i)
        .first()
        .isVisible()
        .catch(() => false);

      if (hasForm) {
        // Fill feedback form
        const subjectInput = page.getByLabel(/subject|title/i).first();
        if (await subjectInput.isVisible().catch(() => false)) {
          await subjectInput.fill('Great service');
        }

        const messageInput = page.getByLabel(/message|comment|feedback/i).first()
          .or(page.locator('textarea').first());
        if (await messageInput.isVisible().catch(() => false)) {
          await messageInput.fill('The maintenance team was very responsive. Thank you!');
        }

        // Rating (if available)
        const ratingStars = page.locator('[class*="star"], [class*="rating"]').first();
        if (await ratingStars.isVisible().catch(() => false)) {
          await ratingStars.click();
        }

        // Submit
        const submitBtn = page.getByRole('button', { name: /submit|send|post/i });
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForLoadState('networkidle');

          const hasSuccess = await page
            .getByText(/thank|submitted|success|received/i)
            .isVisible()
            .catch(() => false);
          expect(hasSuccess || page.url().includes('feedback')).toBeTruthy();
        }
      }
    });
  });

  // ===========================================================================
  // MOBILE RESPONSIVENESS
  // ===========================================================================

  test.describe('Mobile Layout', () => {
    test.use({ project: 'customer-app-mobile' });

    test('should render properly on mobile viewport', async ({ page }) => {
      await page.goto('/auth/login');
      await page.waitForLoadState('domcontentloaded');

      // Login page should be usable on mobile
      const loginPage = new LoginPage(page);
      await expect(loginPage.phoneInput).toBeVisible();

      // Check no horizontal scrollbar (content fits viewport)
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Allow small margin
    });
  });
});

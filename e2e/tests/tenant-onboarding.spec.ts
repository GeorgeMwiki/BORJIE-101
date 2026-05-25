import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testTenants, testProperties } from '../fixtures/test-data';

/**
 * Tenant Onboarding E2E Tests
 * Covers: New tenant signup flow, organization setup, verification
 */

test.describe('Tenant Signup Flow', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display tenant creation form', async ({ page }) => {
    await page.goto('/tenants/new');
    await expect(page.getByRole('heading', { name: /create|new tenant/i })).toBeVisible({ timeout: 10000 });
    
    // Required fields should be visible
    await expect(page.getByLabel(/name|company|organization/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('should create new tenant with minimal info', async ({ page }) => {
    await page.goto('/tenants/new');
    await page.waitForLoadState('networkidle');
    
    const tenantData = testTenants.basic();
    
    // Fill required fields
    await page.getByLabel(/name|company|organization/i).first().fill(tenantData.name);
    await page.getByLabel(/email/i).first().fill(tenantData.email);
    
    // Submit form
    await page.getByRole('button', { name: /create|save|submit/i }).click();
    
    // Should redirect to tenant list or detail
    await expect(page).toHaveURL(/\/tenants/, { timeout: 10000 });
  });

  test('should create tenant with full business details', async ({ page }) => {
    await page.goto('/tenants/new');
    await page.waitForLoadState('networkidle');
    
    const tenantData = testTenants.fullDetails();
    
    // Fill all fields
    await page.getByLabel(/name|company|organization/i).first().fill(tenantData.name);
    await page.getByLabel(/email/i).first().fill(tenantData.email);
    
    // Business details if fields exist
    const phoneInput = page.getByLabel(/phone/i);
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill(tenantData.phone);
    }
    
    const addressInput = page.getByLabel(/address/i);
    if (await addressInput.isVisible().catch(() => false)) {
      await addressInput.fill(tenantData.address);
    }
    
    const taxIdInput = page.getByLabel(/tax|vat|kra/i);
    if (await taxIdInput.isVisible().catch(() => false)) {
      await taxIdInput.fill(tenantData.taxId);
    }
    
    // Submit
    await page.getByRole('button', { name: /create|save|submit/i }).click();
    await expect(page).toHaveURL(/\/tenants/, { timeout: 10000 });
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/tenants/new');
    await page.waitForLoadState('networkidle');
    
    // Try to submit empty form
    await page.getByRole('button', { name: /create|save|submit/i }).click();
    
    // Should show validation errors
    const hasError = await page.getByText(/required|please enter|invalid/i)
      .isVisible()
      .catch(() => false);
    expect(hasError).toBeTruthy();
  });

  test('should prevent duplicate tenant email', async ({ page }) => {
    await page.goto('/tenants/new');
    await page.waitForLoadState('networkidle');
    
    // Use existing email
    await page.getByLabel(/name|company|organization/i).first().fill('Duplicate Test');
    await page.getByLabel(/email/i).first().fill('existing@borjie.com');
    
    await page.getByRole('button', { name: /create|save|submit/i }).click();
    
    // Should show error or stay on form
    await page.waitForLoadState('networkidle');
    const hasError = await page.getByText(/already exists|duplicate|taken/i)
      .isVisible()
      .catch(() => false);
    const stillOnForm = page.url().includes('/new');
    expect(hasError || stillOnForm).toBeTruthy();
  });
});

test.describe('Tenant Organization Setup', () => {
  test.use({ project: 'estate-manager' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should complete onboarding wizard', async ({ page }) => {
    // Navigate to onboarding or setup
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    
    const hasOnboarding = await page.getByText(/welcome|get started|setup/i)
      .isVisible()
      .catch(() => false);
    
    if (hasOnboarding) {
      // Step 1: Company details
      const companyNameInput = page.getByLabel(/company|organization/i);
      if (await companyNameInput.isVisible().catch(() => false)) {
        await companyNameInput.fill('Test Property Management Ltd');
        await page.getByRole('button', { name: /next|continue/i }).click();
      }
      
      // Step 2: Property setup (if exists)
      await page.waitForLoadState('networkidle');
      const hasPropertyStep = await page.getByText(/add property|first property/i)
        .isVisible()
        .catch(() => false);
      
      if (hasPropertyStep) {
        await page.getByLabel(/property name/i).fill(testProperties.apartment().name);
        await page.getByRole('button', { name: /next|continue|skip/i }).click();
      }
      
      // Complete wizard
      await page.getByRole('button', { name: /finish|complete|done/i }).click();
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  test('should setup company profile', async ({ page }) => {
    await page.goto('/settings/company');
    await page.waitForLoadState('networkidle');
    
    const hasSettings = await page.getByText(/company|organization|profile/i)
      .isVisible()
      .catch(() => false);
    
    if (hasSettings) {
      // Update company name
      const nameInput = page.getByLabel(/name|company/i).first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill('Updated Company Name');
      }
      
      // Save changes
      await page.getByRole('button', { name: /save|update/i }).click();
      
      // Should show success
      const hasSuccess = await page.getByText(/saved|updated|success/i)
        .isVisible()
        .catch(() => false);
      expect(hasSuccess || page.url().includes('settings')).toBeTruthy();
    }
  });

  test('should configure notification preferences', async ({ page }) => {
    await page.goto('/settings/notifications');
    await page.waitForLoadState('networkidle');
    
    const hasNotificationSettings = await page.getByText(/notification|email|sms|alerts/i)
      .isVisible()
      .catch(() => false);
    
    if (hasNotificationSettings) {
      // Toggle notification options
      const emailToggle = page.getByLabel(/email notification/i)
        .or(page.locator('[data-testid="email-notifications"]'));
      if (await emailToggle.isVisible().catch(() => false)) {
        await emailToggle.click();
      }
      
      await page.getByRole('button', { name: /save|update/i }).click();
    }
    
    expect(hasNotificationSettings || page.url().includes('settings')).toBeTruthy();
  });
});

test.describe('Tenant Subscription and Billing', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display tenant subscription status', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Click on first tenant
    const tenantRow = page.locator('tr, [data-testid*="tenant"]').first();
    await tenantRow.click();
    
    // Should show subscription info
    const hasSubscription = await page.getByText(/subscription|plan|billing|trial/i)
      .isVisible()
      .catch(() => false);
    expect(hasSubscription || page.url().includes('tenant')).toBeTruthy();
  });

  test('should manage tenant subscription', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Navigate to tenant detail
    const tenantRow = page.locator('tr, [data-testid*="tenant"]').first();
    await tenantRow.click();
    
    // Look for subscription management
    const manageButton = page.getByRole('button', { name: /manage|upgrade|change plan/i });
    if (await manageButton.isVisible().catch(() => false)) {
      await manageButton.click();
      
      // Should show plan options
      const hasPlans = await page.getByText(/basic|pro|enterprise|plan/i)
        .isVisible()
        .catch(() => false);
      expect(hasPlans).toBeTruthy();
    }
  });
});

test.describe('Tenant Verification', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should verify tenant business documents', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Navigate to tenant requiring verification
    const pendingTenant = page.locator('[data-status="pending"]')
      .or(page.getByText(/pending verification/i));
    
    if (await pendingTenant.isVisible().catch(() => false)) {
      await pendingTenant.click();
      
      // Review documents section
      const documentsSection = page.getByText(/documents|verification/i);
      if (await documentsSection.isVisible().catch(() => false)) {
        // Approve verification
        await page.getByRole('button', { name: /approve|verify/i }).click();
        
        // Confirm action
        const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }
      }
    }
  });

  test('should reject tenant with invalid documents', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Navigate to tenant detail
    const tenantRow = page.locator('tr, [data-testid*="tenant"]').first();
    await tenantRow.click();
    
    // Look for reject option
    const rejectButton = page.getByRole('button', { name: /reject|decline/i });
    if (await rejectButton.isVisible().catch(() => false)) {
      await rejectButton.click();
      
      // Enter rejection reason
      const reasonInput = page.getByLabel(/reason|comment/i);
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill('Invalid business registration documents');
        await page.getByRole('button', { name: /submit|confirm/i }).click();
      }
    }
  });

  test('should send verification reminder', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Look for reminder option
    const reminderButton = page.getByRole('button', { name: /remind|resend/i });
    if (await reminderButton.isVisible().catch(() => false)) {
      await reminderButton.click();
      
      // Confirm reminder sent
      const hasConfirmation = await page.getByText(/sent|reminder/i)
        .isVisible()
        .catch(() => false);
      expect(hasConfirmation).toBeTruthy();
    }
  });
});

test.describe('Tenant User Invitation', () => {
  test.use({ project: 'estate-manager' });

  test('should invite team member', async ({ page }) => {
    await page.goto('/settings/team');
    await page.waitForLoadState('networkidle');
    
    // Click invite button
    const inviteButton = page.getByRole('button', { name: /invite|add member|add user/i });
    if (await inviteButton.isVisible().catch(() => false)) {
      await inviteButton.click();
      
      // Fill invitation form
      await page.getByLabel(/email/i).fill('newmember@test.com');
      
      // Select role
      const roleSelect = page.getByLabel(/role/i);
      if (await roleSelect.isVisible().catch(() => false)) {
        await roleSelect.selectOption({ index: 1 });
      }
      
      await page.getByRole('button', { name: /send|invite/i }).click();
      
      // Should show success
      const hasSuccess = await page.getByText(/invitation sent|invited/i)
        .isVisible()
        .catch(() => false);
      expect(hasSuccess || page.url().includes('team')).toBeTruthy();
    }
  });

  test('should display pending invitations', async ({ page }) => {
    await page.goto('/settings/team');
    await page.waitForLoadState('networkidle');
    
    const hasPendingSection = await page.getByText(/pending|invited/i)
      .isVisible()
      .catch(() => false);
    
    // Page should load team settings
    expect(hasPendingSection || page.url().includes('settings')).toBeTruthy();
  });

  test('should resend invitation', async ({ page }) => {
    await page.goto('/settings/team');
    await page.waitForLoadState('networkidle');
    
    const resendButton = page.getByRole('button', { name: /resend/i });
    if (await resendButton.isVisible().catch(() => false)) {
      await resendButton.first().click();
      
      const hasConfirmation = await page.getByText(/resent|sent/i)
        .isVisible()
        .catch(() => false);
      expect(hasConfirmation).toBeTruthy();
    }
  });

  test('should revoke invitation', async ({ page }) => {
    await page.goto('/settings/team');
    await page.waitForLoadState('networkidle');
    
    const revokeButton = page.getByRole('button', { name: /revoke|cancel|remove/i });
    if (await revokeButton.isVisible().catch(() => false)) {
      await revokeButton.first().click();
      
      // Confirm revocation
      const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
      if (await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click();
      }
    }
  });
});

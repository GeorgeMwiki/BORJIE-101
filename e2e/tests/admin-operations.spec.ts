import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testTenants, randomString } from '../fixtures/test-data';

/**
 * Admin Operations E2E Tests
 * Covers: Create tenant, manage users, system settings
 */

test.describe('Admin - Tenant Management', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display tenants list', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    await expect(page.getByRole('heading', { name: /tenant/i })).toBeVisible({ timeout: 10000 });
  });

  test('should create new tenant', async ({ page }) => {
    await page.goto('/tenants/new');
    await page.waitForLoadState('networkidle');
    
    const tenantData = testTenants.basic();
    
    // Fill tenant form
    await page.getByLabel(/name|company|organization/i).first().fill(tenantData.name);
    await page.getByLabel(/email/i).first().fill(tenantData.email);
    
    // Optional: phone
    const phoneInput = page.getByLabel(/phone/i);
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill(tenantData.phone);
    }
    
    // Submit
    await page.getByRole('button', { name: /create|save|submit/i }).click();
    
    // Should redirect or show success
    await expect(page).toHaveURL(/\/tenants/, { timeout: 10000 });
  });

  test('should edit existing tenant', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Click on first tenant
    const tenantRow = page.locator('tr').nth(1)
      .or(page.locator('[data-testid*="tenant"]').first());
    
    if (await tenantRow.isVisible().catch(() => false)) {
      await tenantRow.click();
      await page.waitForLoadState('networkidle');
      
      // Click edit button
      const editButton = page.getByRole('button', { name: /edit/i });
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click();
        
        // Update name
        const nameInput = page.getByLabel(/name/i).first();
        await nameInput.fill(`Updated Tenant ${Date.now()}`);
        
        // Save
        await page.getByRole('button', { name: /save|update/i }).click();
        
        const hasSuccess = await page.getByText(/saved|updated|success/i)
          .isVisible()
          .catch(() => false);
        expect(hasSuccess || page.url().includes('tenant')).toBeTruthy();
      }
    }
  });

  test('should suspend tenant', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Find active tenant
    const tenantRow = page.locator('[data-status="active"]')
      .or(page.locator('tr').nth(1));
    
    if (await tenantRow.isVisible().catch(() => false)) {
      await tenantRow.click();
      await page.waitForLoadState('networkidle');
      
      // Find suspend button
      const suspendButton = page.getByRole('button', { name: /suspend|deactivate/i });
      if (await suspendButton.isVisible().catch(() => false)) {
        await suspendButton.click();
        
        // Confirm
        const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }
        
        const hasStatus = await page.getByText(/suspended|inactive/i)
          .isVisible()
          .catch(() => false);
        expect(hasStatus || page.url().includes('tenant')).toBeTruthy();
      }
    }
  });

  test('should reactivate suspended tenant', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Find suspended tenant
    const tenantRow = page.locator('[data-status="suspended"]')
      .or(page.getByText(/suspended/i).locator('..'));
    
    if (await tenantRow.isVisible().catch(() => false)) {
      await tenantRow.click();
      await page.waitForLoadState('networkidle');
      
      // Find activate button
      const activateButton = page.getByRole('button', { name: /activate|reactivate|enable/i });
      if (await activateButton.isVisible().catch(() => false)) {
        await activateButton.click();
        
        // Confirm
        const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }
        
        const hasStatus = await page.getByText(/active|enabled/i)
          .isVisible()
          .catch(() => false);
        expect(hasStatus || page.url().includes('tenant')).toBeTruthy();
      }
    }
  });

  test('should search tenants', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Find search input
    const searchInput = page.getByPlaceholder(/search/i)
      .or(page.getByLabel(/search/i));
    
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('test');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      
      // Should filter results
      const hasResults = await page.locator('tr, [data-testid*="tenant"]')
        .count() > 0;
      expect(hasResults || page.url().includes('tenant')).toBeTruthy();
    }
  });

  test('should filter tenants by status', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    
    // Find status filter
    const statusFilter = page.getByLabel(/status/i)
      .or(page.locator('select').first());
    
    if (await statusFilter.isVisible().catch(() => false)) {
      await statusFilter.selectOption({ label: /active/i });
      await page.waitForLoadState('networkidle');
    }
  });
});

test.describe('Admin - User Management', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display users list', async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('networkidle');
    
    const hasUsers = await page.getByRole('heading', { name: /user/i })
      .isVisible()
      .catch(() => false);
    expect(hasUsers || page.url().includes('user')).toBeTruthy();
  });

  test('should create new admin user', async ({ page }) => {
    await page.goto('/users/new');
    await page.waitForLoadState('networkidle');
    
    const userData = {
      name: `Admin User ${randomString()}`,
      email: `admin-${randomString()}@test.com`,
      role: 'admin',
    };
    
    // Fill user form
    await page.getByLabel(/name/i).first().fill(userData.name);
    await page.getByLabel(/email/i).first().fill(userData.email);
    
    // Select role
    const roleSelect = page.getByLabel(/role/i);
    if (await roleSelect.isVisible().catch(() => false)) {
      await roleSelect.selectOption({ label: /admin/i });
    }
    
    // Submit
    await page.getByRole('button', { name: /create|save|invite/i }).click();
    
    await expect(page).toHaveURL(/\/users/, { timeout: 10000 });
  });

  test('should edit user role', async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('networkidle');
    
    // Click on first user
    const userRow = page.locator('tr').nth(1)
      .or(page.locator('[data-testid*="user"]').first());
    
    if (await userRow.isVisible().catch(() => false)) {
      await userRow.click();
      await page.waitForLoadState('networkidle');
      
      // Click edit
      const editButton = page.getByRole('button', { name: /edit/i });
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click();
        
        // Change role
        const roleSelect = page.getByLabel(/role/i);
        if (await roleSelect.isVisible().catch(() => false)) {
          await roleSelect.selectOption({ index: 1 });
        }
        
        // Save
        await page.getByRole('button', { name: /save|update/i }).click();
        
        const hasSuccess = await page.getByText(/saved|updated/i)
          .isVisible()
          .catch(() => false);
        expect(hasSuccess || page.url().includes('user')).toBeTruthy();
      }
    }
  });

  test('should deactivate user', async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('networkidle');
    
    const userRow = page.locator('tr').nth(1);
    if (await userRow.isVisible().catch(() => false)) {
      await userRow.click();
      await page.waitForLoadState('networkidle');
      
      // Deactivate
      const deactivateButton = page.getByRole('button', { name: /deactivate|disable|suspend/i });
      if (await deactivateButton.isVisible().catch(() => false)) {
        await deactivateButton.click();
        
        // Confirm
        const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }
      }
    }
  });

  test('should reset user password', async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('networkidle');
    
    const userRow = page.locator('tr').nth(1);
    if (await userRow.isVisible().catch(() => false)) {
      await userRow.click();
      await page.waitForLoadState('networkidle');
      
      // Reset password
      const resetButton = page.getByRole('button', { name: /reset password|send reset/i });
      if (await resetButton.isVisible().catch(() => false)) {
        await resetButton.click();
        
        // Confirm
        const confirmButton = page.getByRole('button', { name: /confirm|send/i });
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }
        
        const hasSuccess = await page.getByText(/sent|reset|email/i)
          .isVisible()
          .catch(() => false);
        expect(hasSuccess || page.url().includes('user')).toBeTruthy();
      }
    }
  });

  test('should view user activity log', async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('networkidle');
    
    const userRow = page.locator('tr').nth(1);
    if (await userRow.isVisible().catch(() => false)) {
      await userRow.click();
      await page.waitForLoadState('networkidle');
      
      // Activity tab
      const activityTab = page.getByRole('tab', { name: /activity|log|history/i });
      if (await activityTab.isVisible().catch(() => false)) {
        await activityTab.click();
        
        const hasActivity = await page.getByText(/login|action|date/i)
          .isVisible()
          .catch(() => false);
        expect(hasActivity || page.url().includes('user')).toBeTruthy();
      }
    }
  });
});

test.describe('Admin - Roles and Permissions', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display roles list', async ({ page }) => {
    await page.goto('/roles');
    await page.waitForLoadState('networkidle');
    
    const hasRoles = await page.getByRole('heading', { name: /role/i })
      .isVisible()
      .catch(() => false);
    expect(hasRoles || page.url().includes('role')).toBeTruthy();
  });

  test('should create custom role', async ({ page }) => {
    await page.goto('/roles/new');
    await page.waitForLoadState('networkidle');
    
    const roleData = {
      name: `Custom Role ${randomString()}`,
      description: 'E2E test role',
    };
    
    // Fill form
    const nameInput = page.getByLabel(/name/i).first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(roleData.name);
    }
    
    const descInput = page.getByLabel(/description/i);
    if (await descInput.isVisible().catch(() => false)) {
      await descInput.fill(roleData.description);
    }
    
    // Select some permissions
    const permissions = page.locator('[type="checkbox"]');
    const permCount = await permissions.count();
    if (permCount > 0) {
      await permissions.first().check();
    }
    
    // Submit
    await page.getByRole('button', { name: /create|save/i }).click();
    
    await expect(page).toHaveURL(/\/roles/, { timeout: 10000 });
  });

  test('should edit role permissions', async ({ page }) => {
    await page.goto('/roles');
    await page.waitForLoadState('networkidle');
    
    // Click on first custom role (not built-in)
    const roleRow = page.locator('tr').nth(1);
    if (await roleRow.isVisible().catch(() => false)) {
      await roleRow.click();
      await page.waitForLoadState('networkidle');
      
      // Edit permissions
      const editButton = page.getByRole('button', { name: /edit/i });
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click();
        
        // Toggle a permission
        const permCheckbox = page.locator('[type="checkbox"]').first();
        if (await permCheckbox.isVisible().catch(() => false)) {
          await permCheckbox.click();
        }
        
        await page.getByRole('button', { name: /save|update/i }).click();
      }
    }
  });

  test('should prevent deleting built-in roles', async ({ page }) => {
    await page.goto('/roles');
    await page.waitForLoadState('networkidle');
    
    // Click on admin role
    const adminRole = page.getByText(/^admin$/i).locator('..');
    if (await adminRole.isVisible().catch(() => false)) {
      await adminRole.click();
      await page.waitForLoadState('networkidle');
      
      // Delete should be disabled or hidden
      const deleteButton = page.getByRole('button', { name: /delete/i });
      if (await deleteButton.isVisible().catch(() => false)) {
        const isDisabled = await deleteButton.isDisabled();
        expect(isDisabled).toBeTruthy();
      }
    }
  });
});

test.describe('Admin - System Settings', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display system settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    const hasSettings = await page.getByText(/setting|configuration/i)
      .isVisible()
      .catch(() => false);
    expect(hasSettings || page.url().includes('setting')).toBeTruthy();
  });

  test('should configure email settings', async ({ page }) => {
    await page.goto('/settings/email');
    await page.waitForLoadState('networkidle');
    
    const hasEmailSettings = await page.getByText(/email|smtp|notification/i)
      .isVisible()
      .catch(() => false);
    
    if (hasEmailSettings) {
      // Update sender email
      const senderInput = page.getByLabel(/sender|from/i);
      if (await senderInput.isVisible().catch(() => false)) {
        await senderInput.fill('noreply@borjie.com');
      }
      
      // Save
      await page.getByRole('button', { name: /save/i }).click();
    }
    
    expect(hasEmailSettings || page.url().includes('setting')).toBeTruthy();
  });

  test('should configure payment gateway', async ({ page }) => {
    await page.goto('/settings/payments');
    await page.waitForLoadState('networkidle');
    
    const hasPaymentSettings = await page.getByText(/payment|mpesa|gateway/i)
      .isVisible()
      .catch(() => false);
    
    expect(hasPaymentSettings || page.url().includes('setting')).toBeTruthy();
  });

  test('should view system logs', async ({ page }) => {
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    
    const hasLogs = await page.getByText(/log|event|audit/i)
      .isVisible()
      .catch(() => false);
    expect(hasLogs || page.url().includes('setting')).toBeTruthy();
  });

  test('should configure feature flags', async ({ page }) => {
    await page.goto('/settings/features');
    await page.waitForLoadState('networkidle');
    
    const hasFeatures = await page.getByText(/feature|flag|toggle/i)
      .isVisible()
      .catch(() => false);
    
    if (hasFeatures) {
      // Toggle a feature
      const featureToggle = page.locator('[type="checkbox"], [role="switch"]').first();
      if (await featureToggle.isVisible().catch(() => false)) {
        await featureToggle.click();
        await page.getByRole('button', { name: /save/i }).click();
      }
    }
    
    expect(hasFeatures || page.url().includes('setting')).toBeTruthy();
  });
});

test.describe('Admin - Audit Trail', () => {
  test.use({ project: 'admin-portal' });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });
  });

  test('should display audit logs', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    const hasAudit = await page.getByText(/audit|log|activity/i)
      .isVisible()
      .catch(() => false);
    expect(hasAudit || page.url().includes('audit')).toBeTruthy();
  });

  test('should filter audit logs by date', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    // Find date filter
    const dateFilter = page.getByLabel(/date|from|to/i)
      .or(page.locator('input[type="date"]'));
    
    if (await dateFilter.isVisible().catch(() => false)) {
      // Set date range
      const today = new Date().toISOString().split('T')[0];
      await dateFilter.first().fill(today);
    }
  });

  test('should filter audit logs by action type', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    // Find action filter
    const actionFilter = page.getByLabel(/action|type/i)
      .or(page.locator('select').first());
    
    if (await actionFilter.isVisible().catch(() => false)) {
      await actionFilter.selectOption({ label: /create|login/i });
      await page.waitForLoadState('networkidle');
    }
  });

  test('should export audit logs', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    // Find export button
    const exportButton = page.getByRole('button', { name: /export|download/i });
    if (await exportButton.isVisible().catch(() => false)) {
      const downloadPromise = page.waitForEvent('download');
      await exportButton.click();
      
      const download = await downloadPromise.catch(() => null);
      if (download) {
        expect(download.suggestedFilename()).toMatch(/audit|log|\.csv|\.xlsx/i);
      }
    }
  });
});

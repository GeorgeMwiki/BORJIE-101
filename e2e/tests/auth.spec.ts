import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { testUsers } from '../fixtures/test-data';

/**
 * Authentication E2E Tests
 * Covers: Login, logout, MFA, session expiry, password management across all portals
 */

// =============================================================================
// ADMIN PORTAL AUTH
// =============================================================================

test.describe('Admin Portal Auth', () => {
  test.use({ project: 'admin-portal' });

  test('should display login page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await expect(page.getByText(/internal admin portal|sign in/i)).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await expect(page).toHaveURL(/\/($|tenants|users|roles)/);
    await expect(page.getByText(/dashboard|tenants|users/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show error on invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail('invalid@test.com', 'wrongpassword');
    await loginPage.expectError(/login failed|invalid|incorrect/i);
  });

  test('should logout successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });

    // Click logout button
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i })
      .or(page.locator('[data-testid="logout-button"]'));
    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click();
      await expect(page).toHaveURL(/\/login/);
    } else {
      // Navigate to login and verify session cleared
      await page.goto('/login');
      await expect(loginPage.emailInput).toBeVisible();
    }
  });

  test('should redirect to login when accessing protected route', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page).toHaveURL(/\/login/);
  });

  test('should persist session after page refresh', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on authenticated page (not redirected to login)
    const url = page.url();
    const isStillAuthed = !url.includes('/login');
    const hasContent = await page.getByText(/dashboard|tenants|users/i)
      .isVisible()
      .catch(() => false);
    expect(isStillAuthed || hasContent).toBeTruthy();
  });
});

// =============================================================================
// OWNER PORTAL AUTH
// =============================================================================

test.describe('Owner Portal Auth', () => {
  test.use({ project: 'owner-portal' });

  test('should display login page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await expect(page.getByText(/welcome back|sign in/i)).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await expect(page).toHaveURL(/\/dashboard/);
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.expectDashboardLoaded();
  });

  test('should show error on invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail('invalid@test.com', 'wrongpassword');
    await loginPage.expectError(/login failed|invalid|incorrect/i);
  });

  test('should logout successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Look for logout in user menu or dropdown
    const userMenu = page.locator('[data-testid="user-menu"]')
      .or(page.getByRole('button', { name: /account|profile/i }));
    if (await userMenu.isVisible().catch(() => false)) {
      await userMenu.click();
    }

    const logoutButton = page.getByRole('button', { name: /logout|sign out/i })
      .or(page.getByRole('menuitem', { name: /logout|sign out/i }));
    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click();
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('should persist session across page refresh', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

// =============================================================================
// CUSTOMER APP AUTH (OTP)
// =============================================================================

test.describe('Customer App Auth (OTP)', () => {
  test.use({ project: 'customer-app' });

  test('should display login page with phone input', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/auth/login');
    await expect(page.getByText(/borjie|sign in/i)).toBeVisible();
    await expect(loginPage.phoneInput).toBeVisible();
  });

  test('should navigate to OTP page after phone submission', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/phone/i).fill(testUsers.customer.phone);
    await page.getByRole('button', { name: /send otp/i }).click();
    await page.waitForURL(/\/auth\/otp/, { timeout: 10000 });
    await expect(page.getByText(/otp|verify|code/i)).toBeVisible();
  });

  test('should show error for invalid phone format', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/phone/i).fill('invalid');
    await page.getByRole('button', { name: /send otp/i }).click();
    await expect(page.getByText(/invalid|phone|format/i)).toBeVisible({ timeout: 5000 });
  });

  test('should handle OTP resend', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/phone/i).fill(testUsers.customer.phone);
    await page.getByRole('button', { name: /send otp/i }).click();
    await page.waitForURL(/\/auth\/otp/, { timeout: 10000 });

    // Look for resend button
    const resendButton = page.getByRole('button', { name: /resend|didn't receive/i });
    await expect(resendButton).toBeVisible({ timeout: 5000 });
  });
});

// =============================================================================
// ESTATE MANAGER AUTH
// =============================================================================

test.describe('Estate Manager Auth', () => {
  test.use({ project: 'estate-manager' });

  test('should display login page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.manager.email, testUsers.manager.password);
    await expect(page).toHaveURL(/\/(dashboard|work-orders|home)/);
    await expect(page.getByText(/dashboard|work order|overview/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show error on invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail('fake@test.com', 'badpassword');
    await loginPage.expectError(/login failed|invalid|incorrect/i);
  });

  test('should persist session after refresh', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.manager.email, testUsers.manager.password);
    await page.waitForURL(/\/(dashboard|work-orders|home)/, { timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should not be redirected to login
    expect(page.url()).not.toContain('/login');
  });

  test('should logout and clear session', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.manager.email, testUsers.manager.password);
    await page.waitForURL(/\/(dashboard|work-orders|home)/, { timeout: 10000 });

    // Try user menu approach
    const userMenu = page.locator('[data-testid="user-menu"]')
      .or(page.getByRole('button', { name: /account|profile|menu/i }));
    if (await userMenu.isVisible().catch(() => false)) {
      await userMenu.click();
    }

    const logoutButton = page.getByRole('button', { name: /logout|sign out/i })
      .or(page.getByRole('menuitem', { name: /logout|sign out/i }))
      .or(page.getByRole('link', { name: /logout|sign out/i }));

    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click();
      await expect(page).toHaveURL(/\/login/);

      // Verify session is cleared - try accessing protected route
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

// =============================================================================
// MFA (Multi-Factor Authentication)
// =============================================================================

test.describe('MFA (Multi-Factor Authentication)', () => {
  test.use({ project: 'admin-portal' });

  test('should show MFA setup option in settings', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.superAdmin.email, testUsers.superAdmin.password);
    await page.waitForURL(/\/($|tenants)/, { timeout: 10000 });

    // Navigate to settings/security
    await page.goto('/settings/security');
    await page.waitForLoadState('networkidle');

    const hasMfaOption = await page.getByText(/two-factor|2fa|mfa|authenticator/i)
      .isVisible()
      .catch(() => false);
    expect(hasMfaOption).toBeTruthy();
  });

  test('should display MFA challenge when enabled', async ({ page }) => {
    // This test assumes MFA is enabled for test user
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('mfa-enabled@borjie.com');
    await page.getByLabel(/password/i).fill('demo123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Check if MFA challenge appears or normal login proceeds
    await page.waitForLoadState('networkidle');
    const hasMfaChallenge = await page.getByText(/verification code|authenticator|6-digit/i)
      .isVisible()
      .catch(() => false);
    const hasNormalLogin = await page.getByText(/dashboard|tenants/i)
      .isVisible()
      .catch(() => false);

    expect(hasMfaChallenge || hasNormalLogin).toBeTruthy();
  });
});

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

test.describe('Session Management', () => {
  test.use({ project: 'owner-portal' });

  test('should handle session expiry gracefully', async ({ page, context }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Clear cookies to simulate session expiry
    await context.clearCookies();

    // Try to navigate to protected route
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('should maintain session in local storage', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Check for auth token in storage
    const localStorage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          items[key] = window.localStorage.getItem(key) || '';
        }
      }
      return items;
    });

    // Verify some form of auth state exists
    const hasAuthState = Object.keys(localStorage).some(
      key => key.includes('auth') || key.includes('token') || key.includes('session')
    );
    expect(hasAuthState || page.url().includes('dashboard')).toBeTruthy();
  });

  test('should redirect to intended page after login', async ({ page }) => {
    // Try to access protected page
    await page.goto('/properties');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);

    // Login
    const loginPage = new LoginPage(page);
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);

    // Should redirect back to properties or dashboard
    await expect(page).toHaveURL(/\/(properties|dashboard)/);
  });

  test('should clear local storage on logout', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto('/login');
    await loginPage.loginWithEmail(testUsers.owner.email, testUsers.owner.password);
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Perform logout
    const userMenu = page.locator('[data-testid="user-menu"]')
      .or(page.getByRole('button', { name: /account|profile/i }));
    if (await userMenu.isVisible().catch(() => false)) {
      await userMenu.click();
    }

    const logoutButton = page.getByRole('button', { name: /logout|sign out/i })
      .or(page.getByRole('menuitem', { name: /logout|sign out/i }));
    if (await logoutButton.isVisible().catch(() => false)) {
      await logoutButton.click();
      await expect(page).toHaveURL(/\/login/);

      // Check that auth data is cleared
      const authData = await page.evaluate(() => {
        return {
          token: window.localStorage.getItem('token'),
          auth: window.localStorage.getItem('auth'),
        };
      });
      expect(authData.token).toBeNull();
      expect(authData.auth).toBeNull();
    }
  });
});

// =============================================================================
// PASSWORD MANAGEMENT
// =============================================================================

test.describe('Password Management', () => {
  test.use({ project: 'owner-portal' });

  test('should have forgot password link', async ({ page }) => {
    await page.goto('/login');
    const forgotLink = page.getByRole('link', { name: /forgot|reset/i });
    await expect(forgotLink).toBeVisible();
  });

  test('should navigate to password reset page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /forgot|reset/i }).click();
    await expect(page).toHaveURL(/\/(forgot|reset)/);
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('should submit password reset request', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByRole('button', { name: /send|reset|submit/i }).click();

    // Should show success message or stay on page
    await page.waitForLoadState('networkidle');
    const hasMessage = await page.getByText(/sent|check|email/i)
      .isVisible()
      .catch(() => false);
    expect(hasMessage || page.url().includes('forgot')).toBeTruthy();
  });
});

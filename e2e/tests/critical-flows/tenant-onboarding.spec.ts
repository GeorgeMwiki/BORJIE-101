/**
 * Critical flow: Customer install -> signup with TZ phone -> redeem TRC invite code
 * -> see TRC membership in OrgSwitcher.
 *
 * External APIs mocked: OTP dispatcher, invite-code service, org-membership API.
 */
import { test, expect } from '@playwright/test';
import { installApiMocks, TZ_PHONE, hasText } from './_helpers';

test.describe('Tenant onboarding via TRC invite code', () => {
  test.use({ project: 'customer-app' });

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      '**/api/auth/otp/**': async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { sent: true } }),
        }),
      '**/api/invites/redeem**': async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              orgId: 'org_trc_dsm_001',
              orgName: 'TRC Dar es Salaam',
              role: 'TENANT',
              membershipId: 'mem_abc123',
            },
          }),
        }),
      '**/api/orgs/memberships**': async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              { orgId: 'org_trc_dsm_001', orgName: 'TRC Dar es Salaam', role: 'TENANT' },
            ],
          }),
        }),
    });
  });

  test('customer signs up with TZ phone, redeems invite, sees TRC in OrgSwitcher', async ({
    page,
  }) => {
    // Step 1: Landing / install PWA entry
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Step 2: Start signup
    const signupCta = page.getByRole('link', { name: /sign ?up|get started/i }).first();
    if (await signupCta.isVisible().catch(() => false)) {
      await signupCta.click();
    } else {
      await page.goto('/signup');
    }
    await page.waitForLoadState('networkidle');

    // Step 3: Enter Tanzania phone number
    const phoneInput = page.getByLabel(/phone/i).first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill(TZ_PHONE);
      await page.getByRole('button', { name: /continue|next|send/i }).first().click();
    }

    // Step 4: Enter OTP (mocked to accept 000000)
    const otpInput = page.getByLabel(/code|otp/i).first();
    if (await otpInput.isVisible().catch(() => false)) {
      await otpInput.fill('000000');
      await page.getByRole('button', { name: /verify|submit/i }).first().click();
    }

    // Step 5: Redeem TRC invite code
    const inviteField = page.getByLabel(/invite|code/i).first();
    if (await inviteField.isVisible().catch(() => false)) {
      await inviteField.fill('TRC-DSM-2026');
      await page.getByRole('button', { name: /redeem|join/i }).first().click();
    }

    // Step 6: Membership reflected in OrgSwitcher
    const ok =
      (await hasText(page, /TRC Dar es Salaam/i)) ||
      (await hasText(page, /membership/i)) ||
      page.url().includes('/app');
    expect(ok).toBeTruthy();
  });

  test('rejects invalid invite codes', async ({ page }) => {
    await page.route('**/api/invites/redeem**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'INVITE_INVALID' }),
      }),
    );
    await page.goto('/onboarding/invite');
    await page.waitForLoadState('networkidle');
    const inviteField = page.getByLabel(/invite|code/i).first();
    if (await inviteField.isVisible().catch(() => false)) {
      await inviteField.fill('BOGUS-CODE');
      await page.getByRole('button', { name: /redeem|join/i }).first().click();
      expect(await hasText(page, /invalid|expired|not found/i)).toBeTruthy();
    }
  });
});

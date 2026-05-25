/**
 * Shared helpers and API mocks for critical flow E2E tests.
 *
 * These tests mock all external integrations (GePG, M-Pesa, notifications)
 * so they can run hermetically in CI without hitting live services.
 */
import type { Page, Route } from '@playwright/test';

// eslint-disable-next-line borjie/no-jurisdictional-literal -- E2E test fixture phone number for TZ pilot
export const TZ_PHONE = '+255712345678';
// eslint-disable-next-line borjie/no-jurisdictional-literal -- E2E test fixture phone number for TZ pilot
export const TZ_PHONE_ALT = '+255754998877';

export const HIGH_RENT_THRESHOLD_TZS = 500_000;

/** Install a catch-all JSON mock handler on the given page. */
export async function installApiMocks(
  page: Page,
  overrides: Record<string, (route: Route) => Promise<void> | void> = {},
): Promise<void> {
  const defaultMocks: Record<string, (route: Route) => Promise<void> | void> = {
    // GePG control number issuance (Tanzania Government e-Payment Gateway)
    '**/api/payments/gepg/control-number**': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            controlNumber: '991234567890',
            amount: 250_000,
            currency: 'TZS',
            expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          },
        }),
      });
    },

    // GePG webhook callback (simulated as a server-to-server POST)
    '**/api/payments/gepg/webhook**': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { status: 'PAID' } }),
      });
    },

    // M-Pesa STK push
    '**/api/payments/mpesa/**': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { checkoutRequestId: 'ws_CO_MOCK', status: 'PENDING' },
        }),
      });
    },

    // Notifications dispatcher (SMS/email/WhatsApp)
    '**/api/notifications/**': async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { dispatched: true } }),
      });
    },
  };

  const merged = { ...defaultMocks, ...overrides };
  for (const [pattern, handler] of Object.entries(merged)) {
    await page.route(pattern, handler);
  }
}

/** Simulate a webhook invocation from inside a test (stand-in for external call). */
export async function fireMockWebhook(page: Page, path: string, body: unknown): Promise<void> {
  await page.evaluate(
    async ({ path: p, body: b }) => {
      await fetch(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      });
    },
    { path, body },
  );
}

/** Sign in a tenant using phone-based auth stub. */
export async function signInAsTenant(page: Page, phone: string = TZ_PHONE): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const phoneInput = page.getByLabel(/phone/i).first();
  if (await phoneInput.isVisible().catch(() => false)) {
    await phoneInput.fill(phone);
    const continueBtn = page.getByRole('button', { name: /continue|login|sign in|send/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
    }
    const otpInput = page.getByLabel(/code|otp/i).first();
    if (await otpInput.isVisible().catch(() => false)) {
      await otpInput.fill('000000');
      await page.getByRole('button', { name: /verify|submit/i }).first().click();
    }
  }
}

/** Soft assertion helper: check for text presence without hard-failing navigation noise. */
export async function hasText(page: Page, text: string | RegExp): Promise<boolean> {
  return page
    .getByText(text)
    .first()
    .isVisible()
    .catch(() => false);
}

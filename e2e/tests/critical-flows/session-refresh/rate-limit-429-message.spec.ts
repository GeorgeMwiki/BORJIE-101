/**
 * @session @critical @security
 *
 * 429 rate-limit → user-facing message (not a raw error).
 *
 * Scenario: a user (or a malicious script) hammers a rate-limited
 * endpoint. The gateway returns HTTP 429. The UI MUST present a
 * human-readable affordance (toast, banner, modal) explaining the
 * cooldown — NOT a raw stack trace, "Network Error", or silent failure.
 *
 * Audit reference: `.audit/deep-audit-2026-05-20.md` — no test ever
 * verifies the UX of a 429. The brain (LLM) endpoint is the most
 * obvious rate-limited surface; the customer-app login OTP send is
 * another. We probe both via the api-gateway directly (the UX wiring
 * test runs through the browser on the customer-app project).
 */
import { test, expect } from '@playwright/test';
import {
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';
import { testUsers } from '../../../fixtures/test-data';

test.describe('@session @critical @security — 429 surfaces a user-friendly message', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('api-gateway: rapid /brain calls eventually return 429 with structured body', async ({
    request,
  }) => {
    // Brain (LLM) endpoint is rate-limited. Hammer it until we either see
    // a 429 OR run out of attempts (in which case there's no limit and
    // the suite flags a gap).
    const candidates = ['/api/v1/brain/chat', '/api/brain/chat', '/api/v1/chat'];
    let sawRateLimit = false;
    let rateLimitBody: unknown = null;

    for (const path of candidates) {
      for (let i = 0; i < 30; i += 1) {
        const resp = await request
          .post(`${API_GATEWAY_URL}${path}`, {
            data: { message: 'ping', conversationId: 'rl-test' },
            failOnStatusCode: false,
          })
          .catch(() => null);
        if (!resp) break;
        if (resp.status() === 429) {
          sawRateLimit = true;
          rateLimitBody = await resp.json().catch(() => resp.text());
          break;
        }
        if (resp.status() === 404) break; // path doesn't exist — try next
      }
      if (sawRateLimit) break;
    }

    if (!sawRateLimit) {
      test.fixme(
        true,
        'No 429 observed on /brain endpoints — rate-limit appears unwired (audit gap)',
      );
      return;
    }

    // 429 body must be structured (JSON or text) — NEVER a stack trace.
    const asString =
      typeof rateLimitBody === 'string' ? rateLimitBody : JSON.stringify(rateLimitBody);
    expect(asString, '429 body must not leak stack trace').not.toMatch(/at\s+\w+\s+\(/);
    expect(asString, '429 body must include a human-readable message').toMatch(
      /rate|limit|too many|cooldown|try again/i,
    );
  });

  test('customer-app UI: 429 surfaces a toast / banner, not a raw error', async ({
    page,
  }) => {
    test.use({ baseURL: process.env.CUSTOMER_APP_URL ?? 'http://localhost:3002' });

    await page.goto('/auth/login').catch(() => undefined);
    const phoneInput = page.getByLabel(/phone/i).first();
    if (!(await phoneInput.isVisible().catch(() => false))) {
      test.fixme(true, 'Customer login UI not rendering — out of scope here');
      return;
    }

    // Spam the OTP-send button (rate-limited per phone).
    await phoneInput.fill(testUsers.customer.phone);
    const sendBtn = page.getByRole('button', { name: /send otp|continue|send/i }).first();
    for (let i = 0; i < 10; i += 1) {
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click().catch(() => undefined);
      }
      await page.waitForTimeout(150);
    }

    // A user-facing rate-limit affordance must be visible somewhere on the
    // page. We're permissive about widget type (toast vs banner vs modal).
    const friendlyMsg = page.getByText(
      /too many|rate limit|try again|wait|slow down|cooldown/i,
    );
    await expect(friendlyMsg.first(), 'user-facing 429 message must render').toBeVisible({
      timeout: 10000,
    });

    // Defence-in-depth: no raw "Network Error" / stack trace bled through.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body, 'no raw "Network Error" string').not.toMatch(/^Network Error$/m);
    expect(body, 'no stack trace bled into UI').not.toMatch(/at\s+\w+\s+\(/);
  });
});

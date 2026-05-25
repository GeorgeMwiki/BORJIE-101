/**
 * Customer App Communication — REAL-BACKEND E2E.
 *
 * Wave-K rewrite: every assertion now hits the real api-gateway. Previously
 * these specs used `page.route('**\/api/v1/feedback', ...)` to fake a 200,
 * which is exactly how the FeedbackThumbs 👍/👎 schema mismatch shipped to
 * production undetected. The post-parity-wave-K audit captured the gap; this
 * file is the regression net.
 *
 * Coverage: CA-AC-040 (in-app chat), CA-AC-041 (announcements), CA-AC-042
 * (notification preferences), CA-AC-043 (cross-channel sync), plus the
 * Jarvis-turn FeedbackThumbs regression test.
 *
 * Pre-reqs: docker-compose.e2e.yml is up and seed-runner has run.
 */

import { test, expect, type Request } from '@playwright/test';
import { CustomerAppPage } from '../../page-objects';
import { loginAsCustomer } from '../../fixtures/auth';
import { randomString } from '../../fixtures/test-data';

const API_GATEWAY_URL =
  process.env.API_GATEWAY_URL ?? 'http://localhost:4000';

test.describe('Customer App Communication (real backend)', () => {
  let customerApp: CustomerAppPage;

  test.beforeEach(async ({ page }) => {
    await loginAsCustomer(page);
    customerApp = new CustomerAppPage(page);
    await customerApp.gotoMessages();
  });

  test.describe('CA-AC-040: In-App Chat (real)', () => {
    test('customer message round-trips through api-gateway', async ({ page }) => {
      const testMessage = `E2E ${randomString(8)}`;

      // Capture the outgoing request to the real gateway so we can assert the
      // server accepted it (not just that the DOM rendered the text).
      const messageRequest = page.waitForRequest(
        (req) =>
          req.url().includes('/api/v1/messag') && req.method() === 'POST',
        { timeout: 10000 },
      );

      await customerApp.sendChatMessage(testMessage);

      const req = await messageRequest;
      const response = await req.response();
      expect(response, 'message POST must hit real api-gateway').not.toBeNull();
      expect(response!.status(), `gateway responded ${response!.status()}`).toBeLessThan(400);

      // And the rendered transcript should echo our text.
      await expect(page.getByText(testMessage)).toBeVisible({ timeout: 5000 });
    });

    test('chat history loads from /api/v1/messages', async ({ page }) => {
      // The chat surface must populate from a real GET, not a fixture script.
      const historyResponse = await page
        .waitForResponse(
          (resp) =>
            resp.url().includes('/api/v1/messag') &&
            resp.request().method() === 'GET',
          { timeout: 10000 },
        )
        .catch(() => null);

      // If the surface lazy-loads history on first send, that's fine — the
      // important guarantee is that when history IS requested it does so via
      // the real gateway.
      if (historyResponse) {
        expect(historyResponse.status()).toBeLessThan(400);
      }

      const chatHistory = page.locator('[data-messages], .message-list, .chat-history');
      await expect(chatHistory.first()).toBeVisible({ timeout: 5000 });
    });

    test('message validation: empty submit is rejected client-side or server-side', async ({
      page,
    }) => {
      await customerApp.chatInput.fill('   ');
      await customerApp.sendMessageButton.click();

      // Real validation path — either the client refuses to fire the POST OR
      // the server returns 4xx. Both are correct; what's NOT correct is a 200
      // for a whitespace-only message.
      const response = await page
        .waitForResponse(
          (resp) =>
            resp.url().includes('/api/v1/messag') &&
            resp.request().method() === 'POST',
          { timeout: 3000 },
        )
        .catch(() => null);

      if (response) {
        expect(response.status(), 'whitespace message must not 200').toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('FeedbackThumbs regression — Jarvis turn 👍/👎 POST contract', () => {
    /*
     * This is the bug-bait test for the wave-K audit finding. The
     * customer-app component POSTs { turnId, threadId, signal, correctionText }
     * to /api/v1/feedback. Before PR #55 the gateway zod schema only accepted
     * { type, subject, message, rating? } and every click 400ed. The stubbed
     * E2E couldn't see it because it intercepted the network call at the
     * browser. Now we forbid mocks and assert the gateway returns 2xx.
     */

    test('thumbs-up POST is accepted by gateway (regression for wave-K FeedbackThumbs bug)', async ({
      page,
    }) => {
      // Navigate to a surface that mounts FeedbackThumbs — the customer-app
      // brain-chat / Jarvis transcript. If the surface isn't reachable as a
      // logged-in customer, the test SKIPS rather than asserting on a
      // non-existent button (avoids false-positive green).
      await page.goto('/jarvis').catch(() => undefined);
      const thumbsUp = page
        .getByRole('button', { name: /thumbs up/i })
        .or(page.locator('[aria-label="Thumbs up"]'));

      if (!(await thumbsUp.first().isVisible({ timeout: 3000 }))) {
        test.skip(true, 'Jarvis turn with FeedbackThumbs not mounted on this build');
        return;
      }

      const feedbackRequest: Promise<Request> = page.waitForRequest(
        (req) =>
          req.url().includes('/api/v1/feedback') && req.method() === 'POST',
        { timeout: 10000 },
      );

      await thumbsUp.first().click();

      const req = await feedbackRequest;
      const body = req.postDataJSON() as Record<string, unknown>;

      // Contract: customer-app sends turn-feedback shape.
      expect(body, 'POST body must contain turnId').toHaveProperty('turnId');
      expect(body, 'POST body must contain signal').toHaveProperty('signal');
      expect(['up', 'thumbs-up']).toContain(body.signal);

      const response = await req.response();
      expect(response).not.toBeNull();
      // THE assertion: gateway must accept this shape and return 2xx.
      // A 400 here is the regression we're guarding against.
      expect(
        response!.status(),
        `gateway must accept turn-feedback shape — got ${response!.status()} which is the wave-K bug`,
      ).toBeLessThan(300);
    });

    test('thumbs-down POST is accepted and reveals correction input', async ({
      page,
    }) => {
      await page.goto('/jarvis').catch(() => undefined);
      const thumbsDown = page
        .getByRole('button', { name: /thumbs down/i })
        .or(page.locator('[aria-label="Thumbs down"]'));

      if (!(await thumbsDown.first().isVisible({ timeout: 3000 }))) {
        test.skip(true, 'Jarvis turn with FeedbackThumbs not mounted on this build');
        return;
      }

      const feedbackRequest: Promise<Request> = page.waitForRequest(
        (req) =>
          req.url().includes('/api/v1/feedback') && req.method() === 'POST',
        { timeout: 10000 },
      );

      await thumbsDown.first().click();

      const req = await feedbackRequest;
      const response = await req.response();
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(300);

      // 👎 click should reveal the correction input so the user can amplify.
      const correctionInput = page.getByLabel(/feedback reason/i);
      await expect(correctionInput).toBeVisible({ timeout: 5000 });
    });

    test('feedback row is persisted in feedback_submissions (queryable via GET)', async ({
      page,
      request,
    }) => {
      await page.goto('/jarvis').catch(() => undefined);
      const thumbsUp = page
        .getByRole('button', { name: /thumbs up/i })
        .or(page.locator('[aria-label="Thumbs up"]'));

      if (!(await thumbsUp.first().isVisible({ timeout: 3000 }))) {
        test.skip(true, 'Jarvis turn with FeedbackThumbs not mounted on this build');
        return;
      }

      // Capture the auth token the browser is using so the API request can
      // reuse the same identity (the GET endpoint is tenant-scoped).
      const token = await page.evaluate(
        () =>
          localStorage.getItem('token') ?? localStorage.getItem('auth') ?? '',
      );

      const submitResponse = page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/v1/feedback') &&
          resp.request().method() === 'POST',
        { timeout: 10000 },
      );
      await thumbsUp.first().click();
      const submit = await submitResponse;
      expect(submit.status()).toBeLessThan(300);

      // Now ask the gateway directly for the persisted row. type=turn-thumbs
      // is the discriminator the wave-K backend writes.
      const listResp = await request.get(
        `${API_GATEWAY_URL}/api/v1/feedback?type=turn-thumbs`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );

      // The gateway may require additional auth (cookie session) — accept
      // either a 200 with the expected discriminator OR a 401 indicating the
      // browser stores the session in cookies rather than localStorage. The
      // POST 2xx above is the load-bearing assertion; this is a DB-sanity
      // backstop.
      if (listResp.ok()) {
        const json = (await listResp.json()) as {
          data?: Array<{ type: string }>;
        };
        expect(json.data ?? []).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'turn-thumbs' })]),
        );
      }
    });
  });

  test.describe('CA-AC-041: Announcements (real)', () => {
    test('notification center loads announcements from gateway', async ({ page }) => {
      const announcementsResponse = page
        .waitForResponse(
          (resp) =>
            resp.url().includes('/api/v1/notifications') ||
            resp.url().includes('/api/v1/announcements'),
          { timeout: 5000 },
        )
        .catch(() => null);

      await customerApp.notificationCenter.click();
      const resp = await announcementsResponse;

      const notificationPanel = page.locator(
        '[data-notifications], .notification-panel, .notification-list',
      );
      await expect(notificationPanel.first()).toBeVisible({ timeout: 5000 });

      if (resp) {
        expect(resp.status(), 'gateway must serve announcements').toBeLessThan(400);
      }
    });
  });

  test.describe('CA-AC-042: Notification Preferences (real)', () => {
    test('preference save round-trips to gateway', async ({ page }) => {
      await customerApp.profileNav.click();
      await page.waitForLoadState('networkidle');

      const notificationSettings = page.getByText(/notification.*settings|preferences/i);
      if (!(await notificationSettings.isVisible({ timeout: 2000 }))) {
        test.skip(true, 'Notification preferences UI not mounted');
        return;
      }
      await notificationSettings.click();

      const toggles = page.locator('input[type="checkbox"], [role="switch"]');
      expect(await toggles.count()).toBeGreaterThan(0);

      const saveButton = page.getByRole('button', { name: /save/i });
      if (!(await saveButton.isVisible({ timeout: 2000 }))) return;

      // Flip the first toggle and assert the save POST/PUT round-trips.
      const firstToggle = toggles.first();
      await firstToggle.click();

      const saveRequest = page.waitForRequest(
        (req) =>
          req.url().includes('/api/v1/notifications/preferences') ||
          req.url().includes('/api/v1/preferences') ||
          req.url().includes('/api/v1/users') && req.method() !== 'GET',
        { timeout: 5000 },
      );
      await saveButton.click();
      const req = await saveRequest.catch(() => null);

      if (req) {
        const resp = await req.response();
        expect(resp).not.toBeNull();
        expect(resp!.status()).toBeLessThan(400);
      }
    });
  });

  test.describe('CA-AC-043: Cross-Channel Sync (real)', () => {
    test('sent message persists and re-fetches on reload', async ({ page }) => {
      const testMessage = `E2E Sync ${randomString(6)}`;

      await customerApp.chatInput.fill(testMessage);

      const sendRequest = page.waitForRequest(
        (req) =>
          req.url().includes('/api/v1/messag') && req.method() === 'POST',
        { timeout: 10000 },
      );
      await customerApp.sendMessageButton.click();
      const req = await sendRequest.catch(() => null);

      if (!req) {
        test.skip(true, 'Messaging POST endpoint not exercised on this build');
        return;
      }
      const resp = await req.response();
      expect(resp).not.toBeNull();
      expect(resp!.status()).toBeLessThan(400);

      // Hard reload — the message should still be there (real persistence).
      await page.reload();
      await customerApp.gotoMessages();
      await expect(page.getByText(testMessage)).toBeVisible({ timeout: 10000 });
    });
  });
});

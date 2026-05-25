/**
 * Wave-2 deep-scrub journey: customer-app feedback round-trip.
 *
 * Flow under test:
 *   1. Tenant opens /feedback, picks a type, types a message, submits.
 *   2. POST /api/v1/feedback fires with the right body.
 *   3. UI flips to the "thank you" success card and offers a history link.
 *   4. Tenant navigates to /feedback/history and sees their submission.
 *
 * The api-gateway is mocked at the network layer via `page.route()`. The
 * Next.js dev server must be reachable for the customer-app pages to render;
 * specs are `.fixme`'d under the stub server (USE_REAL_SERVERS unset) since
 * the stub does not serve /feedback.
 */
import { test, expect } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  captureRequest,
  fulfillJson,
  ok,
  fail,
  seedCustomerAuth,
  screenshotCheckpoint,
} from './_helpers';

const CUSTOMER_BASE_URL = process.env.CUSTOMER_APP_URL ?? 'http://localhost:3002';

test.describe('customer-app feedback round-trip @journeys', () => {
  test.use({ baseURL: CUSTOMER_BASE_URL });
  test.skip(!USE_REAL_SERVERS, 'Requires real customer-app dev server (USE_REAL_SERVERS=1).');

  test.beforeEach(async ({ page }) => {
    await seedCustomerAuth(page);
  });

  test('submits feedback, surfaces thank-you, and shows it in history', async ({ page }) => {
    const submission = captureRequest(
      ok({
        id: 'fb_e2e_001',
        type: 'SUGGESTION',
        subject: 'Suggestion',
        description: 'Add a dark mode',
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      }),
      201,
    );

    await page.route('**/api/v1/feedback', async (route, request) => {
      if (request.method() === 'POST') return submission.handler(route, request);
      // GET on /feedback would only be hit by admin tooling — mirror the empty
      // case so unrelated traffic does not break the spec.
      return fulfillJson(route, ok([]));
    });

    // History endpoint — initially empty, then populated after submit.
    let historyHits = 0;
    await page.route('**/api/v1/feedback/my**', async (route) => {
      historyHits += 1;
      const items = historyHits === 1
        ? []
        : [
            {
              id: 'fb_e2e_001',
              type: 'SUGGESTION',
              subject: 'Suggestion',
              description: 'Add a dark mode',
              status: 'OPEN',
              createdAt: new Date().toISOString(),
            },
          ];
      await fulfillJson(route, ok(items));
    });

    await page.goto('/feedback');
    await page.waitForLoadState('domcontentloaded');

    // Pick "Suggestion" — chip uses role=button per the page implementation.
    await page.getByRole('button', { name: /suggestion/i }).click();
    await page.getByLabel(/your feedback|message|share/i).fill('Add a dark mode');

    await page.getByRole('button', { name: /submit feedback/i }).click();

    // Thank-you card appears.
    await expect(page.getByRole('heading', { name: /thank you for your feedback/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /view history/i })).toBeVisible();

    // The POST body matched the user input.
    const sent = submission.getRequest();
    expect(sent, 'feedback POST never fired').not.toBeNull();
    expect(sent?.method()).toBe('POST');
    const payload = sent?.postDataJSON() as { type: string; description: string };
    expect(payload.type).toBe('SUGGESTION');
    expect(payload.description).toBe('Add a dark mode');

    await screenshotCheckpoint(page, 'feedback-thank-you');

    // Navigate to history; the second call returns the submission.
    await page.getByRole('link', { name: /view history/i }).click();
    await expect(page).toHaveURL(/\/feedback\/history/);
    await expect(page.getByText('Add a dark mode')).toBeVisible();
    await expect(page.getByText(/Open/i).first()).toBeVisible();
  });

  test('renders an inline error and keeps the form when the API fails', async ({ page }) => {
    await page.route('**/api/v1/feedback', async (route) => {
      if (route.request().method() === 'POST') {
        return fulfillJson(route, fail('Server is on fire', 'E_INTERNAL'), 500);
      }
      await route.fallback();
    });

    await page.goto('/feedback');
    await page.getByRole('button', { name: /complaint/i }).click();
    await page.getByLabel(/your feedback|message|share/i).fill('No water all day');
    await page.getByRole('button', { name: /submit feedback/i }).click();

    // The form remains and the alert appears.
    await expect(page.getByRole('alert')).toBeVisible();
    // Submit button label flips back from "Submitting…" — the form is usable again.
    await expect(page.getByRole('button', { name: /submit feedback/i })).toBeEnabled();
  });

  test('history page shows the empty state when no submissions exist', async ({ page }) => {
    await page.route('**/api/v1/feedback/my**', async (route) => {
      await fulfillJson(route, ok([]));
    });

    await page.goto('/feedback/history');
    await expect(page.getByRole('heading', { name: /no feedback yet/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /submit feedback/i })).toBeVisible();
  });

  test('history page surfaces a retry control when the load fails', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/v1/feedback/my**', async (route) => {
      calls += 1;
      if (calls === 1) {
        return fulfillJson(route, fail('Database unreachable'), 500);
      }
      await fulfillJson(route, ok([]));
    });

    await page.goto('/feedback/history');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: /retry/i }).click();
    // After retry the alert disappears and the empty state takes over.
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(page.getByRole('heading', { name: /no feedback yet/i })).toBeVisible();
  });
});

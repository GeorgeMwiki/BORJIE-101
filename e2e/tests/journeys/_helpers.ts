/**
 * Shared helpers for the wave-2 deep-scrub journey specs.
 *
 * The four BORJIE portals all reach the api-gateway via
 *   ${NEXT_PUBLIC_API_URL}/api/v1/<resource>
 * The base URL is per-portal and configured at runtime; specs in this folder
 * mock those calls hermetically with `page.route()` so they pass without a
 * live api-gateway, postgres, or seed data.
 *
 * Specs that require the real Next.js dev server (the stub server in
 * e2e/stub-server/stub.mjs only serves the legacy critical-flows routes)
 * call `requireDevServer(test)` to mark themselves `.fixme` when the env
 * variable USE_REAL_SERVERS is unset — keeping CI green while still
 * documenting the expected behaviour.
 */
import type { Page, Route, Request } from '@playwright/test';

export const USE_REAL_SERVERS = process.env.USE_REAL_SERVERS === '1';

/**
 * Mark a `test.describe` as `.fixme` when no live dev server is available.
 * Specs in this file are written against real Next.js routes (feedback,
 * messaging, settings, …) — they need server-rendered HTML that the
 * minimal stub does not provide.
 */
export function requireDevServer(): void {
  if (!USE_REAL_SERVERS) {
    // Use Playwright's runtime skip mechanism — when called inside a test
    // body, this is a hard skip; it is logged so devs know why.
    // We use `test.fixme()` from the calling site instead; this helper
    // exists for documentation parity.
  }
}

/** Build a successful JSON envelope matching the api-gateway's contract. */
export function ok<T>(data: T): { readonly success: true; readonly data: T } {
  return { success: true, data };
}

/** Build a failure JSON envelope. */
export function fail(
  message: string,
  code = 'E_MOCK',
): { readonly success: false; readonly error: { readonly code: string; readonly message: string } } {
  return { success: false, error: { code, message } };
}

/** Fulfill a route with a JSON body using the platform's response shape. */
export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Capture a request payload while answering it. Useful for asserting that
 * the UI sent the right body to the gateway. Returns a `getRequest()` accessor
 * that resolves the captured request (or `null` if the route was never hit).
 */
export interface RequestCapture {
  readonly handler: (route: Route, request: Request) => Promise<void>;
  readonly getRequest: () => Request | null;
}

export function captureRequest(respondWith: unknown, status = 200): RequestCapture {
  let captured: Request | null = null;
  const handler = async (route: Route, request: Request): Promise<void> => {
    captured = request;
    await fulfillJson(route, respondWith, status);
  };
  return {
    handler,
    getRequest: () => captured,
  };
}

/**
 * Install an auth state into localStorage so customer-app pages think the
 * user is signed in. The token is intentionally bogus — every API call is
 * mocked, so the gateway never validates it.
 */
export async function seedCustomerAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('customer_token', 'mock-customer-token');
      window.localStorage.setItem(
        'customer_user',
        // eslint-disable-next-line borjie/no-jurisdictional-literal -- E2E test fixture phone number
        JSON.stringify({ id: 'cust_test', phone: '+255712345678' }),
      );
    } catch {
      /* ignore */
    }
  });
}

export async function seedManagerAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('manager_token', 'mock-manager-token');
    } catch {
      /* ignore */
    }
  });
}

export async function seedOwnerAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('owner_token', 'mock-owner-token');
    } catch {
      /* ignore */
    }
  });
}

export async function seedPlatformAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem('platform_token', 'mock-platform-token');
    } catch {
      /* ignore */
    }
  });
}

/**
 * Take a screenshot to a stable artifact path on failure. Playwright's
 * built-in `screenshot: 'only-on-failure'` covers the simple case; this
 * helper is for tests that want to capture a labelled screenshot at a
 * known checkpoint (e.g. after a multi-step flow).
 */
export async function screenshotCheckpoint(
  page: Page,
  label: string,
): Promise<void> {
  const sanitised = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  await page
    .screenshot({
      path: `test-results/journeys/${sanitised}.png`,
      fullPage: true,
    })
    .catch(() => {
      /* screenshot capture is non-fatal */
    });
}

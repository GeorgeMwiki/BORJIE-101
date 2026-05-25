/**
 * Phase F.5 — shared helpers for the owner-live-tests journey suite.
 *
 * These specs target the full owner experience: signup → first chat → MD
 * actions across the 10 critical workflows. They run against either
 *
 *   - a live test docker-compose stack (api-gateway + Postgres testcontainer
 *     + mock-LLM) when `USE_REAL_SERVERS=1`, or
 *   - hermetic `page.route()` mocks when the stack isn't available (CI
 *     default for fast PR loops).
 *
 * The helpers below abstract that toggle so individual specs read clean.
 */
import type { Page, Route, Request } from '@playwright/test';
import {
  USE_REAL_SERVERS,
  ok,
  fulfillJson,
  seedOwnerAuth,
} from '../_helpers';

export { USE_REAL_SERVERS, ok, fulfillJson, seedOwnerAuth };

export const OWNER_BASE_URL =
  process.env.OWNER_PORTAL_URL ?? 'http://localhost:3000';
export const GATEWAY_BASE_URL =
  process.env.API_GATEWAY_URL ?? 'http://localhost:4000';

/**
 * Owner-portal localStorage seeder + onboarding session token. The
 * onboarding routes accept `x-onboarding-session` so we install one for
 * specs that drive the signup flow end-to-end without a real login.
 */
export async function seedOnboardingSession(
  page: Page,
  token: string,
): Promise<void> {
  await seedOwnerAuth(page);
  await page.addInitScript((t: string) => {
    try {
      window.localStorage.setItem('onboarding_session', t);
    } catch {
      /* ignore */
    }
  }, token);
}

/**
 * Common MD chat-response shape produced by the welcome.coordinator and
 * by every domain sub-MD. Specs assert the high-level shape; the kernel
 * itself owns the exact wording.
 */
export interface MockMdResponse {
  readonly messageId: string;
  readonly content: string;
  readonly suggestedActions?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly uiParts?: ReadonlyArray<{ readonly type: string; readonly data: unknown }>;
}

export function buildMdResponse(
  content: string,
  extra: Partial<MockMdResponse> = {},
): MockMdResponse {
  return {
    messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    ...extra,
  };
}

/**
 * Install a catch-all gateway responder that the mock-mode specs can
 * layer on top of. Specs that need bespoke routes register them BEFORE
 * calling this — `page.route` matches first-registered-wins.
 */
export async function installFallbackGatewayMocks(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route, request: Request) => {
    // 404 with a deterministic envelope so missing endpoints surface
    // visibly during spec development rather than hanging the page.
    await fulfillJson(
      route,
      {
        success: false,
        error: {
          code: 'NO_MOCK',
          message: `No mock registered for ${request.method()} ${new URL(request.url()).pathname}`,
        },
      },
      404,
    );
  });
}

/**
 * Resolve a baseURL for tests that need to hit the api-gateway directly
 * (signup spec uses this — it doesn't go through the FE).
 */
export function gatewayUrl(path: string): string {
  return `${GATEWAY_BASE_URL.replace(/\/$/, '')}${path}`;
}

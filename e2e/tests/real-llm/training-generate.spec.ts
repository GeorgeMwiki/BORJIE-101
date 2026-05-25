/**
 * Real-LLM: admin generates a training path. Verifies concepts + steps + duration.
 */

import { test, expect } from '@playwright/test';
import {
  GATEWAY_URL,
  HAS_ANTHROPIC,
  REAL_LLM_ENABLED,
  fetchTestJwt,
} from './_shared';

test.describe('real-LLM: training path generation', () => {
  test.skip(!REAL_LLM_ENABLED, 'E2E_REAL_LLM not set');
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set');
  test.setTimeout(90_000);

  test('generates a path with concepts, steps and realistic duration', async ({ request }) => {
    const jwt = await fetchTestJwt();
    const res = await request.post(`${GATEWAY_URL}/api/v1/training/generate`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'estate-manager',
        tenantProfile: {
          portfolioSize: 120,
          primaryChallenge: 'arrears',
          country: 'TZ',
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      path?: {
        concepts?: unknown[];
        steps?: unknown[];
        durationMinutes?: number;
      };
    };
    expect(body.path).toBeDefined();
    expect(Array.isArray(body.path?.concepts)).toBe(true);
    expect(Array.isArray(body.path?.steps)).toBe(true);
    expect((body.path?.concepts ?? []).length).toBeGreaterThanOrEqual(3);
    expect((body.path?.steps ?? []).length).toBeGreaterThanOrEqual(3);
    const mins = body.path?.durationMinutes ?? 0;
    expect(mins).toBeGreaterThan(15);
    expect(mins).toBeLessThan(240);
  });
});

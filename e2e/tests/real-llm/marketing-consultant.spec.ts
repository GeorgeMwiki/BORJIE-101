/**
 * Real-LLM: marketing consultant persona.
 *
 * Prospect asks: "I own 5 blocks in Dar. What would you change?"
 * Response must mention at least 3 of: arrears, M-Pesa, reports,
 * maintenance, reminders.
 */

import { test, expect } from '@playwright/test';
import {
  GATEWAY_URL,
  HAS_ANTHROPIC,
  REAL_LLM_ENABLED,
  assertMentionsAny,
  fetchTestJwt,
} from './_shared';

test.describe('real-LLM: marketing-consultant', () => {
  test.skip(!REAL_LLM_ENABLED, 'E2E_REAL_LLM not set');
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set');
  test.setTimeout(90_000);

  test('mentions 3+ of [arrears, M-Pesa, reports, maintenance, reminders]', async ({ request }) => {
    const jwt = await fetchTestJwt();
    const res = await request.post(`${GATEWAY_URL}/api/v1/public-marketing/consultation`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      data: {
        prospectContext: { country: 'TZ', units: 150, blocks: 5, city: 'Dar es Salaam' },
        question: 'I own 5 blocks in Dar. What would you change about how I run them?',
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { text?: string; response?: string };
    const text = body.text ?? body.response ?? '';
    expect(text.length).toBeGreaterThan(100);
    assertMentionsAny(
      text,
      ['arrears', 'M-Pesa', 'reports', 'maintenance', 'reminders'],
      3,
    );
  });
});

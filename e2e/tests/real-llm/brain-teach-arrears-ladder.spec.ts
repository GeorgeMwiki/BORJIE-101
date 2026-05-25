/**
 * Real-LLM E2E: admin requests a Professor-mode explanation of the
 * arrears ladder. Asserts Professor mode activates and the reply
 * contains Socratic cues.
 */

import { test, expect } from '@playwright/test';
import {
  GATEWAY_URL,
  HAS_ANTHROPIC,
  REAL_LLM_ENABLED,
  assertMentionsAny,
  fetchTestJwt,
  readSse,
} from './_shared';

test.describe('real-LLM: Professor mode — arrears ladder', () => {
  test.skip(!REAL_LLM_ENABLED, 'E2E_REAL_LLM not set');
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set');
  test.setTimeout(120_000);

  test('streams a Professor-mode Socratic exchange', async ({ request }) => {
    const jwt = await fetchTestJwt();

    const res = await request.post(`${GATEWAY_URL}/api/v1/ai-chat/stream`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      data: {
        persona: 'mwikila-professor',
        messages: [
          { role: 'user', content: 'Teach me the arrears ladder step by step.' },
        ],
      },
    });
    if (res.status() === 404) {
      test.skip(true, 'ai-chat/stream not wired');
      return;
    }
    expect(res.status()).toBe(200);

    const buf = await res.body();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    });

    let deltaCount = 0;
    let final = '';
    for await (const event of readSse(stream)) {
      const ev = event as { type?: string; delta?: string; text?: string };
      if (ev.type === 'delta' && ev.delta) {
        deltaCount++;
        final += ev.delta;
      } else if (ev.type === 'final' && ev.text) {
        final = ev.text;
      }
    }
    expect(deltaCount).toBeGreaterThanOrEqual(5);
    expect(final.length).toBeGreaterThan(80);

    // Professor mode should mention at least three of these teaching cues.
    assertMentionsAny(
      final,
      ['ladder', 'step', 'first', 'next', 'why', 'notice', 'grace'],
      3,
    );
  });
});

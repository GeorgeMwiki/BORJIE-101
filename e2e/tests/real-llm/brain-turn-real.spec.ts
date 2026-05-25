/**
 * Real-LLM: single brain turn. Verifies we get at least 5 SSE deltas + a
 * sensible, non-empty final message.
 */

import { test, expect } from '@playwright/test';
import {
  GATEWAY_URL,
  HAS_ANTHROPIC,
  REAL_LLM_ENABLED,
  fetchTestJwt,
  readSse,
} from './_shared';

test.describe('real-LLM: brain turn', () => {
  test.skip(!REAL_LLM_ENABLED, 'E2E_REAL_LLM not set');
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set');
  test.setTimeout(90_000);

  test('streams ≥5 deltas + returns a coherent answer', async ({ request }) => {
    const jwt = await fetchTestJwt();
    const res = await request.post(`${GATEWAY_URL}/api/v1/ai-chat/stream`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      data: {
        persona: 'mwikila-admin',
        messages: [
          { role: 'user', content: 'In 3 sentences: why do arrears build up?' },
        ],
      },
    });
    expect(res.status()).toBe(200);

    let deltaCount = 0;
    let final = '';
    const body = res.body();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        body.then((buf) => {
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        });
      },
    });
    for await (const event of readSse(stream)) {
      const ev = event as { type?: string; delta?: string; text?: string };
      if (ev.type === 'delta' && typeof ev.delta === 'string') {
        deltaCount++;
        final += ev.delta;
      } else if (ev.type === 'final' && typeof ev.text === 'string') {
        final = ev.text;
      }
    }
    expect(deltaCount).toBeGreaterThanOrEqual(5);
    expect(final.length).toBeGreaterThan(50);
  });
});

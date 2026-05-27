/**
 * k6 load test — SSE variant of the Brain turn flow.
 *
 * Hits `POST /api/v1/mining/chat` (the Master Brain SSE entry — see
 * `services/api-gateway/src/routes/mining/chat.hono.ts`). The contract
 * is `text/event-stream`. We measure how quickly the FIRST frame
 * (`turn.accepted`) arrives — that is the user-perceived TTFB.
 *
 * SLO: `turn.accepted` ≤ 200ms p95.
 *
 * Implementation note: k6 has no native SSE consumer. We POST with
 * `Accept: text/event-stream`, receive the response body in one shot
 * (the goroutine blocks until close), then parse it. To stay within
 * the SLO budget we set a short `timeout` so a hanging stream does
 * not skew p95 upward. `responseCallback` is left default — k6 treats
 * 200 as success even when the body is event-stream.
 *
 * Auth: Supabase bearer via `K6_AUTH_TOKEN`. Without a token, the
 * test still exercises the 401 path.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions } from './lib/config';
import { sseHeaders, HAS_AUTH_TOKEN } from './lib/auth';

export const options = buildOptions('brain.stream');

// ─── Prompt pool ─────────────────────────────────────────────────────

const PROMPTS: ReadonlyArray<string> = [
  'Niletee muhtasari wa siku.',           // sw — daily brief
  'Production summary for site 1.',
  'Lipi mahesabu ya leo?',                 // sw — today's numbers
  'List incidents from this week.',
  'CSR commitments delivered percentage.',
];

function pickPrompt(): string {
  const idx = Math.floor(Math.random() * PROMPTS.length);
  return PROMPTS[idx] ?? PROMPTS[0]!;
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function brainStreamingIteration(): void {
  const body = HAS_AUTH_TOKEN
    ? JSON.stringify({
        message: pickPrompt(),
        mode: 'build',
        language: 'sw',
      })
    : '{}';

  // Force a short read so the iteration does not stall on a hanging
  // stream. Real users disconnect after they have their answer; our
  // SLO is anchored on the first frame, not the full payload.
  const res = http.post(url('/api/v1/mining/chat'), body, {
    headers: sseHeaders(),
    tags: { name: 'brain.stream' },
    timeout: '15s',
    // k6 considers status 200 + non-empty body OK by default.
  });

  if (HAS_AUTH_TOKEN) {
    check(res, {
      'status is 200': (r) => r.status === 200,
      'content-type is event-stream': (r) => {
        const ct = (r.headers['Content-Type'] ?? r.headers['content-type'] ?? '') as string;
        return ct.includes('text/event-stream');
      },
      'first event is turn.accepted': (r) => {
        // We only need the first 256 bytes — locate `event: turn.accepted`
        // in the head of the buffer.
        const body = typeof r.body === 'string' ? r.body : '';
        if (body.length === 0) return false;
        const head = body.slice(0, 512);
        return head.includes('event: turn.accepted');
      },
    });
  } else {
    check(res, {
      'status is 401 (no token)': (r) => r.status === 401,
    });
  }

  sleep(1);
}

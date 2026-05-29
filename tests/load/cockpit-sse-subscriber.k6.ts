/**
 * k6 load test — Cockpit SSE subscriber.
 *
 * Gap-3 measured p99: the owner-web cockpit opens a long-lived SSE
 * stream against `/api/v1/cockpit/stream` (see
 * `services/api-gateway/src/routes/cockpit-stream.hono.ts`). The
 * first frame the server emits is `event: connected` with the
 * opened-at timestamp — that is the user-perceived "the dot turned
 * green" moment. We measure how quickly that first frame arrives.
 *
 * Endpoint: GET /api/v1/cockpit/stream  (Accept: text/event-stream)
 *
 * SLO: p95 < 250 ms / p99 < 600 ms (per `lib/config.ts` →
 *      `cockpit.sse.subscribe`).
 *
 * Implementation note: k6 has no native SSE consumer. We open the
 * GET with a short timeout, receive the partial body, and verify
 * `event: connected` is present in the first 512 bytes. Because we
 * cap the read window, latency is dominated by the server-side time
 * to bind the abort signal + write the opening packet, NOT the
 * 25-second heartbeat budget. That keeps p99 honest under load.
 *
 * Auth: Supabase bearer required. The route hard-rejects a missing
 * `auth.tenantId` so unsigned runs land on the 401 path.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_AUTH_TOKEN=eyJ... \
 *   K6_SCENARIO=normal \
 *   k6 run tests/load/cockpit-sse-subscriber.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions } from './lib/config';
import { sseHeaders, HAS_AUTH_TOKEN } from './lib/auth';

export const options = buildOptions('cockpit.sse.subscribe');

// ─── Iteration body ──────────────────────────────────────────────────

export default function cockpitSseIteration(): void {
  // k6 cannot consume an open SSE stream forever — we cap the read at
  // 2 seconds. The server emits the `connected` packet immediately
  // after the abort-signal wiring runs, so 2s is far enough above the
  // SLO budget that a healthy server always populates the body before
  // the timeout fires (and the timeout never colours p99 itself —
  // breaches show up as missing-event check failures, not duration
  // outliers).
  const res = http.get(url('/api/v1/cockpit/stream'), {
    headers: sseHeaders(),
    tags: { name: 'cockpit.sse.subscribe' },
    timeout: '2s',
    // k6 treats a 200 + non-empty body as success; SSE bodies count.
  });

  if (HAS_AUTH_TOKEN) {
    check(res, {
      'status is 200': (r) => r.status === 200,
      'content-type is event-stream': (r) => {
        const ct = (r.headers['Content-Type'] ??
          r.headers['content-type'] ??
          '') as string;
        return ct.includes('text/event-stream');
      },
      'first event is connected': (r) => {
        const body = typeof r.body === 'string' ? r.body : '';
        if (body.length === 0) return false;
        const head = body.slice(0, 512);
        return head.includes('event: connected');
      },
    });
  } else {
    check(res, {
      'status is 401 (no token)': (r) => r.status === 401,
    });
  }

  // Real cockpit clients keep the stream open for the whole session,
  // but we sleep here so a single VU does not act as a connection
  // pump that pegs the server's event-loop on accept/close. 1s
  // think-time mirrors a slow user reload cadence.
  sleep(1);
}

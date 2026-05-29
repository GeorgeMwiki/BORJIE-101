/**
 * k6 load test — Owner dashboard composite read.
 *
 * Gap-3 (SLO attestation) demands measured p95 / p99 for the
 * compound dashboard load. The cockpit issues three GETs per home
 * paint, all on the owner's first second:
 *
 *   1. GET /api/v1/owner/brief       — cockpit's seven-slot snapshot.
 *   2. GET /api/v1/owner/reminders   — open reminders list.
 *   3. GET /api/v1/mining/internal/decision-log/recent (best-effort)
 *      — last N owner-grade decisions. The route returns 200 even
 *      with no decisions; we treat 200/204 as success.
 *
 * The three calls are issued sequentially per iteration (mirrors
 * the owner-web shell which has not yet adopted hub-batching for
 * legacy fields). The k6 tag `name=dashboard.read` aggregates the
 * three sub-requests; the per-tag thresholds enforce the cockpit
 * SLO at the compound level — p95 < 800 ms, p99 < 1 500 ms.
 *
 * Auth: Supabase bearer via `K6_AUTH_TOKEN`. Without a token the
 * test exercises the 401 path so the route's gate is verified.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_AUTH_TOKEN=eyJ... \
 *   K6_SCENARIO=normal \
 *   k6 run tests/load/dashboard-read.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions } from './lib/config';
import { authHeaders, HAS_AUTH_TOKEN } from './lib/auth';

export const options = buildOptions('dashboard.read');

// ─── Endpoint roster ─────────────────────────────────────────────────
//
// The order matches the cockpit's paint order so trace correlation
// reproduces the real critical path. Decision-log is treated as
// best-effort because tenants without prior decisions return an
// empty array (still 200) — the test asserts shape, not non-emptiness.

const DASHBOARD_ENDPOINTS: ReadonlyArray<{
  readonly path: string;
  readonly tag: string;
}> = [
  { path: '/api/v1/owner/brief', tag: 'dashboard.read.brief' },
  { path: '/api/v1/owner/reminders', tag: 'dashboard.read.reminders' },
  {
    path: '/api/v1/mining/internal/decision-log/recent?limit=10',
    tag: 'dashboard.read.decisions',
  },
];

// ─── Iteration body ──────────────────────────────────────────────────

export default function dashboardReadIteration(): void {
  const headers = authHeaders();

  for (const { path, tag } of DASHBOARD_ENDPOINTS) {
    const res = http.get(url(path), {
      headers,
      tags: { name: tag },
      timeout: '8s',
    });

    if (HAS_AUTH_TOKEN) {
      check(res, {
        [`${tag}: 2xx`]: (r) => r.status >= 200 && r.status < 300,
        [`${tag}: json envelope`]: (r) => {
          try {
            const j = r.json();
            return j !== null && typeof j === 'object';
          } catch {
            return false;
          }
        },
      });
    } else {
      check(res, {
        [`${tag}: 401 (no token)`]: (r) => r.status === 401,
      });
    }
  }

  // Mirror real-user think-time between dashboard paints. Cockpit
  // re-fetches happen via the SSE channel (see cockpit-sse-subscriber)
  // so the next dashboard.read fires only on a fresh navigation.
  sleep(2);
}

/**
 * k6 load test — Five hot brain tool calls.
 *
 * Gap-3 measured p99: tool calls are the dominant inner loop when the
 * brain reasons over the owner's day. Latency here directly drives the
 * `brain.turn` envelope — a slow tool blows the streaming SLO.
 *
 * The five hottest read tools (per
 * `services/api-gateway/src/composition/brain-tools/*`) are:
 *   1. mining.incidents.list           — open incident scan
 *   2. mining.fx.latest                — FX rate snapshot (TZS↔USD)
 *   3. owner.brief.snapshot            — cockpit brief read-through
 *   4. owner.reminders.list            — open reminder roster
 *   5. mining.decisions.recent         — recent decision-log replay
 *
 * Each is a plain HTTPS GET against its underlying REST endpoint —
 * the brain calls these via its loopback HTTP client so testing the
 * REST surface measures the same latency the LLM tool loop pays.
 *
 * Per-iteration the VU picks ONE tool at random (weighted equally) so
 * the latency histogram captures the realistic mix instead of always
 * paying the cheapest endpoint first. Each call is tagged with
 * `name=brain.tool.call` so the aggregate p99 lands under the
 * `brain.tool.call` SLO (600 ms p95 / 1 500 ms p99 in
 * `lib/config.ts`); a per-tool secondary tag (`tool=<id>`) lets the
 * operator slice the summary by tool when one regresses.
 *
 * Auth: Supabase bearer required. Without a token the test exercises
 * the 401 path on each tool.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_AUTH_TOKEN=eyJ... \
 *   K6_SCENARIO=normal \
 *   k6 run tests/load/brain-tool-call.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions } from './lib/config';
import { authHeaders, HAS_AUTH_TOKEN } from './lib/auth';

export const options = buildOptions('brain.tool.call');

// ─── Hot tool roster ─────────────────────────────────────────────────

interface HotTool {
  readonly id: string;
  readonly path: string;
}

const HOT_TOOLS: ReadonlyArray<HotTool> = [
  { id: 'mining.incidents.list', path: '/api/v1/mining/incidents?limit=25' },
  { id: 'mining.fx.latest', path: '/api/v1/mining/fx/latest' },
  { id: 'owner.brief.snapshot', path: '/api/v1/owner/brief' },
  { id: 'owner.reminders.list', path: '/api/v1/owner/reminders' },
  {
    id: 'mining.decisions.recent',
    path: '/api/v1/mining/internal/decision-log/recent?limit=10',
  },
];

function pickTool(): HotTool {
  const idx = Math.floor(Math.random() * HOT_TOOLS.length);
  return HOT_TOOLS[idx] ?? HOT_TOOLS[0]!;
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function brainToolCallIteration(): void {
  const tool = pickTool();
  const res = http.get(url(tool.path), {
    headers: authHeaders(),
    // Secondary tag lets the summary break out per-tool p99 separately
    // from the aggregate `brain.tool.call` budget.
    tags: { name: 'brain.tool.call', tool: tool.id },
    timeout: '4s',
  });

  if (HAS_AUTH_TOKEN) {
    check(res, {
      [`${tool.id}: 2xx`]: (r) => r.status >= 200 && r.status < 300,
      [`${tool.id}: json envelope`]: (r) => {
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
      [`${tool.id}: 401 (no token)`]: (r) => r.status === 401,
    });
  }

  // Brain tool calls fan-out inside one turn (no inter-call delay) but
  // a single VU represents one parallel branch. Keep think-time short
  // so we are stressing the tool path, not the gap between turns.
  sleep(0.3);
}

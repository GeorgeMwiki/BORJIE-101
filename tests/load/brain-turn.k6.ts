/**
 * k6 load test — POST /api/v1/brain/turn (JSON path).
 *
 * Exercises the non-streaming Brain turn endpoint that the owner
 * cockpit and admin web use for synchronous Q&A. Hits the LLM, so
 * SLO is wider than CRUD endpoints (p95 < 3s, p99 < 6s).
 *
 * Auth: Supabase bearer token via `K6_AUTH_TOKEN`. Unauthenticated
 * runs still execute — every request will 401 and the threshold for
 * `http_req_failed` will trip loudly so the operator knows.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_AUTH_TOKEN=ey... \
 *   k6 run tests/load/brain-turn.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions } from './lib/config';
import { authHeaders, HAS_AUTH_TOKEN } from './lib/auth';

// k6 reads `options` once at script-load. Every endpoint exports this
// in the same shape so the scenario / threshold story is unified.
export const options = buildOptions('brain.turn');

// ─── Prompt pool ─────────────────────────────────────────────────────
// Owner-strategist class queries that exercise the persona router but
// remain bounded for cost. Each VU picks one round-robin so we do not
// thrash the LLM cache.

const PROMPTS: ReadonlyArray<string> = [
  'What is my cash runway this quarter?',
  'Show me production vs target for the last 30 days.',
  'Which mining licences expire within 60 days?',
  'Summarise the latest incident reports.',
  'Mineral price forecast for gold next quarter.',
  'Lipi mwezi huu — gharama dhidi ya mauzo.', // sw-first
  'How many tons of ore are awaiting assay?',
  'Top 3 risks in the LMBM model right now.',
];

function pickPrompt(): string {
  const idx = Math.floor(Math.random() * PROMPTS.length);
  return PROMPTS[idx] ?? PROMPTS[0]!;
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function brainTurnIteration(): void {
  // Skip the request body when no token is present so the unauth path
  // still runs but does not encode the (irrelevant) payload.
  const body = HAS_AUTH_TOKEN
    ? JSON.stringify({
        userText: pickPrompt(),
        // No threadId — exercise the startThread branch which is the
        // colder of the two paths (cold-start matters at scale).
      })
    : '{}';

  const res = http.post(url('/api/v1/brain/turn'), body, {
    headers: authHeaders(),
    tags: { name: 'brain.turn' },
    timeout: '30s',
  });

  if (HAS_AUTH_TOKEN) {
    check(res, {
      'status is 200': (r) => r.status === 200,
      'has responseText': (r) => {
        try {
          const j = r.json() as Record<string, unknown> | null;
          return typeof j?.responseText === 'string';
        } catch {
          return false;
        }
      },
    });
  } else {
    // No token — we expect 401. Verify the contract still holds.
    check(res, {
      'status is 401 (no token)': (r) => r.status === 401,
    });
  }

  // Polite pacing — VUs do not hammer one endpoint with zero gap.
  sleep(1);
}

/**
 * k6 load test — POST /api/v1/workforce/invites/activate.
 *
 * Workers do NOT self-sign-up. An owner / manager first POSTs an
 * invitation (creating a `workforce_invitations` row with a 6-digit
 * activation code), then the worker activates via the public
 * /activate endpoint. The activation path is the one the launch wave
 * cares about — it is mobile-first, fast, and hot at every shift
 * change.
 *
 * SLO: p95 < 1s.
 *
 * Data hygiene:
 *   The test consumes a pre-seeded pool of (phone, code) pairs via
 *   `K6_WORKFORCE_FIXTURE_JSON` — a JSON array. Example:
 *     export K6_WORKFORCE_FIXTURE_JSON='[{"phoneE164":"+255700000001","activationCode":"123456"}]'
 *
 *   Without a fixture, the test still runs and exercises the 404
 *   `INVITATION_NOT_FOUND` path so we measure unauthenticated
 *   pre-flight latency. Seeding lives in
 *   `scripts/pilot-provision.ts` or a dedicated seeder.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_WORKFORCE_FIXTURE_JSON='[{"phoneE164":"+255...","activationCode":"123456"}]' \
 *   k6 run tests/load/workforce-activate.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions, LOADTEST_RUN_ID } from './lib/config';
import { publicHeaders } from './lib/auth';

declare const __ENV: Readonly<Record<string, string | undefined>>;

export const options = buildOptions('workforce.activate');

// ─── Fixture ─────────────────────────────────────────────────────────

interface ActivationCredential {
  readonly phoneE164: string;
  readonly activationCode: string;
}

function loadFixtures(): ReadonlyArray<ActivationCredential> {
  const raw = __ENV.K6_WORKFORCE_FIXTURE_JSON ?? '';
  if (raw.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown): ReadonlyArray<ActivationCredential> => {
      if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).phoneE164 === 'string' &&
        typeof (entry as Record<string, unknown>).activationCode === 'string'
      ) {
        return [
          {
            phoneE164: (entry as Record<string, string>).phoneE164,
            activationCode: (entry as Record<string, string>).activationCode,
          },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

const FIXTURES: ReadonlyArray<ActivationCredential> = loadFixtures();
const HAS_FIXTURES: boolean = FIXTURES.length > 0;

function pickFixture(): ActivationCredential {
  if (!HAS_FIXTURES) {
    // Synthesise a known-bad pair so the route still executes the
    // lookup → 404 path; measures the cold lookup cost only.
    return {
      phoneE164: `+25570${Math.floor(1000000 + Math.random() * 8_999_999)}`,
      activationCode: '000000',
    };
  }
  const idx = Math.floor(Math.random() * FIXTURES.length);
  return FIXTURES[idx] ?? FIXTURES[0]!;
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function workforceActivateIteration(): void {
  const creds = pickFixture();

  const res = http.post(
    url('/api/v1/workforce/invites/activate'),
    JSON.stringify(creds),
    {
      headers: publicHeaders({
        'X-Loadtest-Run-Id': LOADTEST_RUN_ID,
      }),
      tags: { name: 'workforce.activate' },
      timeout: '5s',
    },
  );

  if (HAS_FIXTURES) {
    check(res, {
      // 200 happy-path or 409 ALREADY_ACTIVATED on second run.
      'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
      'response is JSON': (r) => {
        try {
          const j = r.json();
          return j !== null && typeof j === 'object';
        } catch {
          return false;
        }
      },
    });
  } else {
    // Without fixtures, 404 INVITATION_NOT_FOUND is the contract.
    // We are still measuring the lookup latency.
    check(res, {
      'status is 404 (no fixtures)': (r) => r.status === 404,
    });
  }

  sleep(1);
}

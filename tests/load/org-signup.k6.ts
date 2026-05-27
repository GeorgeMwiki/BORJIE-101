/**
 * k6 load test — POST /api/v1/orgs/signup.
 *
 * Mining-owner self-signup. Public route (no auth) but produces a
 * tenant row + Supabase user + persona binding + audit-chain entry.
 * The route is one of the most expensive write paths at signup time —
 * if it cannot keep p95 < 1.5s under normal load, the launch wave
 * will queue up at the first wizard step.
 *
 * Every signup is tagged with `K6_LOADTEST_RUN_ID` via the
 * `X-Loadtest-Run-Id` header so a cleanup job can sweep them later.
 * The org name itself is also prefixed with the run id (`loadtest_`)
 * so a Drizzle `LIKE 'loadtest_%'` query finds them all.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_SCENARIO=normal \
 *   k6 run tests/load/org-signup.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions, LOADTEST_RUN_ID } from './lib/config';
import { publicHeaders } from './lib/auth';

// k6 reads `options` once at script-load. Threshold = orgs.signup
// SLO (p95 < 1.5s) from `lib/config.ts`.
export const options = buildOptions('orgs.signup');

// ─── Fixtures ────────────────────────────────────────────────────────

const COUNTRIES = ['TZ', 'KE', 'UG', 'NG'] as const;
const CURRENCIES = ['TZS', 'KES', 'UGX', 'NGN'] as const;
const LANGUAGES = ['sw', 'en'] as const;
const BUSINESS_PREFIXES = [
  'Mwamba',
  'Kilimo',
  'Tembo',
  'Simba',
  'Ndovu',
  'Nyota',
  'Bahari',
];

/** Pull a value from a fixed-shape readonly tuple. */
function pick<T>(arr: ReadonlyArray<T>): T {
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? arr[0]!;
}

/** k6 has no crypto.randomUUID — build a short stable suffix. */
function randSuffix(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1_000_000).toString(36);
  return `${ts}-${rand}`;
}

/**
 * Build a fresh signup payload. Every email + phone is unique so
 * we exercise the happy path; the 409 duplicate branch is covered
 * by the unit tests and would skew p95 anyway.
 */
function buildBusinessSignup(): Record<string, unknown> {
  const country = pick(COUNTRIES);
  const currency = pick(CURRENCIES);
  const language = pick(LANGUAGES);
  const suffix = randSuffix();
  const prefix = pick(BUSINESS_PREFIXES);

  return {
    kind: 'business',
    country,
    orgName: `loadtest_${prefix}-mining-${suffix}`,
    businessRegistrationNumber: `BRN-${suffix.toUpperCase()}`,
    taxId: `TIN-${suffix.toUpperCase()}`,
    ownerEmail: `loadtest+${suffix}@borjie.test`,
    ownerFullName: `Loadtest ${prefix} Owner ${suffix}`,
    ownerPhoneE164: `+2557${Math.floor(10000000 + Math.random() * 89999999)}`,
    defaultLanguage: language,
    primaryCurrency: currency,
  };
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function orgSignupIteration(): void {
  const body = JSON.stringify(buildBusinessSignup());

  const res = http.post(url('/api/v1/orgs/signup'), body, {
    headers: publicHeaders({
      // Reinforce the run-id tag at the entity level — the writer
      // can stamp `audit.context.loadtest_run_id` from this header.
      'X-Loadtest-Run-Id': LOADTEST_RUN_ID,
    }),
    tags: { name: 'orgs.signup' },
    timeout: '10s',
  });

  check(res, {
    // 201 is success per the route contract. 503 is the operator-
    // visible failure mode (supabase admin / writer down) and DOES
    // count as a failed request via the threshold above.
    'status is 201 or 503': (r) => r.status === 201 || r.status === 503,
    'response is JSON': (r) => {
      try {
        const j = r.json();
        return j !== null && typeof j === 'object';
      } catch {
        return false;
      }
    },
    'tenantId present when 201': (r) => {
      if (r.status !== 201) return true; // not asserted on non-201
      try {
        const j = r.json() as Record<string, unknown> | null;
        return typeof j?.tenantId === 'string';
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}

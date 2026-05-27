/**
 * k6 load test — POST /api/v1/buyers/signup.
 *
 * Mineral buyer / refiner / broker / fabricator self-signup. Like
 * `orgs/signup` but produces a buyer-tenant + `buyers` row + persona
 * binding to `T5_customer_concierge`.
 *
 * SLO: p95 < 1.5s. Entities tagged with `loadtest_` prefix for sweep.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_SCENARIO=normal \
 *   k6 run tests/load/buyer-signup.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions, LOADTEST_RUN_ID } from './lib/config';
import { publicHeaders } from './lib/auth';

export const options = buildOptions('buyers.signup');

// ─── Fixtures ────────────────────────────────────────────────────────

const COUNTRIES = ['TZ', 'KE', 'UG', 'NG', 'OTHER'] as const;
const CURRENCIES = ['TZS', 'USD', 'KES', 'UGX', 'NGN'] as const;
const LANGUAGES = ['sw', 'en'] as const;
const BUSINESS_KINDS = ['refiner', 'broker', 'fabricator', 'investor'] as const;
const PREFIXES = ['Bahari', 'Tembo', 'Simba', 'Ndovu', 'Nyota', 'Mwamba'];

function pick<T>(arr: ReadonlyArray<T>): T {
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? arr[0]!;
}

function randSuffix(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1_000_000).toString(36);
  return `${ts}-${rand}`;
}

/**
 * Build a fresh BUSINESS-kind buyer signup payload. Mirrors the
 * discriminated-union contract from
 * `services/api-gateway/src/routes/buyers/signup.hono.ts`.
 */
function buildBusinessBuyerSignup(): Record<string, unknown> {
  const country = pick(COUNTRIES);
  const currency = pick(CURRENCIES);
  const language = pick(LANGUAGES);
  const businessKind = pick(BUSINESS_KINDS);
  const suffix = randSuffix();
  const prefix = pick(PREFIXES);

  return {
    kind: 'business',
    country,
    orgName: `loadtest_${prefix}-buyer-${suffix}`,
    businessKind,
    businessRegistrationNumber: `BRN-${suffix.toUpperCase()}`,
    taxId: `TIN-${suffix.toUpperCase()}`,
    contactFullName: `Loadtest Buyer ${prefix} ${suffix}`,
    contactPhoneE164: `+2557${Math.floor(10000000 + Math.random() * 89999999)}`,
    contactEmail: `loadtest-buyer+${suffix}@borjie.test`,
    preferredCurrency: currency,
    preferredLanguage: language,
  };
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function buyerSignupIteration(): void {
  const body = JSON.stringify(buildBusinessBuyerSignup());

  const res = http.post(url('/api/v1/buyers/signup'), body, {
    headers: publicHeaders({
      'X-Loadtest-Run-Id': LOADTEST_RUN_ID,
    }),
    tags: { name: 'buyers.signup' },
    timeout: '10s',
  });

  check(res, {
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
      if (r.status !== 201) return true;
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

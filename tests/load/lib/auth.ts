/**
 * Shared k6 auth helper.
 *
 * Borjie auth (per CLAUDE.md) is canonically Supabase JWT bearer
 * tokens. We never mint tokens inside k6 — that would require pulling
 * a JOSE library through xk6, breaking the "no new pnpm deps" rule
 * and shifting the test from a load probe to an auth-server stress
 * test. Instead:
 *
 *   1. Operator generates a long-lived test JWT (via the same
 *      `scripts/pilot-provision.ts` flow used for HITL pilots).
 *   2. They export it as `K6_AUTH_TOKEN` (and optionally a tenant id
 *      as `K6_TENANT_ID` for routes that read it from the principal).
 *   3. Every test imports `authHeaders()` and the bearer is attached.
 *
 * Public routes (orgs/signup, buyers/signup, workforce/activate) do
 * NOT need a token. They still get a `User-Agent` header so the
 * gateway's access log can correlate runs.
 */

import { AUTH_TOKEN, LOADTEST_RUN_ID, TEST_TENANT_ID } from './config';

/** Module-typed alias for the header bag k6 expects. */
export type HttpHeaders = Readonly<Record<string, string>>;

/**
 * Build the common header set every request carries. Includes the
 * load-test run id so the access log can filter k6 traffic from real
 * user traffic during a soak.
 */
function baseHeaders(): HttpHeaders {
  return {
    'User-Agent': `borjie-k6/1 (${LOADTEST_RUN_ID})`,
    'X-Loadtest-Run-Id': LOADTEST_RUN_ID,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Auth headers for routes that require a verified Supabase JWT.
 * If `K6_AUTH_TOKEN` is unset, returns the base headers — the test
 * will still run, and an `Unauthorized` failure surfaces in the
 * summary so the operator knows what to fix.
 */
export function authHeaders(extra: HttpHeaders = {}): HttpHeaders {
  const headers: Record<string, string> = {
    ...baseHeaders(),
    ...extra,
  };
  if (AUTH_TOKEN.length > 0) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  if (TEST_TENANT_ID.length > 0) {
    headers['X-Tenant-Id'] = TEST_TENANT_ID;
  }
  return headers;
}

/**
 * Headers for routes that explicitly run without a bearer token
 * (orgs/signup, buyers/signup, workforce/activate). Kept as a
 * named export so the intent is loud at the call site.
 */
export function publicHeaders(extra: HttpHeaders = {}): HttpHeaders {
  return {
    ...baseHeaders(),
    ...extra,
  };
}

/**
 * Headers for SSE consumption. `Accept: text/event-stream` is the
 * single contractual switch the gateway honours to flip the chat
 * route from JSON to event-stream framing.
 */
export function sseHeaders(extra: HttpHeaders = {}): HttpHeaders {
  return {
    ...authHeaders(extra),
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
  };
}

/**
 * Convenience flag tests use to short-circuit when the operator has
 * not provided a bearer for an auth-required endpoint. The smoke run
 * still executes (to exercise the 401 path) but stress / normal runs
 * skip the request body so we are not just measuring 401 latency.
 */
export const HAS_AUTH_TOKEN: boolean = AUTH_TOKEN.length > 0;

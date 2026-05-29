/**
 * Shared k6 configuration — base URL, scenarios, thresholds.
 *
 * Reads runtime environment via the k6 `__ENV` global so tests stay
 * portable across local-dev / staging / prod. Every value is a pure
 * primitive so the file is safe to import from any *.k6.ts entry.
 *
 * Scenarios:
 *   smoke   — 1 VU for 10s, verifies the path is alive.
 *   normal  — ramp 0→50 VU over 30s, hold 2m, ramp down.
 *   stress  — ramp 0→200 VU over 1m, hold 1m (find the breakpoint).
 *
 * Thresholds (global):
 *   http_req_failed       rate <  0.01   (less than 1% failure)
 *   http_req_duration     p95  <  2000ms, p99 < 5000ms
 *
 * Per-test SLOs override `http_req_duration` via tagged thresholds
 * — see `endpointThresholds()` for the per-endpoint extension.
 */

// ─── k6 module type shims ───────────────────────────────────────────
// Avoid pulling in @types/k6 (no new pnpm deps). We declare the bare
// surface we touch; the runtime is provided by the k6 binary.
declare const __ENV: Readonly<Record<string, string | undefined>>;

// ─── Constants ───────────────────────────────────────────────────────

/** Default local-dev API gateway base URL. */
const DEFAULT_BASE_URL = 'http://localhost:4000';

/**
 * Resolve the base URL once at module load. Cast strips `undefined`
 * because we always fall back to the local-dev default.
 */
export const BASE_URL: string =
  (__ENV.K6_API_URL && __ENV.K6_API_URL.trim().length > 0
    ? __ENV.K6_API_URL.trim()
    : DEFAULT_BASE_URL);

/**
 * Optional bearer token, supplied via env so tests can hit
 * authenticated routes without minting JWTs at run time.
 */
export const AUTH_TOKEN: string = __ENV.K6_AUTH_TOKEN ?? '';

/**
 * Optional supabase service-role key for tests that mint tokens.
 * `lib/auth.ts` will use it when present.
 */
export const SUPABASE_URL: string = __ENV.K6_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = __ENV.K6_SUPABASE_ANON_KEY ?? '';
export const SUPABASE_SERVICE_ROLE_KEY: string =
  __ENV.K6_SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Tenant context for auth-required runs (header passthrough). */
export const TEST_TENANT_ID: string = __ENV.K6_TENANT_ID ?? '';

/**
 * Tag stamped on every entity a test creates so a cleanup job can
 * delete the residue afterwards. Defaults to a timestamp so multiple
 * runs do not collide.
 */
export const LOADTEST_RUN_ID: string =
  __ENV.K6_LOADTEST_RUN_ID ??
  `lt-${new Date().toISOString().replace(/[:.]/g, '-')}`;

// ─── Scenario presets ────────────────────────────────────────────────

export type ScenarioName = 'smoke' | 'normal' | 'stress';

/**
 * Resolve the scenario name from `__ENV.K6_SCENARIO`. Default `smoke`
 * because that is the safest local-dev choice.
 */
export function activeScenarioName(): ScenarioName {
  const raw = (__ENV.K6_SCENARIO ?? 'smoke').toLowerCase();
  if (raw === 'normal' || raw === 'stress') return raw;
  return 'smoke';
}

/** Ramping-VUs stage. k6 native shape. */
interface RampStage {
  readonly duration: string;
  readonly target: number;
}

/** k6 scenarios block we generate. */
interface ScenarioExecutor {
  readonly executor: 'ramping-vus' | 'constant-vus';
  readonly stages?: ReadonlyArray<RampStage>;
  readonly vus?: number;
  readonly duration?: string;
  readonly gracefulRampDown?: string;
  readonly gracefulStop?: string;
}

const SMOKE: ScenarioExecutor = {
  executor: 'constant-vus',
  vus: 1,
  duration: '10s',
  gracefulStop: '5s',
};

const NORMAL: ScenarioExecutor = {
  executor: 'ramping-vus',
  stages: [
    { duration: '30s', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  gracefulRampDown: '15s',
  gracefulStop: '15s',
};

const STRESS: ScenarioExecutor = {
  executor: 'ramping-vus',
  stages: [
    { duration: '1m', target: 200 },
    { duration: '1m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  gracefulRampDown: '15s',
  gracefulStop: '15s',
};

const SCENARIOS_BY_NAME: Readonly<Record<ScenarioName, ScenarioExecutor>> = {
  smoke: SMOKE,
  normal: NORMAL,
  stress: STRESS,
};

/**
 * Build the k6 `scenarios` block for the currently-active scenario
 * name. Each test exports an `options` object that funnels through
 * this so every endpoint test exercises the same shapes.
 */
export function buildScenarios(): Readonly<Record<string, ScenarioExecutor>> {
  const name = activeScenarioName();
  return { [name]: SCENARIOS_BY_NAME[name] };
}

// ─── Thresholds ──────────────────────────────────────────────────────

/**
 * Per-endpoint p95 / p99 SLO targets in milliseconds. Keys match the
 * `endpoint` tag set by each test so threshold rules read cleanly.
 */
export const ENDPOINT_SLO_MS: Readonly<
  Record<string, { readonly p95: number; readonly p99: number }>
> = {
  'brain.turn': { p95: 3_000, p99: 6_000 },
  'brain.stream': { p95: 200, p99: 500 }, // turn.accepted first event
  'orgs.signup': { p95: 1_500, p99: 3_000 },
  'buyers.signup': { p95: 1_500, p99: 3_000 },
  'workforce.activate': { p95: 1_000, p99: 2_000 },
  'mining.vision': { p95: 5_000, p99: 8_000 },
  // G-FIX-3 — compound dashboard read budget (three serial GETs).
  'dashboard.read': { p95: 800, p99: 1_500 },
  // G-FIX-3 — M-Pesa STK callback (signed POST, ledger write).
  'webhook.mpesa.stk': { p95: 400, p99: 800 },
  // G-FIX-3 — single brain tool exec (hot read-tool roster).
  'brain.tool.call': { p95: 600, p99: 1_500 },
  // G-FIX-3 — cockpit SSE first frame (`event: connected`).
  'cockpit.sse.subscribe': { p95: 250, p99: 600 },
};

/**
 * Build the global + per-endpoint threshold map. Each test passes its
 * own `endpoint` (matching `ENDPOINT_SLO_MS`) so the per-test SLO
 * overrides the global default.
 */
export function buildThresholds(endpoint: string): Readonly<Record<string, ReadonlyArray<string>>> {
  const slo = ENDPOINT_SLO_MS[endpoint];
  const taggedSelector = `{endpoint:${endpoint}}`;
  return {
    // Global failure rate.
    http_req_failed: ['rate<0.01'],
    // Global latency (any tag).
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    // Per-endpoint latency (tighter where applicable).
    [`http_req_duration${taggedSelector}`]: slo
      ? [`p(95)<${slo.p95}`, `p(99)<${slo.p99}`]
      : ['p(95)<2000', 'p(99)<5000'],
  };
}

/**
 * Build the complete `options` object every k6 test exports. Combines
 * scenarios + thresholds + a consistent `tags` block carrying the run
 * id so traces from one run cluster together.
 */
export function buildOptions(endpoint: string): {
  readonly scenarios: Readonly<Record<string, ScenarioExecutor>>;
  readonly thresholds: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly noConnectionReuse: boolean;
} {
  return {
    scenarios: buildScenarios(),
    thresholds: buildThresholds(endpoint),
    tags: {
      endpoint,
      loadtest_run_id: LOADTEST_RUN_ID,
      scenario: activeScenarioName(),
    },
    // Force fresh TCP handshakes so we are measuring server cost, not
    // just keep-alive reuse. Local-dev finds keep-alive masks issues.
    noConnectionReuse: false,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Join the base URL with a path segment, guarding against double
 * slashes. Lifted into a single helper so every test reads the URL
 * the same way.
 */
export function url(path: string): string {
  const trimmedBase = BASE_URL.replace(/\/+$/u, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

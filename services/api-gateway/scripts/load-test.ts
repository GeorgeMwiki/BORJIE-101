/**
 * Load test harness for the BORJIE api-gateway (Wave-7).
 *
 * Boots the api-gateway on a configurable port (default 4001), mints a signed
 * JWT for tenant-001, and runs autocannon against four read-only endpoints
 * with 10 concurrent connections for 30s each. Results are written as JSON
 * next to this script so the companion Markdown report can link them.
 *
 * Read-only / transactional safety:
 *   - Only GET endpoints are exercised.
 *   - The gateway is booted with PORT=4001 against the caller-supplied
 *     DATABASE_URL — the caller is expected to point at a local Postgres,
 *     not production (script refuses to run if DATABASE_URL contains
 *     ".prod." or "rds.amazonaws.com").
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';

// ESM-safe __dirname equivalent. tsx compiles this script as an ESM
// module because the nearest package.json doesn't set `type: module`
// but tsconfig uses NodeNext — we use `import.meta.url` which is always
// defined regardless of runtime.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// autocannon ships CJS; use createRequire so tsx/ESM can load it.
const nodeRequire = createRequire(import.meta.url);
const autocannon = nodeRequire('autocannon') as (
  opts: Record<string, unknown>
) => Promise<AutocannonResult>;

// ---------------------------------------------------------------------------
// Types mirrored from autocannon (kept narrow — only fields we log/report).
// ---------------------------------------------------------------------------

interface LatencyBucket {
  readonly average: number;
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

interface AutocannonResult {
  readonly url: string;
  readonly connections: number;
  readonly duration: number;
  readonly latency: LatencyBucket;
  readonly requests: LatencyBucket & { readonly total: number };
  readonly throughput: LatencyBucket & { readonly total: number };
  readonly errors: number;
  readonly timeouts: number;
  readonly non2xx: number;
  readonly '1xx'?: number;
  readonly '2xx'?: number;
  readonly '3xx'?: number;
  readonly '4xx'?: number;
  readonly '5xx'?: number;
}

interface EndpointSpec {
  readonly name: string;
  readonly method: 'GET';
  readonly path: string;
  readonly authenticated: boolean;
  readonly targetP95Ms: number;
  readonly classLabel: string;
}

interface RunSummary {
  readonly endpoint: EndpointSpec;
  readonly url: string;
  readonly status: 'pass' | 'fail';
  readonly latencyMsP50: number;
  readonly latencyMsP95: number;
  readonly latencyMsP99: number;
  readonly latencyMsMax: number;
  readonly rps: number;
  readonly totalRequests: number;
  readonly errors: number;
  readonly timeouts: number;
  readonly non2xx: number;
  readonly statusHistogram: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.LOAD_TEST_PORT ?? '4001');
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CONNECTIONS = Number(process.env.LOAD_TEST_CONNECTIONS ?? '10');
const DURATION_SEC = Number(process.env.LOAD_TEST_DURATION ?? '30');
const TENANT_ID = 'tenant-001';
const USER_ID = 'loadtest-user';
// Deterministic 64-char secret so the signed token matches what the
// booted gateway validates. Passed through env, never persisted.
const JWT_SECRET =
  process.env.LOAD_TEST_JWT_SECRET ??
  'LOADTEST_secret_at_least_32_chars_long_please_do_not_ship_me';

// Production guardrails — refuse if someone points this at a prod URL.
const FORBIDDEN_DB_FRAGMENTS = ['.prod.', 'rds.amazonaws.com', 'production'];

// ---------------------------------------------------------------------------
// JWT minting
// ---------------------------------------------------------------------------

function mintJwt(): string {
  const payload = {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'ESTATE_MANAGER',
    permissions: ['read:*'],
    propertyAccess: ['*'],
    jti: `loadtest-${Date.now()}`,
  };
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// ---------------------------------------------------------------------------
// Endpoints under test
// ---------------------------------------------------------------------------

const ENDPOINTS: readonly EndpointSpec[] = [
  {
    name: 'health',
    method: 'GET',
    path: '/health',
    authenticated: false,
    targetP95Ms: 10,
    classLabel: 'Health',
  },
  {
    name: 'marketplace.listings',
    method: 'GET',
    path: '/api/v1/marketplace/listings?limit=20&offset=0',
    authenticated: true,
    targetP95Ms: 200,
    classLabel: 'List endpoint',
  },
  {
    name: 'waitlist.by-unit',
    method: 'GET',
    // waitlist router only exposes per-unit and per-customer lists; the
    // per-unit list exercises the same auth + tenant-context + DB path.
    path: '/api/v1/waitlist/units/unit-loadtest',
    authenticated: true,
    targetP95Ms: 200,
    classLabel: 'List endpoint',
  },
  {
    name: 'gamification.policies',
    method: 'GET',
    path: '/api/v1/gamification/policies',
    authenticated: true,
    targetP95Ms: 200,
    classLabel: 'List endpoint',
  },
];

// ---------------------------------------------------------------------------
// Boot gateway subprocess
// ---------------------------------------------------------------------------

function assertSafeDbUrl(): void {
  const dbUrl = process.env.DATABASE_URL ?? '';
  const lowered = dbUrl.toLowerCase();
  for (const frag of FORBIDDEN_DB_FRAGMENTS) {
    if (lowered.includes(frag)) {
      throw new Error(
        `load-test: refusing to run — DATABASE_URL contains "${frag}". ` +
          'This script is for local/CI use only.'
      );
    }
  }
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `gateway did not become ready within ${timeoutMs}ms: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

function bootGateway(): ChildProcess {
  const gatewayDir = resolve(__dirname, '..');
  const entryPoint = resolve(gatewayDir, 'dist/index.js');
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    JWT_SECRET,
    // Tight rate limit would skew the run; widen it for the test only.
    RATE_LIMIT_MAX: '1000000',
    RATE_LIMIT_WINDOW_MS: '60000',
    // Keep outbox worker idle so it doesn't compete for DB/CPU.
    OUTBOX_WORKER_DISABLED: 'true',
    LOG_LEVEL: 'warn',
  };
  const child = spawn(process.execPath, [entryPoint], {
    cwd: gatewayDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (buf: Buffer) => {
    process.stdout.write(`[gw:out] ${buf.toString()}`);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[gw:err] ${buf.toString()}`);
  });
  return child;
}

// ---------------------------------------------------------------------------
// Run a single endpoint
// ---------------------------------------------------------------------------

async function runEndpoint(
  spec: EndpointSpec,
  token: string
): Promise<RunSummary> {
  const url = `${BASE_URL}${spec.path}`;
  const headers: Record<string, string> = {};
  if (spec.authenticated) headers['Authorization'] = `Bearer ${token}`;
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${spec.name} (${spec.method} ${spec.path}) — target P95 < ${spec.targetP95Ms}ms ===`
  );
  const result = await autocannon({
    url,
    method: spec.method,
    headers,
    connections: CONNECTIONS,
    duration: DURATION_SEC,
    // accept non-2xx without treating as hard error — we report the mix.
    expectBody: undefined,
    // autocannon's bailout: drop retry/delay defaults so throughput is honest.
  });

  const statusHistogram = {
    '1xx': result['1xx'] ?? 0,
    '2xx': result['2xx'] ?? 0,
    '3xx': result['3xx'] ?? 0,
    '4xx': result['4xx'] ?? 0,
    '5xx': result['5xx'] ?? 0,
  };

  const p95 = result.latency.p95;
  const status: 'pass' | 'fail' = p95 <= spec.targetP95Ms ? 'pass' : 'fail';

  const summary: RunSummary = {
    endpoint: spec,
    url,
    status,
    latencyMsP50: result.latency.p50,
    latencyMsP95: p95,
    latencyMsP99: result.latency.p99,
    latencyMsMax: result.latency.max,
    rps: result.requests.average,
    totalRequests: result.requests.total,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    statusHistogram,
  };

  // eslint-disable-next-line no-console
  console.log(
    `-> P50=${summary.latencyMsP50}ms P95=${summary.latencyMsP95}ms ` +
      `P99=${summary.latencyMsP99}ms max=${summary.latencyMsMax}ms | ` +
      `RPS=${summary.rps.toFixed(1)} total=${summary.totalRequests} | ` +
      `status=${summary.status} | ` +
      `2xx=${statusHistogram['2xx']} 4xx=${statusHistogram['4xx']} 5xx=${statusHistogram['5xx']}`
  );

  return summary;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertSafeDbUrl();

  // eslint-disable-next-line no-console
  console.log(
    `Load test: ${CONNECTIONS} connections, ${DURATION_SEC}s each, ` +
      `${ENDPOINTS.length} endpoints, target ${BASE_URL}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `DATABASE_URL=${process.env.DATABASE_URL ? '<set>' : '<unset — gateway will run in degraded mode>'}`
  );

  const child = bootGateway();
  let outputPath = '';
  try {
    await waitForReady(BASE_URL, 15_000);
    const token = mintJwt();
    const summaries: RunSummary[] = [];
    for (const spec of ENDPOINTS) {
      // eslint-disable-next-line no-await-in-loop
      const summary = await runEndpoint(spec, token);
      summaries.push(summary);
    }

    const env = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpuCount: (await import('node:os')).cpus().length,
      connections: CONNECTIONS,
      durationSeconds: DURATION_SEC,
      databaseUrlSet: Boolean(process.env.DATABASE_URL),
      generatedAt: new Date().toISOString(),
    };

    const payload = { env, summaries };
    outputPath = resolve(__dirname, 'load-test-results.json');
    await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\nResults written to ${outputPath}`);

    const failed = summaries.filter((s) => s.status === 'fail');
    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n${failed.length}/${summaries.length} endpoints missed their P95 target:`
      );
      for (const f of failed) {
        // eslint-disable-next-line no-console
        console.log(
          `  - ${f.endpoint.name}: P95=${f.latencyMsP95}ms > target ${f.endpoint.targetP95Ms}ms`
        );
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('\nAll endpoints met their P95 targets.');
    }
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve();
        }, 5_000);
        child.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('load-test failed:', err);
  process.exit(1);
});

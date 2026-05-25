#!/usr/bin/env node
/**
 * Load-test suite — 10 scenarios against a booted gateway.
 *
 * Each scenario has a named P95 budget (ms). Exits non-zero if any scenario
 * blows its budget. Writes JSON + HTML reports to ./load-test-reports/.
 *
 * Usage:
 *   node scripts/load-test-suite.mjs
 *   GATEWAY_URL=http://127.0.0.1:4001 CONNECTIONS=20 DURATION=20 \
 *     node scripts/load-test-suite.mjs
 *
 * Env:
 *   GATEWAY_URL     default http://127.0.0.1:4001
 *   CONNECTIONS     default 10
 *   DURATION        default 20 (seconds per scenario)
 *   JWT_SECRET      matches the gateway's JWT secret
 *   REPORTS_DIR     default ./load-test-reports
 */

import autocannon from 'autocannon';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:4001';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? '10');
const DURATION = Number(process.env.DURATION ?? '20');
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-dev-only-32chars';
const REPORTS_DIR = resolve(process.cwd(), process.env.REPORTS_DIR ?? 'load-test-reports');

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mintJwt() {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    userId: 'load-test-user',
    tenantId: 'tenant-001',
    role: 'TENANT_ADMIN',
    permissions: ['*'],
    propertyAccess: ['*'],
    iat: now,
    exp: now + 3600,
  }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${payload}.${sig}`;
}
const TOKEN = mintJwt();
const authHeaders = { authorization: `Bearer ${TOKEN}` };

// 10 scenarios — mix of unauth + authed, read + SSE + POST.
const SCENARIOS = [
  { name: 'health', method: 'GET', url: '/health', headers: {}, budgetMs: 10 },
  { name: 'streaming-chat-init', method: 'GET', url: '/api/v1/ai/chat', headers: authHeaders, budgetMs: 150 },
  { name: 'mcp-manifest', method: 'GET', url: '/api/v1/mcp/manifest', headers: authHeaders, budgetMs: 80 },
  {
    name: 'mcp-tools-call',
    method: 'POST',
    url: '/api/v1/mcp/tools/call',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'noop', arguments: {} }),
    budgetMs: 200,
  },
  { name: 'listings-list', method: 'GET', url: '/api/v1/marketplace/listings', headers: authHeaders, budgetMs: 200 },
  {
    name: 'listings-create',
    method: 'POST',
    url: '/api/v1/marketplace/listings',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ unitId: 'unit-demo', monthlyRentMinor: 1000000 }),
    budgetMs: 300,
  },
  {
    name: 'arrears-projection',
    method: 'GET',
    url: '/api/v1/arrears/cases/case-demo/projection',
    headers: authHeaders,
    budgetMs: 250,
  },
  {
    name: 'training-generate',
    method: 'POST',
    url: '/api/v1/training/generate',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ topic: 'late-rent-escalation', role: 'AGENT' }),
    budgetMs: 400,
  },
  { name: 'compliance-plugins', method: 'GET', url: '/api/v1/compliance-plugins', headers: authHeaders, budgetMs: 150 },
  { name: 'ai-costs-summary', method: 'GET', url: '/api/v1/ai-costs/summary', headers: authHeaders, budgetMs: 200 },
];

async function runScenario(scenario) {
  return new Promise((resolvePromise, reject) => {
    const opts = {
      url: `${GATEWAY_URL}${scenario.url}`,
      method: scenario.method,
      connections: CONNECTIONS,
      duration: DURATION,
      headers: scenario.headers,
    };
    if (scenario.body) opts.body = scenario.body;
    autocannon(opts, (err, result) => {
      if (err) return reject(err);
      resolvePromise({
        name: scenario.name,
        url: scenario.url,
        method: scenario.method,
        budgetMs: scenario.budgetMs,
        p95: result.latency?.p97_5 ?? result.latency?.p99 ?? result.latency?.average ?? 0,
        p50: result.latency?.p50 ?? 0,
        average: result.latency?.average ?? 0,
        requests: result.requests?.total ?? 0,
        throughput: result.throughput?.average ?? 0,
        errors: result.errors ?? 0,
        timeouts: result.timeouts ?? 0,
        non2xx: result['non2xx'] ?? 0,
      });
    });
  });
}

function renderHtml(results) {
  const rows = results.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.method} ${r.url}</td>
      <td>${r.budgetMs}ms</td>
      <td class="${r.p95 > r.budgetMs ? 'bad' : 'ok'}">${r.p95.toFixed(1)}ms</td>
      <td>${r.p50.toFixed(1)}ms</td>
      <td>${r.requests}</td>
      <td>${r.errors}</td>
      <td>${r.non2xx}</td>
    </tr>
  `).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>BORJIE Load Test</title>
<style>body{font-family:system-ui;padding:24px;max-width:1100px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:8px;text-align:left}.bad{background:#ffcdd2}.ok{background:#c8e6c9}</style></head>
<body><h1>BORJIE Load Test Suite</h1>
<p>Gateway: <code>${GATEWAY_URL}</code> · Connections: ${CONNECTIONS} · Duration: ${DURATION}s</p>
<table><thead><tr>
<th>Scenario</th><th>Endpoint</th><th>Budget</th><th>P95</th><th>P50</th>
<th>Requests</th><th>Errors</th><th>non-2xx</th>
</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

async function main() {
  await mkdir(REPORTS_DIR, { recursive: true });
  const results = [];
  for (const scenario of SCENARIOS) {
    process.stderr.write(`[load-test] ${scenario.name} → ${scenario.url}\n`);
    try {
      results.push(await runScenario(scenario));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        name: scenario.name, url: scenario.url, method: scenario.method,
        budgetMs: scenario.budgetMs, p95: Infinity, p50: 0, average: 0,
        requests: 0, errors: 1, timeouts: 0, non2xx: 0, failureReason: msg,
      });
    }
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(resolve(REPORTS_DIR, `report-${timestamp}.json`),
    JSON.stringify({ gateway: GATEWAY_URL, connections: CONNECTIONS, duration: DURATION, results }, null, 2));
  await writeFile(resolve(REPORTS_DIR, `report-${timestamp}.html`), renderHtml(results));
  process.stderr.write(`[load-test] reports written to ${REPORTS_DIR}\n`);

  let failed = 0;
  process.stdout.write('scenario,p95,budget,status\n');
  for (const r of results) {
    const ok = r.p95 <= r.budgetMs;
    if (!ok) failed += 1;
    process.stdout.write(`${r.name},${r.p95.toFixed(1)},${r.budgetMs},${ok ? 'OK' : 'OVER'}\n`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[load-test] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

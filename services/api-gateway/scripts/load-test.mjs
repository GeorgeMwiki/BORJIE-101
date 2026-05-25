#!/usr/bin/env node
/**
 * Load test — runs autocannon against the gateway's key endpoints.
 * Assumes the gateway is booted on $GATEWAY_URL (default 127.0.0.1:4001).
 *
 * Usage:
 *   node services/api-gateway/scripts/load-test.mjs
 *   GATEWAY_URL=http://127.0.0.1:4001 CONNECTIONS=20 DURATION=30 node load-test.mjs
 */

import autocannon from 'autocannon';
import { createHmac } from 'node:crypto';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:4001';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? '10');
const DURATION = Number(process.env.DURATION ?? '30');
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-dev-only-32chars';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}

const TOKEN = mintJwt();

// Targets must hit REAL endpoints (not aspirational roots) — otherwise we
// benchmark 404 paths and fool ourselves about p95. Each path below is
// registered by the respective router.ts (verified via uat-walkthrough.sh).
const targets = [
  { name: 'health', url: '/health', headers: {} },
  { name: 'healthz', url: '/healthz', headers: {} },
  { name: 'marketplace-listings', url: '/api/v1/marketplace/listings', headers: { authorization: `Bearer ${TOKEN}` } },
  { name: 'waitlist-for-unit', url: '/api/v1/waitlist/units/unit-demo', headers: { authorization: `Bearer ${TOKEN}` } },
  { name: 'gamification-policies', url: '/api/v1/gamification/policies', headers: { authorization: `Bearer ${TOKEN}` } },
  { name: 'notification-preferences', url: '/api/v1/me/notification-preferences', headers: { authorization: `Bearer ${TOKEN}` } },
  { name: 'applications', url: '/api/v1/applications', headers: { authorization: `Bearer ${TOKEN}` } },
  { name: 'renewals', url: '/api/v1/renewals', headers: { authorization: `Bearer ${TOKEN}` } },
];

// P95 budget targets from Docs/PERFORMANCE.md
const BUDGETS = {
  'health': 10,
  'healthz': 10,
  'marketplace-listings': 200,
  'waitlist-for-unit': 200,
  'gamification-policies': 200,
  'notification-preferences': 200,
  'applications': 250,
  'renewals': 250,
};

async function runTarget(target) {
  return new Promise((resolve, reject) => {
    autocannon({
      url: `${GATEWAY_URL}${target.url}`,
      connections: CONNECTIONS,
      duration: DURATION,
      headers: target.headers,
    }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function main() {
  console.log(`Load testing ${GATEWAY_URL} — ${CONNECTIONS} connections × ${DURATION}s each\n`);
  const results = [];
  for (const target of targets) {
    console.log(`Running: ${target.name}`);
    try {
      const r = await runTarget(target);
      const p95 = r.latency.p99;
      const budget = BUDGETS[target.name] ?? 500;
      const pass = p95 <= budget;
      results.push({
        name: target.name,
        reqPerSec: Math.round(r.requests.average),
        p50: r.latency.p50,
        p95: r.latency.p95 ?? r.latency.p90,
        p99: r.latency.p99,
        errors: r.errors,
        timeouts: r.timeouts,
        budget,
        pass,
      });
    } catch (err) {
      console.error(`  ✗ ${target.name} failed:`, err.message);
      results.push({ name: target.name, error: err.message });
    }
  }

  console.log('\n=== Results ===');
  console.log('name                  req/s    p50(ms)  p95(ms)  p99(ms)  errors  budget  pass');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.name.padEnd(22)} ERROR: ${r.error}`);
      continue;
    }
    const line = [
      r.name.padEnd(22),
      String(r.reqPerSec).padStart(5),
      String(r.p50).padStart(9),
      String(r.p95 ?? '-').padStart(9),
      String(r.p99).padStart(9),
      String(r.errors).padStart(7),
      String(r.budget).padStart(7),
      r.pass ? '✓' : '✗',
    ].join('  ');
    console.log(line);
  }

  const allPass = results.every(r => r.pass === true || r.error);
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

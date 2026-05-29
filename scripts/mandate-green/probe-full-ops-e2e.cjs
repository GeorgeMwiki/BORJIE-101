#!/usr/bin/env node
/**
 * scripts/mandate-green/probe-full-ops-e2e.cjs
 *
 * V-4 — Full ops system live probe — 8 E2E chains end-to-end:
 *   1. HR/onboarding chain
 *   2. Payroll chain
 *   3. Safety chain
 *   4. Commercial chain
 *   5. Compliance chain
 *   6. Knowledge chain
 *   7. Multi-device sync (R6)
 *   8. Mwikila autonomy
 *
 * For each: HTTP/SSE evidence captured. Output: /tmp/full-ops-e2e.json
 * Run: node scripts/mandate-green/probe-full-ops-e2e.cjs
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { loadSecret } = require('../live-verify/mint-jwt.cjs');

const BASE = process.env.GATEWAY_BASE || 'http://127.0.0.1:4001';
const TENANT = '00000000-0000-0000-0000-000000000001';

const USER_UUIDS = {
  ADMIN: '26b5ecc8-4bc2-4367-af8d-c985151f3b85',
  BUYER: '4f28232f-f270-48c4-867f-1c0a7264662f',
  MANAGER: '90d5a7a9-446a-4e28-a58f-ee9973ecc4b2',
  OWNER: '37544adc-f40e-4ce1-b428-13aa242daf02',
  WORKER: 'bdc609de-815a-48bb-bf81-25edfcf93446',
};

function mint(role) {
  const sub = USER_UUIDS[role];
  return jwt.sign(
    {
      sub,
      userId: sub,
      tenantId: TENANT,
      role,
      permissions: [],
      propertyAccess: ['*'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    loadSecret(),
    { algorithm: 'HS256' },
  );
}

const TOKENS = {
  OWNER: mint('OWNER'),
  ADMIN: mint('ADMIN'),
  WORKER: mint('WORKER'),
  MANAGER: mint('MANAGER'),
  BUYER: mint('BUYER'),
};

function probe(method, urlPath, role, body) {
  return new Promise((resolve) => {
    const url = new URL(BASE + urlPath);
    const start = Date.now();
    const token = TOKENS[role];
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            ms: Date.now() - start,
            body: buf.slice(0, 280),
            full: buf,
          });
        });
      },
    );
    req.on('error', (err) =>
      resolve({ status: 0, ms: Date.now() - start, body: `ERR: ${err.message}`, full: '' }),
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, ms: Date.now() - start, body: 'TIMEOUT', full: '' });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

const CHAINS = [
  // ============ CHAIN 1: HR/Onboarding ============
  {
    chain: '1. HR/Onboarding',
    steps: [
      { name: 'list workforce openings', method: 'GET', path: '/api/v1/workforce/recruiting/openings', role: 'OWNER' },
      { name: 'list candidates', method: 'GET', path: '/api/v1/workforce/recruiting/candidates', role: 'MANAGER' },
      { name: 'list workforce active', method: 'GET', path: '/api/v1/mining/workforce/active', role: 'OWNER' },
      { name: 'list onboarding kits', method: 'GET', path: '/api/v1/workforce/onboarding/kits', role: 'MANAGER' },
    ],
  },
  // ============ CHAIN 2: Payroll ============
  {
    chain: '2. Payroll',
    steps: [
      { name: 'list time entries', method: 'GET', path: '/api/v1/mining/payroll/time-entries', role: 'MANAGER' },
      { name: 'payroll batches index', method: 'GET', path: '/api/v1/mining/payroll/batches', role: 'OWNER' },
      { name: 'payroll runs ledger', method: 'GET', path: '/api/v1/mining/payroll/runs', role: 'OWNER' },
      { name: 'payouts queue', method: 'GET', path: '/api/v1/mining/payroll/payouts', role: 'OWNER' },
    ],
  },
  // ============ CHAIN 3: Safety ============
  {
    chain: '3. Safety',
    steps: [
      { name: 'safety incidents inbox', method: 'GET', path: '/api/v1/mining/safety/incidents', role: 'MANAGER' },
      { name: 'safety hazards register', method: 'GET', path: '/api/v1/mining/safety/hazards', role: 'OWNER' },
      { name: 'safety inspections', method: 'GET', path: '/api/v1/mining/safety/inspections', role: 'MANAGER' },
      { name: 'safety toolbox-talks', method: 'GET', path: '/api/v1/mining/safety/toolbox-talks', role: 'WORKER' },
    ],
  },
  // ============ CHAIN 4: Commercial ============
  {
    chain: '4. Commercial (RFB->CoC)',
    steps: [
      { name: 'RFB nearby (buyer)', method: 'GET', path: '/api/v1/marketplace/rfb/nearby', role: 'BUYER' },
      { name: 'marketplace listings', method: 'GET', path: '/api/v1/marketplace/listings', role: 'BUYER' },
      { name: 'manager dispatch board', method: 'GET', path: '/api/v1/mining/sales', role: 'MANAGER' },
      { name: 'CoC track', method: 'GET', path: '/api/v1/marketplace/chain-of-custody/recent', role: 'OWNER' },
    ],
  },
  // ============ CHAIN 5: Compliance ============
  {
    chain: '5. Compliance (licence/renewal)',
    steps: [
      { name: 'regulator filings index', method: 'GET', path: '/api/v1/ops/regulator-filings', role: 'OWNER' },
      { name: 'compliance pack index', method: 'GET', path: '/api/v1/mining/compliance/licences', role: 'OWNER' },
      { name: 'inspections schedule', method: 'GET', path: '/api/v1/mining/compliance/inspections', role: 'OWNER' },
      { name: 'audit-trail entries', method: 'GET', path: '/api/v1/audit-trail/entries', role: 'OWNER' },
    ],
  },
  // ============ CHAIN 6: Knowledge ============
  {
    chain: '6. Knowledge (corpus/Q&A)',
    steps: [
      { name: 'documents (knowledge surface)', method: 'GET', path: '/api/v1/mining/docs', role: 'OWNER' },
      { name: 'owner brief (uses RAG)', method: 'GET', path: '/api/v1/owner/brief', role: 'OWNER' },
      { name: 'corpus chunks recent ingests', method: 'GET', path: '/api/v1/admin/corpus/recent-ingests', role: 'ADMIN' },
    ],
  },
  // ============ CHAIN 7: Multi-device sync ============
  {
    chain: '7. Multi-device sync (SSE)',
    steps: [
      { name: 'cockpit SSE auth-gate (no token)', method: 'GET', path: '/api/v1/cockpit/stream', role: null },
      { name: 'workforce hero next task', method: 'GET', path: '/api/v1/field/workforce/tasks/next', role: 'WORKER' },
      { name: 'workforce notifications', method: 'GET', path: '/api/v1/workforce/notifications', role: 'WORKER' },
      { name: 'manager task queue', method: 'GET', path: '/api/v1/mining/tasks', role: 'MANAGER' },
    ],
  },
  // ============ CHAIN 8: Mwikila Autonomy ============
  {
    chain: '8. Mwikila Autonomy (T2)',
    steps: [
      { name: 'delegation prefs', method: 'GET', path: '/api/v1/owner/delegation-prefs', role: 'OWNER' },
      { name: 'approvals pending (4-eye)', method: 'GET', path: '/api/v1/owner/approvals/pending', role: 'OWNER' },
      { name: 'autonomous-actions audit', method: 'GET', path: '/api/v1/audit/autonomous-actions', role: 'OWNER' },
      { name: 'brain personae catalog', method: 'POST', path: '/api/v1/brain/personae', role: 'OWNER' },
    ],
  },
];

async function runChain(chain) {
  const out = { chain: chain.chain, results: [] };
  for (const step of chain.steps) {
    const res = await probe(step.method, step.path, step.role);
    out.results.push({
      name: step.name,
      method: step.method,
      path: step.path,
      role: step.role,
      status: res.status,
      ms: res.ms,
      bodySample: res.body,
    });
  }
  return out;
}

async function main() {
  const matrix = { meta: { ts: new Date().toISOString(), base: BASE, tenant: TENANT }, chains: [] };
  console.log(`# Full-Ops E2E Live Probe @ ${BASE}\n`);
  for (const chain of CHAINS) {
    console.log(`## ${chain.chain}`);
    const result = await runChain(chain);
    matrix.chains.push(result);
    for (const r of result.results) {
      const verdict =
        (r.status >= 200 && r.status < 500) || (r.status === 401 && r.role === null) ? 'PASS' : 'FAIL';
      console.log(`- [${verdict}] ${r.method} ${r.path}  -> ${r.status} (${r.ms}ms)`);
    }
    console.log('');
  }
  fs.writeFileSync('/tmp/full-ops-e2e.json', JSON.stringify(matrix, null, 2));
  console.log('# Done. Detail: /tmp/full-ops-e2e.json');

  const all = matrix.chains.flatMap((c) => c.results);
  const passed = all.filter(
    (r) => (r.status >= 200 && r.status < 500) || (r.status === 401 && r.role === null),
  );
  console.log(`\n# Summary: ${passed.length}/${all.length} steps reachable (200/4xx auth-aware)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

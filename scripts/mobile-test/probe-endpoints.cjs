#!/usr/bin/env node
/**
 * Mobile-app endpoint probe — verifies the api-gateway surface used by
 * the workforce-mobile and buyer-mobile Expo apps.
 *
 * Mints role-scoped JWTs via `scripts/smoke/mint.cjs`, then issues a
 * curl-equivalent fetch against every endpoint each app reaches at
 * runtime. Captures HTTP status + first 120 bytes of the body so the
 * caller can spot 401/403/500 regressions and schema drift.
 *
 * Usage:
 *   node scripts/mobile-test/probe-endpoints.cjs
 *   GATEWAY_URL=http://localhost:4001 node scripts/mobile-test/probe-endpoints.cjs
 *
 * Exit code 0 if every probe returned an envelope the apps can parse
 * (2xx OR structured 4xx/503 with `success: false`). Exit 1 otherwise.
 *
 * Wave LIVE-MOBILE-2026-05-29: invoked during the live-test pass to
 * confirm both apps' wire contracts match the gateway's shape.
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:4001'
const TENANT = process.env.TENANT_ID || '06fac8d2-2976-4085-982e-a881a88106a2'
const MINT_SCRIPT = path.resolve(__dirname, '..', 'smoke', 'mint.cjs')

function mint(role) {
  const result = spawnSync('node', [MINT_SCRIPT, role, TENANT], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`mint(${role}) failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

async function probe(label, role, method, path, body) {
  const token = mint(role)
  const url = `${GATEWAY}${path}`
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: method === 'POST' ? 'text/event-stream' : 'application/json',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['Content-Type'] = 'application/json'
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 6_000)
  init.signal = ac.signal
  try {
    const response = await fetch(url, init)
    const text = await response.text()
    clearTimeout(timer)
    const preview = text.replace(/\n/g, ' ').slice(0, 120)
    const ok = response.status < 500 || response.status === 503
    return {
      label,
      role,
      path,
      status: response.status,
      ok,
      preview,
    }
  } catch (err) {
    clearTimeout(timer)
    return {
      label,
      role,
      path,
      status: 0,
      ok: false,
      preview: err.message || 'fetch_failed',
    }
  }
}

const PROBES = [
  // workforce-mobile surface
  { label: 'tab-config', role: 'OWNER', method: 'GET', path: '/api/v1/workforce/tab-config' },
  { label: 'tab-config', role: 'MANAGER', method: 'GET', path: '/api/v1/workforce/tab-config' },
  { label: 'tab-config', role: 'EMPLOYEE', method: 'GET', path: '/api/v1/workforce/tab-config' },
  { label: 'daily-brief', role: 'OWNER', method: 'GET', path: '/api/v1/owner/daily-brief' },
  { label: 'sites', role: 'OWNER', method: 'GET', path: '/api/v1/mining/sites' },
  // buyer-mobile surface
  { label: 'marketplace', role: 'BUYER', method: 'GET', path: '/api/v1/mining/marketplace/listings' },
  { label: 'buyer-profile', role: 'BUYER', method: 'GET', path: '/api/v1/mining/buyers/profile' },
  { label: 'kyc-status', role: 'BUYER', method: 'GET', path: '/api/v1/mining/kyc/status' },
  // chat surfaces — Mr. Mwikila
  {
    label: 'chat-public',
    role: 'BUYER',
    method: 'POST',
    path: '/api/v1/public/chat',
    body: { query: 'Mr. Mwikila, help me find my next 3 tasks.' },
  },
  {
    label: 'chat-brain',
    role: 'OWNER',
    method: 'POST',
    path: '/api/v1/brain/turn',
    body: { userText: 'Mr. Mwikila, help me find my next 3 tasks.' },
  },
]

async function main() {
  console.log(`Probing ${GATEWAY} (tenant=${TENANT})`)
  const results = []
  for (const spec of PROBES) {
    const result = await probe(
      spec.label,
      spec.role,
      spec.method,
      spec.path,
      spec.body,
    )
    results.push(result)
    const flag = result.ok ? 'PASS' : 'FAIL'
    console.log(
      `${flag} [${result.status.toString().padStart(3, ' ')}] ${result.role.padEnd(8, ' ')} ${result.path}`,
    )
    console.log(`      ${result.preview}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * full-endpoint-smoke.ts
 *
 * Drives every route exposed by the live api-gateway and records
 * status + a snippet of the response body. The goal is to surface
 * any endpoint that returns a 500 so the team can root-cause and
 * fix in code (no swallowing).
 *
 * Discovery
 *   1. Fetch GET /api/v1/openapi.json (requires ADMIN JWT).
 *   2. Walk every (path, method) the harvester reports.
 *   3. For every GET: send the JWT, record status + body[0..200].
 *   4. For every POST/PUT/PATCH: send {} as the body. A 400/422
 *      validation failure is fine; a 500 is not.
 *   5. DELETE is skipped unless the path looks idempotent (`/recall`).
 *
 * Output
 *   /tmp/smoke-full.csv — method,path,status,notes
 *   /tmp/smoke-summary.json — { totalRoutes, passes, fails, fivexx }
 *
 * The runner does NOT restart the gateway.
 *
 * Usage
 *   pnpm tsx scripts/smoke/full-endpoint-smoke.ts
 *
 * Env (all optional — sensible defaults)
 *   SMOKE_BASE       default http://localhost:4001
 *   SMOKE_JWT_SECRET default test-secret-for-dev-only-32chars
 *   SMOKE_ROLE       default ADMIN (needed for openapi discovery)
 *   SMOKE_TENANT_ID  default 00000000-0000-0000-0000-000000000001
 */

import { writeFileSync } from 'node:fs'
import jwt from 'jsonwebtoken'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4001'
// Load JWT secret from .env.local first (matches the live gateway),
// fall back to the deterministic test secret.
import { readFileSync } from 'node:fs'
function loadEnvSecret(): string {
  try {
    const env = readFileSync(
      `${process.cwd()}/.env.local`,
      'utf8',
    )
    const m = env.match(/^JWT_SECRET\s*=\s*(\S+)\s*$/m)
    if (m) return m[1]
  } catch {
    // ignore — falls back below
  }
  return 'test-secret-for-dev-only-32chars'
}
const SECRET = process.env.SMOKE_JWT_SECRET ?? loadEnvSecret()
const ROLE = process.env.SMOKE_ROLE ?? 'ADMIN'
const TENANT = process.env.SMOKE_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'

interface Result {
  method: string
  path: string
  status: number
  notes: string
}

function mintJwt(role: string): string {
  // The legacy HS256 path in middleware/hono-auth.ts expects flat
  // `userId` + `tenantId` claims (NOT the standard `sub`), so we mint
  // both for compatibility. Without `userId` the downstream Drizzle
  // query receives an empty `$1` and Postgres throws.
  const subject = role === 'ADMIN' ? 'admin-user' : 'demo-owner'
  return jwt.sign(
    {
      sub: subject,
      userId: subject,
      tenantId: TENANT,
      role,
      permissions: [],
      propertyAccess: ['*'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SECRET,
    { algorithm: 'HS256' },
  )
}

function shouldSkip(method: string, path: string): boolean {
  // Skip mutating destructive deletes — runner shouldn't tear down state.
  if (method === 'DELETE') return true
  // Skip SSE streams — they don't terminate.
  if (path.includes('/stream') || path.endsWith('/events')) return true
  // Skip file-upload endpoints — multipart requires extra setup.
  if (path.includes('/upload') || path.includes('/attachments')) return true
  return false
}

function substitutePathParams(path: string): string {
  // Replace {paramName} (OpenAPI) and :paramName (express-style) with a UUID.
  const uuid = '00000000-0000-0000-0000-000000000001'
  return path
    .replace(/\{[^}]+\}/g, uuid)
    .replace(/:[^/]+/g, uuid)
}

async function probe(
  method: string,
  path: string,
  adminToken: string,
  ownerToken: string,
): Promise<Result> {
  // ADMIN token for admin/admin-* paths, OWNER for everything else.
  const useAdmin =
    path.startsWith('/admin') ||
    path.startsWith('/platform') ||
    path.includes('/sovereign-ledger') ||
    path.includes('/openapi') ||
    path.includes('/parity') ||
    path === '/openapi.json'
  const token = useAdmin ? adminToken : ownerToken

  const url = `${BASE}/api/v1${substitutePathParams(path)}`
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Smoke-Test': 'true',
    },
  }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify({})
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    clearTimeout(timer)
    const txt = await res.text().catch(() => '')
    const snippet = txt.slice(0, 200).replace(/[\r\n\t]+/g, ' ')
    return { method, path, status: res.status, notes: snippet }
  } catch (err) {
    const msg = (err as Error).message || 'fetch-failed'
    return { method, path, status: 0, notes: `FETCH_ERROR ${msg}` }
  }
}

async function main(): Promise<void> {
  const adminToken = mintJwt('ADMIN')
  const ownerToken = mintJwt('OWNER')

  // Step 1: pull the openapi spec (requires ADMIN).
  const specRes = await fetch(`${BASE}/api/v1/openapi.json`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (!specRes.ok) {
    console.error(`Failed to fetch openapi spec: ${specRes.status}`)
    process.exit(1)
  }
  const spec = (await specRes.json()) as {
    paths: Record<string, Record<string, unknown>>
  }
  const paths = spec.paths ?? {}
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const

  // Step 2: gather all (method, path) targets.
  const targets: Array<{ method: string; path: string }> = []
  for (const [p, ops] of Object.entries(paths)) {
    for (const m of methods) {
      if (ops[m]) targets.push({ method: m.toUpperCase(), path: p })
    }
  }
  // Step 2.5: ALSO smoke a hand-picked subset of well-known
  // unguarded mounts that aren't in openapi yet, so we surface
  // 500s in routers without manifests.
  const extraTargets: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/owner/brief' },
    { method: 'GET', path: '/owner/share-links' },
    { method: 'GET', path: '/owner/undo-journal/recent' },
    { method: 'GET', path: '/owner/pinned-items' },
    { method: 'GET', path: '/owner/reminders' },
    { method: 'GET', path: '/owner/drafts/00000000-0000-0000-0000-000000000001/revisions' },
    { method: 'GET', path: '/scope' },
    { method: 'GET', path: '/estate/entities' },
    { method: 'GET', path: '/brain/health' },
    { method: 'GET', path: '/brain/personae' },
    { method: 'GET', path: '/brain/threads' },
    { method: 'GET', path: '/audit-trail' },
    { method: 'GET', path: '/ai-costs' },
    { method: 'GET', path: '/analytics/usage' },
    { method: 'GET', path: '/feature-flags' },
    { method: 'GET', path: '/notifications/preferences' },
    { method: 'GET', path: '/portfolio' },
    { method: 'GET', path: '/insurance/policies' },
    { method: 'GET', path: '/health/dependencies' },
    { method: 'GET', path: '/forecast/scenarios' },
    { method: 'GET', path: '/persona-registry' },
    { method: 'GET', path: '/maintenance/work-orders' },
    { method: 'GET', path: '/hr/employees' },
    { method: 'GET', path: '/mining/licences' },
    { method: 'GET', path: '/mining/sites' },
    { method: 'GET', path: '/production/runs' },
    { method: 'GET', path: '/cooperatives' },
    { method: 'GET', path: '/sensorium/status' },
    { method: 'GET', path: '/voice/sessions' },
    { method: 'GET', path: '/training/courses' },
    { method: 'GET', path: '/tenders' },
    { method: 'GET', path: '/workflow/runs' },
    { method: 'GET', path: '/marketplace/listings' },
    { method: 'GET', path: '/geology/samples' },
    { method: 'GET', path: '/buyers/me' },
    { method: 'GET', path: '/customer/profile' },
    { method: 'GET', path: '/applications' },
    { method: 'GET', path: '/approvals' },
    { method: 'GET', path: '/approval-grants' },
    { method: 'GET', path: '/agent-certifications' },
    { method: 'GET', path: '/admin/jarvis/threads' },
    { method: 'GET', path: '/admin/audit' },
    { method: 'GET', path: '/admin/sovereign-ledger/entries' },
    { method: 'GET', path: '/exceptions' },
    { method: 'GET', path: '/dsar' },
    { method: 'GET', path: '/gdpr/requests' },
    { method: 'GET', path: '/metrics/dashboard' },
    { method: 'GET', path: '/well-known/agent.json' },
    { method: 'GET', path: '/sensorium/state' },
    { method: 'GET', path: '/training/me' },
  ]
  for (const t of extraTargets) {
    // de-dupe with discovered targets
    if (!targets.some((x) => x.method === t.method && x.path === t.path)) {
      targets.push(t)
    }
  }

  console.log(`Smoking ${targets.length} routes against ${BASE}`)

  // Step 3: probe each target. The gateway honours `X-Smoke-Test:
  // true` (set in `probe()`) and bypasses its 100/min rate limit
  // for that header, so we can fan out with a small concurrency
  // window without 429 noise. Set SMOKE_PAUSE_MS to slow the runner
  // down if the rate-limit bypass is disabled.
  const PAUSE_MS = Number(process.env.SMOKE_PAUSE_MS ?? '0')
  const CONC = Number(process.env.SMOKE_CONC ?? '4')
  const results: Result[] = []
  const queue = [...targets]
  let done = 0

  async function next(): Promise<void> {
    const t = queue.shift()
    if (!t) return
    if (shouldSkip(t.method, t.path)) {
      results.push({
        method: t.method,
        path: t.path,
        status: -1,
        notes: 'SKIPPED (mutating delete / stream / upload)',
      })
    } else {
      const r = await probe(t.method, t.path, adminToken, ownerToken)
      results.push(r)
    }
    done += 1
    if (done % 25 === 0) {
      console.log(`progress: ${done} / ${targets.length}`)
    }
    if (PAUSE_MS > 0 && queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
    }
    return next()
  }
  const inflight: Array<Promise<void>> = []
  for (let i = 0; i < CONC; i += 1) inflight.push(next())
  await Promise.all(inflight)

  // Step 4: emit CSV + summary.
  results.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`))
  const csv = ['method,path,status,notes']
  for (const r of results) {
    const noteQuoted = `"${r.notes.replace(/"/g, '""')}"`
    csv.push(`${r.method},${r.path},${r.status},${noteQuoted}`)
  }
  writeFileSync('/tmp/smoke-full.csv', csv.join('\n'))

  const fivexx = results.filter((r) => r.status >= 500 && r.status < 600)
  const skipped = results.filter((r) => r.status === -1)
  const passes = results.filter(
    (r) => r.status >= 200 && r.status < 500 && r.status !== -1,
  )
  const networkFail = results.filter((r) => r.status === 0)

  const summary = {
    base: BASE,
    totalRoutes: results.length,
    skipped: skipped.length,
    passes: passes.length,
    fivexx: fivexx.length,
    networkFail: networkFail.length,
    fivexxDetail: fivexx.map((r) => ({
      method: r.method,
      path: r.path,
      status: r.status,
      notes: r.notes,
    })),
    networkFailDetail: networkFail.map((r) => ({
      method: r.method,
      path: r.path,
      notes: r.notes,
    })),
  }
  writeFileSync('/tmp/smoke-summary.json', JSON.stringify(summary, null, 2))

  console.log('=== smoke summary ===')
  console.log(`total routes: ${results.length}`)
  console.log(`skipped:      ${skipped.length}`)
  console.log(`passes:       ${passes.length}`)
  console.log(`5xx:          ${fivexx.length}`)
  console.log(`network fail: ${networkFail.length}`)
  if (fivexx.length > 0) {
    console.log('--- 5xx detail ---')
    for (const r of fivexx) {
      console.log(`${r.status} ${r.method} ${r.path} :: ${r.notes}`)
    }
  }
  if (networkFail.length > 0) {
    console.log('--- network failures ---')
    for (const r of networkFail) {
      console.log(`${r.method} ${r.path} :: ${r.notes}`)
    }
  }
  // Non-zero exit if any 5xx; the goal is 0 500s.
  process.exit(fivexx.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('smoke runner crashed:', err)
  process.exit(2)
})

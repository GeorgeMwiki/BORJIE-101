/**
 * Zod-coverage allow-list.
 *
 * Mutating route handlers (POST/PUT/PATCH/DELETE) that legitimately
 * skip Zod / schema validation. Each entry MUST justify why.
 *
 * Legitimate categories:
 *   1. The handler takes NO body — it's a pure action trigger keyed by
 *      a path param (e.g. POST /things/[id]/lock).
 *   2. The body is passthrough proxied; upstream service validates.
 *   3. Validation is delegated to a service-layer schema (the route
 *      file is a thin orchestrator).
 *
 * TRACKED GAPS: 14 mutating routes flagged by the 2026-05-18 scanner
 * pass. Each PENDING entry should be removed when the route adds a Zod
 * schema + .safeParse() guard. This list is the concrete worklist for
 * incremental Zod-coverage remediation (see #33).
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const ZOD_ALLOWLIST = new Map([
  // ─── Streaming/SSE proxy passthroughs ──────────────────────────────
  [
    'apps/admin-platform-portal/src/app/api/platform/intelligence/thread/[threadId]/message/route.ts',
    'SSE proxy — body forwarded as-is to gateway; upstream validates.',
  ],

  // ─── TRACKED GAPS: mutating routes without Zod validation ──────────
  [
    'services/api-gateway/src/routes/bff/estate-manager-app.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/bff/owner-portal.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/dsar.router.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/mcp.router.ts',
    'JSON-RPC envelope — validated inside BossnyumbaMcpServer.dispatch; route file is thin proxy.',
  ],
  [
    'services/api-gateway/src/routes/messaging.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/risk-reports.router.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/scheduling.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/tenants.hono.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/training.router.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/unit-subdivision.router.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/users.hono.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'services/api-gateway/src/routes/webhook-dlq.router.ts',
    'PENDING: add Zod schema; tracked gap from universal scanner pass.',
  ],
  [
    'apps/customer-app/src/app/api/brain/turn/route.ts',
    'manual type-narrowing on req.json() with explicit guards; pending migration to Zod.',
  ],
  [
    'apps/estate-manager-app/src/app/api/brain/turn/route.ts',
    'manual type-narrowing on req.json() with explicit guards; pending migration to Zod.',
  ],
  [
    'apps/admin-platform-portal/src/app/api/platform/login/route.ts',
    'login proxy — credentials forwarded to identity service which validates.',
  ],
]);

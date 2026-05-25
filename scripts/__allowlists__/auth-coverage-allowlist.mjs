/**
 * Auth-coverage allow-list.
 *
 * Routes / route files listed here are exempted from the mandatory
 * auth-signal requirement enforced by
 * `scripts/audit-auth-coverage.mjs`. Each entry MUST justify why
 * unauthenticated access is the correct contract.
 *
 * Categories of legitimate exemption:
 *   1. Public health probes / status endpoints (must be unauthenticated
 *      for load balancers and uptime monitors).
 *   2. Anonymous marketing surfaces (waitlist sign-up, public landing
 *      data) — already throttled at the gateway via a public limiter.
 *   3. Webhook intake routes whose authentication is the upstream
 *      signature verification.
 *   4. Pre-auth gates (the route IS the auth flow — login, register,
 *      OTP, password reset).
 *   5. Streaming/SSE proxy passthroughs that forward Authorization
 *      headers to an authenticated upstream service.
 *   6. Internal observability endpoints mounted at the gateway with
 *      admin-only authentication applied at the composition root.
 *
 * Adding an entry is a security decision. Reviewers MUST verify the
 * reason describes a real architectural exemption — never a deferred
 * task. Deferred tasks belong in Docs/TODO_BACKLOG.md.
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const AUTH_ALLOWLIST = new Map([
  // ─── Anonymous marketing / public surfaces ─────────────────────────
  [
    'services/api-gateway/src/routes/public-marketing.router.ts',
    'public marketing leads + waitlist. No tenant ctx; throttled at gateway via public-ai-rate-limit.',
  ],
  [
    'services/api-gateway/src/routes/public-sandbox.router.ts',
    'anonymous demo sandbox — synthetic data only, no real tenants reachable.',
  ],
  [
    'services/api-gateway/src/routes/waitlist.router.ts',
    'public waitlist email capture; captcha + classification-scrubber upstream.',
  ],
  [
    'services/api-gateway/src/routes/public-leads.router.ts',
    'post-chat marketing lead capture — anonymous by design; idempotent by session_id.',
  ],

  // ─── MCP / Agent Card discovery (public manifest) ──────────────────
  [
    'services/api-gateway/src/routes/mcp.router.ts',
    'MCP JSON-RPC entrypoint — auth applied inside the BossnyumbaMcpServer per tools/call; manifest + agent.json are public discovery.',
  ],

  // ─── Internal observability (composition-root admin gate) ──────────
  [
    'services/api-gateway/src/routes/metrics.router.ts',
    'admin-only metrics snapshot — composition root applies admin role gate before mounting.',
  ],

  // ─── Streaming proxies (forward Authorization upstream) ────────────
  [
    'apps/admin-platform-portal/src/app/api/platform/intelligence/thread/[threadId]/message/route.ts',
    'SSE proxy — forwards Authorization + cookie headers to gateway; upstream validates.',
  ],
  [
    'apps/admin-platform-portal/src/app/api/platform/login/route.ts',
    'platform login — IS the auth gate. Sets session cookie on success.',
  ],

  // ─── Public health probes (must be unauthenticated for LB) ─────────
  [
    'apps/admin-platform-portal/src/app/api/platform/health/route.ts',
    'health probe — k8s liveness / uptime monitors require unauthenticated access.',
  ],
  [
    'apps/estate-manager-app/src/app/api/brain/health/route.ts',
    'health probe for the brain proxy; unauthenticated readiness.',
  ],

  // ─── Internal middleware-export file flagged as a route ────────────
  [
    'services/api-gateway/src/routes/hono-auth.ts',
    'middleware re-export — exposes a .get() route on the authMiddleware factory for diagnostic ping; gated by JWT check inside.',
  ],

  // ─── Document-intelligence service routes (gateway-mounted) ────────
  // The document-intelligence service is reached via the api-gateway,
  // which applies authMiddleware before forwarding. The handler file
  // itself does not import authMiddleware (it trusts the upstream),
  // but the routes are NOT publicly reachable.
  [
    'services/document-intelligence/src/routes/documents.routes.ts',
    'service is private — only reachable via api-gateway, which applies authMiddleware before proxying.',
  ],

  // ─── Scanner false positives — Map.get/.delete on internal stores ──
  // The auth-coverage scanner matches `<ident>.get|post|delete(` to
  // catch Hono / Express route handlers. The files below register NO
  // HTTP routes — the matches are calls into JavaScript Map data
  // structures used by in-process middleware bookkeeping.
  [
    'services/api-gateway/src/routes/ask/ask-rate-limit.ts',
    'middleware factory — Map.delete/.get on token-bucket store; not an HTTP route.',
  ],
  [
    'services/api-gateway/src/routes/reports/reports-rate-limit.ts',
    'middleware factory — Map.delete/.get on token-bucket store; not an HTTP route.',
  ],
  [
    'services/api-gateway/src/routes/marketplace/in-memory-data-port.ts',
    'in-process data port helper — Map.get for org-membership lookup; not an HTTP route.',
  ],

  // ─── Public health probes (must be unauthenticated for LB) ─────────
  [
    'services/onboarding-orchestrator/src/routes/readyz.ts',
    'k8s readiness probe — LB + uptime monitors require unauthenticated access; checks DB SELECT 1 only.',
  ],
  [
    'services/outcomes-metering/src/routes/readyz.ts',
    'k8s readiness probe — LB + uptime monitors require unauthenticated access; checks DB SELECT 1 only.',
  ],
]);

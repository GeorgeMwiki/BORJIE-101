/**
 * SSRF-coverage allow-list.
 *
 * Files in this map have outbound `fetch()` / `axios` / `https.request`
 * call sites that bypass `safeHttpFetch` (the central SSRF guard at
 * `packages/enterprise-hardening/src/http/safe-http-fetch.ts`). Each
 * entry MUST justify why the bypass is safe.
 *
 * Legitimate categories:
 *   1. URL is a compile-time constant pointing at a vendor API the
 *      product depends on (e.g. https://api.anthropic.com/v1/messages).
 *      No tenant input can influence the host, so an SSRF guard is
 *      redundant.
 *   2. Same-origin client-side fetches (browser same-origin policy +
 *      CORS already prevent SSRF).
 *   3. Env-pinned internal hosts (REDIS_URL, OTLP_ENDPOINT) — the
 *      deploy controls the host; tenant code cannot influence it.
 *   4. Load-testing / health-probe scripts that ping known endpoints
 *      and don't run in tenant-handling code paths.
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const SSRF_ALLOWLIST = new Map([
  // ─── Vendor LLM clients (compile-time hosts) ───────────────────────
  [
    'packages/ai-copilot/src/providers/anthropic.ts',
    'compile-time api.anthropic.com — host is not tenant-influenced.',
  ],
  [
    'packages/ai-copilot/src/providers/openai.ts',
    'compile-time api.openai.com — host is not tenant-influenced.',
  ],
  [
    'packages/ai-copilot/src/providers/deepseek.ts',
    'compile-time api.deepseek.com — host is not tenant-influenced.',
  ],
  [
    'packages/ai-copilot/src/providers/ai-provider.ts',
    'shared provider plumbing — wraps anthropic/openai/deepseek clients (compile-time hosts).',
  ],
  [
    'packages/ai-copilot/src/voice/elevenlabs-provider.ts',
    'compile-time api.elevenlabs.io — voice TTS vendor.',
  ],
  [
    'packages/ai-copilot/src/voice/openai-voice-provider.ts',
    'compile-time api.openai.com voice endpoint.',
  ],

  // ─── Payment provider integrations (env-pinned vendor hosts) ───────
  [
    'services/payments/src/providers/mpesa/auth.ts',
    'env-pinned Safaricom Daraja auth endpoint — vendor-controlled host.',
  ],
  [
    'services/payments/src/providers/mpesa/b2c.ts',
    'env-pinned Safaricom Daraja B2C endpoint — vendor-controlled host.',
  ],
  [
    'services/payments/src/providers/mpesa/query.ts',
    'env-pinned Safaricom Daraja query endpoint — vendor-controlled host.',
  ],
  [
    'services/payments/src/providers/mpesa/stk-push.ts',
    'env-pinned Safaricom Daraja STK-push endpoint — vendor-controlled host.',
  ],
  [
    'services/payments/src/providers/airtel-money/payment.ts',
    'env-pinned Airtel Money API base — vendor-controlled host.',
  ],
  [
    'services/payments/src/providers/clickpesa/clickpesa-provider.ts',
    'env-pinned ClickPesa API base — vendor-controlled host.',
  ],
  [
    'services/payments/src/providers/gepg/gepg-client.ts',
    'env-pinned GePG (Govt Electronic Payment Gateway TZ) endpoint — regulator-controlled host.',
  ],
  [
    'services/payments/src/providers/tigopesa/payment.ts',
    'env-pinned Tigo Pesa API base — vendor-controlled host.',
  ],
  [
    'services/payments-ledger/src/providers/mpesa-provider.ts',
    'env-pinned Safaricom Daraja endpoints — vendor-controlled host.',
  ],

  // ─── Notification / WhatsApp providers ─────────────────────────────
  [
    'services/notifications/src/whatsapp/meta-client.ts',
    'env-pinned graph.facebook.com — Meta Cloud API host.',
  ],

  // ─── Webhook delivery (has its own SSRF guard via tests) ───────────
  [
    'services/webhooks/src/delivery.ts',
    'webhook delivery has its own SSRF guard tested in webhook-delivery-ssrf.test.ts.',
  ],

  // ─── Internal MCP composition (sidecar dial) ───────────────────────
  [
    'services/api-gateway/src/composition/mcp-client-process-intel.ts',
    'internal sidecar dial — pm4py MCP server reached over compose network only.',
  ],

  // ─── Health probes (env-pinned internal services) ──────────────────
  [
    'services/api-gateway/src/health/deep-health.ts',
    'k8s deep-health probe — dials env-pinned internal service URLs (Redis, Postgres, MCP) only.',
  ],
  [
    'services/api-gateway/src/index.ts',
    'gateway bootstrap — health-check on env-pinned upstream hosts at startup.',
  ],

  // ─── Load testing harness (not in tenant code path) ────────────────
  [
    'services/api-gateway/scripts/load-test.ts',
    'load-test script — not in tenant code path; targets are deploy-pinned.',
  ],

  // ─── Domain-services internal calls (env-pinned partner APIs) ──────
  [
    'services/domain-services/src/customer/financial-profile-service.ts',
    'env-pinned credit-bureau partner API — host is deploy-controlled.',
  ],

  // ─── Reports HTML generator (CDN asset fetch, env-pinned) ──────────
  [
    'services/reports/src/generators/interactive-html-generator.ts',
    'env-pinned CDN URLs for Chart.js + Tailwind embed in report HTML.',
  ],

  // ─── Statement generation (env-pinned PDF generator) ───────────────
  [
    'services/payments-ledger/src/services/statement-generation.service.ts',
    'env-pinned PDF-generation service — host is deploy-controlled.',
  ],

  // ─── API client (browser-side, same-origin assumed) ────────────────
  [
    'packages/api-client/src/client.ts',
    'API client wraps fetch for browser-side same-origin calls + SSR proxy.',
  ],
  [
    'packages/api-client/src/hooks/useMigration.ts',
    'browser-side hook — same-origin /api calls only.',
  ],
  [
    'packages/chat-ui/src/hooks/useChatStream.ts',
    'browser-side hook — same-origin /api/v1 SSE streaming.',
  ],

  // ─── Kernel grounding / orchestrator (env-pinned LLM router) ───────
  [
    'packages/central-intelligence/src/kernel/kernel-types.ts',
    'type-only file with example fetch signature in a JSDoc-illustration stub.',
  ],
  [
    'packages/database/src/services/kernel-grounding.service.ts',
    'env-pinned grounding sidecar URL — deploy-controlled host.',
  ],

  // ─── Enterprise hardening (n8n / camunda integrations) ─────────────
  [
    'packages/enterprise-hardening/src/enterprise/custom-workflows.ts',
    'env-pinned n8n / camunda workflow engine endpoint — tenant-configurable URL passes through allowlistedHosts check inside.',
  ],
  [
    'packages/enterprise-hardening/src/enterprise/webhooks.ts',
    'enterprise webhook dispatcher — runs URL through `validateWebhookUrl` host-allowlist check before fetch (defence in depth covers SSRF).',
  ],
  [
    'packages/enterprise-hardening/src/resilience/health-check.ts',
    'env-pinned internal health-probe targets — caller passes a deploy-controlled URL list.',
  ],
  [
    'packages/genui/src/components/PrefillForm.tsx',
    'browser-side React component — same-origin /api fetch only (server-emitted endpoint path).',
  ],

  // ─── Vendor-pinned compile-time hosts (api-gateway composition) ────
  [
    'services/api-gateway/src/auth/supabase/supabase-auth-routes.ts',
    'Supabase auth endpoints — host is `NEXT_PUBLIC_SUPABASE_URL` (deploy-pinned vendor URL); same vendor model as packages/ai-copilot/src/providers/anthropic.ts.',
  ],
  [
    'services/api-gateway/src/composition/executive-brief.composition.ts',
    'compile-time api.anthropic.com — Haiku 3.5 fallback wiring; host is not tenant-influenced.',
  ],

  // ─── Verra registry client (compile-time vendor host) ──────────────
  [
    'packages/carbon-market/src/verra/client.ts',
    'compile-time registry.verra.org/uiapi — VCS carbon-credit registry; URL built from VERRA_REGISTRY_BASE_URL constant + path.',
  ],

  // ─── Scanner false positives — function signatures, not fetch() ────
  // The audit-ssrf-coverage scanner matches `(?:^|[^.\w])fetch\(`
  // call sites. The files below define INTERFACE signatures whose
  // first parameter happens to be named `fetch(arg)` or follow that
  // shape, OR contain string-only example URLs inside throw messages
  // that the regex picks up as call sites.
  [
    'packages/analytics/src/dashboards/compose.ts',
    'false positive — type-only import of CompiledQuery; no outbound HTTP in this file.',
  ],
  [
    'packages/openclaw-operating-model/src/context-architecture/context.ts',
    'false positive — `fetch(args: {...})` is a pure function signature on a context-builder helper; no outbound HTTP.',
  ],
  [
    'packages/probe-runners/src/defection-runner.ts',
    'false positive — `fetch(caseInput, auditMode)` is the AuditedBrainFetcher interface method signature; no outbound HTTP.',
  ],
  [
    'packages/probe-runners/src/sycophancy-runner.ts',
    'false positive — `fetch(caseInput)` is the SycophancyBrainFetcher interface method signature; no outbound HTTP.',
  ],
  [
    'packages/timezone-detection/src/detect/detect-from-ip.ts',
    'reference stub — `fetch("https://ipapi.co/...")` and `fetch("https://api.ipgeolocation.io/...")` live inside throw-message strings of `createIpapiAdapterStub()` + `createIpgeolocationAdapterStub()` instructing operators what to wire at composition time; no runtime fetch executed.',
  ],
]);

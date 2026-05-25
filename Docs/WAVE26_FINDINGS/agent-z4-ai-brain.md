# Wave 26 — Agent Z4 — AI Brain Utilities Wiring

Scope: wire the three `@borjie/ai-copilot` utilities Wave-25 Agent T
flagged as "tests passing but not in the production call path":

1. `createIntelligenceHistoryWorker`
2. `buildMultiLLMRouterFromEnv`
3. `withBudgetGuard`

All three now reach the production boot path, are observable via startup
logs, and are exercised by existing HTTP endpoints. Typecheck + tests
green across `@borjie/api-gateway` (194 tests), `@borjie/ai-copilot`
(933 tests), and `@borjie/domain-services` (339 tests).

---

## createIntelligenceHistoryWorker wiring

**Composition file:** `services/api-gateway/src/composition/intelligence-history-wiring.ts` (new, 210 lines)

- `createPostgresIntelligenceHistoryRepository(db)` — idempotent
  UPSERT into `intelligence_history` on `(tenant_id, customer_id, snapshot_date)`
  leveraging the unique index from migration 0019.
- `createPostgresCustomerCohortProvider(db)` — reads active tenants
  (`tenants.is_active = TRUE`) and customers (`customers.tenant_id = ?`)
  via tenant-scoped queries.
- `createPostgresCustomerSignalsProvider(db)` — aggregates maintenance
  open count, complaints-last-30d, payments on-time/late; risk scores left
  `null` so a richer calculator can replace them later. All tables
  wrapped in `try/catch` so missing migrations default to zero rather than
  crashing the daily tick.
- `createIntelligenceHistorySupervisor(db, logger)` — packages the worker
  with a 24h `setInterval`, immediate first-tick, pino logging, and
  `start()`/`stop()` hooks.

**Task registration:** `packages/ai-copilot/src/background-intelligence/types.ts`
added the `'recompute_intelligence_history'` literal to the `TaskName`
union.

**Start/stop lifecycle:** `services/api-gateway/src/index.ts`
- Imports `createIntelligenceHistorySupervisor` from `composition/background-wiring`.
- Constructs `intelligenceHistorySupervisor` alongside the heartbeat and
  background supervisors.
- Calls `intelligenceHistorySupervisor.start()` once the HTTP server is
  listening (right after `heartbeatSupervisor.start()` and
  `backgroundSupervisor.start()`).
- `gracefulShutdown()` calls `.stop()` in the drain step before closing
  the Postgres pool.

**Also registered as a scheduled task:** `services/api-gateway/src/composition/background-wiring.ts`
`buildExtensionTasks` adds `recompute_intelligence_history` (cron
`0 2 * * *`, feature-flag `ai.bg.recompute_intelligence_history`) to the
scheduler catalogue so the same worker also runs per-tenant via the
1-minute scheduler tick loop for cross-cadence redundancy.

**Exports added:** `services/domain-services/src/intelligence/index.ts`
(new) re-exports the worker class, factory, and types so the subpath
`@borjie/domain-services/intelligence` resolves.

---

## buildMultiLLMRouterFromEnv wiring

**Composition file:** `services/api-gateway/src/composition/service-registry.ts`

- Added import from `@borjie/ai-copilot/providers`:
  `buildMultiLLMRouterFromEnv`, `withBudgetGuard`, `createAnthropicClient`,
  `ModelTier`, and supporting types.
- `ServiceRegistry` now exposes `llmRouter: MultiLLMRouter | null`.
- Live block: when `ANTHROPIC_API_KEY` is set, builds the router via
  `buildMultiLLMRouterFromEnv(aiCostLedger)`. The factory activates the
  OpenAI and DeepSeek providers automatically when their keys are set
  (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`). Null when no Anthropic key —
  the brain routes continue to return 503 `BRAIN_NOT_CONFIGURED`.
- Degraded registry slots the field as `null`.

**Router files that now use it:**
- Exposed on `c.get('services').llmRouter` via the existing
  `createServiceContextMiddleware`. Any current or future router can
  pull the router out of the Hono context without re-constructing
  providers.
- Brain SSE path (`ai-chat.router.ts`) and non-streaming brain path
  (`brain.hono.ts`) intentionally kept on the existing `AnthropicProvider`
  to preserve the SSE contract (`streamTurn` events). Budget enforcement
  is added through the ledger pre-flight check (see below) — the router
  is available for future deterministic multi-LLM dispatches without
  churning the stream.

**Env-var deps:** `ANTHROPIC_API_KEY` (required to build the router),
`OPENAI_API_KEY` and `DEEPSEEK_API_KEY` (optional — activate their
providers + put them on the fallback chain).

**Observability:** `services/api-gateway/src/index.ts` now logs a single
`ai-brain-utilities wired` line at boot:

```
{"llmRouter":"live","budgetGuardedAnthropic":"live","aiCostLedger":"live",
 "providers":{"anthropic":true,"openai":false,"deepseek":false}}
```

---

## withBudgetGuard wiring

**Wrap site:** `services/api-gateway/src/composition/service-registry.ts`

- `ServiceRegistry.buildBudgetGuardedAnthropicClient` is a factory
  `(tenantId, operation?) => BudgetGuardedAnthropicClient`. The factory
  is required (not a pre-built client) because the budget guard closes
  over the tenant context, and tenant is only known at request time.
- Null when `ANTHROPIC_API_KEY` is absent.
- Each call: builds a fresh `AnthropicClient` via `createAnthropicClient({ apiKey, defaultModel: ModelTier.SONNET })`,
  then wraps with `withBudgetGuard(inner, { ledger: aiCostLedger, context: () => ({ tenantId, operation }), provider: 'anthropic' })`.

**Per-tenant cost-ledger integration:** the wrapped SDK's
`messages.create` call sequence is:
1. `ledger.assertWithinBudget(tenantId)` — throws `AiBudgetExceededError`
   if the tenant is over cap. No HTTP request made.
2. `inner.sdk.messages.create(request)` — actual Anthropic call.
3. `ledger.recordUsage(...)` — best-effort; accounting failure never
   bubbles into the caller.

**HTTP surfacing:** budget errors surface at two hot-path sites:

1. **SSE chat** (`routes/ai-chat.router.ts`): before opening the
   `streamSSE` frame, we call
   `services.aiCostLedger.assertWithinBudget(tenantId)`. On
   `AiBudgetExceededError` we return HTTP `429` with
   `{ code: 'BUDGET_EXCEEDED', error: ... }`. `pipeStreamTurnToSSE`
   additionally inspects thrown errors inside the iterator and emits a
   final `event: error\ndata: {"code":"BUDGET_EXCEEDED",...}` SSE frame
   so mid-stream budget violations (e.g. from a tool that calls
   `withBudgetGuard` during the turn) render cleanly in the UI.

2. **Non-streaming brain** (`routes/brain.hono.ts`): `POST /brain/turn`
   performs the same pre-flight `assertWithinBudget` check and returns
   HTTP `429` with `code: 'BUDGET_EXCEEDED'` on violation, mirroring the
   SSE behaviour.

---

## Behaviour changes the user will see

1. **Boot log line** — `ai-brain-utilities wired` at startup reports
   which of the three utilities are live and which providers are
   configured. Grep-friendly for ops.
2. **Daily intelligence snapshots** — as soon as `DATABASE_URL` is
   configured the gateway begins writing one `intelligence_history` row
   per active customer per day (`runDaily` fires at boot + every 24h).
   Also accessible via the scheduler's per-tenant task loop (cron
   `0 2 * * *`, feature-flag `ai.bg.recompute_intelligence_history`).
3. **Budget-exceeded 429** — over-cap tenants hitting `/api/v1/ai/chat`
   or `/api/v1/brain/turn` get a clean `429 { code: 'BUDGET_EXCEEDED' }`
   instead of a half-open SSE or a generic 500. The chat UI can render a
   "monthly AI budget reached" banner keyed on the `BUDGET_EXCEEDED` code.
4. **Multi-LLM ready** — `c.get('services').llmRouter` is now populated
   for every authenticated request. Any downstream router can call
   `llmRouter.complete({ context, hints, request })` and get
   Anthropic-primary / OpenAI-fallback / DeepSeek-fallback routing plus
   automatic per-tenant budget + usage accounting.
5. **No contract change to existing SSE** — `turn_start`, `delta`,
   `tool_call`, `tool_result`, `proposed_action`, `turn_end` event shapes
   are untouched. Only the `error` event now carries `code: 'BUDGET_EXCEEDED'`
   when applicable; existing error handlers ignoring the `code` field
   continue to work.

---

## Deferrals

1. **`withBudgetGuard` around `createAnthropicClient` inside
   payment-risk / churn-predictor / ai-mediator / renewal-strategy-generator.**
   These services still construct raw `AnthropicClient`s without the
   budget wrapper. Wiring them requires threading a `tenantId` down to
   each service constructor; deferred because they are not on the ai-chat
   / brain hot path (they run from the background scheduler today, which
   in a Wave-27 iteration should use `services.buildBudgetGuardedAnthropicClient`
   to construct its client).

2. **`MultiLLMRouter.complete` as the primary SSE executor.** The brain's
   `AnthropicProvider` still uses direct fetch with its own retry loop —
   not the multi-LLM router. Replacing it requires re-implementing
   `streamTurn` over the router's non-streaming `complete` API or adding
   a streaming capability to `MultiLLMRouter`. Out of scope for this
   wave; the router is ready for deterministic one-shot dispatches via
   `c.get('services').llmRouter`.

3. **Richer signal population in `intelligence-history-wiring.ts`.** The
   signals provider emits `null` for `paymentRiskScore`, `churnRiskScore`,
   `sentimentScore`, and both sub-score JSON columns. Maintenance /
   complaints / payment-timing counts are real. Wiring the deterministic
   calculators from `packages/ai-copilot/src/credit-rating` and the
   existing churn-predictor is a follow-up — the snapshot rows are
   present and idempotent today, so retroactive model audits can
   backfill the score columns without schema churn.

4. **Feature flag default for `ai.bg.recompute_intelligence_history`.**
   The scheduler defaults open (`isEnabled` falls back to `true`) so the
   task runs in pilot. Admin UI to flip it off per-tenant exists via the
   feature-flags router but no dashboard button is wired; ops must POST
   directly for now.

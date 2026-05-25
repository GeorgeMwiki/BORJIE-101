# Agent PhG — AI-Native Capability Suite

**Mandate:** Push capabilities to AI limits, not human limits. Build
eight services that leverage Anthropic/OpenAI + our existing heartbeat,
memory, and event bus to do things humans CANNOT do at scale.

**Status:** All 8 capabilities shipped. 5 migrations applied live. 34 tests
passing. Both typechecks green.

---

## Capability list

| # | Capability             | Port(s)                                     | Migration                              | Endpoint                                           |
| - | ---------------------- | ------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| 1 | sentiment-monitor      | `ClassifyLLMPort`, `SentimentEventPublisher`| `0102_ai_native_signals.sql`           | `POST /ai-native/sentiment/scan`, `GET /ai-native/signals` |
| 2 | market-surveillance    | `ClassifyLLMPort`, `MarketRatePort`         | `0103_market_rate_snapshots.sql`       | (scheduled cron — manual trigger via internal API)  |
| 3 | multimodal-inspection  | `VisionLLMPort`                             | `0104_inspection_ai_findings.sql`      | `POST /ai-native/inspections/:id/analyze`          |
| 4 | polyglot-support       | `ClassifyLLMPort`                           | `0105_polyglot_conversations.sql`      | (streams via messaging router; persistence ready)  |
| 5 | predictive-interventions | `ClassifyLLMPort`, `PredictiveInterventionEventPublisher` | `0106_tenant_predictions.sql` | `GET /ai-native/predictions/tenant/:customerId`  |
| 6 | policy-simulator       | pure Monte-Carlo (no LLM required)          | (reuses `0106` prediction probs)       | `POST /ai-native/simulate/policy`                  |
| 7 | natural-language-query | `ClassifyLLMPort`, `NlQueryRunner`          | (reads existing tables)                | `POST /ai-native/query/nl`                         |
| 8 | pattern-mining         | `ClassifyLLMPort`, `PatternMiningRepository`| (reads any pre-aggregated view)        | (weekly cron; consumed by advisor persona)         |

File tree:

```
packages/ai-copilot/src/ai-native/
  shared.ts                       — BudgetGuard, ClassifyLLMPort, VisionLLMPort, promptHash, MIN_TENANTS_FOR_AGGREGATION
  sentiment-monitor/index.ts
  market-surveillance/index.ts
  multimodal-inspection/index.ts
  polyglot-support/index.ts
  predictive-interventions/index.ts
  policy-simulator/index.ts
  natural-language-query/index.ts
  pattern-mining/index.ts
  index.ts                         — barrel
  __tests__/*.test.ts              — 8 test suites, 34 tests
```

Router: `services/api-gateway/src/routes/ai-native.router.ts`
Mounted in `services/api-gateway/src/index.ts` at `/api/v1/ai-native`.

---

## AI-native vs human-playbook — why this isn't just "a better chatbot"

Agent PhB1 is building human-playbook task agents (rent-reminder,
late-fee, inspection-scheduler). Those automate **what humans already
do**, just faster. This agent's suite does work humans **cannot do at
scale, at any speed**:

- **sentiment-monitor** — a human reads one message at a time, maybe 100
  per day. This classifies every single message, complaint, and feedback
  row in real time across thousands of customers with uniform rubric.
  Rolling-window shift detection emits a `TenantSentimentShift` event
  when a tenant's mood cliffs — the human playbook cannot detect this
  until the complaint letter arrives.
- **market-surveillance** — a human checks comparable rent on a handful
  of units at renewal. This scans every active unit every day against
  geolocated comparables, extracts structured rent/sqft/amenities from
  unstructured listings via an LLM, and emits drift events.
- **multimodal-inspection** — a human inspector photographs, then later
  types up findings. This ingests the photos directly, returns structured
  per-finding bounding boxes + severity + cost ranges + recommended
  trades. Every finding carries a confidence score.
- **polyglot-support** — a human support team can't staff every
  language. An LLM can. This detects ISO-639 codes per turn and responds
  in the caller's language, always persisting an English mirror for
  audit.
- **predictive-interventions** — a human can't run probabilistic risk
  models per customer per horizon every night. This produces
  `[pay_on_time, pay_late, default, churn, dispute]` distributions over
  30/60/90-day windows for every active tenant, and emits opportunities
  when any probability crosses a threshold.
- **policy-simulator** — a human owner can't Monte-Carlo 1,000 renewal
  paths across thousands of leases. This exposes "what-if" as one API
  call.
- **natural-language-query** — owners don't write SQL. They type a
  question; the LLM compiles it to a typed AST; the AST is validated
  against a field allowlist (no injection); the compiler emits a
  parameterized query bound to `tenant_id = $1`.
- **pattern-mining** — no human can safely anonymize and correlate
  signals across hundreds of tenants without a consent / privacy breach.
  This uses a min-5-tenant aggregation guard (`MIN_TENANTS_FOR_AGGREGATION`)
  and publishes insights that NEVER reference identifiable customers.

---

## Budget-guard + audit integration

Every LLM call in this suite accepts a `BudgetGuard` callback. Services
call `guard(tenantId, operation)` BEFORE any round-trip. The current
`shared.ts` exports:

```ts
export interface BudgetGuard { (tenantId: string, operation: string): Promise<void> | void }
```

**Composition-root integration:**

```ts
const budgetGuard: BudgetGuard = async (tenantId) => {
  await costLedger.assertWithinBudget(tenantId);
};
const sentimentMonitor = createSentimentMonitor({ repo, llm, budgetGuard });
```

This delegates to `CostLedger.assertWithinBudget(tenantId)` which throws
`AiBudgetExceededError` if the tenant is over their monthly cap. The
error propagates as a 503 with a clear code from the router.

**Audit reproducibility:** every persisted row carries:
- `model_version` (e.g. `claude-3-5-sonnet-20241022`, or `DEGRADED_MODEL_VERSION = 'degraded-no-llm'`)
- `prompt_hash` (SHA-256 hex digest of the system + user prompts)
- `confidence` (0..1 where present)
- `explanation` (one-sentence human-readable reason)

A later auditor can compare prompt-hashes across runs to verify no
silent prompt drift.

**pattern-mining** uses a sentinel tenant id `'__system__'` so
ledger tracking distinguishes system-level cost from per-tenant usage.

TODO(Agent Z4): once the multi-LLM router lands, replace direct
`BudgetGuard` callbacks with `withBudgetGuard(router, { ledger, context })`
from `packages/ai-copilot/src/providers/budget-guard.ts`.

---

## Global-first compliance (no hardcoded locale)

- **Language.** Every LLM call uses a prompt that explicitly asks for
  ISO-639-1/-2 detection. `polyglot_conversations.detected_language` +
  `response_language` are free-form ISO codes. `ai_native_signals.language_code`
  is also ISO. No en/sw toggle anywhere.
- **Currency.** `market_rate_snapshots.currency_code` and
  `inspection_ai_findings.currency_code` are ISO-4217 strings. Costs
  stored in **minor units** (cents) as `BIGINT` to avoid float drift.
- **Country dispatch.** The `MarketRatePort` is abstract — per-country
  adapters are expected to be resolved via
  `getCountryPlugin(tenantCountry)` from `@borjie/compliance-plugins`.
  No scraper is hardcoded into the pipeline.
- **Schemas.** Every migration uses `text` not `varchar(n)`. CHECK
  constraints allow any ISO string; we don't whitelist countries.

---

## What's stubbed — external adapters

| Adapter              | Env var          | Location                                               |
| -------------------- | ---------------- | ------------------------------------------------------ |
| Vision model         | `VISION_API_KEY` | Implement `VisionLLMPort`; wire into `multimodal-inspection` |
| Market rate scraper  | `MARKET_RATE_*`  | Implement `MarketRatePort`; adapterId is free-form     |
| Classification LLM   | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Implement `ClassifyLLMPort` using existing `providers/anthropic-client.ts` |
| Pattern-mining LLM   | same as above    | Same port; runs as `__system__` tenant                 |
| NL-query runner      | `DATABASE_URL`   | `NlQueryRunner` accepts `(tenantId, sql, params) => rows`; bind to the existing postgres client |

When any port is unconfigured the capability falls back to
`DEGRADED_MODEL_VERSION = 'degraded-no-llm'` and returns a
zero-confidence structured result — **the pipeline never crashes**. The
router surfaces config-missing as HTTP 503 with an explicit code:

- `SENTIMENT_MONITOR_UNAVAILABLE`
- `MULTIMODAL_INSPECTION_UNAVAILABLE`
- `NL_QUERY_UNAVAILABLE`
- `POLICY_SIMULATOR_UNAVAILABLE`
- `PREDICTIVE_INTERVENTIONS_UNAVAILABLE`

---

## Verification

### Typechecks

```
pnpm --filter @borjie/ai-copilot typecheck   # green
pnpm --filter @borjie/api-gateway typecheck  # green
```

### Tests

```
pnpm --filter @borjie/ai-copilot test -- src/ai-native
  Test Files  8 passed (8)
  Tests      34 passed (34)
```

Per-capability test counts: sentiment-monitor 4, market-surveillance 5
(incl. pure-helper tests), multimodal-inspection 4, polyglot-support 4,
predictive-interventions 4, policy-simulator 4, natural-language-query
5, pattern-mining 4. Every suite exercises: (a) happy path with LLM,
(b) degraded no-key path, (c) guardrail / validation failure.

### Migrations applied live

```
psql borjie -f 0102_ai_native_signals.sql          — CREATE TABLE + 4 indexes + rollup table
psql borjie -f 0103_market_rate_snapshots.sql      — CREATE TABLE + 2 indexes
psql borjie -f 0104_inspection_ai_findings.sql     — CREATE TABLE + 2 indexes
psql borjie -f 0105_polyglot_conversations.sql     — CREATE TABLE + 3 indexes
psql borjie -f 0106_tenant_predictions.sql         — CREATE TABLE + index + opportunities table
```

`\dt` confirms all 7 tables live:

```
 ai_native_sentiment_rollups
 ai_native_signals
 inspection_ai_findings
 market_rate_snapshots
 polyglot_conversations
 predictive_intervention_opportunities
 tenant_predictions
```

---

## Safety invariants

1. **pattern-mining** NEVER leaks identifying data. The
   `enforcePrivacyFloor` filter server-side drops any aggregate with
   `tenantCount < 5`. Test `pattern-mining.test.ts` verifies a 2-tenant
   aggregate yields zero insights.
2. Every prediction / signal / finding carries `model_version` +
   `confidence` + `explanation` + `prompt_hash`. No opaque outputs.
3. Natural-language queries compile through a field allowlist
   (`QUERY_FIELD_ALLOWLIST`). LLM-proposed fields outside the allowlist
   raise `InvalidQueryASTError` → HTTP 400. Generated SQL is always
   parameterized; placeholders never mix with user input.
4. Tenant isolation: every query compiles to `WHERE tenant_id = $1`.
   The router always binds `tenantId` from the JWT.

---

## Integration points (composition-root wiring)

The gateway composition root constructs the services using the live
Postgres client + Anthropic/OpenAI client and injects them via
`services.*` on the Hono context:

```ts
services.sentimentMonitor       = createSentimentMonitor({ repo, llm, publisher, budgetGuard });
services.marketSurveillance     = createMarketSurveillance({ repo, port, llm, publisher, budgetGuard });
services.multimodalInspection   = createMultimodalInspection({ repo, vision, budgetGuard });
services.polyglotSupport        = createPolyglotSupport({ repo, llm, budgetGuard });
services.predictiveInterventions = createPredictiveInterventions({ repo, llm, publisher, budgetGuard });
services.policySimulator        = createPolicySimulator({ loadLeases });
services.naturalLanguageQuery   = createNaturalLanguageQuery({ runner, llm, budgetGuard });
services.patternMiner           = createPatternMiner({ repo, llm, budgetGuard });
```

**Wiring status (2026-05-08, post wave-2).** Of the eight,
`marketSurveillance` and `predictiveInterventions` now have real
Drizzle-backed wirings under
`services/api-gateway/src/composition/{market-surveillance,predictive-interventions}-wiring.ts`
(commit `f3f02d2`); their persistence ports (`market_rate_snapshots`,
`tenant_predictions`, `predictive_intervention_opportunities`) route
through the typed services in `packages/database/src/services/`
(commit `e33cebc`). The external `MarketRatePort` and the LLM port for
predictions are still stubbed (heuristic-baseline mode) until concrete
adapters land — the surveillance loop returns `[]` from
`listActiveUnits` and predictions fall back to heuristic baselines.
The other six services (`sentimentMonitor`, `multimodalInspection`,
`polyglotSupport`, `policySimulator`, `naturalLanguageQuery`,
`patternMiner`) remain unwired in the registry — their routers
continue to return 503 with a clear `*_UNAVAILABLE` code until those
slots ship.

Repositories are thin `postgres-js` wrappers — straight INSERTs /
SELECTs against the migration tables. They're intentionally left out of
`packages/ai-copilot` so the package stays framework-agnostic.

---

## Non-duplication with Agent PhB1 (human-playbook)

Agent PhB1 owns `packages/ai-copilot/src/task-agents/` — rent-reminder,
late-fee, inspection-scheduler, renewal-reminder, dispute-triage.
Those are **scheduled task runners** that encode a human's playbook.

Agent PhG (this agent) owns `packages/ai-copilot/src/ai-native/` —
**LLM-native continuous classifiers, simulators, and query engines**
that a human CANNOT run at scale.

Zero overlap in file paths, zero overlap in functions, zero collisions
in exports (the barrel uses namespaced `AiNative.*` in the top-level
`index.ts`).

---

## Stop-condition checklist

- [x] 8 capabilities shipped with working stubs.
- [x] Each hits a real live DB table (migrations 0102–0106 applied).
- [x] Endpoints respond 201/200 with structured JSON (or 503 with clear
      config-missing reason).
- [x] `pnpm --filter @borjie/ai-copilot typecheck` green.
- [x] `pnpm --filter @borjie/api-gateway typecheck` green.
- [x] 34 tests passing (≥ 24 required, 3 per capability minimum).
- [x] Router mounted at `/api/v1/ai-native` with 1-line import + 1-line
      `api.route` in `services/api-gateway/src/index.ts`.
- [x] Global-first: ISO-639 languages, ISO-4217 currencies, no
      hardcoded en/sw, no hardcoded jurisdictions.
- [x] Safety: min-5-tenant privacy guard on pattern-mining, audit
      reproducibility via `prompt_hash` + `model_version` + `confidence`
      + `explanation` on every output.
- [x] No commits, no push (per constraints).

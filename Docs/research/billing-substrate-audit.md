# Borjie platform-billing substrate audit — vs the Claude-Code model

**Date:** 2026-06-09
**Lane:** `our-billing-substrate-audit` (repo READ-ONLY)
**Branch:** `integration/parity-final`
**Scope:** What Borjie has TODAY for charging the owner for the *platform*
(Mr. Mwikila) — measured against the owner directive: Claude-Code-style
subscription **TIERS**, each with per-period usage **RATE-LIMITS**
(brain-turns / agent-compute / token budgets like Claude Code's 5-hour +
weekly caps), **METERED** per org, billed via **Stripe**, with an honest
"limit reached — upgrade or wait" surface; full powers default ON inside the
tier budget (the limit is a usage cap, not a feature gate).

> **The one distinction this audit never blurs** (CLAUDE.md hard rule):
> the **tenant estate money** (royalty / ledger / M-Pesa / offtake via
> `LedgerService.post`) is the mining *business* money and is OUT OF SCOPE
> here. This audit is only about **Borjie platform revenue** — the SaaS fee
> the owner pays to use the product. The two are never conflated.

---

## TL;DR verdict

Borjie has **three disconnected fragments** of a platform-billing system, none
of which together form the Claude-Code model:

1. **A platform-subscription charge path** (`PlatformBillingService` +
   `tenant_subscriptions`, migration 0178) — REAL, wired, ledger-correct, but
   it is a **flat MRR charge with no tiers, no usage caps, no metering link,
   and no Stripe-product/price catalog**. The caller hands it an `mrrMinor`
   number; nothing derives it from a plan.
2. **An enforced USD cost-cap** (`aiCostLedger` + `tenant_ai_budgets` /
   `ai_cost_entries`, migration 0305) — REAL, wired, and **actually enforced
   on the brain path** (`brain.hono.ts:494`, `ai-chat.router.ts:237`). But it
   is a single per-tenant **monthly USD cap an admin types in by hand**, not a
   tier-derived per-period (5h/weekly) brain-turn/agent-compute budget.
3. **A Claude-Code-shaped LLM budget governor** (`@borjie/llm-budget-governor`
   + `tenant_llm_budgets` / `tenant_llm_budget_caps`, migration **0272**) —
   this is the substrate the directive points at (tiers, token caps, period
   windows, downgrade ladder). It is **built, but DARK**: its `evaluateCall`
   is never invoked on any LLM/brain path, and **its migration lives in
   `.archive/` and is never applied by Borjie's runner** — the tables do not
   exist in the live DB.

**Net:** the *charge* rail exists, a *cost cap* is enforced, but the
**tier → entitlement → per-period usage-rate-limit → metered-against-tier →
limit-hit-upgrade** spine that defines the Claude-Code model **does not exist
end to end**. No plan/tier→limit mapping, no per-org usage meter expressed in
the directive's units (brain-turns / agent-compute), no Stripe product catalog,
no honest "upgrade or wait" surface, no overage path.

---

## Component-by-component

### 1. Tier / plan model — **PARTIAL**

**What exists**
- A `borjie_plan` pg enum (`packages/database/src/schemas/tenant.schema.ts:48`):
  `mwanzo | mkulima | mfanyabiashara | kampuni | group`, defaulted on
  `tenants.plan` (`tenant.schema.ts:117`). Comment at line 115 says it "Drives
  feature gates + AI-agent budgets."
- A legacy `subscription_tier` enum on the same table
  (`tenant.schema.ts:114`: `starter … enterprise … custom`) — a parallel,
  unused-for-billing ladder.

**The gap**
- The plan column is **just a label**. There is **no entitlements/limits table**
  mapping a plan to its usage caps (no brain-turn cap, no token cap, no
  agent-compute cap, no period window per plan). The comment's claim that plan
  "drives AI-agent budgets" is **not realised anywhere** — grep finds no code
  reading `tenants.plan` to set a budget cap. The enforced cap
  (`tenant_ai_budgets`) is set per-tenant by an admin, decoupled from `plan`.
- `tenant_subscriptions.plan` is a free `text` column the API caller supplies
  (`platform-billing-service.ts:52`, route schema `billing.router.ts:41`
  accepts any string ≤80 chars) — there is no canonical plan→price catalog.

**Files:** `packages/database/src/schemas/tenant.schema.ts:42-54,114-117`;
`packages/database/src/schemas/tenant-subscriptions.schema.ts:51-52`;
`services/api-gateway/src/routes/owner/billing.router.ts:40-47`.

---

### 2. Per-tenant usage metering (brain-turns / tokens / agent-compute) — **PARTIAL**

Two real metering ledgers exist, both **token/USD-cost** shaped, neither
expressed in the directive's brain-turn / agent-compute units:

**a) `aiCostLedger` (the one that's enforced)** —
`packages/ai-copilot/src/cost-ledger.ts`. Append-only `ai_cost_entries`
(per-LLM-call: provider, model, input/output tokens, `cost_usd_micro`) +
`currentMonthSpend()` roll-up. Tables created in forward migration
**0305** (`ai_cost_entries` at line 374, `tenant_ai_budgets` at line 2323,
both FORCE-RLS at 3286 / 4438). Wired live in
`service-registry.ts:2194` (`createCostLedger`), enforced (see §4).

**b) `mcp_cost_ledger` (MCP-tool spend only)** —
`services/api-gateway/src/composition/mcp/persistent-mcp-cost-ledger.ts`,
migration **0301**. Per-MCP-tool-call USD + tokens, `aggregateByServer/Tool`,
fail-soft. This meters *MCP tool* spend, not brain turns, and is not tied to a
plan or to enforcement (it's observability — `persistent-mcp-cost-ledger.ts:14`).

**The gap**
- Both meters count **USD micro-dollars and raw tokens**. There is **no
  brain-turn counter**, **no agent-compute meter**, and **no per-period
  (5-hour / weekly) window** — the Claude-Code unit and cadence are absent.
- Metering is **not joined to a tier**: `ai_cost_entries` has no plan column;
  `currentMonthSpend` is a calendar-month USD sum, not "X turns of Y allotted
  this 5-hour window for plan Z."
- The two meters are uncoordinated (MCP spend is invisible to the enforced
  `aiCostLedger` cap).

**Files:** `packages/ai-copilot/src/cost-ledger.ts:1-130`;
`packages/database/src/schemas/ai-cost.schema.ts:22,58`;
`packages/database/src/migrations/0305_create_missing_schema_tables.sql:374,2323`;
`services/api-gateway/src/composition/mcp/persistent-mcp-cost-ledger.ts`;
`packages/database/src/migrations/0301_mcp_cost_persistence.sql:57`.

---

### 3. Rate-limit enforcement (RSS-08 Redis token-bucket) — **PARTIAL**

**What exists**
- A real distributed token-bucket: `redis-token-bucket.ts` consumed by
  `rate-limiter.ts`. `customRateLimit` / `perUserRateLimit` charge a shared
  Redis bucket when `REDIS_URL` is set, falling back to an in-process `Map`
  otherwise (`rate-limiter.ts:391-419`, the RSS-08 closure).
- The brain path has its own per-user request limiter
  (`brain.hono.ts:168-174,486-488`): 429 `RATE_LIMIT` keyed by
  `tenant:actor`.

**The gap (this is generic HTTP throttling, not tiered billing rate-limits)**
- Limits are **per-role and per-endpoint**, hard-coded constants
  (`rate-limiter.ts:69-107`: `OWNER: 300 req/min`, `ADMIN: 5000`, etc.). They
  are **not per-org and not per-tier** — two owners on different plans get the
  same cap. The key is `rate:{tenantId}:{userId}` (`rate-limiter.ts:466`), so
  the *bucket* is per-user, but the *capacity* is role-derived, never
  plan/tier-derived.
- The roles are still the **real-estate role ladder** (`PROPERTY_MANAGER`,
  `RESIDENT`, `MAINTENANCE_STAFF` at `rate-limiter.ts:74-78`) — stale post
  property→mining migration.
- These are **request-per-minute** limits (anti-abuse), not the directive's
  **usage budget** (brain-turns / token-compute over a 5h/weekly period). The
  token bucket has no link to `tenant_llm_budgets` or any plan entitlement.

**Files:** `services/api-gateway/src/middleware/rate-limiter.ts:69-107,391-419,456-471`;
`services/api-gateway/src/routes/brain.hono.ts:168-174,486-488`.

---

### 4. Limit-hit enforcement on the brain path — **PARTIAL**

**What is enforced (real)**
- `brain.hono.ts:494` and `ai-chat.router.ts:237` call
  `ledger.assertWithinBudget(tenantId)` *before* the LLM call and return a
  clean **429 `BUDGET_EXCEEDED`** when over the monthly USD cap (only when the
  tenant's `tenant_ai_budgets.hardStop = true`; otherwise it's informational —
  `cost-ledger.ts:11-15`). The Anthropic wrapper also short-circuits
  (`cost-ledger.ts:20-22`, `packages/ai-copilot/src/providers/budget-guard.ts`).
- So a per-tenant **monthly USD hard-stop is genuinely enforced.**

**The gap**
- This is the **wrong cap shape** for the directive: one admin-entered monthly
  USD number, not a plan-tier-derived per-period usage budget. There is no
  "Pro vs Max" differentiation, no 5h/weekly window, no upgrade path on hit.
- The richer, tier-aware governor (`llm-budget-governor`, §6) that *would*
  produce `downgrade` / `block(over-cap-tokens)` decisions is **never called**
  on this path (confirmed: zero `evaluateCall` callers outside its own
  definition).

**Files:** `services/api-gateway/src/routes/brain.hono.ts:494-505`;
`services/api-gateway/src/routes/ai-chat.router.ts:171-183,227-244`;
`packages/ai-copilot/src/cost-ledger.ts:11-22,80-100`.

---

### 5. Stripe-for-Borjie subscriptions (platform revenue rail) — **PARTIAL**

**What exists (and is correctly separated from estate money)**
- `PlatformBillingService` (`services/api-gateway/src/composition/billing/platform-billing-service.ts`)
  — `subscribe()` charges the platform fee through the **provider PORT**
  (`IPaymentProvider`, the same Stripe/M-Pesa contract in
  `services/payments-ledger/src/providers`) and posts a **balanced 2-leg
  journal** (DR `platform_billing_receivable` / CR
  `platform_subscription_revenue`) through `LedgerService.post()`. Idempotent
  on `(tenant, plan, billingPeriod)`. This is correctly modeled as platform
  revenue, distinct from estate money (`platform-billing-service.ts:1-31`).
- `tenant_subscriptions` read-model (migration **0178**, applied) — one active
  sub per tenant, `external_id` for webhook reconciliation, MRR minor-units +
  ISO-4217 currency, FORCE-RLS.
- Route `GET/POST /api/v1/billing/subscription`
  (`routes/owner/billing.router.ts`), wired live
  (`service-registry.ts:2853 buildPlatformBilling(db)`).

**The gap**
- **No Stripe product / price catalog and no plan→price mapping.** `subscribe()`
  takes a raw `mrrMinor` integer and a free-text `plan` from the request
  (`billing.router.ts:42-47`) — the price is supplied by the *caller*, not
  derived from a Borjie plan. There is no Stripe `Price`/`Product` id, no
  `stripe.subscriptions.create`, no checkout/portal.
- **No webhook handler reconciling Borjie subscription lifecycle.** The Stripe
  webhook handler that exists (`services/payments-ledger/src/providers/stripe/webhook-handler.ts`)
  is the **estate** payments rail (tenant invoices), not platform-subscription
  lifecycle (`invoice.paid` / `customer.subscription.updated` → flip
  `tenant_subscriptions.status`). The `external_id` reconciliation hook
  described in 0178's comment is **unbuilt**.
- **No metering→invoice link.** Usage (§2) never feeds an overage line or a
  usage-based Stripe charge. `subscribe()` is a flat recurring fee only.
- It is **not wired to the plan ladder** (§1) or to any tier price.

**Files:** `services/api-gateway/src/composition/billing/platform-billing-service.ts`;
`packages/database/src/schemas/tenant-subscriptions.schema.ts`;
`packages/database/src/migrations/0178_tenant_subscriptions.sql`;
`services/api-gateway/src/routes/owner/billing.router.ts`;
`services/api-gateway/src/composition/service-registry.ts:1604-1620,2853`.

---

### 6. The directive's named substrate — `tenant_llm_budgets` + `tenant_llm_budget_caps` (migration 0272) — **ABSENT (built but dark + unmigrated)**

This is the package the owner directive explicitly points at as "metering," and
it is the most Claude-Code-shaped thing in the repo — **yet it is not live.**

**Schema (`packages/database/.archive/migrations/0272_tenant_llm_budgets.sql`)**
- `tenant_llm_budgets` — per-period spend rows
  (`tenant_id`, `period_kind ∈ {daily,monthly}`, `period_start/end`,
  `spend_tokens`, `spend_cents`, `highest_tier_used ∈ {haiku,sonnet,opus}`).
  Atomic `ON CONFLICT … DO UPDATE SET spend = spend + EXCLUDED.spend` increment
  (0272:16-20).
- `tenant_llm_budget_caps` — per-tenant cap config: `cap_cents`, `cap_tokens`,
  `allowed_tiers text[]`, `downgrade_at_fraction` (default 0.85) (0272:42-51).

**Governor (`packages/llm-budget-governor/src/governor.ts`)** — genuinely
tier-aware: `evaluateCall` returns `proceed | downgrade | block`, hard-blocks on
`over-cap-cents` / `over-cap-tokens`, auto-downgrades opus→sonnet→haiku when
approaching the cap or when a tier isn't allowed (`governor.ts:61-180`),
period-resets daily/monthly, emits `alertSink.emitBlock/emitDowngrade`. A
Postgres store (`postgres-store.ts`) and live-vs-degraded wiring
(`llm-budget-postgres-wiring.ts`) both exist.

**Why it is ABSENT in practice — two hard blockers:**
1. **Never enforced.** Grep for `evaluateCall` / `recordSpend` against the
   brain/LLM/orchestrator paths returns **zero callers** outside the package's
   own definitions and the registry construction. The governor is constructed
   in `service-registry.ts:1681,2583` and exposed as
   `registry.llmBudgetGovernor`, but **no route, brain turn, or LLM wrapper
   calls `evaluateCall` before a call or `recordSpend` after one.** Its own
   header admits the swap was "DEFERRED" (`postgres-store.ts:36-43`).
2. **Tables never created in the live DB.** Migration 0272 lives in
   `packages/database/.archive/migrations/` — which the repo's own migration
   notes declare **"out of band for this repo's runners"**
   (`0297_…:62`, `0157_…:40`). There is **no forward
   `packages/database/src/migrations/0272*` and no `tenant_llm_budget*` CREATE
   anywhere in `src/migrations/` or `drizzle/`** (only a `down/` teardown
   script references it). So even though the Postgres store is wired in "live"
   mode, **its queries target tables that do not exist** — every
   `getBudget` returns null → governor falls through to
   `proceed{remaining: +Infinity}` (`governor.ts:63-73`), i.e. **unlimited**.
   There is also **no seeding** of `tenant_llm_budget_caps` from a plan, so
   even if the table existed, no tenant would have a cap.

**Files:** `packages/database/.archive/migrations/0272_tenant_llm_budgets.sql`;
`packages/llm-budget-governor/src/governor.ts:61-218`;
`packages/llm-budget-governor/src/postgres-store.ts:36-43,144-294`;
`packages/llm-budget-governor/src/types.ts:104-109`;
`services/api-gateway/src/composition/llm-budget-postgres-wiring.ts`;
`services/api-gateway/src/composition/service-registry.ts:1681-1686,2583-2584`.

---

### 7. Limit-hit UX / "upgrade or wait" surface + overage — **ABSENT**

**What exists**
- Backend 429s with machine codes: `BUDGET_EXCEEDED` (monthly USD cap) and
  `RATE_LIMIT` / `TOO_MANY_REQUESTS` (request throttle). The
  `ai-chat.router.ts:171-183` comment says it's "for the chat panel to render a
  'monthly AI budget reached' banner."
- `aiCostsRouter` (`routes/ai-costs.router.ts`) exposes
  `/ai-costs/summary|entries|budget` with an `overBudget` boolean and admin
  `PUT /budget`.

**The gap**
- **No tier-aware "limit reached — upgrade or wait" surface.** The owner-web
  `PlanBillingPanel.tsx` only renders plan / status / maxUnits / maxUsers read
  from `GET /tenants/current` — **no usage meter, no remaining-budget gauge, no
  reset-time, no upgrade CTA, and it does not even call
  `/billing/subscription`.** Its footer admits billing controls are "coming in
  a later wave" (`PlanBillingPanel.tsx:78-81`).
- **No overage / upgrade flow** anywhere (no "exceed → pay more" or "exceed →
  prompt upgrade" path). The only over-limit outcomes are a flat 429 or
  (in the dark governor) a silent model **downgrade** — which the directive
  explicitly forbids ("never a silent degrade").
- The `resetsAt` / `retryAfter` data the governor would produce never reaches a
  UI because the governor is dark.

**Files:** `apps/owner-web/src/components/settings/PlanBillingPanel.tsx`;
`services/api-gateway/src/routes/ai-costs.router.ts`;
`services/api-gateway/src/routes/ai-chat.router.ts:171-183`.

---

## Scorecard

| Billing component | Status | Evidence | Core gap |
|---|---|---|---|
| Tier / plan model | **PARTIAL** | `tenant.schema.ts:48,117`; `tenant-subscriptions.schema.ts:51` | Plan is a bare label; no plan→entitlement/limits table; free-text plan on subs |
| Per-tenant usage metering | **PARTIAL** | `cost-ledger.ts`; `0305:374,2323`; `persistent-mcp-cost-ledger.ts`; `0301` | USD/token only — no brain-turn / agent-compute units, no 5h/weekly window, not tier-joined |
| Rate-limit enforcement (RSS-08) | **PARTIAL** | `rate-limiter.ts:69-107,391-419` | Per-role/per-endpoint req/min throttle, not per-org/per-tier usage budget; stale RE roles |
| Brain-path limit enforcement | **PARTIAL** | `brain.hono.ts:494`; `ai-chat.router.ts:237` | Enforces a flat admin-set monthly USD cap, not a tier-derived per-period budget |
| Stripe-for-Borjie subscriptions | **PARTIAL** | `platform-billing-service.ts`; `0178`; `billing.router.ts` | Flat MRR charge; no Stripe product/price catalog, no plan→price, no sub-lifecycle webhook, no metering link |
| `tenant_llm_budgets` + caps (0272) | **ABSENT** | `.archive/…/0272_*.sql`; `governor.ts`; no `src/migrations/0272*` | Built but DARK: `evaluateCall` never called; migration archived/unapplied → tables don't exist → governor passes through unlimited |
| Limit-hit UX / upgrade / overage | **ABSENT** | `PlanBillingPanel.tsx`; `ai-costs.router.ts` | No usage gauge, no "upgrade or wait" CTA, no overage/upgrade flow; over-limit = flat 429 or forbidden silent downgrade |

---

## What a Claude-Code-model build would need to connect (closure spine)

1. **Promote 0272 into a forward migration** (`src/migrations/`) so
   `tenant_llm_budgets` / `tenant_llm_budget_caps` actually exist; or fold its
   per-period+token+tier columns into the already-applied `tenant_ai_budgets`.
2. **A plan→entitlement catalog** (a `plan_entitlements` table or typed
   registry) mapping each `borjie_plan` tier to its per-period brain-turn /
   token / agent-compute caps + allowed model tiers + downgrade fraction, and
   **seed `tenant_llm_budget_caps` from the tenant's plan** at signup/plan-change.
3. **Wire the governor onto the brain path** — call `evaluateCall` before, and
   `recordSpend` after, the LLM/orchestrator turn (replacing or augmenting the
   flat USD `assertWithinBudget`), counting in **brain-turns / agent-compute**,
   not just USD.
4. **Express the period as 5h/weekly windows** (the directive's cadence), not
   calendar-month USD.
5. **Stripe product/price catalog + subscription-lifecycle webhook** feeding
   `tenant_subscriptions` (derive `mrrMinor`/`plan` from the Stripe price, not
   from the request body), plus an **overage** path.
6. **Honest limit-hit UX** in `PlanBillingPanel` + chat: a usage gauge, the
   `resetsAt`, and an "upgrade or wait" CTA on `BUDGET_EXCEEDED` — and **remove
   the silent model-downgrade** as the over-limit behaviour (directive forbids
   silent degrade).

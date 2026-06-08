# THE PLATFORM BILLING ARCHITECTURE — Borjie (and BossNyumba)

**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Lane:** synthesis (builds on `billing-claude-code-model.md` + `billing-substrate-audit.md` + `MASTER_GAP_REGISTER.md`)
**Scope:** How **Borjie charges the OWNER for the PLATFORM** (Mr. Mwikila) — the
SaaS/subscription revenue rail. **Claude-Code-style:** subscription **TIERS**,
each with per-period usage **RATE-LIMITS** (brain-turns / agent-compute / token
budgets), **METERED per org**, billed via **Stripe**, honest "limit reached —
upgrade or wait" surface, **FULL POWERS DEFAULT ON within the tier budget** (the
limit is a usage cap, not a feature gate). Same model in both repos.

> ## THE NON-NEGOTIABLE SEPARATION (CLAUDE.md hard rule — restate first)
> There are **TWO physically distinct money systems** and they are **NEVER**
> conflated:
>
> 1. **TENANT ESTATE MONEY** — royalty / double-entry ledger / M-Pesa / offtake
>    settlement = the mining *business* operations. Flows **only** through
>    `LedgerService.post()` (`services/payments-ledger/`), RLS-scoped, immutable
>    double-entry. **Already built.** Out of scope here.
> 2. **BORJIE PLATFORM REVENUE** (this doc) — the SaaS fee the owner pays Borjie
>    to use Mr. Mwikila. A Stripe subscription/charge to the org. **A platform
>    overage is a Stripe invoice line — it is NEVER a ledger journal entry, and
>    tenant estate funds are NEVER drawn to pay the platform bill.**
>
> The platform meter is cost-weighted-token / agent-compute. The estate ledger
> is journal entries in TZS/multi-currency. Crossing them is a P0 bug.

---

## 0. Architecture in one diagram (the closure spine)

```
  ┌─────────────────────────── CONTROL PLANE (admin-web :3020, Borjie-internal) ───────────────────────────┐
  │  plan_entitlements catalog (Starter/Pro/Max/Enterprise → caps)   billing console (tenant-as-account)    │
  │  Stripe Product/Price catalog sync   overage policy   usage analytics across all orgs (METADATA only)    │
  └──────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘
                                                  │  seeds caps on signup / plan-change
                                                  ▼
  ┌──────────────────── tenant_subscriptions (0178) ──────────────────┐    ┌──── tenant_llm_budget_caps (0320) ────┐
  │  one active sub / tenant · plan · status · stripe_*_id            │───▶│  cap_brain_turns · cap_tokens · cap_cents│
  │  current_period_start/end · MRR minor · external_id (webhook)     │    │  allowed_tiers[] · period_kind (5h/wk/mo) │
  └─────────────────────────────────┬─────────────────────────────────┘    └──────────────────┬────────────────────┘
                                     │ Stripe webhook lifecycle                                  │ reads cap
                                     ▼                                                            ▼
  ┌─── Stripe (PLATFORM revenue rail, NOT estate) ───┐    ┌──────────── BRAIN PATH (brain.hono.ts turn) ───────────┐
  │  Checkout · Customer Portal · Meter(brain_unit)  │    │  PRE:  governor.evaluateCall({tenant,model,estTokens}) │
  │  Pricing-plan: license-fee + credit-grant + rate │◀───│        → proceed | (surfaced) downgrade | BLOCK 429    │
  │  webhooks → flip tenant_subscriptions.status     │    │  CALL: LLM / orchestrator turn (FULL POWERS ON)        │
  │  usage-events ← overage meter                    │    │  POST: governor.recordSpend({tokens,cents,turn,tier})  │
  └──────────────────────────────────────────────────┘    │        → tenant_llm_budgets (atomic increment)         │
                                     ▲                      └────────────────────────┬───────────────────────────────┘
                                     │ overage usage-event                           │ writes spend
                                     └───────────────────────────────────────────────┘
                                                  │ enforced atomically across replicas
                                                  ▼
  ┌──────── RSS-08 shared-Redis token-bucket (per-org-per-tier capacity) ────────┐
  │  capacity derived from plan_entitlements (NOT role) · Lua-atomic · burst-ok   │
  └───────────────────────────────────────────────────────────────────────────────┘
                                                  │ 429 BUDGET_EXCEEDED { resetsAt, upgradeUrl }
                                                  ▼
  ┌── owner-web :3010 PlanBillingPanel (DATA PLANE) ──┐
  │  usage gauge · remaining · resetsAt · extra-usage │
  │  toggle · "upgrade or wait" CTA · overage cap      │
  └────────────────────────────────────────────────────┘
```

The substrate audit verdict: the **charge rail exists** (`PlatformBillingService` +
`tenant_subscriptions` 0178), a **flat USD cost-cap is enforced** (`aiCostLedger` +
`tenant_ai_budgets` 0305 at `brain.hono.ts:494`), and a **Claude-Code-shaped governor
exists but is DARK** (`@borjie/llm-budget-governor`, migration 0272 archived/unapplied,
`evaluateCall` never called). This doc connects them into the full
**tier → entitlement → per-period usage-limit → metered-against-tier → honest-limit-hit → Stripe** spine.

---

## 1. The TIER model (full-powers-on within budget)

### 1.1 Borjie tiers (per ORG; seats/roles live *within* the org)

We **reuse the existing `borjie_plan` pg enum** (`tenant.schema.ts:48`:
`mwanzo | mkulima | mfanyabiashara | kampuni | group`) as the canonical plan key —
no new enum. Map each to a Claude-ladder analogue. **Every paid tier has FULL
POWERS ON; the tier sizes the USAGE BUDGET, never the feature set.**

| `borjie_plan` | Display | Claude analogue | Price (USD/mo, illustrative) | Per-period usage budget | Model tiers allowed | Overage |
|---|---|---|---|---|---|---|
| `mwanzo` | Mwanzo (Starter/Trial) | Pro $20 | $0 trial → $29 | small brain-turn / token budget, 5h window | haiku, sonnet | off by default |
| `mkulima` | Mkulima (Small-scale) | Max 5x $100 | $99 | ~5× Mwanzo; priority routing | haiku, sonnet, opus | opt-in |
| `mfanyabiashara` | Mfanyabiashara (Trader) | Max 5x–20x | $199 | ~10× Mwanzo; heavier autonomous loops | haiku, sonnet, opus | opt-in |
| `kampuni` | Kampuni (Company) | Max 20x $200 | $399 | ~20× Mwanzo; heavy autonomous-MD workloads | all + priority | opt-in, higher cap |
| `group` | Group/Estate (Enterprise) | Enterprise | custom (base seat-fee + **metered usage**) | custom per-org caps, SSO/admin | all | metered usage, custom caps |

> **Pricing numbers are illustrative** and live in the `plan_entitlements`
> catalog + Stripe Price objects, **never hard-coded in code paths** (CLAUDE.md
> multi-currency rule; platform subscription billed in USD via Stripe — distinct
> from the TZS estate-currency rule which governs *estate* contracts, confirmed
> open-question in the source dossier §2.5/§4).

### 1.2 What each tier INCLUDES — full powers, default ON
- **Every capability** (chat, forecast, document generation, media, marketplace,
  workforce, autonomous MD loops, juniors, organ-synthesis) is **ON in every paid
  tier**. There is **no per-feature gate**. (MASTER_GAP_REGISTER "FULL POWERS
  DEFAULT ON" + "the limit is the usage cap, not a feature gate.")
- The **only** thing a tier changes is the **size of the per-period usage budget**
  and the **allowed model-tier ceiling** (a budget-economy choice — e.g. Mwanzo
  may exclude Opus the way Team Standard excludes Opus — **surfaced honestly, not
  a silent capability lock**, per dossier §3.1).
- The **sovereign RAILS** (money / licence / deletion stay HITL) are **not**
  "powers turned off" — they are the fiduciary rail (INV-F). Full powers ON + the
  owner still signs the irreversible step.

### 1.3 Entitlement catalog — the new source of truth
A typed `plan_entitlements` registry + table maps each `borjie_plan` →
`{ cap_brain_turns, cap_tokens, cap_cents, period_kind, allowed_tiers[],
downgrade_at_fraction, overage_enabled_default, stripe_price_id }`. This is what the
substrate audit called the missing "plan→entitlement/limits table" (§1 gap, closure
spine #2). It is the **only** place plan→limit mapping lives; the governor and the
token-bucket both read from caps seeded out of it.

---

## 2. The METERING model (what is metered + where the hook lives)

### 2.1 The metering UNIT — cost-weighted tokens → "Brain Units"
Adopt Anthropic's **CCU pattern** (dossier §1.3/§3.2): rate each brain-turn's token
spend in USD at the per-model rate, **cost-weight Opus > Sonnet > Haiku**, normalize
to a single internal unit. We meter THREE dimensions (Bessemer agent primitives,
dossier §2.3):

- **Brain-turns** (CPR — cost per resolved request): one metered brain turn = one
  `/brain` orchestration cycle to closure.
- **Cost-weighted tokens** (CPT): `input + output` tokens × per-model cost weight.
  The existing `TIER_RANK` (haiku=1 / sonnet=2 / opus=3) and `highest_tier_used`
  tracking is the seed weighting.
- **Agent-compute / agent-minutes** (CPAM): wall-clock or junior-swarm steps for
  long autonomous loops (durable-execution horizon, INV-G).

These extend **`tenant_llm_budgets`** (the directive's named substrate) — we add
`spend_brain_turns` and `spend_agent_ms` alongside the existing `spend_tokens` /
`spend_cents` / `highest_tier_used`.

### 2.2 Where the meter hook lives on the brain path
The governor's existing two-call contract is exactly right and already exists in
`@borjie/llm-budget-governor` (`governor.ts:30,182`):

```
PRE-CALL  : governor.evaluateCall({ tenantId, model, estimatedTokens })
              → GovernanceDecision = proceed | downgrade | block
POST-CALL : governor.recordSpend({ tenantId, model, inputTokens, outputTokens,
              costCents, brainTurns: 1, agentMs })
              → tenant_llm_budgets atomic ON CONFLICT DO UPDATE increment
```

**Hook sites (the audit's closure-spine #3 — governor is currently DARK, zero
`evaluateCall` callers):**
- `services/api-gateway/src/routes/brain.hono.ts:494` — **replace/augment** the flat
  `ledger.assertWithinBudget()` with `governor.evaluateCall()` BEFORE the LLM call,
  and add `governor.recordSpend()` AFTER (the same point that today writes
  `aiCostLedger`).
- `services/api-gateway/src/routes/ai-chat.router.ts:237` — same swap.
- `packages/ai-copilot/src/providers/budget-guard.ts` — the Anthropic wrapper
  short-circuit becomes a governor `evaluateCall` consumer so EVERY LLM call
  (not just `/brain`) is metered.

The **`aiCostLedger` / `tenant_ai_budgets` (0305)** stays as the USD-cost
observability ledger (append-only `ai_cost_entries` is genuinely useful for Stripe
overage reconciliation), but **enforcement authority moves to the governor** so the
cap is **tier-derived per-period**, not an admin-typed flat monthly USD number.

### 2.3 The PERIOD windows (Claude's cadence)
`tenant_llm_budgets.period_kind` extends from `{daily, monthly}` to add the
Claude-Code cadence: **`session_5h`** (rolling 5-hour window, starts on first turn)
and **`weekly`** (resets 7 days after window start). Each period row carries its own
`spend_*` counters and resets independently — three nested windows stack exactly as
in dossier §1.2.

---

## 3. The ENFORCEMENT (per-org-per-tier token-bucket + honest limit-hit)

### 3.1 RSS-08 — shared-Redis token-bucket, per-org-per-tier
The meter **records** spend; the bucket **enforces** the cap atomically in the
request path. The audit's enforcement gaps:
- RSS-08 is **process-local Map** today → real cap = `max × replicas` (dossier
  §3.3 + RSS-08). **Route through shared Redis** (Lua-atomic) — billing correctness
  **depends on closing RSS-08**.
- Current capacity is **role-derived + per-endpoint** (`rate-limiter.ts:69-107`,
  stale RE roles `PROPERTY_MANAGER`/`RESIDENT`). Replace with **capacity derived
  from `plan_entitlements`** keyed `bucket:{tenantId}:{period}` — two owners on
  different plans get **different** caps.

Token-bucket gives **controlled bursts** while holding a steady average (dossier
§2.5) — exactly right for the 5h rolling window.

### 3.2 The honest limit-hit response (TEST=PAYING — never a silent degrade)
The governor already returns a `block` decision with `resetsAt` / `remainingCents`
/ `remainingTokens` (`types.ts:63-80`) — wire it to a **structured 429** the UI can
render. Three honest states (dossier §3.4):

1. **Approaching** → soft banner: *"Approaching your monthly brain budget — resets
   [date]."* (warning at `downgrade_at_fraction`, e.g. 0.85.)
2. **Included exhausted, extra-usage OFF** → hard honest stop:
   `429 BUDGET_EXCEEDED { code, message, resetsAt, upgradeUrl, remaining: 0 }` →
   *"Limit reached — resets [time]. Upgrade your plan or enable extra usage."*
   **NO fake answer, NO quiet model-downgrade.**
3. **Extra-usage ON** → *"Included budget spent — continuing with metered usage
   (≈ [rate]); stops at your $[cap] cap."* → Stripe overage usage-event.

> **Silent auto-downgrade is FORBIDDEN.** The governor's `downgrade_at_fraction`
> opus→sonnet→haiku swap is acceptable **only when DISCLOSED** ("now on the economy
> model to stretch your budget"). A `downgrade` decision must surface a banner; a
> *silent* swap violates TEST=PAYING (dossier §3.4 caveat). Treat downgrade as a
> **surfaced** budget-economy mode the owner can decline.

### 3.3 The upgrade / overage flow
Mirror Anthropic's 2026 "extra usage" toggle (dossier §1.5):
- Owner opts in to continue at **standard rates** with an **owner-controlled monthly
  spend cap**; overage billed **separately** from the subscription via a Stripe Meter
  usage-event; **unused credits do not roll over**.
- Three terminal states only: **included** / **paid-overage** / **stopped at the
  owner's cap**. Never a silent degrade.

---

## 4. STRIPE-FOR-BORJIE subscriptions (platform revenue rail — distinct from estate)

> **Reuse the same Stripe ACCOUNT, but a SEPARATE billing surface.** The existing
> `services/payments-ledger/src/providers/stripe/` (checkout-session, client,
> webhook-handler) is the **ESTATE** rail (tenant invoices → `LedgerService.post`).
> Platform subscriptions get their **own** service + webhook handler so a platform
> charge **never** posts to the estate ledger.

### 4.1 What to build on top of the existing `PlatformBillingService`
`PlatformBillingService` (`platform-billing-service.ts`) already charges a flat
platform fee through the provider PORT and posts a balanced 2-leg journal (DR
`platform_billing_receivable` / CR `platform_subscription_revenue`) — **correct
platform-revenue modeling, distinct from estate money.** Gaps to close (audit §5):

- **Stripe Product/Price catalog + plan→price mapping.** Today `subscribe()` takes a
  raw `mrrMinor` + free-text `plan` from the request body (`billing.router.ts:42-47`).
  Replace: derive `mrrMinor`/`plan` from a **Stripe `Price`** id stored on
  `plan_entitlements`. Use a **Stripe "pricing plan"**: `license-fee` (tier base) +
  `service-action credit-grant` (included budget) + `rate-card` (metered overage) —
  the whole base+included+overage shape in one object (dossier §2.4).
- **Stripe `Meter`** per billable dimension (`brain_unit`, `agent_minute`). Report
  usage-events from the metering path; Stripe aggregates to the invoice at cycle end
  (dossier §1.3 CCU pattern, §2.4).
- **Platform subscription-lifecycle webhook** (new, separate from the estate
  webhook-handler): `checkout.session.completed` / `invoice.paid` /
  `customer.subscription.updated|deleted` → flip `tenant_subscriptions.status` +
  reconcile on `external_id` (the 0178 hook the audit flagged unbuilt). Idempotent via
  `Idempotency-Key` (CLAUDE.md webhook rule).
- **Checkout + Customer Portal** entry points for upgrade/downgrade self-serve.

### 4.2 INV-A — admin-web billing console vs owner-web billing settings
Per the hard data-plane/control-plane wall (MASTER_GAP_REGISTER INV-A):

| Surface | Port | What it owns | What it must NEVER do |
|---|---|---|---|
| **admin-web** (Borjie-internal) | 3020 | tenants-as-accounts billing console: plan catalog, Stripe Product/Price sync, per-org plan + overage policy, cross-org usage analytics (**METADATA only**) | NEVER read tenant *business* data (ledger, documents, PII). Service-role scoped to platform tables only. |
| **owner-web** (data plane) | 3010 | the OWNER's own billing settings: their plan, usage gauge, remaining budget, resetsAt, extra-usage toggle, overage cap, "upgrade or wait" CTA, invoices | Owner-admin lives HERE, never in admin-web. |

The existing `apps/admin-web/.../tenants` screen is the home for the control-plane
console; `apps/owner-web/.../PlanBillingPanel.tsx` is the data-plane settings (today
it only renders plan/status with a "coming in a later wave" footer — audit §7).

### 4.3 The accounting separation (restate)
A platform overage is a **Stripe invoice line**; it is **never** an estate ledger
journal entry. Tenant estate funds are **never** drawn to pay the platform bill.
`PlatformBillingService` posting to `platform_subscription_revenue` is the platform's
*own* books, separate from the tenant estate's RLS-scoped double-entry ledger.

---

## 5. The MIGRATIONS needed (append-only, RLS, forward-only)

Latest applied forward migration is **0319**. New migrations are immutable +
forward-only + FORCE-RLS on every tenant-scoped table (CLAUDE.md). **Same migrations
in both repos.**

| Migration | Creates / alters | Notes |
|---|---|---|
| **0320_tenant_llm_budgets.sql** | Promote the archived 0272 into a **forward** migration: `tenant_llm_budgets` (+ new `spend_brain_turns`, `spend_agent_ms`; `period_kind` adds `session_5h`,`weekly`) + `tenant_llm_budget_caps` (`cap_brain_turns`, `cap_tokens`, `cap_cents`, `allowed_tiers[]`, `downgrade_at_fraction`, `period_kind`). Atomic `ON CONFLICT DO UPDATE` increment. | The audit's #1 blocker: 0272 lives in `.archive/` and is **never applied** → governor passes through unlimited. FORCE-RLS both tables. |
| **0321_plan_entitlements.sql** | `plan_entitlements` catalog: `borjie_plan` PK → `cap_brain_turns`, `cap_tokens`, `cap_cents`, `period_kind`, `allowed_tiers[]`, `downgrade_at_fraction`, `overage_enabled_default`, `stripe_price_id`, `stripe_meter_id`. Platform-metadata table (tenant_id NULL, like corpus). | The missing plan→limits table (audit §1). Seeded with the §1.1 tiers. |
| **0322_platform_subscription_lifecycle.sql** | Extend `tenant_subscriptions` (0178) with `stripe_subscription_id`, `stripe_customer_id`, `current_period_start/end`, `cancel_at_period_end`, `overage_enabled`, `overage_cap_cents`. Append-only `platform_billing_events` (webhook idempotency log, hash-chain-friendly). | Enables sub-lifecycle webhook reconciliation (audit §5). FORCE-RLS. |
| **0323_seed_caps_from_plan.sql** | Backfill `tenant_llm_budget_caps` from each tenant's `tenants.plan` via `plan_entitlements`; trigger/function to re-seed on plan-change. | Audit closure-spine #2: "seed caps from the tenant's plan." Without this, even with tables, no tenant has a cap. |

All four are append-only; none edit a shipped numbered file (CLAUDE.md "migrations
are immutable"). Run through `migration-apply-check.yml` on fresh PG17+pgvector.

---

## 6. PRESENT / PARTIAL / ABSENT + the EXACT files to build/extend

| Component | Status | Build / extend (exact files) |
|---|---|---|
| **Tier / plan model** | PARTIAL | Reuse `borjie_plan` (`packages/database/src/schemas/tenant.schema.ts:48`). **BUILD** `plan_entitlements` table (`0321`) + typed registry `packages/billing-entitlements/src/plan-entitlements.ts` (NEW package). |
| **`tenant_llm_budgets` + caps** | ABSENT (built but dark + unmigrated) | **PROMOTE** `packages/database/.archive/migrations/0272_tenant_llm_budgets.sql` → `packages/database/src/migrations/0320_tenant_llm_budgets.sql` (+ `spend_brain_turns`, `spend_agent_ms`, `session_5h`/`weekly`). Export schema in `packages/database/src/schemas/index.ts`. |
| **Metering hook on brain path** | ABSENT (governor dark, 0 callers) | **WIRE** `governor.evaluateCall` PRE + `governor.recordSpend` POST at `services/api-gateway/src/routes/brain.hono.ts:494`, `services/api-gateway/src/routes/ai-chat.router.ts:237`, `packages/ai-copilot/src/providers/budget-guard.ts`. Governor already exists: `packages/llm-budget-governor/src/governor.ts` + `postgres-store.ts`. |
| **Governor live store** | PARTIAL (wiring deferred behind P75) | **SWAP** composition root to `createPostgresBudgetStore` in `services/api-gateway/src/composition/llm-budget-postgres-wiring.ts` / `service-registry.ts:1681,2583` so caps survive restart. |
| **Rate-limit enforcement (RSS-08)** | PARTIAL (process-local Map; role-derived) | **EXTEND** `services/api-gateway/src/middleware/rate-limiter.ts:391-419` → shared `redis-token-bucket.ts`; **derive capacity from `plan_entitlements`** not role (`rate-limiter.ts:69-107`); key `bucket:{tenantId}:{period}`. Closes RSS-08. |
| **Honest limit-hit 429** | PARTIAL (flat `BUDGET_EXCEEDED`) | **EXTEND** `brain.hono.ts:497-505` to return `{ code, message, resetsAt, upgradeUrl, remaining }` from the governor `block` decision (`packages/llm-budget-governor/src/types.ts:63-80`). |
| **Stripe platform subscriptions** | PARTIAL (flat MRR, no catalog/webhook) | **EXTEND** `services/api-gateway/src/composition/billing/platform-billing-service.ts` (derive price from Stripe). **BUILD** NEW `services/api-gateway/src/composition/billing/stripe-platform-client.ts` (Product/Price/Meter/Checkout/Portal) + NEW `services/api-gateway/src/composition/billing/platform-subscription-webhook.ts` (lifecycle, separate from estate `payments-ledger/.../stripe/webhook-handler.ts`). |
| **Overage / upgrade flow** | ABSENT | **BUILD** overage usage-event emitter (Stripe Meter) in `platform-billing-service.ts` + owner-controlled cap on `tenant_subscriptions` (`0322`). |
| **owner-web billing settings (data plane)** | ABSENT (read-only stub) | **EXTEND** `apps/owner-web/src/components/settings/PlanBillingPanel.tsx`: usage gauge, remaining, resetsAt, extra-usage toggle, overage cap, "upgrade or wait" CTA. New API `GET /billing/usage` + `POST /billing/overage` on `services/api-gateway/src/routes/owner/billing.router.ts`. |
| **admin-web billing console (control plane)** | ABSENT | **BUILD** plan-catalog + Stripe sync + per-org plan/overage + cross-org usage analytics (METADATA only) under `apps/admin-web/.../tenants`. Service-role scoped to platform tables (INV-A). |
| **Estate-vs-platform separation** | PRESENT (correct) | Keep `PlatformBillingService` posting to `platform_subscription_revenue` distinct from `LedgerService.post()` estate ledger. **DO NOT** route platform billing through the estate ledger. |

**Same files/packages in BossNyumba** (`/Users/.../Cursor Projects/BOSSNYUMBA101`) —
identical billing model, identical migrations, identical `plan_entitlements` shape
(plan display names differ for real-estate; caps/structure identical).

---

## 7. The dependency-ordered BUILD-WAVE list (FULL POWERS ON — ship enabled, kill-switch only)

Per the **FULL POWERS DEFAULT ON** directive: each wave ships **ON + verified
end-to-end**, NOT behind a default-OFF flag. The flag name is retained **only as a
kill-switch** (default ON; flipped OFF only for emergency/rollback). Verify-then-ON
is a gate *before* the flip, not a permanent off-state.

- **Wave 1 — Substrate live (the dark→light flip).** Promote 0272 → forward
  `0320` (+ brain-turn/agent-ms/5h/weekly columns); export schema; swap composition
  to `createPostgresBudgetStore`. *Verify:* `migration-apply-check.yml` green on fresh
  PG17; governor store round-trips. **Blocks everything.**
- **Wave 2 — Entitlement catalog + cap seeding.** Build `plan_entitlements` (`0321`),
  the typed `@borjie/billing-entitlements` registry, and `0323` seed-caps-from-plan
  trigger. *Verify:* every tenant gets a cap derived from `tenants.plan`.
- **Wave 3 — Meter the brain path (governor goes live).** Wire `evaluateCall` PRE +
  `recordSpend` POST at `brain.hono.ts` / `ai-chat.router.ts` / `budget-guard.ts`;
  extend `tenant_llm_budgets` increments to brain-turns + agent-ms. **Ship ON.**
  *Verify:* a metered brain turn debits the budget; kill-switch `LLM_BUDGET_GOVERNOR`
  default ON.
- **Wave 4 — Enforce per-org-per-tier (close RSS-08).** Route the token-bucket
  through shared Redis; derive capacity from `plan_entitlements`; key per-org-per-
  period. *Verify:* `sandbox-load-test`-style multi-replica proof that cap ≠
  `max × replicas`.
- **Wave 5 — Honest limit-hit surface (TEST=PAYING).** Structured `429
  BUDGET_EXCEEDED { resetsAt, upgradeUrl, remaining }`; owner-web usage gauge +
  resetsAt + "upgrade or wait" CTA; surfaced (never silent) downgrade banner.
  *Verify:* hitting the cap shows reset time + upgrade CTA, no fake answer.
- **Wave 6 — Stripe platform subscriptions.** Product/Price/Meter catalog +
  plan→price mapping; Checkout + Customer Portal; separate platform
  subscription-lifecycle webhook reconciling `tenant_subscriptions.status`. *Verify:*
  upgrade in Checkout flips the live plan + reseeds caps; webhook idempotent.
- **Wave 7 — Overage / extra-usage flow.** Owner-controlled overage toggle + monthly
  cap; Stripe Meter usage-events for overage; no-rollover; three honest states.
  *Verify:* overage charges land as Stripe invoice lines, never estate ledger entries.
- **Wave 8 — admin-web control-plane console (INV-A).** Plan catalog, Stripe sync,
  per-org plan/overage policy, cross-org usage analytics (METADATA only; service-role
  scoped to platform tables). *Verify:* console reads zero tenant business rows.

**Kill-switches (default ON):** `LLM_BUDGET_GOVERNOR`, `PLATFORM_BILLING_ENFORCE`,
`PLATFORM_OVERAGE` — each flips OFF only for emergency/rollback, never a dark default.

---

## 8. Open questions to confirm before build (from the source dossier)
- **"Brain Unit" definition:** pure cost-weighted tokens, or composite incl.
  tool-calls/agent-steps (CPR/CPAM)? Pick ONE and instrument it first (dossier §4).
- **RSS-08 → shared-Redis** is a prerequisite for correct multi-replica enforcement
  (currently cap = `max × replicas`).
- **`createPostgresBudgetStore` wiring** (deferred behind P75) must land or caps reset
  every deploy.
- **Stripe "pricing plans"** still private-preview — confirm GA, else fall back to
  `Meter` + `credit-grant` + separate overage `Price`.
- **Platform currency:** subscription billed in USD via Stripe (Borjie revenue),
  independent of the tenant's TZS estate currency. This is **NOT** the
  domestic-non-TZS-rejection rule (which governs *estate* contracts only).

---

## Sources
- `Docs/research/billing-claude-code-model.md` (Claude-Code model dossier)
- `Docs/research/billing-substrate-audit.md` (Borjie substrate audit, READ-ONLY)
- `Docs/research/MASTER_GAP_REGISTER.md` (FULL POWERS DEFAULT ON · TEST=PAYING ·
  Platform billing · INV-A · RSS-08)
- Verified in-repo: `packages/llm-budget-governor/{governor,types,postgres-store}.ts`,
  `packages/database/.archive/migrations/0272_tenant_llm_budgets.sql`,
  `services/api-gateway/src/composition/billing/platform-billing-service.ts`,
  `services/api-gateway/src/routes/{brain.hono.ts,owner/billing.router.ts}`,
  `services/api-gateway/src/middleware/rate-limiter.ts`,
  `apps/owner-web/src/components/settings/PlanBillingPanel.tsx`,
  `services/payments-ledger/src/providers/stripe/`.

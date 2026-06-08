# Platform Billing — the Claude-Code Model (dossier)

**Lane:** `claude-code-billing-model`
**Date:** 2026-06-09
**Author:** research subagent (parity-final integration)
**Scope:** How **Borjie charges the OWNER for the platform itself** — the
SaaS/subscription rail. This is the *platform* money path, NOT the tenant
*estate* money (royalty / ledger / M-Pesa). The two MUST NEVER be conflated.

---

## 0. The owner directive in one paragraph

Borjie bills the platform **exactly like Anthropic bills Claude / Claude Code**:
**subscription TIERS**, each carrying **usage RATE-LIMITS** (per-period
brain-turn / agent-compute / token budgets — the Claude Code "5-hour rolling
window + weekly cap" shape), **METERED per org**, billed through **Stripe**
(Borjie's revenue rail). When an org hits its limit it gets an **honest**
"limit reached — resets at *X*, or upgrade / enable extra usage" message —
**never** a silent degrade or a fake answer (TEST=PAYING). **Full powers are
DEFAULT ON within the tier's usage budget** — the limit is the *usage cap*,
not a *feature gate*. Same billing model in both repos (Borjie + BossNyumba);
they share the billing rail.

> **Hard separation.** Platform billing (this doc) = Borjie's revenue from the
> owner, Stripe, tenant-LLM-budget substrate. **Estate money** (royalty, double-
> entry ledger, M-Pesa/Stripe *tenant* payments) goes through
> `LedgerService.post()` and is governed by RLS + the immutable double-entry
> invariant. A platform overage charge is a Stripe charge to Borjie; it is
> **not** a ledger posting. Do not route platform billing through the estate
> ledger, and do not route estate money through the platform meter.

---

## 1. The model to mirror — Anthropic Claude / Claude Code (June 2026)

### 1.1 Subscription tiers + price points

| Plan | Price (June 2026) | Models | Claude Code? | Notes |
|------|-------------------|--------|--------------|-------|
| **Free** | $0 | Sonnet 4.6, Haiku 4.5 | no | small rolling allowance |
| **Pro** | **$20/mo** ($17/mo annual) | all models + Claude Code | yes (shared pool) | the baseline paid tier |
| **Max 5x** | **$100/mo** | all models | yes | ~5× Pro usage; priority routing in peak |
| **Max 20x** | **$200/mo** | all models | yes | ~20× Pro usage; the power-user tier |
| **Team Standard** | **$25/seat/mo** ($20 annual) | Sonnet, Haiku only — **no Opus** | **no** | collaboration, admin tooling |
| **Team Premium** | **$125/seat/mo** ($100 annual) | all models + **Claude Code** | yes | "premium seat"; ~6.25× Pro/session |
| **Enterprise** | custom (~$20/seat seat-fee **+ metered usage**; in-market quotes start ~$60/seat, min ~70 users) | all + admin/SSO/integrations | yes | seat fee covers workspace + admin; usage scales metered |

Team plans require **min 5 members**, support **up to 150 seats**; above 150 →
Enterprise. The structural lesson: **the seat fee is the *base*, and Claude Code
(the compute-heavy capability) is gated to the *premium* seat / higher tier —
not because the feature is locked, but because that tier carries the larger
usage budget.**

### 1.2 Rate-limit mechanics (the heart of the model)

Three nested windows stack on top of each other:

1. **5-hour rolling session window** — the primary limit. It **starts on your
   first message** of a session and resets 5 hours later. Each tier gets a
   per-window **token budget** (approximate, post-May-2026 doubling):
   - Pro ≈ **44,000 tokens / 5h window**
   - Max 5x ≈ **88,000 tokens / 5h window**
   - Max 20x ≈ **220,000 tokens / 5h window**
   The May 2026 update roughly **doubled** the 5-hour budget for longer
   uninterrupted sessions.

2. **Weekly limits** (added **28 Aug 2025**, sit *on top* of the 5-hour window,
   reset **7 days after the session starts**). There are **two** weekly caps:
   - one **overall** weekly cap (all models)
   - one **model-specific** weekly cap (originally Opus-specific; on Max plans,
     a separate Sonnet-vs-all-models split). Stated rationale: rein in the <5%
     of power users running Claude Code 24/7 and curb account-sharing/reselling.
   Indicative weekly hours: Pro ≈ 40–80h Sonnet; Max 5x ≈ 140–280h Sonnet +
   15–35h Opus; Max 20x ≈ 240–480h Sonnet + 24–40h Opus.

3. **Per-org / per-account scope** — limits are tracked per account (per org for
   Team/Enterprise), enforceable per user/IP/API-key/tenant/model.

### 1.3 How usage is *metered* (the unit) + Opus-vs-Sonnet weighting

- **The unit is the TOKEN, not the message.** Long prompts, large files, and
  deep conversation history all burn the budget even on a handful of prompts.
- **Model weighting is by cost.** Opus is ~**1.7×** Sonnet on list price
  ($5/$25 per-M in/out for Opus vs $3/$15 for Sonnet; Haiku $1/$5). So Opus
  **consumes meaningfully more quota per token** than Sonnet — the meter is
  effectively *cost-weighted tokens*, not raw tokens. Guidance Anthropic gives
  users: switch to Opus when you need it, don't leave it on by default.
- Claude Code surfaces spend live: `/cost` (API-key sessions) and `/status`
  show running window/session consumption; the community `ccusage` tool reads
  the same usage data.
- On AWS Marketplace, Anthropic rates token usage in USD at per-model rates,
  applies discounts, then **converts to "CCU" (Claude Consumption Units) at
  $0.01/CCU** and reports hourly. This is the canonical "**normalize
  heterogeneous model spend into one billable unit**" pattern.

### 1.4 The limit-hit UX (honest, never silent)

The exact pattern to mirror:

- **Approaching:** a soft warning — *"Approaching 5-hour limit"* (and the
  analogous weekly warning) when nearing the cap.
- **Hit (no extra usage):** a **blocking** error —
  *"5-hour limit reached — resets [time]."* The reset time is shown explicitly.
- **Hit (extra usage / credits enabled):** *"5-hour limit resets [time] —
  continuing with usage credits."* The user gets a clear notice that they are
  now spending beyond the included allowance.
- General message family: *"You've hit your limit for Claude messages. Please
  wait before trying again."*

Key properties: **the reset time is always shown**; the user is **told whether
they're now paying overage**; and the system **stops or switches to paid
overage — it never silently degrades the answer.** That honesty IS the product
contract (TEST=PAYING).

### 1.5 Overage / extra-usage / pay-as-you-go fallback

- In 2026 Anthropic added an **"extra usage" toggle** on every paid consumer
  plan. When you exhaust the included limit you can **opt in** to continue at
  **standard API rates**, with a **monthly spend cap you control**. Overage is
  billed **separately** from the subscription.
- **Effective 15 Jun 2026:** *programmatic* (Claude Code / API-style) usage
  moves **off the shared subscription pool** onto a **separate monthly credit
  pool** billed at full API rates: Pro = **$20** credit, Max 5x = **$100**,
  Max 20x = **$200**. **Unused credits do not roll over.**
- Extra-usage / overage rates anchor to the API price card (Haiku $1/$5,
  Sonnet $3/$15, Opus $5/$25 per-M in/out) — so the fallback is literally
  "drop to pay-as-you-go API pricing once the subscription budget is spent."

**The shape to copy:** *included budget (subscription) → optional metered
overage at a transparent rate, user-capped → hard stop at the user's overage
cap.* Three honest states: included / paid-overage / stopped.

---

## 2. Broader SOTA — usage-based AI-product billing (2026)

### 2.1 The dominant pattern: **hybrid (subscription + usage)**
- Chargebee 2025: **43%** of companies use hybrid today, projected **61% by
  end-2026**. A stable subscription **base** + a usage component that **scales
  with delivered value**. This is exactly the Claude tiers-plus-overage shape.

### 2.2 Prepaid credits / token burndown
- Credits/tokens = prepaid spend-over-time units; standard across OpenAI,
  Anthropic, and AI-native startups because they give the customer a **sense of
  budget control** while staying flexible. Stripe records every credit
  grant/use/expiry in an **immutable ledger** (credit-balance-transactions API).

### 2.3 New cost primitives for *agent* products (Bessemer)
The seat no longer captures the cost of tokens, context windows, tool calls, or
agent steps. The 2026 primitives:
- **CPT** — cost per thousand tokens
- **CPR** — cost per resolved request
- **CPAM** — cost per agent-minute
These are the right metering dimensions for an **agent/brain** product where the
cost driver is LLM/agent compute — Borjie's exact situation.

### 2.4 Stripe usage-based billing (the implementation rail)
- Since API `2025-03-31.basil`, **every metered price requires a backing
  `Meter`**; the legacy usage-records API is gone. You **report usage events**;
  Stripe **aggregates** to an invoice at cycle end.
- **Pricing plans** (private preview): combine **rate cards** (usage) + **license
  fees** (recurring base) + **service actions** (recurring credit-grant
  allocation) in one plan — i.e. subscription-base + included-credits +
  metered-overage in a single Stripe object.
- **Billing credits**: create a credit grant (Dashboard/API); credits only apply
  to subscription line items linked to a meter price; immutable ledger of every
  transaction.
- **Mar 2026 — Stripe LLM token billing**: send granular usage (tokens, model
  API calls, agent tasks, automated workflows); Stripe meters and converts to
  charges. Usage-based became the **default** model for AI startups.
- Supported shapes day-one: token-based, outcome-based, credit-burndown,
  subscription-with-overages.

### 2.5 Rate-limit-as-billing-enforcement
- **Redis token-bucket** (Lua-atomic, shared counters across gateway nodes) is
  the canonical distributed enforcer: tokens accrue to a max capacity, each
  request consumes, empty bucket → deny until refill. Token-bucket allows
  **controlled bursts** while holding a steady average; sliding/fixed window
  suit hard "N per day" quotas. Enforce **per user / IP / API-key / tenant /
  model**. This is precisely RSS-08's role: the meter *records* spend, the
  bucket *enforces* the cap in the request path.

### 2.6 Operating table-stakes
- **"You cannot charge for what you cannot measure — instrument before you
  price."** Usage alerts, spend dashboards, and billing forecasts are
  non-negotiable for any consumption product. (Maps directly to Borjie's
  observability/usage-metering substrate.)

---

## 3. Recommended model for Borjie (estate-OS, cost driver = LLM/agent compute)

The cleanest tier + limit + metering model, mapped onto existing substrate:

### 3.1 Tiers (per ORG; seats/roles live *within* the org)
Mirror Claude's ladder; full powers default-on in every paid tier — the tier
sizes the **usage budget**, not the feature set:

| Borjie tier | Analogue | What scales |
|-------------|----------|-------------|
| **Starter** | Pro $20 | small per-period brain-turn / agent-compute budget |
| **Pro** | Max 5x $100 | ~5× budget; priority routing |
| **Max / Estate** | Max 20x $200 | ~20× budget; heavy autonomous-MD workloads |
| **Enterprise** | Enterprise | base seat-fee + **metered usage**, custom caps, SSO/admin |

Junior tiers may exclude the most expensive model (Opus-equivalent) the way
Team Standard excludes Opus — but **as a budget-economy choice, surfaced
honestly, not a silent capability lock.**

### 3.2 The metering UNIT — cost-weighted tokens → "Brain Units"
Adopt the **CCU pattern**: rate each brain-turn's token spend in USD at the
per-model rate, **cost-weight Opus > Sonnet > Haiku** (the existing
`TIER_RANK` haiku=1 / sonnet=2 / opus=3 and `highest_tier_used` tracking is the
seed), normalize to a single internal unit ("Brain Unit" / agent-minute). Meter
on **CPT / CPR / CPAM** dimensions, not seats. This is what makes the cost
driver (LLM/agent compute) the thing actually billed.

### 3.3 The LIMIT windows
- **Rolling session window** (Claude's 5-hour) for burst fairness — implement
  with the **RSS-08 Redis token-bucket** (the meter counts cost-weighted
  tokens, the bucket enforces the per-period cap atomically across replicas).
  Note RSS-08 is currently process-local Map → real cap = max × replicas; the
  register flags routing it through **shared Redis** as the fix — billing
  correctness **depends on closing RSS-08**.
- **Period budget** (daily/monthly) via the **`tenant_llm_budgets` /
  `tenant_llm_budget_caps`** substrate (migration 0272): per-period
  `spend_tokens` + `spend_cents`, atomic `ON CONFLICT DO UPDATE` increment,
  per-tenant `cap_cents` / `cap_tokens` / `allowed_tiers` /
  `downgrade_at_fraction`. The Postgres-backed `@borjie/llm-budget-governor`
  store already implements `getBudget` / `setBudget` / `getUsage` /
  `recordSpend`. (Wiring note: the composition-root swap to
  `createPostgresBudgetStore` was deferred behind P75 — must land for caps to
  survive restart; the in-memory store reset spend to zero on every deploy.)

### 3.4 The limit-hit UX — honest, three states (TEST=PAYING)
1. **Approaching** → soft banner: *"Approaching your monthly brain budget —
   resets [date]."*
2. **Included exhausted, extra-usage OFF** → hard, honest stop:
   *"Limit reached — resets [time]. Upgrade your plan or enable extra usage."*
   **No fake answer, no quiet model-downgrade-without-telling-the-owner.**
3. **Extra-usage ON** → *"Included budget spent — continuing with metered usage
   (≈ [rate]); stops at your $[cap] cap."* Mirror Anthropic's separate
   **overage credit pool** + **user-controlled monthly cap** + **no rollover**.

> **Caveat on auto-downgrade.** The substrate has a `downgrade_at_fraction`
> (auto-drop to a cheaper model at 85% of budget). Per the owner's *honest /
> never-silent-degrade* directive, an auto-downgrade is acceptable **only if it
> is disclosed** ("now on the economy model to stretch your budget") — a
> *silent* swap to a weaker model violates TEST=PAYING. Treat downgrade as a
> **surfaced** budget-economy mode, not a hidden one.

### 3.5 The billing RAIL — Stripe
- One **Stripe `Meter`** per billable dimension (brain-units / agent-minutes).
- A **Stripe "pricing plan"**: license fee (tier base) + service-action credit
  grant (included budget) + rate card (metered overage) — the whole
  base-plus-included-plus-overage shape in one object.
- Report usage events from the **observability/usage-metering** path (the meter
  is the source of truth; instrument *before* pricing).
- **Per-ORG billing** — the org/tenant is the Stripe customer; seats/roles are
  internal. Surface a **spend dashboard + forecast + alerts** (table stakes).

### 3.6 The non-negotiable separation (restate)
Platform billing (Stripe charge to the owner, metered on brain compute) is
**physically and accounting-wise distinct** from estate money (royalty/ledger/
M-Pesa via `LedgerService.post()`, RLS-scoped, immutable double-entry). A
platform overage is a Stripe invoice line; it is **never** a ledger journal
entry, and tenant estate funds are **never** drawn to pay the platform bill.

---

## 4. Open questions / things to confirm before build
- Exact internal unit definition ("Brain Unit"): pure cost-weighted tokens, or a
  composite that also prices tool-calls / agent-steps (CPR/CPAM)? — pick one and
  instrument it first.
- RSS-08 → shared-Redis migration is a **prerequisite** for correct multi-replica
  enforcement (currently cap = max × replicas).
- `createPostgresBudgetStore` composition-root wiring (deferred behind P75) must
  land or caps reset on every deploy.
- Stripe "pricing plans" are still **private preview** — confirm GA / fallback to
  meter + credit-grant + separate overage price if not yet available.
- TZ/multi-currency: platform subscription likely billed in USD via Stripe
  (Borjie's revenue), independent of the tenant's TZS estate currency — confirm
  the platform-currency policy (this is *not* the domestic-non-TZS-rejection
  rule, which governs *estate* contracts).

---

## Sources
- [Claude Help Center — What is the Max plan?](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)
- [Claude Help Center — How do usage and length limits work?](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)
- [Claude Help Center — Models, usage, and limits in Claude Code](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code)
- [Claude Help Center — Manage extra usage for paid Claude plans](https://support.claude.com/en/articles/12429409-manage-extra-usage-for-paid-claude-plans)
- [Claude Help Center — Troubleshoot Claude error messages](https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages)
- [Claude API Docs — Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude API Docs — Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [TechCrunch — Anthropic unveils new rate limits to curb Claude Code power users (28 Jul 2025)](https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/)
- [apidog — Weekly rate limits for Claude Pro/Max guide](https://apidog.com/blog/weekly-rate-limits-claude-pro-max-guide/)
- [Geeky Gadgets — Claude Code usage limits & plans (Aug 2025)](https://www.geeky-gadgets.com/claude-code-usage-limits-pricing-plans-guide-sept-2025/)
- [Faros.ai — Claude Code Token Limits for engineering leaders](https://www.faros.ai/blog/claude-code-token-limits)
- [CloudZero — Claude pricing 2026](https://www.cloudzero.com/blog/claude-pricing/)
- [findskill.ai — Claude Code pricing after June 15: decision table](https://findskill.ai/blog/claude-code-pricing-after-june-15-decision-table/)
- [LaoZhang AI — Claude extra usage cost](https://blog.laozhang.ai/en/posts/claude-extra-usage-cost)
- [Saeree/GrandLinux — Claude Code in Team Plan: Premium Seat at $100](https://www.grandlinux.com/en/blogs/claude-team-premium.html)
- [Finout — Claude pricing in 2026 for individuals/orgs/developers](https://www.finout.io/blog/claude-pricing-in-2026-for-individuals-organizations-and-developers)
- [Stripe Docs — How advanced usage-based billing works](https://docs.stripe.com/billing/subscriptions/usage-based/advanced/about)
- [Stripe Docs — Implement advanced usage-based billing with pricing plans](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-plans)
- [Stripe Docs — Set up billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits/implementation-guide)
- [Stripe Blog — Introducing credits for usage-based billing](https://stripe.com/blog/introducing-credits-for-usage-based-billing)
- [PYMNTS — Stripe introduces billing tools to meter and charge AI usage (Mar 2026)](https://www.pymnts.com/news/artificial-intelligence/2026/stripe-introduces-billing-tools-to-meter-and-charge-ai-usage/)
- [Flexprice — Hybrid pricing guide for SaaS & AI (2026)](https://flexprice.io/blog/hybrid-pricing-guide)
- [Lago — 6 proven pricing models for AI SaaS](https://getlago.com/blog/6-proven-pricing-models-for-ai-saas)
- [Schematic HQ — Why usage-based billing is taking over SaaS (2026)](https://schematichq.com/blog/why-usage-based-billing-is-taking-over-saas)
- [Redis Docs — Rate limiter / token-bucket use cases](https://redis.io/docs/latest/develop/use-cases/rate-limiter/)

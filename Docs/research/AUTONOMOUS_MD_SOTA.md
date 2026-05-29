# Autonomous MD — State-of-the-Art research

**Last updated:** 2026-05-29
**Audience:** Borjie engineers shipping the Mr. Mwikila autonomous-MD
framework, security reviewers, and external auditors evaluating the
delegation + reversibility model.
**Purpose:** Survey the 2024-2026 SOTA on autonomous-agent oversight
patterns (Anthropic Computer Use, OpenAI Operator, Devin, Manus, Cursor
agent governance) and synthesise the Borjie-specific framework that
lets Mr. Mwikila act on the owner's behalf with auditability + override.

The Borjie owner is frequently non-technical, often offline, sometimes
travelling between Geita, Mwanza, and Dar es Salaam. Mr. Mwikila is the
brain that runs the day-to-day under owner-defined delegation tiers
with a reversible-action inbox and hard-coded inviolable safety rails.

## 1. The four reference systems

### 1.1 Anthropic Computer Use (Sonnet 4.6+)

Anthropic frames the agentic loop as "make human expertise count where
it matters most." Three patterns translate cleanly to Borjie:

1. **Bounded autonomy.** Computer Use logs every action and the loop
   is interruptible. Borjie's analogue is the kill-switch (fail-closed)
   + per-action audit chain.
2. **Prompt-injection classifier → step-up confirmation.** When the
   classifier flags a screenshot, the agent stops and asks for human
   confirmation before the next action. Borjie's parallel is the
   four-eye gate + the inviolable refusal layer.
3. **Tool-as-action-envelope.** Every action is a discrete tool call
   with its own ID. Borjie already does this — every action is a brain
   tool ID + provenance row + audit chain link.

Source pattern adopted: the **per-action confirmation envelope** is
exposed in the Mwikila inbox row's `requires_confirmation` field when
the delegation tier is T1 (propose-only). The owner's one-tap approve
in the inbox is the moral equivalent of the Computer Use "are you sure"
prompt.

### 1.2 OpenAI Operator (computer-using agent)

Operator's headline pattern is the **confirmation prompt on
irreversible actions**. OpenAI's own internal testing found
confirmations reduced model-mistake severity by roughly 90%; of 13
test errors, 5 were irreversible and 8 reversible within minutes.

Three concrete Operator patterns Borjie adopts:

1. **Default to reversible.** Operator's guidelines say: "minimize and
   disclose irreversible actions; prefer reversible approaches."
   Borjie's T2 tier ships a `reversal_token` valid for `N` hours
   (default 24h, configurable). The action is executed but a one-tap
   reversal undoes it; only after the window expires is the action
   final.
2. **Confirmation only on irreversible.** Operator critics have noted
   that asking on every action ("are you sure" 90 seconds apart) is
   not real autonomy. Borjie's tiers (T0/T1/T2/T3) let the owner
   classify categories by reversibility so we never ask twice on a
   reversible-by-default category, but we always ask on T1 high-stakes
   categories.
3. **State-of-the-world disclosure.** Operator describes what it is
   about to do before doing it. Borjie's `mwikila_actions_inbox.summary`
   + `rationale` columns are the disclosure surface.

### 1.3 Devin (Cognition Labs) — 1-5 autonomy scale

The 2024-2026 Devin documentation crystallised the industry's six-point
autonomy scale (Levels 0-5):

| Level | Name | Behaviour |
|-------|------|-----------|
| L0 | Observe-only | Watches; never acts. |
| L1 | Suggest | Suggests actions; human decides. |
| L2 | Recommend-with-reasoning | Recommendations carry rationale + logs. |
| L3 | Wait-for-approval | Has a draft; executes only on human OK. |
| L4 | Execute-then-notify | Acts immediately, opens an override window. |
| L5 | Fully autonomous | Acts and only logs. |

Borjie maps this onto four tiers (T0 = L0/L1; T1 = L3; T2 = L4; T3 = L5)
because owner-facing UX with only four buttons is more legible than
six tiers. The four factors Devin uses to choose the level —
**reversibility, blast radius, signal quality, time sensitivity** —
are the same factors Mr. Mwikila uses internally to decide whether to
escalate an action to a higher tier even when the category default
allows the lower one.

Devin also walked back several 2024 autonomy claims when production
deployments revealed the demo-vs-shipping gap. Borjie therefore ships
T2 as the default for the routine categories (shifts, payroll-prep,
royalty-prep, license reminders, marketplace counter-bids within
delegation envelope), and reserves T3 for items the owner has
explicitly elevated. T0/T1 is the default for hiring/firing, capex,
contracts.

### 1.4 Manus (Butterfly Effect)

Manus's headline workflow pattern is **citation-first output**: every
web fact carries a citation. Borjie already enforces this via the
Auditor Agent (`evidence_id` required on every junior recommendation).

The Manus pattern Borjie adopts for autonomy is **workflow memory
across days**: a multi-step task survives a session break. Borjie's
`mwikila_actions_inbox` is the persistent surface — once a proposal
lands it lives there until owner-approved, owner-denied, executed, or
reversed.

### 1.5 Cursor agent governance + Oasis policy layer

Cursor's enterprise governance layer (with Oasis) introduced four
per-action policy verdicts:

- **allow** — execute immediately
- **warn** — execute but log a warning
- **require step-up approval** — pause and prompt the human
- **deny** — refuse

Borjie's analogue is the inviolable layer + the delegation tier
combination. The inviolable layer is "deny" or "require step-up";
the tier matrix is "allow" or "warn" depending on category.

Cursor also formalised the **acting-on-behalf identity binding** —
the audit row must explicitly link the triggering user to the
executing OAuth identity acting on their behalf. Borjie's audit chain
already carries the `actor` field; the new inbox row adds
`acting_on_user_id` (the owner) + `actor='mwikila'` so a regulator can
prove the action was bounded by the owner's delegation.

## 2. The Borjie delegation tier system

### 2.1 Tier definitions

| Tier | Name | Behaviour |
|------|------|-----------|
| T0 | Inform-only | Mr. Mwikila does NOT act. Drops a notification in the inbox; owner does the action. Default for everything sensitive (hiring, capex > threshold, contracts). |
| T1 | Propose | Mr. Mwikila drafts a proposal in the inbox. One-tap approve → executes. Default for routine but moderate-impact actions (license-renewal forms, payroll batch). |
| T2 | Act-with-reversal | Mr. Mwikila executes immediately. Inbox row carries a `reversal_token` valid for `N` hours (default 24h). One-tap reverse undoes. Default for low-stakes routine (shift schedule drafts, royalty filing pre-fills, marketplace counter-bids within envelope). |
| T3 | Irrevocable | Mr. Mwikila acts; no reversal token. Rare. Owner explicitly elevated this category. |

### 2.2 Categories (12)

| Category | Default tier | Rationale |
|----------|--------------|-----------|
| `shifts` | T2 | Schedule changes are reversible within hours. |
| `payroll-prep` | T1 | Owner must approve every payroll batch. |
| `royalty-filing` | T1 | Regulator-facing; owner signs. |
| `license-renewal-reminders` | T2 | Renewal reminder draft is harmless. |
| `contract-followups` | T1 | Counterparty-facing; owner reviews. |
| `worker-hires` | T0 | Owner decides hires; Mr. Mwikila informs only. |
| `worker-discipline` | T0 | Hard stop. No autonomous discipline. |
| `capex` | T0 | Money out is owner-only above threshold. |
| `inventory-orders` | T2 | Routine restock is reversible. |
| `compliance-filings` | T1 | Owner signs. |
| `marketplace-bids` | T1 | Buyer-initiated bid on a parcel; owner reviews. |
| `marketplace-counters` | T2 | Counter-offer within envelope; owner can reverse. |

### 2.3 Reversibility windows

The `reversal_token` is a one-time UUID that the inbox UI surfaces with
a countdown clock ("Reversible for 23h 14m"). The window is computed
from `executed_at` + the category's default window (24h for most; 4h
for marketplace-counters because counterparties may rely on the price).

After the window expires, the action is final and the inbox row
transitions from `executed` to `committed` (T2's terminal state). The
audit chain records both the execution and the commitment events.

### 2.4 Owner override semantics

At any time the owner can:

1. **Approve** a T0/T1 proposal — flips status to `owner_approved`,
   Mr. Mwikila executes, status becomes `executed`.
2. **Deny** a T0/T1 proposal — flips status to `owner_denied`, no
   action taken, learnings written to the decision-journal.
3. **Reverse** a T2 execution within the window — flips status to
   `reversed`, the underlying action is undone via a domain-specific
   reversal handler (e.g. shift schedule deleted + workers re-notified).
4. **Adjust delegation tier** for a category — takes effect on the
   next tick. Past actions remain in their tier.

## 3. Inviolable safety rails (owner cannot disable)

These are hard-coded refusals registered in the kernel's `inviolable`
layer. They override every delegation tier:

| Rule | Reason |
|------|--------|
| Never fire/hire family members | Conflict of interest; family is owner-only territory. |
| Never deposit > monthly threshold without owner approval | Money-path safety; CLAUDE.md hard rule. |
| Never enter contracts in non-TZS currency | USD-cliff remediation (post-Mar-2026); domestic non-TZS contracts rejected at the API layer. |
| Kill-switch fail-closed | If the platform safety substrate is down, no autonomous action fires; the inbox is suspended. |
| Capex > delegation envelope | Even if the owner set capex to T3, the inviolable cap (per `owner_delegation_prefs.envelope_threshold_tzs`) wins. |

These five rules are checked in the `runWithInviolableGuard` helper in
`packages/central-intelligence/src/kernel/autonomy/inviolable-rails.ts`.
Every handler invokes the guard before executing. A failure transitions
the proposal to status `blocked_by_inviolable` and emits an owner-
facing alert.

## 4. Audit + observability invariants

Every autonomous action produces:

1. **Decision-journal entry** — `decided_by_kind='agent_apply'`,
   `decided_by_actor_id='mwikila'`, rationale carries the
   delegation-tier reasoning + handler ID + envelope check result.
2. **Audit hash-chain row** — `actor='mwikila'`,
   `acting_on_user_id=<owner>`, `delegation_tier=<T0..T3>`. The chain
   is append-only and hash-linked per CLAUDE.md.
3. **Cockpit SSE event** — `MwikilaActedEvent` for executions,
   `MwikilaProposesEvent` for proposals. Owner cockpit shows live
   pulses.
4. **Pino structured log line** — `mwikila.action.executed` or
   `mwikila.action.proposed` with full structured payload.

## 5. Why this is SOTA-equal-or-better

| Capability | Anthropic CU | OpenAI Operator | Devin | Manus | Cursor+Oasis | **Borjie** |
|------------|--------------|-----------------|-------|-------|--------------|------------|
| Per-action confirmation | Y | Y | Y | partial | Y | **Y** |
| Reversibility window | N | partial | Y | N | N | **Y (24h default, configurable)** |
| Delegation tier matrix | N | partial | Y (1-5) | N | N | **Y (4 tier × 12 cat)** |
| Inviolable hard rules | partial | partial | partial | partial | Y (deny verdict) | **Y (5 rules, kernel-enforced)** |
| Audit chain | N | N | Y | N | Y | **Y (hash-chained)** |
| Reversal token | N | partial | N | N | N | **Y (one-time UUID)** |
| Reversibility-aware default tier | N | N | partial | N | N | **Y (per-category)** |
| Owner cockpit live pulses | N | N | N | N | N | **Y (SSE)** |
| Bilingual sw/en inbox | N | N | N | N | N | **Y** |

Borjie ships every dimension. The vertical-specific moat is the same
five-pillar argument from `AGENTIC_SOTA_COMPARISON.md` (corpus +
regulatory packs + personas + closed loop + bilingual + multi-currency)
applied to autonomy: a Tanzanian mining-estate owner does not want a
generalist agent with shell access; they want Mr. Mwikila — bounded,
auditable, reversible, and tuned to TMA / PCCB / GMP-21 royalty rules.

## 6. Open questions for 2026 Q3+

1. **Multi-owner delegation** — when an owner adds a co-owner or a
   site manager with elevated trust, do we layer a per-actor tier on
   top of the per-category default? (current design: no, single owner
   delegation; multi-owner is roadmap.)
2. **Cross-tenant autonomy** — when an owner runs multiple tenants
   (Geita + Mwanza), do we let one inbox span tenants? (current
   design: per-tenant inbox; cross-tenant aggregation lives in the
   cockpit's portfolio view.)
3. **Learning from reversals** — when an owner reverses three T2
   actions in a category, should Mr. Mwikila auto-downgrade that
   category to T1? (proposed; needs owner-side opt-in.)
4. **Voice approval** — the workforce-mobile voice agent could speak
   the proposal summary and accept a spoken "ndio" / "yes". Roadmap.

## 7. References

- Anthropic Claude Computer Use docs and 2026 release notes
- OpenAI Operator System Card (2025-01) and 2026 reviews
- Devin docs (release notes 2026)
- Manus AI 2026 reviews
- Cursor + Oasis governance layer write-up (2026)
- Apptitude AI Agent Autonomy Levels Framework (2026)
- Borjie `Docs/RESEARCH/AGENTIC_SOTA_COMPARISON.md`
- CLAUDE.md (hard rules: money path, RLS, kill-switch, audit chain,
  TZS-primary, evidence-required, Pino logger, no console.log)

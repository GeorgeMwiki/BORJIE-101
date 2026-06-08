# Operational Closed-Loop Fabric — 2026 SOTA Dossier

**Lane:** `fabric-sota`
**Date:** 2026-06-08
**Audience:** Borjie (mining-estate OS) + sibling BossNyumba (real-estate OS) — same brain/wiring, different domain layer. This dossier is domain-agnostic; every pattern applies to both.
**Scope:** The end-to-end fabric that turns a consequential event into a closed loop:

```
DETECT → SCHEDULE durable reminder LADDER → FIRE once cluster-wide (leader-elected, idempotent)
       → ROUTE to right recipient on PREFERRED CHANNEL (+ fallback, delivery+read receipt)
       → ACT (draft+assign, not just nag) → ESCALATE on inaction (dynamic policy)
       → FOLLOW-THROUGH to CLOSURE → CONFIRM+AUDIT (hash-chained, at-least-once)
       → LEARN (self-tune the ladder per recipient)
```

**Honour rails (NEVER violate, carried from CLAUDE.md):** money / licence / deletion stay HITL; predictions APPEND to rule-based decisions, never replace; EN/SW absolute toggle (no mixing); multi-currency `formatCurrency`; AI audit chain is hash-chained, append-only; webhook delivery at-least-once + idempotent consumers.

---

## How to read this dossier

Each fabric stage below maps to one or more SOTA product/research categories. For every stage we give: (a) the 2026 SOTA landscape with named tools and concrete capabilities, (b) the specific mechanic Borjie/BossNyumba should adopt, and (c) a **Beyond-today leap** — the move that goes past what any single 2026 vendor ships.

A central architectural finding frames everything: **no single 2026 vendor closes the whole loop.** Notification platforms (Novu/Knock/Courier) do routing+preferences+receipts but stop at "delivered." Durable-execution engines (Temporal/Inngest/DBOS/Restate) do the survive-restart timers but have no notion of channel or recipient preference. Escalation engines (PagerDuty/incident.io/Rootly) do the policy ladder but are SRE-shaped, not business-event-shaped. AR/dunning tools (Upflow/Growfin/Stripe) close the financial loop only. **The fabric is the integration of these four primitives under one audit chain + one rails layer — that integration is itself the differentiator.**

---

## Stage 1 — DETECT (event → loop genesis)

**SOTA pattern.** The detection edge is the **transactional outbox**: when a domain row changes (licence row gets `expiry`, invoice row gets `due`, equipment row gets `service_due`), the same DB transaction that writes the row also writes an outbox event. A relay polls the outbox every 10–50 ms and publishes. This solves the dual-write problem (you cannot atomically write a row AND emit an event to a broker; the outbox makes them one local transaction). ([event-driven.io](https://event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained/), [microservices.io](https://microservices.io/patterns/data/transactional-outbox.html))

**Critical caveat for the rails:** the outbox guarantees **at-least-once**, not exactly-once. If the relay crashes after publishing but before marking the row delivered, it republishes on restart. Therefore every downstream consumer (the scheduler that creates the ladder) **must be idempotent** — keyed on the event's stable identity (e.g. `licence_id + expiry_date`). This is already a Borjie hard rule ("Webhook delivery is at-least-once. Consumers MUST be idempotent via Idempotency-Key").

**Borjie/BN move.** Borjie already has `SPEC_outbox-producer-dualwrite.md` in this repo. Detection events for the fabric (`*.expiring`, `*.due`, `*.service_due`, `*.shift_gap`, `*.arrears`) should all originate from the outbox so detection inherits the same transactional guarantee as money writes. A "loop genesis" consumer dedups on event identity and only then asks the scheduler to build a ladder.

**Beyond-today leap.** Most systems detect on a fixed rule ("30 days before expiry"). The leap is **predictive detection that APPENDS**: a forecasting model (already specced in `forecast-sota-foundation-models.md`) predicts *which* obligations are at risk of being missed (this owner historically renews late; this buyer historically pays at +14d) and pre-warms a more aggressive ladder — but as an *append* to the rule-based detection, never a replacement (honour rail). The rule still fires at 30 days; the prediction adds an earlier, softer rung.

---

## Stage 2 — SCHEDULE the durable reminder LADDER

**SOTA landscape (durable execution, 2026).** Durable execution stopped being niche in 2025; by 2026 four engines dominate, and the right choice is the one whose durable-timer model survives restarts with exactly-once *effect*:

| Engine | Durability model | Long-running timers | Op. footprint | SDKs | Maturity |
|---|---|---|---|---|---|
| **Temporal** | Persists full execution history to a dedicated cluster; **replays** history to reconstruct state after a worker crash; activities already executed don't re-run | **Workflows can run for years**; `sleep()` persists via history — the canonical long-timer engine | High (Temporal cluster) | Go, Java, Python, TS, .NET, PHP | Production at scale |
| **Inngest** | Event-driven durable step functions; each step individually retryable with backoff | `step.sleep` / `step.sleepUntil` / `step.waitForEvent` — **these don't count toward concurrency capacity while waiting** | Low (serverless/edge friendly) | TS-first | Medium-high |
| **DBOS** | Workflow state = **rows in your existing Postgres**; each `@step()` is idempotent + retried; exactly-once is tightest when side effects stay in the same DB | Postgres-backed sleeps | **Lowest — Postgres only**; shipped Go SDK + Databricks Lakebase partnership Apr-2026 | Python, TS, Go | Early but rising |
| **Restate** | Journal/event-sourced; `ctx.run()` is **natively exactly-once per journal entry** — replays journal on crash, skips already-executed runs, *no app-level idempotency key needed* | Journal-backed durable sleeps | Low (sidecar/embedded) | TS, Kotlin, Java, Go, Python | Medium |

Sources: [devstarsj durable-execution 2026](https://devstarsj.github.io/2026/04/03/durable-execution-temporal-restate-dbos-distributed-workflows-2026/), [Inngest flow control docs](https://www.inngest.com/docs/guides/flow-control), [DBOS vs Temporal 2026](https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution), [Kai Waehner](https://www.kai-waehner.de/blog/2025/06/05/the-rise-of-the-durable-execution-engine-temporal-restate-in-an-event-driven-architecture-apache-kafka/), [Inngest GitHub](https://github.com/inngest/inngest).

**Why this is the spine of the ladder.** A reminder ladder is a long-running workflow: "remind at T-30, T-14, T-7, T-1, T+1, escalate at T+3" may span **months**. A naive cron + DB-flag approach loses runs across pod restarts and deploys, and is plagued by duplicate execution and race conditions (the system-design literature is blunt about this — distributed locks, leader election, DB flags "still do not fully eliminate race conditions, duplicate executions, or missed runs during pod restarts"). A durable-execution engine encodes the entire ladder as one workflow whose `sleep()`s survive restarts — the ladder *is* the workflow. ([Quartz→Temporal at Turo](https://medium.com/turo-engineering/quartz-to-temporal-modernizing-job-scheduling-at-turo-7e120b98472c), [Temporal scheduler vs background jobs](https://medium.com/@cavidan.hatamov/why-temporal-scheduler-changes-how-we-think-about-background-jobs-in-distributed-systems-82051a122e54))

**Borjie/BN move.** Borjie's stack is **Postgres/Supabase-centric** (RLS-forced, the whole money path is double-entry in Postgres). That argues strongly for **DBOS-style "Postgres is the durable store"** as the default ladder engine — it keeps the ladder state inside the same RLS-governed Postgres that already holds the audit chain, minimizes new infra, and gives exactly-once-effect when the side effect (writing the audit row) is in the same DB. Where a ladder needs months-long horizon or massive fan-out, **Temporal** is the proven fallback. The repo already carries `workflow-engine` package + `workflow-engine-wiring.ts` — the recommendation is to make that engine durable-execution-backed rather than in-memory-timer-backed.

**Beyond-today leap — the self-authoring ladder.** Today an engineer hand-codes the rungs. The leap: **an LLM authors the escalation policy from the goal in natural language** ("ensure this licence is renewed before expiry; this owner is HITL on money") and emits a *validated* durable-workflow graph. 2026 research already does NL→workflow (FlowMind generates workflows from user queries; WorkTeam constructs workflows from NL with multi-agents; Microsoft/ServiceNow patent NL→executable-workflow). The Borjie-specific twist: the LLM output is **constrained** — it can only compose pre-approved rungs (notify / wait / re-notify / reassign / escalate-to-owner) and **cannot author a rung that auto-executes a money/licence/deletion action** (honour rail enforced at the policy-gate, not by the LLM's good behaviour). Sources: [WorkTeam](https://arxiv.org/pdf/2503.22473), [workflow-optimization survey](https://arxiv.org/html/2603.22386v1), [Stonebranch LLM-in-workflow](https://www.stonebranch.com/blog/10-clever-ways-to-embed-llm-tasks-in-automation-workflows).

---

## Stage 3 — FIRE once cluster-wide (leader-elected, idempotent)

**SOTA pattern.** Two layers of defence, used together:

1. **Don't rely on leader election alone for correctness.** The Amazon Builders' Library is explicit: leader election is hard (split-brain, two-leaders during partition) and "systems that perform work which is idempotent can often tolerate two leaders with minimal loss of efficiency." So leader election is an *efficiency* optimization; **idempotency is the correctness guarantee.** ([AWS Builders' Library](https://aws.amazon.com/builders-library/leader-election-in-distributed-systems/))
2. **Fence the fire with idempotency + dedup store.** Attach an idempotency key to each rung fire (`ladder_id + rung_index`), check a dedup store before acting, let at-least-once redelivery be harmless. Consumers record processed message IDs for 24–72h. The `Idempotency-Key` header is now an IETF-draft de-facto standard (Stripe, Increase). ([BackendBytes idempotency](https://backendbytes.com/articles/idempotency-patterns-distributed-systems/), [OneUptime exactly-once](https://oneuptime.com/blog/post/2026-01-30-exactly-once-delivery/view))

**The clean answer in 2026:** let the **durable-execution engine own "fire once."** Temporal/Restate/DBOS make a scheduled step fire exactly-once-in-effect by construction (Restate's journal skips already-executed runs *without* app-level keys; Temporal replays history so a fired activity never re-fires). This collapses Stage 3 into Stage 2 — you stop hand-rolling Redis mutexes + Quartz leader election. ([techinterview distributed scheduler](https://www.techinterview.org/post/3233474183/system-design-distributed-task-scheduler-cron-job-delayed-execution-priority-queue-exactly-once-celery-temporal-airflow/))

**Borjie/BN move.** Each rung-fire writes an idempotency-keyed row to the **same hash-chained audit chain** Borjie already enforces. Because the audit row is in Postgres and the ladder engine is Postgres-backed (DBOS-style), the fire + the audit write are *one transaction* → exactly-once effect with zero extra coordination service. This is the cleanest possible satisfaction of the "fire once cluster-wide, nothing dropped" requirement.

**Beyond-today leap.** Idempotency keys that are **semantic, not syntactic**: instead of `ladder_id+rung_index`, the key is a content hash of *what the recipient would experience* (this exact message, this channel, this recipient, this obligation-state). Two different ladders that would nag the same owner about the same overdue royalty on the same morning **collapse to one** — cross-ladder dedup, so a busy owner is never double-pinged when three obligations converge. No 2026 vendor does cross-workflow semantic dedup; it falls out naturally once the audit chain is the dedup substrate.

---

## Stage 4 — ROUTE to the right recipient on their PREFERRED CHANNEL (+ fallback + receipts)

**SOTA landscape (notification orchestration, 2026).** Three platforms define the category; their preference + fallback + receipt models differ in ways that matter:

| | **Novu** | **Knock** | **Courier** |
|---|---|---|---|
| **Preference granularity** | Per-workflow subscriber prefs: `setPreference(user, workflow, {channel:{email,in_app,sms,push,chat}})` | Per-workflow channel-type prefs: `setPreferences(user,{workflows:{wf:{channel_types:{...}}}})` | **Topic-based** subscription mgmt: `topics:{"package-updates":{status:"OPTED_IN"}}` |
| **Channel fallback / escalation** | No native smart routing | Conditional routing via dashboard workflows + **step conditions** ("send email only if in-app not yet *seen*") | **Native** "try email, fall back to SMS" with `escalation: sms` after timeout — the only one with built-in channel escalation |
| **Digest / batch** | `step.digest({amount,unit})` | digest + **batch_size cap** forces flush at N events | visual designer |
| **Workflow authoring** | Code-first (`@novu/framework`, in your repo) | Dashboard visual editor | Visual drag-drop |
| **Deploy** | **Only one fully self-hostable** (needs Postgres+Redis+MongoDB) | SaaS | SaaS |
| **Delivery + read receipts** | basic | **Strongest: explicit message-status model** | provider-level |

Sources: [pkgpulse Novu vs Knock vs Courier 2026](https://www.pkgpulse.com/blog/novu-vs-knock-vs-courier-notification-infrastructure-2026), [Knock notification-infra top platforms](https://knock.app/blog/the-top-notification-infrastructure-platforms-for-developers), [Courier vs Knock](https://www.courier.com/guides/courier-vs-knock-notification-system).

**Read-receipt mechanics (the "delivery+read confirmation" requirement).** Knock's model is the reference: messages carry a **delivery status** (delivered to provider/recipient — mutually exclusive, hierarchical, implicitly managed) and **engagement status** (seen / read / interacted — can be multiple). Status changes fire **outbound webhooks** (`message.seen`, `message.read`) with 8 built-in retries. The recommended source of delivery truth is **provider webhooks** (Twilio/WhatsApp deliver status directly), avoiding rate-limit issues and giving immediate updates. WhatsApp Cloud API itself emits delivery + read (blue-tick) receipts that flow into this model. Sources: [Knock message-statuses](https://docs.knock.app/send-notifications/message-statuses), [Knock webhook event-types](https://docs.knock.app/developer-tools/outbound-webhooks/event-types), [Meta WhatsApp send-messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).

**Per-recipient-per-event-type channel routing (the core ask).** The pattern that satisfies "channel-per-recipient-per-event-type + fallback + read receipts" is **Knock-style step-conditions** + **Courier-style channel escalation** combined: route an event on the recipient's preferred channel *for that event type*, then **escalate to the next channel only if the prior channel was not `seen`/`read` within a delay**. e.g. licence-expiry → owner's preferred WhatsApp → if not read in 2h → SMS → if not read in 6h → email → if not read in 24h → in-app + push. The "not read" gate is exactly Knock's documented use case. Channel fallback on *delivery failure* (WhatsApp down → SMS) is the WhatsApp-BSP standard. Sources: [Knock step-conditions](https://docs.knock.app/designing-workflows/step-conditions), [getkanal WhatsApp guide](https://getkanal.com/blog/whatsapp-business-api-guide), [chatarmin SMS vs WhatsApp](https://chatarmin.com/en/blog/sms-whatsapp-api).

**Borjie/BN move.** Self-hostability + data-residency (Tanzania, RLS, multi-tenant) point to **Novu self-hosted as the channel-delivery substrate**, but Novu lacks native channel-escalation — so the **escalation/ladder logic lives in Borjie's durable workflow engine (Stage 2), not in the notification tool.** Notification tool = "send on channel X and report status"; the durable workflow = "decide channel order, gate on read-receipt, escalate." This separation also satisfies the EN/SW rail: the message *body* is rendered by Borjie's localization layer (absolute single-language per locale) and handed to the notification tool already-localized, so the channel layer never mixes languages.

**Beyond-today leap.** **Learned channel preference, not declared.** Today the recipient (or an admin) sets `WhatsApp first`. The leap: infer each recipient's *effective* channel from read-receipt history — this manager opens WhatsApp in 4 min but email never; this owner ignores push but always reads the 6 a.m. SMS. The fabric **re-orders the channel ladder per recipient from observed seen/read latency**, and APPENDS the inferred order to the declared preference (declared still wins if set — honour rail: predictions append). See Stage 9.

---

## Stage 5 — ACT (draft + assign, not just nag)

**SOTA landscape (agentic follow-through, 2026).** The 2026 shift is from *alerting* to *acting*. AI-SRE agents (incident.io AI SRE, Rootly AI SRE, Resolve.ai, Cleric) no longer just page a human — they investigate, surface root cause, and **draft the fix**: "ask incident to generate a fix and open a pull request, all within Slack." The universal guardrail across every 2026 vendor: **bounded, reversible, approval-gated** for high-impact actions — Rootly "never auto-remediates without human sign-off." Sources: [incident.io AI SRE](https://incident.io/ai-sre), [Rootly AI SRE 2026](https://rootly.com/sre/ai-sre-agent-ai-changing-incident-response-2026), [ilert agentic incident mgmt](https://www.ilert.com/agentic-incident-management-guide), [digitalapplied agentic runbooks 2026](https://www.digitalapplied.com/blog/agentic-workflow-incident-response-playbook-2026).

**Translate to business events.** The fabric should not send "your licence expires in 7 days." It should send **"your licence expires in 7 days — I've drafted the renewal application (pre-filled from your records), pre-booked the inspection slot, and assigned the document gathering to your site manager. Approve to submit."** This is the Borjie thesis ("Mr. Mwikila is the brain") expressed in the loop: the reminder *carries an action*, drafted by the junior agent, with evidence cited (every junior recommendation cites ≥1 `evidence_id` — honour rail).

**Borjie/BN move.** Each rung's ACT payload is produced by the relevant junior agent (compliance-agent for licence/KYC, cost-engineer for invoices, machinery-advisory for service, safety-agent for inspections). The draft is attached to the notification; the **approval is the loop's closure trigger**. Honour rail enforced at the policy-gate: drafting is autonomous; *submitting* a money/licence/deletion action is HITL — the recipient taps approve, and only then does the action execute through the proper service (`LedgerService.post()` for money, never a direct write).

**Beyond-today leap.** **Agentic follow-through that closes the loop autonomously within rails.** For *non*-HITL classes (e.g. "remind the site manager to log today's safety walk," "reassign a shift gap to the next available qualified worker"), the agent doesn't just draft — it *executes and confirms* within explicit scope/confidence/reversibility bounds (the 2026 AI-SRE guardrail model: scope controls + confidence thresholds + approval gates only for high-impact). The loop closes with *zero* human touch for low-stakes obligations, while money/licence/deletion stay HITL. This is the difference between a reminder system and an operating system.

---

## Stage 6 — ESCALATE on inaction (dynamic policy ladder)

**SOTA landscape (escalation engines, 2026).** **Major 2026 fact: Opsgenie reached end-of-sale 4-Jun-2025, full data deletion 5-Apr-2027 — it is no longer a viable adoption decision; existing users must migrate.** The category re-formed around:

- **PagerDuty** — deepest routing customization for complex enterprises; premium layered pricing, web-first UI with training overhead.
- **incident.io** — opinionated, Slack-native escalation policies; on-call included at ~$45/user/mo Pro; claims up to 80% MTTR reduction, operational in 2–5 days.
- **Rootly** — full incident lifecycle natively in Slack; AI SRE built-in (not bolted on), shows reasoning, zero third-party training on your data, never auto-remediates without sign-off.
- **Squadcast** ($9/user/mo), **Grafana OnCall**, **Better Stack** — lean, 40–70% under PagerDuty.

Sources: [incident.io escalation-tools comparison](https://incident.io/blog/escalation-policy-tools-comparison), [UpTickNow PagerDuty alternatives 2026](https://upticknow.com/blog/pagerduty-alternatives-incident-alerting-2026.html), [Rootly best PagerDuty alternatives 2026](https://rootly.com/sre/best-pagerduty-alternatives-2026-top-call-platforms-29499), [Neubird PagerDuty vs Opsgenie](https://neubird.ai/blog/pagerduty-vs-opsgenie/).

**The escalation-ladder primitive.** A policy ladder = ordered rungs of (recipient/role, channel, wait-before-escalate), with the escalation triggered by **unacknowledged** at each rung. For Borjie the rungs map to the **role hierarchy**: employee → site manager → operations manager → owner (and for the owner, the family-office / succession chain). "On-call" becomes "who is responsible for this obligation right now," resolved against the workforce schedule (so a shift gap escalates to whoever is actually on rota, not a static name).

**Borjie/BN move.** Borjie should *not* adopt an SRE escalation product wholesale — those are incident-shaped (services, alerts, MTTR). Instead, **port the escalation-policy data model** (ordered rungs, ack-gating, role/rota resolution) into Borjie's own durable workflow, so escalation reuses the same audit chain, RLS, and EN/SW localization as the rest of the loop. The dynamic part: rungs are not fixed — they're resolved at fire-time against the live org graph (`vision-org-graph-twin.md` in this repo) so reassignment/leave/promotion are reflected automatically.

**Beyond-today leap.** **The LLM authors the escalation policy from the goal** (continuing Stage 2's leap into the ladder's *escalation* half). Instead of a human configuring "after 3 unacked rungs, page the owner," the owner states intent in natural language ("nag the manager twice, then it's my problem; never wake me before 6 a.m.; royalty arrears jump straight to me") and the LLM compiles a constrained, validated escalation policy. 2026 research supports NL→policy synthesis (LLMs for access-control policy synthesis; constrained process maps for multi-agent workflows). The constraint layer guarantees the generated policy can only escalate to *real* roles in the org graph and can only attach *approved* actions. Sources: [LLM access-control policy synthesis](https://arxiv.org/pdf/2510.20692), [constrained process maps](https://arxiv.org/pdf/2602.02034).

---

## Stage 7 — FOLLOW-THROUGH to CLOSURE (the financial exemplar: dunning/AR)

**SOTA landscape (dunning / AR follow-up, 2026).** The most mature closed-loop-to-closure systems in 2026 are AR/dunning platforms — they're the proof that "remind → escalate → recover → confirm" works at scale:

- **Upflow** — Smart Dunning Automation: personalized email sequences per customer segment; dunning emails auto-sent at scheduled times; 2026 added **AI-Suggested "Promise to Pay"** (LLM reads customer replies, auto-tags PTP, feeds cash forecast). ([Upflow automate-collections](https://upflow.io/accounts-receivable-automation/automate-collections), [Upflow review 2026](https://research.com/software/reviews/upflow-review))
- **Growfin** — **AI-based account prioritization**: focuses the team on accounts most likely to pay / most at risk. ([Growfin](https://www.growfin.ai/))
- **Stripe Smart Retries** — the gold standard of self-tuning: **ML over 500+ attributes** (customer / business / payment) trained on billions of Stripe-network data points predicts the *optimal time* to retry a failed payment. Businesses using Stripe recovery tools reclaim **~57% of failed recurring payments**; recovered subscriptions continue ~7 more months. 25% of lapsed subscriptions are pure payment-failure (involuntary churn). Sources: [Stripe how-we-built Smart Retries](https://stripe.com/blog/how-we-built-it-smart-retries), [Stripe Smart Retries docs](https://docs.stripe.com/billing/revenue-recovery/smart-retries).

**The closure principle.** A loop is not closed when the message is read — it's closed when the *obligation state changes*: licence renewed, invoice paid, service logged, shift filled, inspection passed. The fabric must **watch the source-of-truth row** and auto-close the ladder when the underlying obligation clears (cancel remaining rungs, stop nagging). Dunning tools do this by watching the payment row; the fabric generalizes it to every obligation type. Upflow's PTP tagging is the bridge: a *promise* of future closure pauses the ladder without fully closing it.

**Borjie/BN move.** Closure is detected the same way as detection (Stage 1) — via the outbox: when the `licence.status → renewed` / `invoice.status → paid` event lands, the loop-genesis consumer signals the durable workflow (`step.waitForEvent` in Inngest terms, or a Temporal signal) to terminate the ladder. Money-path closure is observed *from the ledger* (`LedgerService` postings), never inferred from a message read.

**Beyond-today leap.** **Network-effect retry/follow-up timing.** Stripe's edge is its *network* data (billions of cross-merchant payments → optimal retry time). Borjie/BN can build the mining/real-estate analogue: across *all tenants* (privacy-preserved, tenant_id=NULL ground-truth like the corpus), learn that *artisanal miners in this district renew within 48h of the 2nd WhatsApp but ignore email entirely*, or *this class of buyer pays on the 1st of the month* — and self-tune both the *retry timing* and the *channel/rung order* from the federated signal, while every individual nudge stays tenant-scoped under RLS. No vertical OS has a cross-tenant "Smart Retries for business obligations" yet.

---

## Stage 8 — CONFIRM + AUDIT (hash-chained, at-least-once, nothing dropped)

**SOTA pattern.** Layered exactly-once-effect over at-least-once infra (the only honest model — "exactly-once delivery is mathematically impossible in distributed systems; effectively-exactly-once = at-least-once delivery + idempotent processing"):

- **Producer:** transactional outbox + idempotency keys.
- **Broker:** transactions where available.
- **Consumer:** dedup store + idempotent handlers, retaining processed IDs 24–72h.

Sources: [event-driven.io outbox/inbox](https://event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained/), [systemoverflow outbox+idempotency+saga](https://www.systemoverflow.com/learn/distributed-primitives/distributed-transactions/implementation-patterns-transactional-outbox-idempotency-and-saga-pivots), [Laravel exactly-once-effects](https://medium.com/@mohamadshahkhajeh/transactional-outbox-idempotency-in-laravel-exactly-once-effects-over-at-least-once-f4bae734d75f).

**Borjie/BN move — already a hard rail, here's the fit.** Every fabric event (detect, schedule, fire, route, deliver, read, act, escalate, close) appends an immutable, **hash-chained** row to Borjie's existing AI audit chain — append-only, no mutation. Because the chain is hash-linked, "nothing dropped" is *provable*: a gap in the chain is detectable by hash discontinuity, not just absence. The `inbox` side dedups inbound provider webhooks (WhatsApp/SMS delivery receipts) so an at-least-once receipt doesn't double-advance the loop state. This stage is where Borjie's existing invariants (hash-chained audit, at-least-once webhooks, idempotent consumers) become the *guarantee surface* for the whole fabric — the fabric inherits provability for free.

**Beyond-today leap.** **The audit chain as the dedup substrate** (already hinted in Stage 3): because every fire is keyed and chained, the chain *is* the idempotency store — no separate Redis/dedup service. And because it's hash-chained, you get **tamper-evident SLA proof**: "we attempted to notify this owner of this licence expiry on these 4 channels at these times, and here is the cryptographic chain proving it" — which in a regulated mining/real-estate context is a *compliance artifact*, not just an ops log. A reminder fabric that emits regulator-grade proof of diligence is beyond any 2026 vendor.

---

## Stage 9 — LEARN (self-tune the ladder per recipient)

**SOTA landscape (adaptive timing / self-tuning, 2026).**

- **Send-Time Optimization (STO)** — Braze, Iterable, Airship, ActiveCampaign use ML on per-user open/engagement history to send when each individual is most likely to engage; continuously re-tunes as schedules change; for cold-start users, **clusters with similar users** (demographics/location/device/behavior) and uses the cluster's optimal time. Sources: [Braze STO](https://www.braze.com/resources/articles/send-time-optimization), [Iterable STO](https://iterable.com/blog/what-is-send-time-optimization/), [Airship ML STO](https://www.airship.com/blog/our-machine-learning-model-for-predictive-send-time-optimization/).
- **Offline RL for notifications** (research frontier) — the right framing isn't "predict response to *this* notification," it's "a user's experience depends on a *sequence* of notifications." The arxiv work trains a **Double Deep Q-Network offline**, with a **state-marginalized importance-sampling policy-evaluation** method to tune offline *without live-deployment risk*, then launches the learned policy online. The learned decision is **when and whether to send** — optimizing the *sequence* for engagement, not single-message open rate. Source: [Offline RL for Mobile Notifications (arxiv 2202.03867)](https://arxiv.org/abs/2202.03867).
- **Stripe Smart Retries** (Stage 7) is the production proof that ML-tuned *timing* beats fixed schedules for the financial-follow-up case.

**Borjie/BN move.** Layer STO + offline-RL onto the ladder so the system learns, **per recipient**, (a) the *rung* at which they reliably act (if this manager always acts on rung 2, start at rung 2's intensity sooner / drop the wasted rung 1), (b) the *channel* they actually read (Stage 4 leap), and (c) the *time of day* they engage. Crucially — honour rail — **the learned policy APPENDS to the rule-based ladder; it never replaces it.** The rule guarantees the obligation is always covered; the learned layer only *re-weights* timing/channel/intensity within the rule's envelope. This is the exact "predictions append" pattern Borjie already enforces for decisions.

**Beyond-today leap — the self-tuning reminder ladder.** The headline beyond-today capability: a ladder that **learns each recipient acts at rung N and re-shapes itself** — fewer rungs for the responsive, a denser/earlier/cross-channel ladder for the chronic late-actor — modeled as offline-RL over the *sequence* (the DQN framing), evaluated offline (importance-sampling) before any live change so a mis-tune never spams a real owner. Combine the three leaps and the fabric becomes self-authoring **and** self-tuning: the LLM writes the initial policy from the goal (Stages 2/6), offline-RL re-shapes it per recipient (Stage 9), the hash chain proves every change (Stage 8), and the honour rails (money/licence/deletion HITL, predictions-append, EN/SW) bound the whole thing by construction. That is a closed-loop operational fabric that **no 2026 vendor ships as a unit** — each ships one organ; Borjie/BN is the organism.

---

## Synthesis — the build recommendation (one paragraph)

Adopt a **four-primitive fabric under one rails+audit layer**: (1) **Postgres-backed durable execution** (DBOS-style default, Temporal for months-long / massive-fan-out) owns the ladder *and* the fire-once guarantee, collapsing Stages 2+3 and keeping ladder state in the same RLS Postgres as the audit chain; (2) **self-hosted Novu** is the channel-delivery substrate (data-residency + self-host), but channel *order/escalation/read-receipt-gating* lives in the durable workflow, not in Novu — adopting Knock's step-condition + Courier's channel-escalation *patterns* without buying an SRE escalation product; (3) **junior agents draft+assign the action** on each rung (incident.io/Rootly "act, don't just alert" model) with money/licence/deletion HITL at the policy-gate; (4) **closure is observed from the source-of-truth row via the outbox** (ledger for money), and the **hash-chained audit chain doubles as the idempotency/dedup substrate and the regulator-grade proof-of-diligence artifact**. Then layer **STO + offline-RL** to self-tune the ladder per recipient as an *append* to the rule-based envelope. The four primitives exist as best-in-class 2026 products; the **integration under Borjie's existing invariants is the moat.**

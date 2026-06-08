# Hands — Autonomous Action Execution (how insight becomes COMPLETED WORK)

**Lane:** `autonomous-action-execution` (SOTA dossier — no code, no commit)
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** research pass over 2026 SOTA (saga/compensation, durable execution, HITL-on-irreversible, idempotency, DLQ/escalation, dry-run, receipt-capture) + the real East-Africa actuator landscape (M-Pesa Daraja, Airtel/Tigo, WhatsApp Cloud API, Tume ya Madini / TRA / BRELA / GePG) + a read-only audit of our own substrate (`action-runtime` saga schema, `workflow-engine`, `loop-runner`, `event_outbox`, `LedgerService`, `inngest-executor`, `disbursement-reconciliation.job`).
**Audience:** Borjie (mining-estate OS, Mr. Mwikila brain) **and** sibling BossNyumba (real-estate OS) — same brain + same wiring spine; only the domain actuator set differs. **This is built once in the shared execution layer and serves both.**

---

## 0. Thesis — the bar (INV-F made literal)

Per **INV-F** (`MASTER_GAP_REGISTER.md`): Borjie/BN is a **service that DOES THE ACTUAL WORK end-to-end via real-world actuators**, not an advisory product. Default is **DO, not suggest**. The lane question is exact:

> **How does an insight become COMPLETED, CONFIRMED work — end-to-end, reliably — through real actuators (M-Pesa, WhatsApp, TRA, Tume ya Madini), such that a multi-step real-world operation either completes or cleanly unwinds, survives a 3-week part-shipment, never double-pays, gates a human on the one irreversible step, and proves it finished with a captured receipt?**

The answer is a single **Action Orchestrator**: a durable, compensable, idempotent state machine that **plans** a real-world operation, **simulates** it (dry-run), **executes with compensation**, **gates HITL on the irreversible step only**, and **proves completion with captured receipts** — all over our existing RLS-Postgres + ledger + outbox + audit-chain invariants. The central 2026 finding: **no single vendor closes this loop** — durable-execution engines (Temporal/DBOS/Restate/Inngest) survive restarts but know nothing of "this licence", saga/compensation is a pattern not a product, and the actuators (M-Pesa/WhatsApp/TRA) are each callback-only with their own idempotency quirks. The moat is the **integration of those primitives under one rails layer + one hash-chained audit chain**, expressed over our money/licence/deletion invariants.

The good news from the code audit: **we already have ~70% of the organs.** The `action_plans`/`action_steps` saga schema is built (with a `COMPENSATE` step kind, `budget_micros`, quotas, an `approval_matrix_dsl_compiled` routing table, and a full `DRAFT→EXECUTING→PARTIAL→COMPLETED|COMPENSATED|COMPENSATION_FAILED` lifecycle). The `disbursement-reconciliation.job` is a **textbook saga-on-the-money-path reference implementation** (idempotency-keyed re-drive + compensating reversal + fail-loud, ledger-only). The gap is the **joint**: the saga schema has **no executor and no route** (confirmed orphan), and the durable engine (Inngest/Temporal) is **opt-in and dark** (`DURABLE_EXEC_ENABLED=false`).

---

## 1. The pipeline — insight → completed work, in nine stages

```
INSIGHT (forecast: mill bearing fails in ~18d)
  │
  ▼ 1. PLAN  — decompose into an ordered action_plan (steps + their compensations + budget + HITL class)
  │
  ▼ 2. CLASSIFY each step: reversibility (reversible / compensable / IRREVERSIBLE) + actuator + cost
  │
  ▼ 3. DRY-RUN / SIMULATE — resolve recipients, render messages, price the PO, check balance,
  │      validate the TRA/Madini form, surface the whole plan + projected effects as a PREVIEW
  │
  ▼ 4. AUTONOMY GATE  — posture × rails decide AUTO-RUN vs PROPOSE-then-execute per step
  │      (drafting always auto; the IRREVERSIBLE step is two-phase: approve-then-execute)
  │
  ▼ 5. EXECUTE  — durable workflow walks the steps; each external call is idempotency-keyed,
  │      retried with backoff+jitter, checkpointed exactly-once-in-effect, audit-chained
  │
  ▼ 6. AWAIT  — long real-world latency (B2C callback, 3-week part shipment, assay turnaround):
  │      the workflow SLEEPS durably; an inbound webhook/event wakes it
  │
  ▼ 7. CONFIRM / CAPTURE RECEIPT — provider receipt (M-Pesa code, WhatsApp read, GePG control no.,
  │      delivery POD) written back to the step; money confirmed ONLY from the ledger posting
  │
  ▼ 8. COMPENSATE-OR-COMPLETE — if a step fails irrecoverably, run compensations in REVERSE order;
  │      if compensation itself fails → COMPENSATION_FAILED → DLQ + LOUD human escalation
  │
  ▼ 9. CLOSE + LEARN — obligation row clears, tracked task closes, LoopClosed audited;
         outcome (latency, success, cost) APPENDS to the rule envelope (never replaces it)
```

The flagship worked example (the prompt's own): **forecast mill-failure → raise PO → track delivery → schedule maintenance → confirm done.**

| Stage | Step | Actuator | Reversibility | Gate |
|---|---|---|---|---|
| PLAN | decompose → 5-step plan | — | — | auto |
| 1 | draft RFQ to 3 parts suppliers | WhatsApp / email | reversible (just a message) | **auto** |
| 2 | compare quotes, pick supplier | — (internal) | reversible | auto |
| 3 | **raise PO + disburse deposit** | **M-Pesa B2C / bank** | **IRREVERSIBLE (money out)** | **HITL approve-then-execute** |
| 4 | track delivery (3-week sleep) | supplier webhook / SMS poll | n/a (observe) | auto |
| 5 | on arrival: schedule maintenance window | calendar + WhatsApp to crew | compensable (cancel event) | auto |
| 6 | confirm work done | field-visit confirmation + photo receipt | n/a (observe) | auto |
| 7 | close loop: clear obligation, file the cost | ledger posting + audit | — | auto |

Only **one** step (the deposit) gates a human. Everything else runs. That is the autonomy posture made concrete.

---

## 2. SOTA primitive #1 — Saga + compensation for external side effects

**The pattern (2026 consensus, Temporal/Azure/lexicon):** model every real-world operation as a recoverable sequence of local steps, each with a defined **compensating action**; on failure, run compensations in **reverse order** to unwind. You cannot get distributed ACID across M-Pesa + WhatsApp + TRA; you embrace **eventual consistency** with explicit unwind. ([Temporal saga guide](https://temporal.io/blog/mastering-saga-patterns-for-distributed-transactions-in-microservices), [Azure saga pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga), [Software Patterns Lexicon](https://softwarepatternslexicon.com/serverless-patterns-and-anti-patterns/workflows/saga-compensation-patterns/))

**The hard truths for our domain (the lexicon's "irreversible effects" warning):**

1. **Not everything is reversible.** A sent WhatsApp, a filed TRA return, an emitted audit record cannot be un-sent. The 2026 design is **not** to assume rollback semantics the world doesn't have — it is to **classify each step** and define a *concrete* compensating action (or an *accepted residual effect*) per step:
   - **Reversible** — delete a draft, cancel a calendar event, void a pending order. Compensation = exact inverse.
   - **Compensable** — money disbursed → post a **compensating reversal journal** (not a "delete"); a PO raised → issue a cancellation PO. The original effect stands in history; a *new* opposing effect neutralizes it.
   - **Irreversible** — a sent message, a filed government return, a refiner hand-off. Compensation = **a notify/correction action + an accepted residual** ("we sent a correction message"). These steps are exactly the ones that must be **HITL-gated before** they fire (§4).
2. **Compensations must be idempotent** — messages get redelivered, steps get retried; every compensation must tolerate double-execution.
3. **Compensation can itself fail.** The 2026 answer: log it, alert, **dead-letter for manual intervention** — never silently swallow. (This is precisely our `COMPENSATION_FAILED` terminal state.)
4. **Orchestration over choreography** for our use: a central orchestrator (our `action_plan`) gives visibility + control; choreography (services reacting to events) is for loosely-coupled simple flows. We want the orchestrated form because a human must be able to *see the whole plan* before approving.

**Our reality (audited):**
- ✅ **Schema is built and correct.** `packages/database/src/schemas/action-runtime.schema.ts`: `action_plans` (`DRAFT/ROUTED_FOR_APPROVAL/APPROVED/EXECUTING/PARTIAL/COMPLETED/FAILED/COMPENSATED/COMPENSATION_FAILED/EXPIRED/CANCELLED`), `action_steps` with `kind ∈ {…,COMPENSATE}`, `compensation_step_index`, `attempts`, `last_error`, `tool_call_ref`, `otel_span_id`, `audit_chain_id`; `action_quotas` (daily counters + money ceiling); `approval_matrix_dsl_compiled` (the HITL routing DSL). Migrations 0225–0228, RLS-FORCED.
- ✅ **A reference saga exists on the money path.** `services/payments-ledger/src/jobs/disbursement-reconciliation.job.ts` is the gold-standard pattern: a debited-but-undelivered B2C is parked `NEEDS_REVERSAL`, surfaced **LOUD** (non-empty set logged WARN with queryable count+ids), then idempotently driven to terminal — **re-drive under the SAME `disbursement-transfer:<id>` key** (provider-idempotent, never double-send), or post the **compensating reversal** keyed `disbursement-reversal:<id>` (post-once) via `LedgerService.postJournalEntry`, or leave `NEEDS_REVERSAL` + flag loud when undeterminable. **This is the template the generic executor should generalize.**
- ❌ **No generic saga executor.** The `action_plans` schema is **orphan** — confirmed: zero routes/composition wire it, no walker transitions `EXECUTING→COMPLETED|COMPENSATED`. (The `interactive-reports`/`damage-claim` "action plan" hits are an unrelated report-action concept.) The capability is **schema-only**.

**→ Gap OURGAP-1:** build the generic saga executor that walks `action_steps`, calls actuators idempotently, and runs `COMPENSATE` steps in reverse on failure — generalizing the `disbursement-reconciliation` template from money to all actuators.

**Beyond-today leap:** **auto-synthesized compensations.** When the planner emits a step (`SEND_WHATSAPP`, `FILE_GEPG`, `POST_LEDGER`), the orchestrator auto-attaches the canonical inverse from a **compensation catalog** keyed by `kind` (ledger→reversal-journal, calendar→cancel-event, message→correction-message, PO→cancellation-PO). The LLM never hand-writes a compensation; it selects from a pre-approved, rail-bound catalog — so a plan is **compensable by construction**, and an irreversible step is *flagged at plan time* (it has no clean inverse → it must be HITL).

---

## 3. SOTA primitive #2 — Durable execution (survive the 3-week shipment)

**The pattern (2026):** a long real-world operation (T-30 reminder ladder, a 3-week part shipment, an assay turnaround, a monthly-close) is a **months-long workflow**. A cron+DB-flag approach loses runs across pod restarts and double-executes. A **durable-execution engine** encodes the whole thing as one workflow whose `sleep()`/`waitForEvent()` **survive restarts**, and whose steps replay deterministically from a checkpointed history — so a scheduled step fires **exactly-once-in-effect by construction**. ([Durable execution comparison](https://devstarsj.github.io/2026/04/03/durable-execution-temporal-restate-dbos-distributed-workflows-2026/), [DBOS vs Temporal 2026](https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution), [Durable execution for LLM agents](https://appscale.blog/en/blog/durable-execution-llm-agents-temporal-langgraph-checkpointing-2026))

**The three engines, 2026 verdict (for our Postgres/Supabase stack):**

| Engine | Model | Fit for us |
|---|---|---|
| **DBOS Transact** | Library; **reuses your Postgres** as the durable store. Each step's checkpoint commits **in the same transaction** as the step's DB writes → step is exactly-once *if it does a DB op*; on restart replays from last committed step. Idempotency key per workflow. ([Why Postgres for durable execution](https://www.dbos.dev/blog/why-postgres-durable-execution), [Supabase + DBOS](https://supabase.com/blog/durable-workflows-in-postgres-dbos), [dbos-transact-ts](https://github.com/dbos-inc/dbos-transact-ts)) | **DEFAULT.** "One database, one deploy, one set of metrics." The ladder/saga state lives in the **same RLS Postgres** as the audit chain → the actuator-fire + the audit-row write are **one transaction** → exactly-once with zero extra coordination service. Unbeatable unit economics. Risk: Postgres contention on heavy fan-out. |
| **Temporal** | Dedicated cluster (Frontend/History/Matching) + worker fleet; deterministic replay, versioning, **native saga compensation**, sticky workers. ([Kai Waehner](https://www.kai-waehner.de/blog/2025/06/05/the-rise-of-the-durable-execution-engine-temporal-restate-in-an-event-driven-architecture-apache-kafka/)) | **FALLBACK for the destructive 5%** — multi-month horizons, massive fan-out, regulated payout batches, KRA/MRI exports, evictions. Operational cost (3 services + persistence + worker fleet) is the price of its depth. |
| **Restate** | Lightweight sidecar that intercepts HTTP calls and adds durability; cloud-native, simpler to operate than Temporal. | Watch-list; not needed if DBOS+Temporal split holds. |

**Our reality (audited):**
- ✅ **The split is already an ADR.** `Docs/ADR/0003-inngest-and-temporal-coexistence.md` decides: **Inngest** primary (short, event-driven, retry-friendly ≤30s — agency dispatch, webhook fan-out, notification dispatch), **Temporal** for the destructive 5% (KRA-MRI export, eviction, payout batch). Coordination via outbox + event bus only.
- ✅ **Inngest durable executor is built.** `packages/central-intelligence/src/durable/inngest-executor.ts` (checkpointed `step.run`, deterministic idempotency) + `inngest-client.ts` + `inngest-webhook.router.ts`.
- ❌ **It is opt-in and DARK.** `DURABLE_EXEC_ENABLED=false` by default; when disabled the gateway calls the original (non-durable) path. So today **no long real-world workflow survives restart** — a mid-batch crash loses the run, and an armed multi-week sleep is silently dropped.
- 🟡 **DBOS is not in the stack** even though our substrate (Supabase Postgres + RLS + same-txn audit) is its *ideal* fit and the cheapest path to "the ladder-fire and the audit-row are one transaction."

**→ Gap OURGAP-2:** flip durable execution **on** for the action path (enable Inngest at the composition root for the saga executor + the reminder ladders), and evaluate **DBOS** as the Postgres-native default so a step's actuator-effect-checkpoint + audit-row commit atomically. **→ Gap OURGAP-3:** today an armed `schedule_wake`/multi-week sleep is **in-memory** and lost on restart (per EXECUTION_SPEC); the 3-week part-shipment cannot be tracked durably until this lands.

**Beyond-today leap:** **the plan IS the durable workflow.** Don't run a bespoke cron per detector and a separate saga executor. Compile each `action_plan` into a single DBOS/Temporal workflow whose steps are the `action_steps` and whose `sleep`s are the await-windows; `loop_instance.durable_workflow_id` keys it back. Then "fire exactly once cluster-wide" **disappears** — we stop hand-rolling Redis mutexes + advisory-lock leader election, because the engine guarantees it. One abstraction (`enactPlan(plan)`) replaces the cron zoo.

---

## 4. SOTA primitive #3 — HITL on the IRREVERSIBLE step only (approve-then-execute, two-phase)

**The pattern (2026):** for **high-severity + irreversible** actions, the agent **proposes, pauses, serializes its complete state to durable storage, returns control**, and **resumes from the exact checkpoint** when an approve/reject/modify signal arrives. This is **Draft→Approve→Execute** with approval packets, resumable interrupts, idempotency keys, and audit logs. The classifier is two-stage: action-type heuristics + an LLM "ActionGuard" judge. ([Draft→Approve→Execute](https://pub.towardsai.net/human-in-the-loop-for-ai-agents-draft-approve-execute-c7fe0b72b0af), [HITL approval workflows for SaaS actions](https://truto.one/blog/implementing-human-in-the-loop-approval-workflows-for-consequential-saas-api-actions/), [HITL patterns for high-stakes decisions](https://dev.to/omnithium/human-in-the-loop-patterns-for-high-stakes-ai-agent-decisions-1fg6), [Magentic-UI arXiv](https://arxiv.org/pdf/2507.22358))

**The critical nuance:** gate **only** the irreversible step, not the whole plan. **Human-in-the-loop** (block-and-wait) on the irreversible commit; **human-on-the-loop** (observe, can interrupt) on everything reversible. ([HITL vs human-on-the-loop](https://www.waxell.ai/blog/human-in-the-loop-vs-human-on-the-loop-ai-agents)) Drafting the RFQ, comparing quotes, scheduling the crew — all auto. The **deposit disbursement** — pause, surface the approval packet (who, how much, to whom, why, projected effects), wait for a signal, then execute under an idempotency key so the approval can't double-fire.

**Our reality (audited):**
- ✅ **The gate and the routing DSL exist.** `four_eye_requests` (payment/regulator/contract/asset/termination) + `approval_matrix_dsl_compiled` (compiled predicate→approval-route rules). `policy-gate.ts` + `inviolable.ts` enforce HIGH-risk prefixes (sovereign/kill_switch/four_eye/policy_rollout) against literal rules.
- ✅ **The executor already creates a proposal and does NOT block.** `packages/central-intelligence/src/kernel/agency/executor/executor.ts`: high-stakes steps route through the four-eye gate (set `awaiting-approval:<actionId>`); the executor does not block. Sovereign-tier tool invocations write to a hash-chained sovereign action ledger with a **fail-closed** option (`sovereignLedgerFailClosed`).
- ❌ **The resume-after-approval bridge is missing for the saga path.** The `action_plans` lifecycle has `ROUTED_FOR_APPROVAL→APPROVED→EXECUTING`, but with no executor (OURGAP-1) there is nothing that, on approval-signal, **resumes the durable workflow from the gated step**. Per EXECUTION_SPEC, HITL `interrupt()`/`Command`-resume gates inside the main-loop are a listed unbuilt upgrade.

**→ Gap OURGAP-4:** wire the **two-phase resume**: approval signal → durable workflow resumes from the gated `action_step` and executes it under its idempotency key. The pause/serialize/return-control half exists; the **resume-and-execute** half does not.

**Beyond-today leap:** **the approval packet is a dry-run preview (next section), not a sentence.** When the orchestrator pauses on the deposit, the human sees the *whole simulated plan*: "I will pay TZS 4.2M to Supplier X (balance after: TZS 11.8M ✓), then track delivery (~18d), then book the crew for the first window after arrival. Approve the payment to proceed; all other steps run automatically." One approval releases a *plan*, not a click. And the gate is **risk-graduated**: argument-based auto-approve for a TZS-50k WhatsApp-airtime top-up under the daily quota; mandatory four-eye for a TZS-4M B2C; sovereign dual-control for a licence-affecting filing.

---

## 5. SOTA primitive #4 — Dry-run / simulation BEFORE commit

**The pattern (2026):** the right checkpoint boundary depends on each step's **cost and reversibility**; a wrong action in the wrong place can trigger effects that are hard to reverse — so **simulate first**. Workflow state tracks exactly which stage you're in, and AI decisions are bound to **stored evidence artifacts**. ([Agentic workflow checkpointing 2026](https://zylos.ai/research/2026-03-04-ai-agent-workflow-checkpointing-resumability/), [Temporal agentic durability 2026](https://olmecdynamics.com/news/temporal-durable-execution-agentic-workflows-2026), [Agents-at-work 2026 playbook](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/))

**What a dry-run means for our actuators (concrete):**
- **Money:** price the PO, check the ledger balance *would* clear (`balance after`), confirm the disbursement is within the daily `action_quotas.money_micros` ceiling — **without posting**.
- **Messaging:** resolve the recipient, pick the channel from preference, **render the localized body** (EN/SW, single-language, validated before egress), and show it — **without sending**.
- **Government:** validate the TRA/Madini/GePG form against its schema, compute the control number / liability, surface "this will file return R for period P" — **without submitting**. (M-Pesa, TRA, and Madini are all **callback-only / form-bound**; a dry-run that catches a malformed payload here saves a real penalty.)
- **The whole plan:** project the end-state ("after this: licence renewed, PO closed, maintenance done, TZS spent = X") and the side-effect ledger, as the approval preview.

**Our reality (audited):**
- 🟡 **Partial, scattered.** The disbursement path reads the current row before acting (a *de facto* per-step pre-check) and M-Pesa providers are **provider-idempotent** (a re-driven transfer under the same key is a safe no-op — a form of safe dry-run-then-commit). But there is **no first-class `simulate(plan)`** that resolves + renders + prices the whole plan and returns a structured preview before a single side effect fires.
- ❌ **No plan-level projected-effects preview** feeding the approval packet.

**→ Gap OURGAP-5:** add a `simulate(plan)` pass that runs every step in **DRY-RUN mode** (resolve, render, price, validate — no egress) and returns a structured `projectedEffects` artifact, which becomes the approval packet (§4) and is stored as evidence on the `action_plan`.

**Beyond-today leap:** **a sandbox digital-twin commit.** Before the real run, replay the plan against a **shadow ledger + shadow org-graph** (an in-memory or `tenant_id`-shadow copy) so the orchestrator can *prove* the plan reaches the intended end-state and reverts cleanly under an injected mid-step failure — i.e., **the compensation path is tested on the actual plan before any real actuator is touched.** This is "test the failure path as rigorously as the happy path" (saga best practice) done automatically, per-plan, at run-time.

---

## 6. SOTA primitive #5 — Idempotency keys for external calls (never double-pay)

**The pattern (2026, Stripe-canonical):** the client generates a unique key (V4 UUID or equivalent entropy) per operation and sends it with the request; the server **saves the result (status + body) of the first request for that key** and **returns the same result for every retry** — regardless of success or failure. Combined with checkpointing: the checkpoint says *which step to resume from*, the idempotency key ensures *replaying a step doesn't duplicate the external effect*. Keys are retained ~24h (long enough to retry). ([Stripe idempotency design](https://stripe.com/blog/idempotency), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Idempotency keys in Postgres — Brandur](https://brandur.org/idempotency-keys), [Idempotent AI agents 2026](https://www.buildmvpfast.com/blog/idempotent-ai-agent-retry-safe-patterns-production-workflow-2026))

**Per-actuator reality (East Africa):**
- **M-Pesa Daraja (B2C/C2B/STK):** callbacks **may be redelivered** — the handler **must be idempotent**, deduping on `MpesaReceiptNumber`/`ConversationID`. B2C is **callback-only** (you cannot reliably poll the result), so the idempotency key on the *outbound* `createTransfer` is what prevents a retry from double-sending. ([Daraja idempotency guidance](https://www.kenzobe.com/blog/mpesa-daraja-api-errors), [Safaricom Daraja portal](https://developer.safaricom.co.ke/)) Note: Tanzania uses **Vodacom M-Pesa** (Daraja-family); the same idempotency discipline applies.
- **Airtel Money / Tigo Pesa (Mixx by Yas):** OAuth2 client-credentials, Collections + Disbursements; integrated directly or via aggregators (**ClickPesa**) for TZ. Each transfer carries a client transaction reference = the idempotency key. ([Airtel developer portal](https://developers.airtel.africa/), [Airtel Money via ClickPesa](https://clickpesa.com/payment-gateway/payment-and-payout-methods/airtel-money-api-integration-guide/), [Tigo Pesa / Mixx via ClickPesa](https://clickpesa.com/payment-gateway/payment-and-payout-methods/mixx-by-yas-tigo-pesa-api-integration-guide/))
- **WhatsApp Cloud API:** outbound messages, status webhooks (`sent`/`delivered`/`read`/`failed`), **retried up to 7 days** on non-200 — so our webhook handler must be idempotent on `message_id`. (Note: **BSUID** replaces the phone-number identifier from June 2026.) ([WhatsApp webhooks reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/), [Cloud API webhook 2026 guide](https://anjoktechnologies.in/blog/whatsapp-cloud-api-webhook-setup-explained-messages-status-events-2026-guide-))
- **GePG (Government e-Payment Gateway):** control-number-based; the control number is the natural idempotency key for a filing/payment to Tume ya Madini / TRA. ([Tume ya Madini systems](https://www.tumemadini.go.tz/), [Madini portal](https://portal.madini.go.tz/))

**Our reality (audited):**
- ✅ **Strong on the money path.** `services/payments-ledger`: `webhook-idempotency.middleware.ts`, `webhook-dedupe-store.ts`, `mpesa-webhook.middleware.ts`, Stripe + M-Pesa providers with idempotency keys; the reconciliation job's `disbursement-transfer:<id>` / `disbursement-reversal:<id>` keys are exemplary.
- 🟡 **Not yet a universal step contract.** `action_steps` carries `tool_call_ref` (indexed) — the *place* for a per-step idempotency key — but there is no enforced "every `CALL_EXTERNAL_API`/`SEND_*`/`FILE_*` step MUST carry and honor an idempotency key derived from `(plan_id, step_index)`" because the executor that would enforce it doesn't exist (OURGAP-1).

**→ Gap OURGAP-6:** make idempotency a **universal step contract**: every external-effect `action_step` derives a deterministic key `(tenant, plan_id, step_index)`, the actuator port honors it, and the result (provider id + status) is persisted on the step so a replay short-circuits. Generalize the money-path discipline to WhatsApp/SMS/GePG/Madini.

**Beyond-today leap:** **a unified Actuator Port contract.** One TypeScript interface every actuator implements — `execute(step, idempotencyKey): Promise<Receipt>`, `simulate(step): Promise<Projection>`, `compensate(step, key): Promise<Receipt>`, `confirm(providerId): Promise<DeliveryStatus>` — so M-Pesa, Airtel, Tigo, WhatsApp, SMS, GePG, Madini, BRELA, and the ledger all plug into the *same* executor with the *same* idempotency/dry-run/compensate/confirm guarantees. New actuator = one adapter, never a new executor.

---

## 7. SOTA primitive #6 — Retry/backoff + dead-letter + escalation when an actuator fails

**The pattern (2026):** **failure classification** — transient errors (network, 5xx, rate-limit) get **exponential backoff + jitter** up to a bounded attempt count; **permanent errors** (4xx, validation, auth) **fail fast straight to the DLQ** (never burn the retry budget on what can't succeed); ambiguous errors get limited retries. After the budget is exhausted → **dead-letter queue** + **escalate to a human**. ([Retry patterns 2026](https://dev.to/young_gao/retry-patterns-that-actually-work-exponential-backoff-jitter-and-dead-letter-queues-75), [DLQ as safety net](https://medium.com/@vinay.georgiatech/dead-letter-queues-and-retry-queues-the-safety-net-for-distributed-systems-b961c718e6a0), [Background jobs 2026 reference](https://www.digitalapplied.com/blog/background-job-queue-patterns-2026-engineering-reference))

**Our reality (audited):**
- ✅ **The substrate exists.** `event_outbox` (status `pending/processing/published/failed/dead_letter`, `retry_count`/`max_retries`/`next_retry_at`, `lockedBy`/`lockExpiresAt`) + `event_dead_letter`. The notification dispatcher has exponential backoff + DLQ. `mining_escalations` (worker→manager→owner chain) + `four_eye_requests` exist.
- 🟡 **Per-step failure classification is missing.** `action_steps.attempts` + `last_error` exist, but no executor classifies transient-vs-permanent, schedules backoff, or moves a step to DLQ + escalation. The `COMPENSATION_FAILED` terminal state exists but nothing drives a row into it then up the escalation chain.
- ❌ **No "actuator failed → escalate up the org chain" control loop** (the fabric audit's gap #4: escalation-on-inaction is policy-less).

**→ Gap OURGAP-7:** the executor must **classify each step failure** (transient→backoff+jitter within `max_retries`; permanent→fast-fail to `action_steps` FAILED → plan compensation; budget-exhausted→`event_dead_letter` + advance `mining_escalations`), and a `COMPENSATION_FAILED` plan must **page a human LOUD** (the reconciliation job's "surface loud" discipline, generalized).

**Beyond-today leap:** **self-healing within rails.** On a *permanent* actuator failure (e.g. M-Pesa down, recipient un-reachable), the orchestrator doesn't just DLQ — it **re-plans within the autonomy envelope**: switch B2C → Airtel/Tigo for the same payee, or WhatsApp → SMS → voice-call escalation, *without* a new human approval **as long as the re-plan stays within the originally-approved budget + reversibility class**. The human approved "pay TZS 4.2M to Supplier X"; the *rail* (which payment network) is the orchestrator's to heal.

---

## 8. SOTA primitive #7 — Receipt capture: closing the loop (proof of done)

**The pattern (2026):** completion is **observed, not assumed.** The workflow waits for the **external confirmation event** (provider receipt) and binds it as a **stored evidence artifact** on the step before declaring the step done. Money is confirmed only from the authoritative source — the **ledger posting**, never from a message read.

**Per-actuator receipt:**
- **M-Pesa:** `MpesaReceiptNumber` from the B2C/C2B result callback → the proof + dedup key.
- **WhatsApp:** `delivered`/`read` status webhook → proof of reach.
- **GePG / Madini / TRA:** control number + payment-confirmation / filing acknowledgement.
- **Field work:** crew confirmation + photo (POD), bound to the maintenance step.

**Our reality (audited):**
- ✅ **Money receipts are captured + reconciled.** M-Pesa/Stripe webhook handlers correlate by provider id; the reconciliation job confirms PAID only from `getTransferStatus`/result; ledger postings are the source of truth.
- ❌ **THE joint is open for messaging.** Per `fabric-code-audit.md`: the WhatsApp/SMS delivery+read webhook is received, signature-verified, normalized — but the composition-root `onDeliveryStatus` **only publishes to the event bus and never writes back** to `notification_dispatch_log.delivery_status`/`delivery_reported_at`. **The loop knows "sent", not "delivered/read".** So a messaging action can't *prove* it reached the recipient.
- ❌ **No per-step receipt binding** on `action_steps` for non-money actuators.

**→ Gap OURGAP-8:** **write the delivery/read receipt back** (close the existing open joint — a small fix with outsized value) and bind every actuator's receipt to its `action_step` so a plan can prove every step reached confirmed completion. **→ Gap OURGAP-9:** money-closure is observed only from the ledger (already true on the disbursement path) — preserve this invariant in the generic executor (never infer "paid" from a webhook alone).

**Beyond-today leap:** **a cryptographic completion certificate.** When a plan reaches `COMPLETED`, the orchestrator emits a single **hash-chained completion certificate** binding every step's receipt (M-Pesa code + WhatsApp read + GePG control number + photo-POD hash) into one append-only `ai_audit_chain` entry. The owner gets a verifiable "this real-world operation completed, here is the proof of every external effect" — a court/regulator-grade artifact that no advisory product can produce.

---

## 9. The autonomy posture × rails gate — what auto-runs vs what gates

**The decision function (synthesizing INV-F + our rails):** each step is gated by **`posture(tenant, persona, action-class)` × `reversibility(step)` × `rails(money/licence/deletion)` × `budget/quota`**:

```
gate(step) =
  if step.kind ∈ {money-out, licence-affecting, deletion}        → HITL (four_eye / sovereign dual-control)   ALWAYS
  elif reversibility(step) == IRREVERSIBLE                       → HITL approve-then-execute (§4)
  elif cost(step) > posture.auto_ceiling OR over daily quota     → PROPOSE (human-on-the-loop)
  elif posture == FULL_AUTO and reversible/compensable           → AUTO-RUN, audit, observable, interruptible
  else (drafting, internal, notify)                              → AUTO-RUN
```

- **Drafting is always autonomous.** Compose the RFQ, render the message, build the form, plan the maintenance window — all auto, all the time. This is the "DO not suggest" default.
- **Submitting** any money/licence/deletion action is **HITL at the policy-gate** — `inviolable.ts:482` meta-rail; these stay dual-control **forever** (the offense moat is safe only because the defense moat is fixed). HIGH-risk prefixes (sovereign/kill_switch/four_eye/policy_rollout) hit **literal** policy rules — no reason-resolver generalization.
- **Predictions APPEND, never replace.** Predictive detection (forecast mill-failure) *adds* a loop; the learned channel/timing *appends* to the rule envelope — the rule-based ladder is never overwritten.
- **The autonomy controller is the meta-rail** (RSS-16 in the register, currently a BLOCKER): trigger→check→enforce **outside** the agent loop, immutable to the agent. The orchestrator can grow capability but can **never** touch its own gate/audit/test machinery.

**Our reality:** `flow_autonomy` posture (`FLOW_AUTONOMY_POSTURES`, `isFlowAuto`, Drizzle-backed in `workflow-engine/src/autonomy`), `policy-gate.ts`, `inviolable.ts`, `approval_matrix_dsl_compiled`, and `action_quotas` all exist. The **gate logic is present**; what's missing is the **executor that consults it per step** (OURGAP-1) and the **autonomy-controller meta-rail** that wraps it outside the loop (RSS-16).

**Beyond-today leap:** **earned, per-action-class autonomy that ratchets up on a proven track record and instantly reverts on a near-miss** — the posture is not a global dial but a learned, audited trust ledger per `(tenant, action-class)`: a tenant whose last 200 WhatsApp dispatches all confirmed delivered earns auto-send up to a higher quota; a single mis-send drops it back to propose. Money/licence/deletion never ratchet — they are fixed HITL by the meta-rail.

---

## 10. The beyond-today vision — the Action Orchestrator

One organ that turns any insight into proven, completed work:

```
                              ┌────────────────────────────────────────────────┐
   INSIGHT (forecast,         │  ACTION ORCHESTRATOR                            │
   regulatory diff,    ──────►│  plan → classify → SIMULATE → gate → enact      │
   obligation, owner goal)    │  → await → confirm → compensate-or-complete     │
                              │  → close → learn                                │
                              └───────┬───────────────┬───────────────┬─────────┘
                                      │ DBOS/Inngest  │ Unified        │ split read/write
                                      │ durable wf    │ Actuator Port  │ HITL gate
                                      ▼               ▼                ▼
                          ┌──────────────────┐ ┌────────────────┐ ┌──────────────┐
                          │ action_plans /   │ │ M-Pesa·Airtel· │ │ four_eye /   │
                          │ action_steps     │ │ Tigo·WhatsApp· │ │ sovereign /  │
                          │ (saga state m/c) │ │ SMS·GePG·      │ │ autonomy-    │
                          │ + compensation   │ │ Madini·BRELA·  │ │ controller   │
                          │   catalog        │ │ ledger·calendar│ │ meta-rail    │
                          └────────┬─────────┘ └───────┬────────┘ └──────────────┘
                                   │ every transition          │ every receipt
                                   ▼                           ▼
                          ┌────────────────────────────────────────────────────┐
                          │ ai_audit_chain (hash-linked) + completion certificate│
                          └────────────────────────────────────────────────────┘
```

The orchestrator **plans** a real-world operation, **simulates** it against a shadow twin, **executes** it durably with auto-synthesized compensations and idempotent actuators, **gates the one irreversible step** with a dry-run preview, **proves completion** with a hash-chained certificate of every captured receipt, and **learns** the autonomy envelope per action-class. No 2026 vendor ships this; the moat is the integration over our money/licence/deletion invariants.

---

## 11. Our gaps vs workflow-engine / loop-runner / outbox / ledger (the connective tissue)

| ID | Severity | Gap | Evidence | Closure |
|---|---|---|---|---|
| **OURGAP-1** | **BLOCKER** | **`action_plans` saga executor is orphan** — schema (0225–0228) built, **no walker, no route** transitions `EXECUTING→COMPLETED\|COMPENSATED`; no consumer | confirmed: zero gateway routes/composition reference `action_plans` (the report/damage "action plan" hits are unrelated) | Build the generic executor generalizing `disbursement-reconciliation.job` from money to all actuators; wire a `/actions` route + durable worker |
| **OURGAP-2** | **HIGH** | **Durable execution is DARK** — `DURABLE_EXEC_ENABLED=false`; no long workflow survives restart | `inngest-executor.ts:23-25` opt-in; ADR-0003 split exists but unflipped | Enable Inngest for the action path; evaluate **DBOS** (Postgres-native, same-txn audit) as the default per §3 |
| **OURGAP-3** | **HIGH** | **Multi-week sleeps are in-memory** — the 3-week shipment / armed `schedule_wake` is lost on restart | EXECUTION_SPEC: wake/monitor state in-memory | Back the await-windows with the durable engine (the plan IS the workflow, §3 leap) |
| **OURGAP-4** | **HIGH** | **Two-phase resume missing** — pause/propose exists; **resume-from-gated-step on approval** does not | `executor.ts` sets `awaiting-approval` but no resume; EXECUTION_SPEC lists `interrupt()`/`Command` as unbuilt | Wire approval-signal → durable workflow resume from gated `action_step` under its idempotency key |
| **OURGAP-5** | **HIGH** | **No first-class `simulate(plan)`** — no resolve+render+price+validate dry-run producing a projected-effects preview | scattered per-step pre-checks only | Add `simulate(plan)` → `projectedEffects` artifact = the approval packet (§5); shadow-twin commit (leap) |
| **OURGAP-6** | **HIGH** | **Idempotency not a universal step contract** — strong on money, absent as an enforced contract on WhatsApp/SMS/GePG/Madini | `action_steps.tool_call_ref` is the slot but unenforced (no executor) | Unified **Actuator Port** contract: every external step keys `(tenant, plan_id, step_index)`, honors it, persists the receipt (§6 leap) |
| **OURGAP-7** | **HIGH** | **No per-step failure classification / DLQ→escalation** for actuator failures | `event_outbox`+`event_dead_letter`+`mining_escalations` exist but the saga path doesn't classify/escalate | Executor: transient→backoff+jitter; permanent→fast-fail→compensate; exhausted→DLQ + advance escalation; `COMPENSATION_FAILED`→page LOUD |
| **OURGAP-8** | **MED→HIGH** | **Delivery/read receipt never written back** — fabric joint open; messaging can't prove "delivered/read" | `fabric-code-audit.md` §Stage 5: `onDeliveryStatus` publishes to bus, **never UPDATEs** `notification_dispatch_log` | Write receipt back; bind every actuator receipt to its `action_step` (small fix, outsized value) |
| **OURGAP-9** | **MED** | **Preserve ledger-only money-closure in the generic executor** — don't let it infer "paid" from a webhook | disbursement path already correct; the generalization must not regress it | Money-closure observed only from `LedgerService.post()`; completion certificate (§8 leap) |
| **OURGAP-10** | **HIGH (xref RSS-16)** | **Autonomy-controller meta-rail absent** — gate logic exists but not wrapped *outside* the agent loop, immutable to the agent | RSS-16 BLOCKER; `kernel/autonomy-controller/` does not exist | Build it; the executor consults posture×reversibility×rails×quota per step (§9); never agent-mutable |

**What we DON'T need to build (reuse):** the saga **schema** (`action-runtime.schema.ts` ✓), the money-path saga **reference** (`disbursement-reconciliation.job` ✓), the durable engine **code** (`inngest-executor` ✓ — just enable), the outbox + DLQ **substrate** (`event_outbox`/`event_dead_letter` ✓), the HITL **gate + DSL** (`four_eye_requests`/`approval_matrix_dsl_compiled` ✓), the autonomy **posture store** (`flow_autonomy` ✓), the hash-chained **audit chain** (`ai_audit_chain` ✓), and the **actuator providers** (M-Pesa/Stripe ✓; WhatsApp/SMS/email/push/calendar adapters ✓). The work is the **executor + the connective tissue**, not greenfield — exactly the EXECUTION_SPEC verdict: "Effort is mostly WIRING."

**The one keystone for this lane:** **OURGAP-1 (the saga executor).** Until it ships, the built saga schema, the durable engine, the HITL gate, the actuator providers, and the autonomy posture all have **nowhere to converge** — the insight reaches a plan and stops. Build the executor (generalizing the disbursement reconciliation template), back it durably (DBOS/Inngest), give it the Unified Actuator Port + `simulate()` + idempotent compensations + DLQ-escalation + receipt-capture, and the insight→completed-work loop closes end-to-end.

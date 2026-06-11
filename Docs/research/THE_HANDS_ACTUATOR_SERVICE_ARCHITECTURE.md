# THE HANDS — Actuator-Service Architecture (synthesis)

**Lane:** `the-hands-actuator-service` (synthesis dossier — no code, no commit)
**Date:** 2026-06-08 · **Branch:** `integration/parity-final`
**Synthesizes:** `hands-actuators-fabric.md` (the PORT layer) · `hands-action-execution.md` (the ORCHESTRATOR) · `hands-service-model.md` (the OPERATING MODEL) · `hands-code-audit.md` (the repo ground truth) · `MASTER_GAP_REGISTER.md` (INV-F, INV-F-sharpened, INV-C, INV-D, INV-E, INV-G) · `OPERATIONAL_CLOSED_LOOP_FABRIC.md` (the delivery-receipt closed loop)
**Scope:** Borjie (mining-estate OS, Mr. Mwikila brain) **and** BossNyumba (real-estate OS). Same brain + same wiring spine; only the domain actuator binding differs. **Built once in the shared `packages/actuators` + `services/action-orchestrator` layer; serves both.**
**Bar:** SOTA, best-in-the-world, fiduciary-grade. The launch jurisdiction is **Tanzania** (then KE / UG / NG).

> **INV-F (owner directive):** Borjie/BN is a SERVICE that DOES THE ACTUAL WORK end-to-end via real-world ACTUATORS — default **DO, not suggest**. Every external action is **idempotent + reversible-or-compensable**, driven to **confirmed completion** (the closed-loop fabric), within the **rails** (money / licence / deletion HITL on the irreversible step) + the **autonomy posture**. The measure of success is **WORK DONE, not advice given. We charge for the service, not seats.**
>
> **INV-F (sharpened):** sensitive/irreversible actions follow **PREPARE → REVIEW+PERMISSION → EXECUTE-or-HANDOFF**. The MD does the full labour autonomously, then asks "prepared and ready — shall I execute it, or will you?" If the owner takes the wheel, the MD **still tracks to confirmed closure**.

---

## 0. The thesis in one paragraph

The brain produces *intents* ("pay supplier TZS 4.2M", "file the 6% royalty before the export permit", "tell the buyer the assay is ready"). Today those intents reach an artifact and stop, or fire one of five property-bound single-step tools. **THE HANDS** is the missing arm: a **uniform actuator PORT** (`packages/actuators`) above our existing transport + money organs, a per-category set of **adapters** (payments / messaging / e-gov / procurement / logistics / accounting / assay-refiner / e-sign), a durable **Action Orchestrator** (`services/action-orchestrator`) that plans → simulates → gates → executes-with-compensation → captures-receipts → closes the loop, a **rails × autonomy gate** that mechanically decides auto-vs-HITL per action, and a **service operating model** (outcome-metered, accountability-bound, audit-chained, insured, with a human-oversight tier). The keystone finding across all four dossiers and the code audit is identical: **we already have ~70% of the organs** — a production-grade money rail (`mpesa-provider` B2C + `disbursement.service` ledger-before-transfer + `NEEDS_REVERSAL` compensation), a production-grade notification rail (durable outbox + Twilio/Africa's-Talking/Resend/push), a transport primitive (`base-connector`), a complete saga **schema** (`action-runtime.schema.ts`), a durable engine (`inngest-executor`), a four-eye gate + autonomy posture store, and a hash-chained audit. **What is missing is the JOINT** — the uniform port above the adapters, and the saga **executor** that converges all of it into one closed-loop arm. The moat is the integration over our money/licence/deletion invariants; **no 2026 vendor ships this whole loop.**

---

## 1. THE ACTUATOR PORT LAYER (the uniform interface) — `packages/actuators`

### 1.1 Design law — an actuator is not an adapter

The **adapter** is the protocol-specific code (Daraja HTTP/JSON, TRA XML+PKCS#12 signing, WhatsApp Graph, a portal-driver recipe). It lives under `packages/connectors/src/adapters/` and is built on `createBaseConnector` (already provides retry, circuit-breaker, idempotency-key passthrough, audit sink — verified shape: `ConnectorRequest<I>` / `ConnectorOutcome<O>` / `AuditSink` in `packages/connectors/src/base-connector.ts`). The **actuator** is the *capability contract* — it declares `reversibility`, supports `dryRun`, returns an `idempotencyKey`-keyed receipt, and exposes a `preview`/`confirm`/`compensate` triad. **One adapter backs many actuators** (M-Pesa → `payment.disburse_b2c`, `payment.collect_c2b`, `payment.b2b_settle`). The brain never sees the adapter; it sees the actuator capability — selected by the modality-arbiter's fifth verb `ACTUATE` exactly as it selects ANSWER/SKILL/WORKFLOW/LOOP/AGENT.

### 1.2 The uniform port (the keystone deliverable)

A single TypeScript interface (`packages/actuators/src/port.ts`, new package), sitting **above** `BaseConnector` (transport) and **beside** `PowerTool` (meta-capability). Five SOTA properties are baked into the *type*, so the rails fall out of the type system, not out of code review:

| Field / method | Why it is load-bearing |
|---|---|
| **`capability`** — stable id `actuator.<category>.<verb>` (`payment.disburse_b2c`, `tax.issue_efd_receipt`, `mining.pay_royalty`, `message.send_template`, `esign.send_for_signature`, …); the union is **open** (`\| string`) so runtime-registered actuators extend it (INV-C). | The arbiter picks an actuator the way it picks a tool. |
| **`reversibility`** ∈ `reversible` (true undo API — Stripe refund, e-sign void) \| `compensable` (no undo, an offsetting forward action restores state — B2C-back, reversal journal) \| `irreversible` (append-only / sovereign — TRA receipt, issued licence, executed contract). | The autonomy gate enforces INV-F **mechanically**: `irreversible ⇒ requiresApproval=true ⇒ four-eye before confirm`. Money/licence/deletion are HITL **by construction**. |
| **`idempotencyKey`** (caller-supplied, deterministic `(tenant, plan_id, step_index)`) → mapped to each adapter's native key (Daraja `OriginatorConversationID`, Stripe `idempotency-key`, TRA sequential RCTNUM, GePG control number, WhatsApp `wamid`). | At-most-once **effect** end-to-end. At-least-once delivery (webhooks) + idempotent effect = exactly-once-effect. The existing `webhook-dedupe-store.ts` is the dedupe half. |
| **`dryRun` / `preview(ctx, req)`** — mandatory, side-effect-free; returns `{ projected, estimatedCost, chosenRail, reversibility, requiresApproval }`. | The structural answer to "DO not suggest, but never surprise." The debate/LATS loop runs on previews; the human approves the preview; `confirm` executes **exactly what was previewed**. This IS the PREPARE step of INV-F-sharpened. |
| **`confirm(ctx, req)`** — the committing call; MUST be idempotent on `idempotencyKey`; returns `confirmed` (rail-confirmed) \| `pending` (submitted, awaiting async webhook) \| `refused` \| `failed{retriable}`. | The single committing verb. PAYMENTS actuators `confirm` **through `LedgerService.post()`** — the money invariant is satisfied because the actuator is *defined* in terms of the ledger. |
| **`ActuatorReceipt`** `{ capability, idempotencyKey, externalRef, reversibility, compensationHandle, at }` | The **closed-loop anchor**. An action is not "done" on `confirm` returning — it is done when the receipt's `externalRef` is reconciled against the inbound confirmation (webhook / Z-report acceptance / inbound WhatsApp "received" / delivery callback). `pending → confirmed` is driven by the existing outbox + webhook substrate. |
| **`compensate(ctx, receipt)`** — `reversible`→undo API; `compensable`→offsetting forward action; `irreversible`→refuse + raise `REQUIRES_MANUAL_REVIEW`. | Makes saga rollback **uniform** across every category. The brain's multi-step plans become sagas where each actuator carries its own compensation. |

**Composition with what exists (zero greenfield where avoidable):** transport = `createBaseConnector` (no new HTTP machinery); money mirror = `services/payments-ledger` `LedgerService.post()`; audit = `ActuatorAuditSink` → hash-chained `sovereign-action-ledger` (reuse `PowerToolAuditDestination='sovereign-action-ledger'`); gate = existing four-eye `createApprovalGate.propose()` + `PowerToolTier`; arbiter landing pad = the modality-arbiter's `ACTUATE` verb (COG-07 / AUT-14).

### 1.3 The per-category adapters (nine families, anchored on Tanzania)

For each family: the real 2026 rail, idempotency anchor, reversibility, and the irreversible step that stays HITL.

| Category | Adapters (TZ launch, then KE/UG/NG) | Key capabilities | Reversibility | HITL on the irreversible step |
|---|---|---|---|---|
| **Payments** | M-Pesa/Vodacom Daraja (C2B/STK/B2C/B2B), Airtel Money, Tigo/Mixx-by-Yas + HaloPesa via **ClickPesa/PayIn aggregator**, bank/TISS/SWIFT, Stripe (cards, non-TZ) | `payment.collect_c2b`, `payment.request_stk`, `payment.disburse_b2c`, `payment.b2b_settle`, `payment.bank_transfer`, `payment.card_refund` | B2C **compensable** (offsetting B2C-back; never a "cancel"); cards **reversible** (refund) | **disburse / money-out** → dual-control four-eye before `confirm` |
| **Messaging** | WhatsApp Cloud API (native send — today BSP-only via Twilio, gap B2), SMS (Beem / Africa's Talking / Twilio), Email (Resend/SES) | `message.send_template`, `message.send_session`, `message.send_otp`, `message.send_sms`, `message.send_email` | **irreversible** (a delivered message); compensation = corrective follow-up | none for utility/service; **marketing blast** above a recipient-count threshold → approve |
| **E-government / regulatory** | TRA VFD (EFDMS e-receipt, PKCS#12 SHA-1/RSA, sequential RCTNUM), TRA filing (portal-driver), **GePG** (control numbers — `gepg-real.ts` EXISTS), **Tume ya Madini / IDRAS** (licence + 6% royalty + 1% fee, money via GePG), **BRELA** (portal-driver) | `tax.issue_efd_receipt`, `tax.post_z_report`, `govpay.request_control_number`, `mining.pay_royalty`, `mining.renew_licence`, `mining.request_export_permit`, `registry.file_annual_return` | **irreversible / append-only** (no cancellation exists; a wrong receipt → a NEW number) | **every filing / licence / royalty / permit submission is HITL** (sovereign; HIGH-risk policy prefix). The brain prepares + pre-fills + schedules + reminds; a human submits |
| **Procurement / suppliers** | mostly no API → signed-PO PDF + WhatsApp/email + AP commitment in ledger; large suppliers via marketplaces | `procure.issue_po`, `procure.request_quote`, `procure.cancel_po` | PO **reversible** while unfulfilled (cancel + reverse AP commitment) | issuing a PO above a financial-commitment threshold → HITL |
| **Logistics** | secure transport / bonded mineral movement (permit-gated), DHL/Aramex for export legs | `logistics.book_shipment`, `logistics.track`, `logistics.generate_manifest` | booking **reversible** pre-pickup; **irreversible** once moving | dispatching a high-value consignment → HITL |
| **Accounting export** | QuickBooks Online / Xero (mature OAuth2 REST) — the external books become a **read-replica** of our ledger | `accounting.push_journal`, `accounting.push_invoice`, `accounting.export_ledger` | **reversible** (reversing journal in target) | bulk period-close push → HITL; routine sync auto |
| **Assay-lab / refiner / buyer** (Borjie) | TMAA / Mining Commission assay (cert mandatory for export), LBMA Good-Delivery refiner, offtaker provisional→final settlement (LBMA ref) | `assay.request`, `assay.ingest_certificate`, `refiner.consign`, `refiner.settle`, `offtake.create_contract`, `offtake.provisional_settle`, `offtake.final_settle` | provisional **reversible** into final; consignment + final settle **irreversible/compensable** | sample-submit, consign, contract-execute, final-settle → the four sovereign confirm steps |
| **E-signature** | one stack of record (retire the duplicate) — DocuSign / Dropbox-Sign / Adobe + a **QTSP (eMudhra-class)** for Qualified signatures under TZ Electronic Transactions Act Cap. 442 | `esign.create_envelope`, `esign.send_for_signature`, `esign.void_envelope`, `esign.fetch_executed` | **reversible** (void) before completion; **irreversible** once executed (compensation = superseding signed amendment) | sending a binding contract for signature → HITL on first-of-kind |

**Portal-driver as a first-class transport (the e-gov reality).** BRELA, Tume-ya-Madini, and TRA-filing lack clean public REST APIs in 2026. The port supports a hardened, audited **`portal-driver`** backend (Borjie already has `packages/browser-perception`) behind the **same** `dryRun`/`confirm`/`reversibility` contract. The brain does not know whether `mining.renew_licence` is fulfilled by REST or a robot filling the cadastre form — it sees only the capability. The day Tume-ya-Madini ships a real API, the *transport* swaps; the capability contract and every dependent junior are untouched. (`hands-service-model.md` §1.8 reality check: design for graceful degradation across direct-API → aggregator → assisted-portal-with-four-eyes.)

### 1.4 Runtime-extensible registry (INV-C)

`packages/actuators/src/registry.ts` mirrors the existing `PowerToolRegistry` and `connectors/registry.ts` (both in-repo). Boot path registers the §1.3 actuators. The **beyond-today** path is `discoverAndWrap(spec)`: the 2026 MCP-native move — **discover** (fetch OpenAPI/MCP manifest, or propose a portal-driver recipe when there's no API) → **wrap** (synthesize an `Actuator` conforming to the port; `reversibility` defaults conservatively to `irreversible` when unknown → forces HITL) → **quarantine** (enters at the **lowest tier, `dryRun`-only, irreversible-by-default**, written to the sovereign ledger; **cannot be promoted to live `confirm` without a human signing off**) → **promote** (after eval + human sign-off, `reversibility` + HITL policy frozen into a signed policy row). **The leap:** the MD can *grow a new hand* when reality presents a new rail, behind the identical contract, **within the same money/licence/deletion rails that protect every other hand — because the rails live in the PORT, not in any individual actuator.** New rail, same guardrails, by construction.

---

## 2. THE ACTION-EXECUTION ORCHESTRATOR — `services/action-orchestrator`

One organ turns any insight into proven, completed work. The nine-stage pipeline (from `hands-action-execution.md` §1):

```
INSIGHT (forecast: mill bearing fails in ~18d)
 ▼ 1 PLAN       decompose → ordered action_plan (steps + compensations + budget + HITL class)
 ▼ 2 CLASSIFY   each step: reversibility × actuator × cost
 ▼ 3 SIMULATE   DRY-RUN: resolve recipients, render EN/SW body, price the PO, check balance,
                validate the TRA/Madini form → one structured PREVIEW of projected effects
 ▼ 4 GATE       posture × reversibility × rails × quota → AUTO-RUN vs PROPOSE-then-execute per step
 ▼ 5 EXECUTE    durable workflow walks steps; each external call idempotency-keyed, retried
                with backoff+jitter, checkpointed exactly-once-in-effect, audit-chained
 ▼ 6 AWAIT      durable SLEEP across real-world latency (B2C callback, 3-week shipment, assay);
                an inbound webhook/event wakes it
 ▼ 7 CONFIRM    capture provider receipt (M-Pesa code, WA read, GePG control no., POD);
                money confirmed ONLY from the ledger posting
 ▼ 8 CLOSE/COMP if a step fails irrecoverably → run compensations in REVERSE; if compensation
                fails → COMPENSATION_FAILED → DLQ + LOUD human escalation
 ▼ 9 LEARN      obligation clears, task closes, LoopClosed audited; outcome (latency/cost/success)
                APPENDS to the rule envelope (never replaces it)
```

**Reuse, don't rebuild.** The saga **schema is built and correct** — `packages/database/src/schemas/action-runtime.schema.ts` (verified): `action_plans` (`DRAFT→ROUTED_FOR_APPROVAL→APPROVED→EXECUTING→PARTIAL→COMPLETED|FAILED|COMPENSATED|COMPENSATION_FAILED|EXPIRED|CANCELLED`, `budget_micros`, 72h expiry), `action_steps` with `kind ∈ {DRAFT_LETTER, ROUTE_APPROVAL, POST_LEDGER, FILE_GEPG, SEND_WHATSAPP, SEND_SMS, SEND_EMAIL, SCHEDULE_FIELD_VISIT, MUTATE_ENTITY, CALL_EXTERNAL_API, EMIT_WEBHOOK, NOTIFY, VERIFY, COMPENSATE}`, `compensation_step_index`, `attempts`, `last_error`, `tool_call_ref`, `otel_span_id`, `audit_chain_id`, status `PENDING→RUNNING→SUCCEEDED|FAILED|COMPENSATING|COMPENSATED|SKIPPED`), `action_quotas`, `approval_matrix_dsl_compiled`. Migrations 0225–0228, RLS-FORCED. **The reference saga exists on the money path** — `services/payments-ledger/src/jobs/disbursement-reconciliation.job.ts` is the gold-standard template (idempotency-keyed re-drive under `disbursement-transfer:<id>`, compensating reversal keyed `disbursement-reversal:<id>`, surface-LOUD when undeterminable). **The gap is the JOINT:** the saga schema is **orphan — no executor, no route** (confirmed: zero non-schema/non-test references across `central-intelligence` + `api-gateway`).

**Five SOTA primitives the executor must implement (each maps to a code-audit gap):**

1. **Saga + compensation** — auto-attach the canonical inverse from a **compensation catalog** keyed by `kind` (ledger→reversal-journal, calendar→cancel-event, message→correction-message, PO→cancellation-PO) so a plan is **compensable by construction** and an irreversible step is *flagged at plan time* (no clean inverse → must be HITL). Generalize the disbursement-reconciliation template from money to all actuators. *(OURGAP-1, keystone.)*
2. **Durable execution** — `DURABLE_EXEC_ENABLED` is `false` by default (verified `inngest-executor.ts:23`); no long workflow survives restart. Flip it on for the action path; **evaluate DBOS** (Postgres-native — the actuator-effect-checkpoint + audit-row commit in **one transaction** on our RLS Supabase). ADR-0003 already splits Inngest (≤30s) / Temporal (destructive 5%). *(OURGAP-2, OURGAP-3.)* **The plan IS the durable workflow** — compile each `action_plan` into one DBOS/Temporal workflow whose steps are the `action_steps` and whose sleeps are the await-windows; the cron zoo + Redis mutexes disappear.
3. **HITL on the irreversible step only** — gate the deposit, not the whole plan. Pause / serialize / return-control exists in `executor.ts` (sets `awaiting-approval:<actionId>`); **the resume-from-gated-step on approval is missing.** Wire the two-phase resume: approval signal → durable workflow resumes from the gated `action_step` under its idempotency key. The approval packet **is the dry-run preview** (§5 of action-exec), not a sentence: "I will pay TZS 4.2M to Supplier X (balance after: TZS 11.8M ✓), then track delivery (~18d), then book the crew. Approve the payment; all other steps run automatically." *(OURGAP-4.)*
4. **Dry-run / simulate(plan)** — no first-class `simulate(plan)` exists today (only scattered per-step pre-checks). Add a pass that runs every step in DRY-RUN (resolve + render EN/SW + price + validate, no egress) → a `projectedEffects` artifact = the approval packet, stored as evidence on the `action_plan`. **Leap:** a **shadow digital-twin commit** replays the plan against a shadow ledger + shadow org-graph to prove it reaches the end-state AND reverts cleanly under an injected mid-step failure — the compensation path tested before any real actuator fires. *(OURGAP-5.)*
5. **Idempotency + retry/DLQ + receipt capture** — make idempotency a **universal step contract** (`(tenant, plan_id, step_index)`); classify each failure (transient→backoff+jitter within `max_retries`; permanent→fast-fail→compensate; exhausted→`event_dead_letter` + advance `mining_escalations`); `COMPENSATION_FAILED`→page LOUD. **Close the open delivery-receipt joint** (OPERATIONAL_CLOSED_LOOP_FABRIC Stage 5, the keystone weld): `onDeliveryStatus` today publishes to the bus but **never UPDATEs** `notification_dispatch_log.delivery_status` — so messaging knows "sent" not "delivered/read." Write the receipt back; bind every actuator receipt to its `action_step`. Money-closure stays observed **only from the ledger** (never inferred from a webhook). *(OURGAP-6/7/8/9.)* **Leap:** a **cryptographic completion certificate** — at `COMPLETED`, bind every step's receipt (M-Pesa code + WA read + GePG control number + photo-POD hash) into one append-only `ai_audit_chain` entry: court/regulator-grade proof no advisory product can produce.

---

## 3. THE RAILS × AUTONOMY GATE — auto-vs-HITL per action

The decision function (INV-F + INV-F-sharpened + our rails), consulted by the executor **per step**:

```
gate(step) =
  if step.kind ∈ {money-out, licence-affecting, deletion}     → HITL (four_eye / sovereign dual-control)  ALWAYS
  elif reversibility(step) == IRREVERSIBLE                     → HITL approve-then-execute (PREPARE→REVIEW→EXECUTE)
  elif cost(step) > posture.auto_ceiling OR over daily quota   → PROPOSE (human-on-the-loop)
  elif posture == FULL_AUTO and reversible/compensable         → AUTO-RUN, audit, observable, interruptible
  else (drafting, internal, notify)                            → AUTO-RUN
```

- **Drafting is always autonomous** (compose RFQ, render message, build form, plan window) — the "DO not suggest" default and the PREPARE step of INV-F-sharpened.
- **Submitting** any money/licence/deletion action is HITL at the policy-gate — `inviolable.ts` meta-rail; these stay dual-control **forever** (the offense moat is safe only because the defense moat is fixed). HIGH-risk prefixes (sovereign/kill_switch/four_eye/policy_rollout) hit **literal** policy rules — no reason-resolver generalization.
- **Predictions APPEND, never replace** the rule-based ladder.
- **The autonomy-controller is the meta-rail (RSS-16, BLOCKER):** trigger→check→enforce **outside** the agent loop, immutable to the agent. The orchestrator can grow capability (INV-C) but can **never** touch its own gate / audit / test machinery.

**Reality:** `flow_autonomy` posture, `policy-gate.ts`, `inviolable.ts`, `approval_matrix_dsl_compiled`, `action_quotas`, and the risk-tier map (`orchestration/risk-tiers.ts`) all **exist** — the gate logic is present. What's missing is the **executor that consults it per step** (OURGAP-1) and the **autonomy-controller meta-rail that wraps it outside the loop** (RSS-16 / AUT-05). **Leap:** **earned, per-action-class autonomy** — a learned, audited trust ledger per `(tenant, action-class)` that ratchets up on a proven track record (200 confirmed WhatsApp deliveries → auto-send to a higher quota) and instantly reverts on a near-miss. Money/licence/deletion **never** ratchet — fixed HITL by the meta-rail. Calibrate confidence thresholds (0.85 irreversible / 0.70 reversible) against Expected Calibration Error after 30 days to a target FP rate matched to reviewer capacity (GAP-HANDS-7).

---

## 4. THE SERVICE OPERATING MODEL — work-done, not seats

The 2026 market name for INV-F is **service-as-software**: the customer pays for *completed business outcomes*, not seats or API access (Bloomberg: outcome-based pricing ~10%→~60% of software pricing this decade). The strategic consequence is clarifying: **the moment you act in the real world, you own the consequences** — **California AB 316 (eff. 2026-01-01): autonomy is NOT a liability defense**; "deploying an AI agent concentrates accountability on the deployer." So the winning architecture is not "a smarter agent" — it is a **fiduciary-grade autonomous operator** whose every act is identity-bound, authority-scoped, evidence-cited, cryptographically auditable, insured, and four-eye-gated on the irreversible step. **That trust substrate IS the product.**

| Pillar | What it means | Status (repo) |
|---|---|---|
| **Outcome metering** | Bill on royalty-settled-on-time, arrears-recovered, assays-cleared, offtake-contracts-closed, filings-accepted-by-TRA/IDRAS — meter the actuator outcomes the closed-loop fabric already confirms. Beyond: a **performance bond / fee-clawback** auto-rebated from the ledger on a missed SLA (provable — every outcome is hash-chained). | **GAP-HANDS-1** (absent) |
| **Outcome SLA + BPO-style contract** | Not a SaaS uptime page — covers *uptime + accuracy + tool-correctness + response-time*; a machine-readable **delegation-of-authority + escalation matrix** mirroring the BPO contract = the documented "reasonable safeguards" defense AB 316 rewards. | **GAP-HANDS-8** (absent) |
| **Accountability / audit** | Tamper-evident, cryptographically anchored provenance — the **Trust Receipt** per act `{intent, authority-grant id, evidence_ids, confidence, policy rule matched, four-eyes approver, actuator response, reversal handle}`, the human/insurer/regulator-readable face of `ai_audit_chain`; align to the IETF `draft-sharif-agent-audit-trail`. | hash-chain **PRESENT**; portable Trust Receipt **GAP-HANDS-4** |
| **Authority control plane** | Shift from access control → **authority control**: a **scoped, parameterized, TTL'd payment token** per tenant per actuator (bound by wallet/amount/use-case) — a refiner B2C is a different grant from a wage payout (FIDO Agentic-Auth WG, 2026). | **GAP-HANDS-3** (absent) |
| **Insurance / bonding** | Map the risk ladder to **insured authority bands** — money/licence/deletion acts run only inside the insured aggregate (Armilla/HSB-class affirmative AI policy). | **GAP-HANDS-5** (absent) |
| **Human-oversight tier** | Three modes — human-*out* (autonomous) / human-*in* (pause+approve) / human-*on* (monitor) — chosen dynamically by **irreversibility × blast-radius × compliance-exposure × confidence**; out-of-parameters → escalate to a **named reviewer**. This maps *exactly* onto INV-F's money/licence/deletion HITL. | gate **PRESENT**; calibration **GAP-HANDS-7** |
| **Fiduciary charter** | A published per-tenant **Fiduciary Statement** + a regulator-facing read-only attestation endpoint (Tume-ya-Madini/TRA verify posture without a site visit). | **GAP-HANDS-6** (absent) |

---

## 5. PRESENT / PARTIAL / ABSENT — with file evidence + the exact wiring

**Legend:** PRESENT = real adapter that performs the side-effect **AND** a wired runtime call path · PARTIAL = real adapter exists but unwired / mock-default / domain-mismatched / no compensation · ABSENT = no adapter.

| Organ | State | Evidence | Exact wiring to turn it into a full actuator |
|---|---|---|---|
| **Transport primitive** | **PRESENT** | `packages/connectors/src/base-connector.ts` (`createBaseConnector` `:213`; `ConnectorRequest`/`ConnectorOutcome`/`AuditSink`) | reuse as each actuator's `confirm` backend; no new HTTP machinery |
| **M-Pesa Daraja (STK+B2C)** | **PARTIAL→PRESENT** | `mpesa/client.ts` (`stkPush :159`, `b2c :237`), `mpesa-provider.ts` (`createTransfer :362`, RSA `SecurityCredential :29`) | wrap as `payment.disburse_b2c`/`collect_c2b`/`request_stk` actuators; **fix KES→TZS** (`mpesa-provider.ts:100`); add Tigo/Airtel adapters (ABSENT); whitelist B2C/B2B; founder-provision live creds (`MPESA_LIVE_KEYS_PRESENT`) |
| **Disbursement orchestration** | **PRESENT** (best-in-class) | `disbursement.service.ts` (idempotency gate `:166`, ledger-post-before-transfer `:259`, `NEEDS_REVERSAL :407`); `disbursement-reconciliation.job.ts` | **generalize this template** into the saga executor (§2.1) — money → all actuators |
| **Ledger / double-entry** | **PRESENT** | `LedgerService.post()` + `ledger-hash-chain.ts` | PAYMENTS actuators `confirm` through it; preserve ledger-only money-closure in the generic executor (OURGAP-9) |
| **Notification rail (SMS/WA/Email/Push)** | **PRESENT** | durable outbox `dispatcher-worker.ts` (atomic claim `:206`, backoff/DLQ `:112`); Twilio + Africa's-Talking + Resend; wired to brain via `agency-port-bindings.ts:87` | wrap as `message.send_*` actuators; **close the delivery-receipt joint** — write `onDeliveryStatus` back to `notification_dispatch_log.delivery_status` (OPERATIONAL_CLOSED_LOOP_FABRIC Stage 5, OURGAP-8) |
| **Native WhatsApp Cloud send** | **ABSENT** (ingest-only) | `packages/connectors/whatsapp/` = receive-only (`getMedia`, no `sendMessage`); outbound only via Twilio BSP | add native Cloud-API templated/session send → `message.send_template` |
| **GePG (TZ gov e-payment)** | **PARTIAL** (real, unwired) | `connectors/src/adapters/gepg-real.ts` (`generateControlNumber`, status poll); exported `index.ts:150` but **no gateway importer** | wire `createGepgRealAdapter()` at composition + a `FILE_GEPG` step handler → `govpay.request_control_number` |
| **KRA eRITS** | **PARTIAL** (wired, wrong-domain) | `kra-erits-real.ts` wired via `composition/durable/temporal/kra-erits-filing-workflow.ts` — but **Kenya rental**, not TZ mining | keep for **BN-KE**; build the TZ analogues |
| **NIDA / e-Ardhi** | **PARTIAL** (env-gated) | `nida-real.ts` wired `hq-tool-port-bindings.ts:116`; `eardhi-adapter.ts` (`EARDHI_GATEWAY_URL`) — fall back to `notYetWired` stub | promote to actuators; e-Ardhi serves **BN land/title** |
| **TRA VFD / TRA filing** | **ABSENT** | only `tra-filing-assistant` prompt scaffold + `regulatory-filings` schema | build `tra-vfd-real.ts` adapter (XML + PKCS#12 SHA-1/RSA, sequential RCTNUM) → `tax.issue_efd_receipt` (irreversible, HITL first go-live) |
| **Tume-ya-Madini / IDRAS** | **ABSENT** | KI-16 flags it for *sensing* only; no submission adapter | build licence/royalty submission adapter (portal-driver + GePG money leg) → `mining.pay_royalty`/`renew_licence`/`request_export_permit` (sovereign HITL) |
| **BRELA / NEMC** | **ABSENT** | — | portal-driver actuators → `registry.file_annual_return` (HITL) |
| **Assay / refiner / offtaker / logistics** | **ABSENT** | marketplace = internal DB rows only (`marketplaceListings`) | build the mineral-trade chained-saga family (§1.3) |
| **E-signature** | **PARTIAL** (built, unwired, duplicated) | real `document-ai/.../docusign-adapter.ts` + `document-studio/.../dropbox-sign-adapter.ts`; **zero gateway importer** | **pick ONE stack**, bind at composition, expose `esign.send_for_signature` (request→persist→poll-to-signed); retire the duplicate |
| **Generic saga executor** | **ABSENT at runtime** (schema-only) | `action-runtime.schema.ts` complete (0225–0228); **zero non-schema references** | **THE KEYSTONE** — build `services/action-orchestrator` walking `action_steps` via the actuator port (§2) |
| **Durable backbone** | **PARTIAL** (mock-default) | `inngest-executor.ts:23` (`DURABLE_EXEC_ENABLED=false`); Temporal `createMockTemporalClient` default | flip the flag for the action path; evaluate **DBOS** (Postgres-native, same-txn audit) |
| **Rails / autonomy gate** | **PARTIAL** | `four_eye_requests` + `approval_matrix_dsl_compiled` + `policy-gate.ts` + `inviolable.ts` + `flow_autonomy` + `risk-tiers.ts` exist | wire the **autonomy-controller meta-rail** (RSS-16) so the gate fires *outside* the agent loop; **four-eye router is in-memory (RSS-21)** → Drizzle-back it |
| **Audit chain** | **PRESENT** | `ai_audit_chain` hash-linked; `audit-hash-chain.ts` | emit the **completion certificate** + **Trust Receipt** (§4) |

**One-line verdict:** we have the *transport*, the *money mirror*, a production *notification rail*, a tiered *meta-tool registry*, a complete *saga schema*, a durable *engine*, the *gate*, and the *audit chain* — world-class foundations, **~70% of the organs**. The missing pieces are exactly two joints: **(a) the uniform actuator PORT above the adapters**, and **(b) the saga EXECUTOR that converges everything into one closed-loop arm.** Build those two and the insight→completed-work loop closes end-to-end. **The effort is mostly WIRING, not greenfield.**

---

## 6. SAME HANDS FOR BORJIE + BOSSNYUMBA

One actuator fabric, two domain bindings — exactly the "same brain/wiring, only the domain layer differs" invariant. BN reuses **every** category: PAYMENTS (rent collect C2B / deposit refund B2C / contractor payout B2B), MESSAGING (rent-due / viewing-confirmed), E-GOV (TRA rental-income e-receipt; **land/title registry** — e-Ardhi — instead of Tume-ya-Madini), PROCUREMENT (maintenance parts), LOGISTICS (move-in/out, key handover), ACCOUNTING export, E-SIGN (lease execution). **Only two members swap:** §1.3's mining-licence actuator → land/title registry; the mineral-trade family → property-transaction family (valuation API, conveyancing). The code audit's finding is that **BN is actually the better-fit domain for what is already wired** — the property-bound agency tools (`leases`/`units`/`arrears`/`rent.reminder`/`listing.publish rent`) are literally BN's domain; in Borjie they are residue to be re-domained to mining nouns (sites/licences/royalty/shipments/assays). The shared holes (saga executor, unwired e-sign, unwired GePG) are identical in both — built once, both benefit.

---

## 7. DEPENDENCY-ORDERED FULL-CODE ROADMAP (flag-default-safe; real external calls behind dry-run + sandbox first)

Every wave ships flag-off; every external call goes through `dryRun` + a sandbox endpoint before a live one; live `confirm` is founder-credential-gated. **Blockers** and **PERMANENTLY-HITL** actions are marked.

### Wave 0 — Close the delivery-receipt loop (the keystone weld) — flag `FABRIC_DELIVERY_WRITEBACK`
Smallest fix, outsized value: `onDeliveryStatus` UPDATEs `notification_dispatch_log.delivery_status`/`delivery_reported_at`. Messaging can finally prove "delivered/read." No external dependency. *(OURGAP-8 / OPERATIONAL_CLOSED_LOOP_FABRIC Stage 5.)*

### Wave 1 — The actuator PORT + registry — flag `ACTUATORS_PORT` (off)
New `packages/actuators`: `port.ts` (the §1.2 interface), `registry.ts`, the compensation catalog, the `ActuatorAuditSink` → sovereign-ledger binding. **No live calls yet** — wrap existing PRESENT organs (M-Pesa, notification rail, ledger) as the first actuators in dry-run. **Depends on:** nothing. **Unblocks:** everything below.

### Wave 2 — The saga EXECUTOR (THE KEYSTONE — **BLOCKER**) — flag `ACTION_ORCHESTRATOR` (off)
`services/action-orchestrator`: walk `action_steps`, call actuators idempotently via the port, run `COMPENSATE` in reverse on failure — **generalizing `disbursement-reconciliation.job`** from money to all actuators. Add `/actions` route + durable worker. Implement `simulate(plan)` → `projectedEffects` (the approval packet) + the two-phase resume (approval → resume-from-gated-step). **Depends on:** Wave 1. **Until this ships, the saga schema + durable engine + HITL gate + actuator providers + autonomy posture all have NOWHERE TO CONVERGE.** *(OURGAP-1/4/5; INV-D EXECUTE-to-closure.)*

### Wave 3 — Durable backbone real — flag `DURABLE_EXEC_ENABLED=true` (action path)
Flip Inngest on for the action path; deploy the worker; **evaluate DBOS** (Postgres-native — actuator-checkpoint + audit-row in one txn on RLS Supabase). Back the await-windows durably so the 3-week shipment survives restart (the plan IS the workflow). Drizzle-back the four-eye router (**RSS-21**). **Depends on:** Wave 2. *(OURGAP-2/3; INV-G uncapped duration.)*

### Wave 4 — Autonomy-controller meta-rail (**BLOCKER**, xref RSS-16) — flag `AUTONOMY_META_RAIL` (off)
`kernel/autonomy-controller/` wrapping policy-gate + inviolable, **immutable to the agent**; the executor consults posture × reversibility × rails × quota per step **outside** the agent loop. Wire the autonomy-cap hook (**AUT-05**). **Depends on:** Wave 2. *(OURGAP-10; INV-F rails by construction.)*

### Wave 5 — Wire the TZ money-out + e-gov money rails (sandbox first) — flag `TZ_RAILS` (off)
M-Pesa-TZ (TZS) + ClickPesa/PayIn aggregator (Tigo/Airtel/HaloPesa) actuators; **wire `createGepgRealAdapter()`** + `FILE_GEPG` handler. All against sandbox (`gepg-sandbox.go.tz`, M-Pesa sandbox) before live. **PERMANENTLY HITL:** every disbursement (money-out), every GePG payment. **Depends on:** Waves 2+4. *(GAP-HANDS-2; code-audit H.2.)*

### Wave 6 — Re-domain agency tools + wire one e-sign stack — flag `MINING_ACTUATORS` (off)
Re-domain the five property-bound agency tools to mining nouns (sites/licences/royalty/shipments/assays) **or** accept them as BN-only. Pick ONE e-sign stack, bind at composition, expose `esign.send_for_signature` end-to-end (request→persist→poll-to-signed); retire the duplicate. **PERMANENTLY HITL:** sending a binding contract for signature (first-of-kind). **Depends on:** Wave 2. *(code-audit H.3/H.4.)*

### Wave 7 — TZ-mining e-gov actuators (portal-driver) — flag `TZ_EGOV` (off)
Build `tra-vfd-real.ts` (`tax.issue_efd_receipt`), Tume-ya-Madini/IDRAS licence+royalty submission (portal-driver + GePG money leg), BRELA annual return. All behind the portal-driver transport with dry-run preview + human submit. **PERMANENTLY HITL (sovereign):** every filing / licence / royalty / permit submission — the brain prepares + pre-fills + reminds; **a human always submits**. **Depends on:** Waves 2+5. *(code-audit H.5; INV-F money/licence rail.)*

### Wave 8 — Mineral-trade chained saga (Borjie-specific) — flag `MINERAL_TRADE` (off)
Assay → certificate → refiner consign → offtake provisional/final settle, as one durable saga. **PERMANENTLY HITL:** sample-submit, refiner-consign, contract-execute, final-settle (the four sovereign confirm steps). **Depends on:** Waves 2+5+6.

### Wave 9 — Service operating model — flag `SERVICE_MODEL` (off)
Outcome meter + SLA attainment + fee-clawback (GAP-HANDS-1/8); **Trust Receipt** + completion certificate (GAP-HANDS-4); authority control plane / scoped payment tokens (GAP-HANDS-3); insurance/bonding linkage + insured aggregate (GAP-HANDS-5); Fiduciary Charter + regulator attestation endpoint (GAP-HANDS-6); calibrated confidence thresholds (GAP-HANDS-7). **Depends on:** Waves 2–4 (everything must be audit-chained + gated first).

### Wave 10 — INV-C runtime extension + earned autonomy — flag `ACTUATOR_DISCOVERY` (off)
`discoverAndWrap()` + quarantine-promote (new actuators born `dryRun`-only, irreversible-by-default, human-sign-off to go live); earned per-action-class autonomy trust ledger (ratchets up on track record, reverts on near-miss; **money/licence/deletion never ratchet**). **Depends on:** Waves 2+4+9.

### Wave 11 — BossNyumba parity — flag `BN_ACTUATORS` (off)
Bind the same fabric to BN's domain: swap mining-licence→land/title (e-Ardhi), mineral-trade→property-transaction; keep KRA-eRITS for BN-KE. Everything else is the shared spine. **Depends on:** all prior waves landing in the shared layer.

**Critical path:** Wave 0 → **Wave 1 → Wave 2 (KEYSTONE BLOCKER) → Wave 4 (meta-rail BLOCKER)** → Waves 3/5/6/7/8 (rails + adapters, parallelizable once 2+4 land) → Wave 9 (service model) → Waves 10/11. The two blockers (saga executor + autonomy meta-rail) gate the whole arm; everything else is adapters hanging off a port that already enforces the rails by construction.

---

## Sources (in-repo)

`Docs/research/{hands-actuators-fabric, hands-action-execution, hands-service-model, hands-code-audit}.md` · `Docs/research/MASTER_GAP_REGISTER.md` (INV-F / INV-F-sharpened / INV-C / INV-D / INV-E / INV-G; COG-07/AUT-14, KI-16, RSS-16/21, AUT-05) · `Docs/research/OPERATIONAL_CLOSED_LOOP_FABRIC.md` (Stage 5 keystone weld) · `packages/connectors/src/base-connector.ts` · `packages/connectors/src/adapters/{gepg-real, kra-erits-real, nida-real, eardhi-adapter}.ts` · `services/payments-ledger/src/providers/{mpesa-provider, stripe-provider}.ts` · `services/payments-ledger/src/services/disbursement.service.ts` · `services/payments-ledger/src/jobs/disbursement-reconciliation.job.ts` · `packages/database/src/schemas/action-runtime.schema.ts` (verified kinds: FILE_GEPG/SEND_WHATSAPP/SEND_SMS/SEND_EMAIL/CALL_EXTERNAL_API/EMIT_WEBHOOK/MUTATE_ENTITY/VERIFY/COMPENSATE) · `packages/central-intelligence/src/durable/inngest-executor.ts` (`DURABLE_EXEC_ENABLED`) · `packages/central-intelligence/src/kernel/power-tools/{registry, types}.ts` · `services/api-gateway/src/services/{notification-dispatch/dispatcher-worker, action-executor/registry, orchestration/risk-tiers}.ts` · `services/api-gateway/src/composition/agency-port-bindings.ts` · `packages/browser-perception/` · `packages/connectors/whatsapp/`.

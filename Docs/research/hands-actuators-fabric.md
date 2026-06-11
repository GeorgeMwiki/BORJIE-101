# The Hands — Real-World Actuator Fabric (SOTA dossier)

**Lane:** `real-world-actuators-fabric`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** research subagent (web-grounded, June-2026 sources)
**Scope:** Borjie (mining-estate OS) + BossNyumba (real-estate OS) share one brain/wiring; only the domain layer differs. This dossier designs the **actuator layer** — the MD's *hands* — that lets the brain **do the actual work end-to-end** via real-world rails, not merely advise.

> **INV-F (Master Gap Register):** Borjie/BN is a SERVICE that DOES THE ACTUAL WORK end-to-end via real-world ACTUATORS. Default is **DO, not suggest**. External actions are **idempotent + reversible/compensable**, driven to **confirmed completion** (the closed-loop fabric), within **rails** (money / licence / deletion HITL on the irreversible step). This lane builds the rails.

---

## 0. The thesis — what a "hand" is, and why ports not adapters

A **junior agent** (cost-engineer, compliance, sales-offtake, treasury) produces an *intent*: "pay this supplier TZS 4.2M", "file this VAT return", "send the assay result to the buyer", "renew PML #4471 before it lapses". An **actuator** is the thing that turns that intent into a **confirmed real-world effect** on an external system of record — M-Pesa moves the money, TRA stamps the e-receipt, Tume ya Madini records the royalty, WhatsApp delivers the message.

Today Borjie already has the *transport* primitive for this (`packages/connectors/src/base-connector.ts` — rate-limit, circuit-breaker, retry, idempotency-key passthrough, audit sink, oauth2 refresh) and real adapters (`mpesa-real.ts`, `gepg-real.ts`, `kra-erits-real.ts`, `nida-real.ts`). It also has the *money* spine (`services/payments-ledger`: M-Pesa + Stripe providers, double-entry ledger, outbox, webhook-dedupe-store). What is **missing** is the **uniform actuator port** above these — a single interface the brain composes (`capability`, `idempotencyKey`, `reversibility`, `dryRun`, `confirm`) so the modality-arbiter can pick an actuator the way it picks a tool, and the closed-loop runner can drive any external action to confirmed completion or compensation. That port, plus a per-category capability matrix and a runtime **actuator registry** (INV-C), is what this dossier specifies.

**Design law:** an actuator is *not* an adapter. The adapter is the protocol-specific HTTP/XML/SOAP code (it lives under `packages/connectors/src/adapters/`). The **actuator** is the *capability contract* — it declares `reversibility`, supports `dryRun`, returns an `idempotencyKey`-keyed receipt, and exposes a `confirm`/`compensate` pair. One adapter (M-Pesa) backs many actuators (`payment.disburse_b2c`, `payment.collect_c2b`, `payment.b2b_settle`). The brain never sees the adapter; it sees the actuator port.

---

## 1. The actuator categories needed to RUN an estate

To actually *run* a mining estate (Borjie) or a property portfolio (BN), the brain needs hands in **nine** categories. For each: the real 2026 rail in Tanzania (launch jurisdiction), the API reality, auth/sandbox, idempotency, reversibility, and the irreversible step that **must stay human** (HITL).

### 1.1 PAYMENTS — moving money out and pulling money in

The single most consequential actuator family. Tanzania mobile-money + bank + card, all behind the existing double-entry ledger so every external movement has a matching internal posting (the money invariant: *every external actuator effect is mirrored in `LedgerService.post()`*).

| Rail | Real API (2026) | Auth / sandbox | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|---|
| **M-Pesa (Vodacom TZ)** | **Daraja API** (Safaricom/Vodacom). C2B (Pay Bill / Till collect), B2C (disburse to wallet — salaries, supplier payouts, reimbursements), B2B (Pay Bill→Pay Bill supplier settlement), STK Push (request-to-pay). | OAuth bearer (consumer key/secret → token). Sandbox auto-activated for STK/C2B; **B2C + B2B require separate whitelisting + manual go-live activation**. | `payment.collect_c2b`, `payment.request_stk`, `payment.disburse_b2c`, `payment.b2b_settle` | Borjie `idempotencyKey` → Daraja `OriginatorConversationID`; webhook callbacks deduped in existing `webhook-dedupe-store.ts`. | **Forward-only** at the rail: a sent B2C is *not* recallable. Compensation = an offsetting B2C *back* (a new transfer), recorded as a saga compensation, never a "cancel". | The **disburse step** (money leaving the estate wallet) is the irreversible step → dual-control four-eye before `confirm`. |
| **Airtel Money TZ** | **Airtel Africa Developer Portal** (`developers.airtel.africa`) — Collections + Disbursements, pan-African, OAuth 2.0 client-credentials, sandbox + production endpoints, KYC for prod. | client_id/secret, OAuth2; sandbox available. | same capability ids, `provider=airtel` | provider `transaction.id` keyed to Borjie idempotencyKey | forward-only (offsetting disbursement to compensate) | same disburse HITL |
| **Tigo Pesa / Mixx by Yas TZ** | Reached in 2026 primarily via **aggregators** (ClickPesa, Selcom, Beem, Pesapal) rather than a first-party public dev portal; aggregator exposes one collect/disburse API across M-Pesa + Airtel + Tigo. | aggregator API key / OAuth | same ids, `provider=aggregator:<name>` | aggregator ref keyed | forward-only | same |
| **Bank / SWIFT / TISS** | Bank-specific host-to-host or aggregator (Selcom/ClickPesa bank payout); cross-border via SWIFT/correspondent. | bank-issued creds / aggregator | `payment.bank_transfer`, `payment.swift_remit` | bank reference / UETR | reversal only by recall request (slow, manual) | always HITL (high value) |
| **Cards (Stripe)** | Existing `stripe-provider.ts` — used for non-TZ / online card flows; PaymentIntent + Refund + Transfer + Connect. | Stripe secret key; full sandbox. | `payment.card_charge`, `payment.card_refund`, `payment.payout_connect` | native Stripe `idempotency-key` | **refundable** (true reversal API) | charge HITL only above threshold |

**Beyond-today leap:** a **rail-arbiter** actuator that, given an intent ("pay supplier X TZS 4.2M, recipient on Airtel"), *chooses the cheapest reachable rail* by live fee/latency/reachability — it tries M-Pesa B2C, falls back to Airtel, then aggregator — and presents the chosen rail + fee as part of the `dryRun` preview before the human confirms. The estate stops caring *which* mobile-money network the counterparty is on; the brain routes money the way IP routes packets.

### 1.2 MESSAGING — the counterparty conversation rail

Every real action ends in a message: "your royalty is paid", "assay ready", "shift starts 06:00", "rent due". Tanzania = WhatsApp-first + SMS fallback.

| Rail | Real API (2026) | Auth / sandbox | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|---|
| **WhatsApp** | **WhatsApp Cloud API** (Meta Graph). Per-message pricing since 1-Jul-2025 (billed on **delivery**, by recipient + category: marketing / utility / **authentication** / service). 24h service window = free service replies; utility templates free inside window. Templates must be pre-approved. | Meta system-user token + WABA + phone-number-id; full sandbox test number. | `message.send_template`, `message.send_session`, `message.send_otp` | Borjie idempotencyKey → dedupe on `wamid`; existing `packages/connectors/whatsapp` already has webhook-signature + ingest + redact. | **Not reversible** (a delivered message is delivered). Compensation = a corrective follow-up message. | None for utility/service; **marketing blasts** above a recipient-count threshold → human approve (cost + reputational blast radius). |
| **SMS** | Beem Africa / Africa's Talking / Twilio (TZ short/long codes, sender-id). | API key | `message.send_sms` | message-id dedupe | not reversible | none (low blast radius) |
| **Email** | SES / Postmark / Resend | API key | `message.send_email` | message-id | not reversible | none |

**Beyond-today leap:** an **inbound-actuator** view of messaging — WhatsApp is *bidirectional*. The same connector that *sends* the royalty-paid template *receives* the buyer's "confirmed, send the dore" reply, and the closed-loop runner treats that inbound message as the **confirmation signal** that closes the loop on the shipment actuator. Messaging becomes both a hand and a *sensor* on the same wire.

### 1.3 E-GOVERNMENT / REGULATORY — the sovereign rails

This is the category that makes Borjie a *system of record participant*, not a CRM. Tanzania's e-gov rails are real, mostly XML/token-based, and largely **append-only / non-reversible** — which is exactly why they are HITL on the irreversible filing step.

| Rail | Real API (2026) | Auth / sandbox | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|---|
| **TRA — tax e-receipt (VFD)** | **TRA VFD API** (EFDMS). Endpoints: `vfdRegReq` (one-time device registration), `vfdtoken` (bearer, ~86399s), `efdmsRctInfo` (post each receipt/invoice), `efdmszreport` (daily Z-report). XML body; **SHA-1-with-RSA PKCS#12 signature**, base64; headers `Cert-Serial`, `Routing-Key`, bearer. Mandatory ≥14M TZS turnover. | PKI cert (PKCS#12) + token; **test server `virtual.tra.go.tz`** documented, prod URL gated. | `tax.issue_efd_receipt`, `tax.post_z_report`, `tax.register_vfd` | **Sequential** — RCTNUM + global counter (GC) must increment with *no gaps*; resubmit of same RCTVNUM rejected as duplicate (built-in idempotency). | **No cancellation exists.** A wrong receipt → issue a *new* number; the cancelled number's sequence is never reused. Pure append-only. | Issuing a fiscal receipt is a tax-legal act → the *first* go-live wiring is HITL; steady-state per-sale receipts can be auto once the policy is signed (they mirror real ledger sales). |
| **TRA — TIN check / filing** | TIN verification (used by BRELA at registration — "Check TIN" against TRA DB); return filing via TRA portal (no clean public REST — RPA/portal-driver fallback). | portal creds | `tax.verify_tin`, `tax.file_return` (portal-driven) | n/a (read) / submission-id | filing not reversible (amend = new filing) | **return filing always HITL** (sovereign tax act) |
| **GePG — gov payments** | **Government Electronic Payment Gateway** (Ministry of Finance). Open API for billers/third-parties; generates **control numbers**; accepts partial payments against one control number until billed amount met. Mandatory for all gov institutions since Jul-2018. | MoF-issued biller creds, signed messages | `govpay.request_control_number`, `govpay.reconcile_payment` | control-number is the natural idempotency key | a control number can expire/reissue; a *settled* gov payment is not reversible by the payer | requesting a control number = safe (dryRun-able); **paying it** rides the PAYMENTS HITL |
| **Tume ya Madini — mining licence + royalty** | **Mining Commission** portal + online **cadastre / MOMS**. Licence lifecycle (PML/ML/SML/processing/refining), **royalty 6% on gross value + 1% clearing/inspection fee paid before export permit issues**, online submissions (~48h export-permit processing). Royalty/fee **collected via GePG control numbers**. | portal creds; **no first-party public REST API** in 2026 → portal-driver / form-fill actuator + GePG for the money leg. | `mining.renew_licence`, `mining.pay_royalty` (→ GePG), `mining.request_export_permit`, `mining.verify_licence_status` | submission/application id; GePG control number for the money | application withdrawable pre-decision; an *issued* licence/permit is a sovereign instrument — not app-reversible | **every licence/royalty/permit submission is HITL** (sovereign; HIGH-risk policy prefix). The brain *prepares + pre-fills + schedules + reminds*; a human *submits*. |
| **BRELA — business registry** | **ORS** (`ors.brela.go.tz`) + new **BOS** platform (launched 8-Apr-2026; hybrid ORS+BOS in 2026). Company/business-name registration, annual returns, change of particulars, IP marks. Public name/number search is free. **No developer API published as of 2026** → read via search actuator, write via portal-driver. | portal creds | `registry.search_company` (read), `registry.file_annual_return` (portal-driven) | application id | annual return amendable; registration not reversible | filing/registration HITL |

> **Codebase reality:** `packages/connectors/src/adapters/gepg-real.ts` and `kra-erits-real.ts` (Kenya's eTIMS analogue) already exist — TRA VFD and Tume-ya-Madini actuators are the **named-but-unbuilt** members of this family; KI-16 in the Master Gap Register already flags the regulator-feed adapter (Tumemadini/NEMC/TRA/BoT/GePG) as registered-for-*sensing* but not for *acting*. This lane is the acting half.

**Beyond-today leap:** because BRELA, Tume ya Madini, and TRA-filing lack clean public REST APIs, the actuator port must support a **`portal-driver` transport** (a hardened, audited browser-perception driver — Borjie already has `packages/browser-perception`) as a *first-class actuator backend* behind the same `dryRun`/`confirm`/`reversibility` contract. The brain doesn't know whether `mining.renew_licence` is fulfilled by a REST call or a robot filling the cadastre form — it just sees the capability. The day Tume ya Madini ships a real API, the actuator's *transport* swaps; the capability contract and every junior that depends on it are untouched.

### 1.4 PROCUREMENT / SUPPLIERS — ordering the real things

| Rail | Real API (2026) | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|
| Supplier PO / parts | Mostly **no API** in TZ artisanal-mining supply chain → actuator = "issue PO" = generate signed PDF + WhatsApp/email it to supplier + create AP commitment in ledger; large suppliers via aggregator marketplaces. | `procure.issue_po`, `procure.request_quote`, `procure.cancel_po` | PO number | **PO cancellable** while unfulfilled (compensation = cancellation message + reverse the AP commitment); once goods shipped → partially reversible (return) | issuing a PO that creates a financial commitment above threshold → HITL |

**Beyond-today:** a PO is a *promise of money*. The procurement actuator pre-stages the matching B2C/B2B payment actuator so that on goods-received confirmation (inbound message / delivery webhook) the closed-loop runner *fires the payment* automatically within rails — three-way match (PO ↔ receipt ↔ invoice) executed by the brain, payment still HITL.

### 1.5 LOGISTICS — moving the physical mineral / dore / asset

| Rail | Real API (2026) | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|
| Secure transport / courier / bonded movement of dore + export consignment | Carrier APIs where they exist (DHL/Aramex for export legs); domestic secure-transport mostly bookings via message + signed manifest. **Mineral movement is permit-gated** (ties to 1.3). | `logistics.book_shipment`, `logistics.track`, `logistics.generate_manifest` | booking ref / tracking number | booking cancellable pre-pickup; once consignment moves → not reversible | dispatching a high-value consignment → HITL |

### 1.6 ACCOUNTING EXPORT — the books leave the building

| Rail | Real API (2026) | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|
| QuickBooks Online / Xero / Sage / TZ-local | QBO + Xero have mature OAuth2 REST APIs; export journal/invoice/bill rows from the double-entry ledger. | `accounting.push_journal`, `accounting.push_invoice`, `accounting.export_ledger` | external-system idempotency-key; our ledger entry id as external ref | push reversible via reversing-journal in the target system | bulk period-close push → HITL; routine sync auto |

**Beyond-today:** the ledger is the *source of truth*; the accounting actuator makes external books a **read-replica** of Borjie's ledger, reconciled continuously, so the estate's QuickBooks is *never* the place work happens — it is a downstream projection the brain keeps in sync.

### 1.7 ASSAY-LAB / REFINER / BUYER — the mineral-trade rails (Borjie-specific)

The category that makes Borjie an *operator*, not a dashboard. The mineral-trade loop: sample → **assay** → certificate → **refiner** (dore→bars) → **offtaker** settlement (provisional then final on LBMA ref) → export permit (Tume ya Madini + 6% royalty + 1% fee via GePG).

| Rail | Real API (2026) | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|
| **Assay lab / TMAA** | Tanzania Minerals Audit Agency (now under the Mining Commission) — gold must be **assayed**; **certificate of assay mandatory** for export/refiner sale. Mostly portal/manual + lab LIMS; actuator = submit sample request + ingest certificate (OCR via existing `ocr-extraction-task.ts`). | `assay.request`, `assay.ingest_certificate`, `assay.verify_purity` | sample id | request cancellable; a *certificate* is a fact, not reversible | submitting an official sample → HITL |
| **Refiner (LBMA Good Delivery)** | LBMA Good Delivery refiners (Perth Mint etc.) — accreditation requires ≥5y existence, ≥3y refining, ≥10t/y gold. Actuator = consignment instruction + settlement terms. | `refiner.consign`, `refiner.settle` | consignment id | consignment in transit not reversible | consigning gold → HITL (high value, sovereign-adjacent) |
| **Offtaker / buyer settlement** | Provisional vs **final settlement** (LBMA reference price, moisture/impurity adjustment for dore). Borjie marketplace (`apps/buyer-mobile`) is the in-house buyer rail; external via contract + payment actuator. | `offtake.create_contract`, `offtake.provisional_settle`, `offtake.final_settle` | contract id | provisional settle reversible into final; final settle = forward-only (offsetting entry) | contract execution + final settle → HITL |

**Beyond-today:** the assay certificate, refiner consignment, and offtake contract become **chained actuators** in one durable saga: assay-ready (inbound) → auto-draft offtake contract at the assayed grade → on buyer e-sign → fire provisional settlement payment → on refiner return + LBMA fix → fire final settlement + export-permit royalty. The whole mineral-to-money loop runs as one closed-loop workflow; humans only touch the four sovereign confirm steps (sample submit, consign, contract execute, royalty/permit).

### 1.8 E-SIGNATURE — making the contract binding

| Rail | Real API (2026) | Capabilities | Idempotency | Reversibility | HITL |
|---|---|---|---|---|---|
| **e-sign** | Tanzania **Electronic Transactions Act, Cap. 442 (No. 13 of 2015)** — e-signatures carry the *same legal status as handwritten*; **TCRA licenses Certification Authorities**. Providers: **eMudhra/emSigner** (QTSP-accredited incl. Kenya — Qualified Electronic Signatures), DocuSign/Adobe Sign (Advanced ES, eIDAS-compliant), DocuSeal (OSS). Borjie already has an **e-sign PORT**. | `esign.create_envelope`, `esign.send_for_signature`, `esign.void_envelope`, `esign.fetch_executed` | envelope id | **void-able before completion** (true reversal); once fully executed → binding, not reversible (compensation = a superseding signed amendment) | sending a binding contract for signature → HITL on first-of-kind; executed-doc retrieval auto |

**Beyond-today:** pick a **QTSP (eMudhra-class)** as the canonical CA so Borjie-executed offtake/employment/lease contracts are *Qualified* (highest evidentiary weight under Cap. 442 + eIDAS 2.0 for cross-border buyers), not merely Advanced — the estate's paperwork survives a dispute in a buyer's risk committee without extra evidence.

### 1.9 — BossNyumba parity note (same hands, different fingers)

BN reuses **every** category. PAYMENTS (rent collect C2B, deposit refund B2C, contractor payout B2B), MESSAGING (rent-due, viewing-confirmed), E-GOV (TRA rental-income e-receipt, **land-registry / title** instead of Tume-ya-Madini), PROCUREMENT (maintenance parts), LOGISTICS (move-in/move-out, key handover), ACCOUNTING export, E-SIGN (lease execution). The only swapped members: 1.3's mining-licence actuator → **land/title registry**; 1.7's mineral-trade family → **property-transaction** family (valuation API, conveyancing). One actuator fabric, two domain bindings — exactly the "same brain/wiring, only the domain layer differs" invariant.

---

## 2. The actuator PORT abstraction (the uniform interface)

The keystone deliverable. A single port the brain composes, sitting *above* `BaseConnector` (transport) and *beside* `PowerTool` (meta-capability). It is the contract every category in §1 implements.

```ts
// packages/actuators/src/port.ts  (proposed — new package)

/** What an actuator can do — stable id, written `actuator.<category>.<verb>`. */
export type ActuatorCapability =
  | 'payment.disburse_b2c' | 'payment.collect_c2b' | 'payment.b2b_settle'
  | 'payment.request_stk'  | 'payment.bank_transfer' | 'payment.card_refund'
  | 'message.send_template' | 'message.send_sms' | 'message.send_otp'
  | 'tax.issue_efd_receipt' | 'tax.post_z_report'
  | 'govpay.request_control_number'
  | 'mining.renew_licence' | 'mining.pay_royalty' | 'mining.request_export_permit'
  | 'registry.file_annual_return'
  | 'procure.issue_po' | 'logistics.book_shipment'
  | 'accounting.push_journal'
  | 'assay.request' | 'refiner.consign' | 'offtake.final_settle'
  | 'esign.send_for_signature'
  | string; // open — runtime-registered actuators (INV-C) extend the set

/** How much an effect can be undone — drives the HITL gate + saga policy. */
export type Reversibility =
  | 'reversible'        // true undo API exists (Stripe refund, esign void)
  | 'compensable'       // no undo, but an offsetting forward action restores state (B2C-back)
  | 'irreversible';     // append-only / sovereign (TRA receipt, issued licence, executed contract)

export interface ActuatorContext {
  readonly tenantId: string | null;
  readonly callerId: string;
  readonly tier: PowerToolTier;          // reuse the persona ladder
  readonly threadId: string;
  readonly approvalRecordId: string | null; // set when four-eye fired BEFORE confirm
  readonly auditSink: ActuatorAuditSink;     // hash-chained, append-only (reuse sovereign-action-ledger)
  readonly clock: () => Date;
}

export interface ActuatorRequest<I> {
  readonly capability: ActuatorCapability;
  readonly input: I;
  /** Caller-supplied stable key. The fabric guarantees at-most-once *effect*. */
  readonly idempotencyKey: string;
  /** When true: compute + return the preview (fee, recipient, rail chosen,
   *  reversibility, projected ledger postings) WITHOUT touching the rail. */
  readonly dryRun: boolean;
}

export type ActuatorOutcome<O> =
  | { kind: 'preview'; capability: ActuatorCapability; reversibility: Reversibility;
      projected: O; estimatedCost?: Money; chosenRail?: string; requiresApproval: boolean }
  | { kind: 'confirmed'; receipt: ActuatorReceipt; output: O } // effect happened, rail-confirmed
  | { kind: 'pending';   receipt: ActuatorReceipt }            // submitted, awaiting async webhook
  | { kind: 'refused';   reason: ActuatorRefusal; message: string }
  | { kind: 'failed';    retriable: boolean; message: string };

/** Tamper-evident proof the effect occurred — the closed-loop anchor. */
export interface ActuatorReceipt {
  readonly capability: ActuatorCapability;
  readonly idempotencyKey: string;
  readonly externalRef: string;          // Daraja conversation id / wamid / RCTNUM / control number
  readonly reversibility: Reversibility;
  readonly compensationHandle: string | null; // token a compensate() call replays
  readonly at: string;
}

export type ActuatorRefusal =
  | 'TIER_TOO_LOW' | 'APPROVAL_MISSING' | 'KILLSWITCH_HALTED'
  | 'RAIL_UNREACHABLE' | 'OUT_OF_RAILS'  // money/licence/deletion guardrail
  | 'NOT_CONFIGURED';

export interface Actuator<I = unknown, O = unknown> {
  readonly capability: ActuatorCapability;
  readonly reversibility: Reversibility;
  readonly requiresApproval: boolean;     // HITL on the irreversible step
  readonly inputSchema: z.ZodType<I>;
  /** Cheap, side-effect-free preview. MUST be safe to call any number of times. */
  preview(ctx: ActuatorContext, req: ActuatorRequest<I>): Promise<ActuatorOutcome<O>>;
  /** The committing call. MUST be idempotent on idempotencyKey. */
  confirm(ctx: ActuatorContext, req: ActuatorRequest<I>): Promise<ActuatorOutcome<O>>;
  /** Undo (reversible) or offset (compensable). Refuses on irreversible. */
  compensate(ctx: ActuatorContext, receipt: ActuatorReceipt): Promise<ActuatorOutcome<unknown>>;
}
```

**Why this shape — five SOTA properties baked in:**

1. **`dryRun` is mandatory, not optional.** Every actuator can be *previewed*: fee, rail, recipient, reversibility, and **projected ledger postings** before a single byte hits M-Pesa. The brain's debate/LATS loop runs on previews; the human approves the preview; `confirm` executes exactly what was previewed. This is the structural answer to "DO not suggest, but never surprise."
2. **`reversibility` is a first-class field**, so the autonomy-controller can *mechanically* enforce INV-F: `irreversible` ⇒ `requiresApproval=true` ⇒ four-eye gate fires before `confirm`. Money / licence / deletion fall out of the type system, not out of a code review.
3. **`idempotencyKey` guarantees at-most-once *effect*** end to end — caller key → adapter's native key (Daraja `OriginatorConversationID`, Stripe `idempotency-key`, TRA sequential RCTNUM, GePG control number). At-least-once delivery (webhooks) + idempotent effect = the standard exactly-once-effect posture; the existing `webhook-dedupe-store.ts` is the dedupe half.
4. **`compensate` makes saga rollback uniform.** `reversible` → call the undo API; `compensable` → fire the offsetting forward action; `irreversible` → refuse and raise `REQUIRES_MANUAL_REVIEW` (the documented Temporal-saga escape hatch for partially-reversible side effects). The brain's multi-step plans become sagas where each actuator carries its own compensation.
5. **`ActuatorReceipt` is the closed-loop anchor.** The closed-loop runner doesn't consider an action *done* on `confirm` returning — it's done when the **receipt's `externalRef` is reconciled** against the inbound confirmation (webhook, Z-report acceptance, inbound WhatsApp "received", delivery callback). `pending` → `confirmed` is driven by the existing outbox + webhook substrate.

**Composition with what exists (zero greenfield where avoidable):**

- **Transport:** each actuator's `confirm` is implemented on top of `createBaseConnector` (already has retry, circuit-breaker, idempotency-key passthrough, audit). No new HTTP machinery.
- **Money mirror:** PAYMENTS actuators post through `services/payments-ledger` `LedgerService.post()` — the actuator's `projected` in a preview *is* the projected double-entry. The hard rule ("money path goes through `LedgerService.post()`") is satisfied because the actuator is *defined* in terms of it.
- **Audit:** `ActuatorAuditSink` writes to the **hash-chained `sovereign-action-ledger`** (reuse `PowerToolAuditDestination='sovereign-action-ledger'`) — every external effect is append-only signed.
- **Gate:** `requiresApproval` routes through the existing four-eye `createApprovalGate.propose()`; `tier` reuses `PowerToolTier`. The autonomy-controller meta-rail (RSS-16, named but unbuilt) wraps the registry's dispatch so the gate fires *outside* the agent loop and the agent can never reach its own gate.
- **Arbiter landing pad:** the modality-arbiter (COG-07/AUT-14, the register's keystone) gains a fifth verb — `ACTUATE` — that selects an actuator capability the same way it selects ANSWER/SKILL/WORKFLOW/LOOP/AGENT. Captured skills already have somewhere to land; now real-world *effects* do too.

---

## 3. The actuator REGISTRY + runtime extension (INV-C, beyond-today)

```ts
// packages/actuators/src/registry.ts (proposed)
export interface ActuatorRegistry {
  register(a: Actuator): void;                 // boot-time, code-defined actuators
  resolve(cap: ActuatorCapability): Actuator | null;
  list(forTier: PowerToolTier): ActuatorCapability[];
  /** INV-C — the brain wraps a *newly discovered* external API as an actuator
   *  at runtime, behind the SAME port, and it becomes immediately composable. */
  discoverAndWrap(spec: DiscoveredActuatorSpec): Promise<RegistrationOutcome>;
}
```

The registry mirrors the existing `PowerToolRegistry` (boot-composed, orchestrator-looked-up) and the `connectors` `registry.ts` — both already in-repo. The boot path registers the §1 actuators. The **beyond-today** path is `discoverAndWrap`:

This is the 2026 MCP-native move. Per the SOTA (Kong MCP Registry, Spring AI `McpSyncServer.addTool()`, MCP `notifications/tools/list_changed`, **Dynamic Client Registration** so an agent can obtain credentials and onboard a server *without prior coordination*), an agent no longer needs to know every tool in advance — it queries a registry, identifies the right service, and executes it dynamically, tools added/removed at runtime with no restart.

Borjie's version, hardened for a system that *moves real money in Tanzania*:

1. **Discover** — the brain encounters a new external system (a new offtaker's settlement API, a new bank's payout API, a freshly-shipped Tume-ya-Madini REST endpoint). It fetches the **OpenAPI / MCP manifest**, or, when there's *no* API (BRELA/cadastre), proposes a **portal-driver** recipe.
2. **Wrap** — `discoverAndWrap` generates an `Actuator` conforming to the port: it must declare `capability`, infer/`require` a `reversibility` (defaulting conservatively to `irreversible` when unknown → forces HITL), build a Zod `inputSchema`, and synthesize `preview`/`confirm`/`compensate` over `BaseConnector` or the portal driver.
3. **Quarantine** — a newly-wrapped actuator enters at the **lowest tier, `dryRun`-only, irreversible-by-default**, written to the sovereign ledger, and **cannot be promoted to live `confirm` without a human signing off** — the meta-rail invariant: the agent can *grow new hands*, but it can never grant *itself* the right to use a new hand on the money/licence/deletion path. New capability is always born quarantined.
4. **Promote** — after eval (the trajectory/eval harness that "defines done") + human sign-off, the actuator graduates to live, its `reversibility` and HITL policy frozen into a signed policy row.

**The leap stated plainly:** a world-class autonomous MD in 2026 is not one with a fixed toolbelt — it is one that can *grow a new hand* when reality presents a new rail, wrap it behind the identical `dryRun`/`confirm`/`reversibility`/`compensate` contract, and start using it **within the same money/licence/deletion rails that protect every other hand** — because the rails live in the *port*, not in any individual actuator. New rail, same guardrails, by construction.

---

## 4. Where Borjie stands today vs this design (the gap)

| Layer | Have | Gap |
|---|---|---|
| Transport primitive | ✅ `base-connector.ts` (rate-limit, breaker, retry, idempotency-key, audit) | — |
| Real adapters | ✅ `mpesa-real.ts`, `gepg-real.ts`, `kra-erits-real.ts`, `nida-real.ts`; `payments-ledger` M-Pesa+Stripe; `connectors/whatsapp` | TRA-VFD, Tume-ya-Madini, BRELA, Airtel, e-sign-prod, assay/refiner adapters unbuilt |
| Money spine | ✅ double-entry ledger, outbox, webhook-dedupe | B2C/B2B disburse path not whitelisted/live; rail-arbiter absent |
| Meta-capability registry | ✅ `power-tools/registry.ts` (tiered, four-eye, sovereign-ledger audit) | no **actuator** port/registry above it |
| Uniform actuator port | ❌ | **the keystone of this lane** — `capability`/`idempotencyKey`/`reversibility`/`dryRun`/`confirm`/`compensate` |
| Runtime discovery (INV-C) | ⚠️ MCP/connectors registry exists for *sensing* | `discoverAndWrap` + quarantine-promote not built |
| Closed-loop runner | ⚠️ outbox + webhook substrate | receipt-reconciliation saga driver not generalised across categories |
| Autonomy meta-rail | ❌ (RSS-16, named-not-built) | wrap registry dispatch so HITL fires outside the agent loop |

**One-line verdict:** Borjie has the *transport* and the *money mirror* and a tiered *meta-tool registry* — world-class foundations. The missing piece, and the entire point of this lane, is the **actuator port + registry** that turns "we have a connector to M-Pesa" into "the brain has a *hand* it can preview, confirm within rails, and compensate" — generalised across all nine categories and extensible at runtime.

---

## Sources

- M-Pesa Daraja API (B2C/C2B/B2B, payout/disbursement, whitelisting): https://developer.safaricom.co.ke/ · https://www.kenzobe.com/blog/mpesa-b2c-vs-c2b · https://clickpesa.com/m-pesa-disbursement-explained-setup-limits-and-options/
- Airtel Money Africa Developer Portal (collections/disbursements, OAuth2, sandbox): https://developers.airtel.africa/ · https://clickpesa.com/payment-gateway/payment-and-payout-methods/airtel-money-api-integration-guide/
- WhatsApp Business Cloud API per-message pricing (2026, delivery-billed, categories): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing · https://respond.io/blog/whatsapp-business-api-pricing
- TRA VFD API (endpoints, SHA-1/RSA PKCS#12 signing, sequential RCTNUM idempotency, no cancellation): https://tra-docs.netlify.app/guide/api/ · https://www.tra.go.tz/page/efd-vfd-suppliers · https://edicomgroup.com/blog/the-electronic-invoice-in-tanzania
- GePG Government Electronic Payment Gateway (control numbers, open biller API, partial payments): https://www.gepg.go.tz/faq/ · https://clickpesa.com/understanding-gepg-in-tanzania-what-it-is-how-it-works-and-why-it-matters/
- Tume ya Madini / Mining Commission (licences, 6% royalty + 1% clearing fee, cadastre, export permit): https://www.tumemadini.go.tz/ · https://www.tumemadini.go.tz/mineral-trade/mineral-royalties-and-inspection-fees-rates/ · https://www.zatra.co/post/mining-licenses-in-tanzania-explained-2026-investor-guide
- BRELA ORS + new BOS platform (no public API, hybrid 2026, TIN check vs TRA): https://ors.brela.go.tz/orsreg/searchbusinesspublic · https://gerpatsolutions.co.tz/brela-bos-system-tanzania-2026-complete-guide-to-new-business-registration-platform/
- Tanzania Electronic Transactions Act Cap. 442 (e-sign legal status, TCRA-licensed CAs) + e-sign providers (eMudhra QTSP / DocuSign AES): https://www.emsigner.com/Areas/Home/legalityCountryTanzania · https://kgpartners.co.tz/the-legal-framework-governing-electronic-signatures-in-tanzania/ · https://emudhra.com/en/blog/emudhra-vs-docusign-enterprise-esignature
- Gold assay/refiner/offtake (TMAA assay certificate, LBMA Good Delivery, provisional vs final settlement, 48h export permit): https://www.zatra.co/post/how-to-export-gold-from-tanzania-legally-2026-compliance-trading-guide · https://www.lbma.org.uk/good-delivery/how-to-apply-for-good-delivery-accreditation
- Saga / compensating transactions / idempotency / durable execution / HITL for partially-reversible side effects: https://temporal.io/blog/mastering-saga-patterns-for-distributed-transactions-in-microservices · https://temporal.io/blog/compensating-actions-part-of-a-complete-breakfast-with-sagas · https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- MCP runtime tool discovery / dynamic client registration / registry (INV-C beyond-today): https://konghq.com/blog/engineering/mcp-registry-dynamic-tool-discovery · https://spring.io/blog/2025/05/04/spring-ai-dynamic-tool-updates-with-mcp/ · https://stytch.com/blog/mcp-oauth-dynamic-client-registration/ · https://www.speakeasy.com/mcp/tool-design/dynamic-tool-discovery
- In-repo grounding: `packages/connectors/src/base-connector.ts`, `packages/connectors/src/adapters/{mpesa-real,gepg-real,kra-erits-real,nida-real}.ts`, `services/payments-ledger/src/providers/{payment-provider.interface,mpesa-provider,stripe-provider,webhook-dedupe-store}.ts`, `packages/central-intelligence/src/kernel/power-tools/{types,registry}.ts`, `packages/connectors/whatsapp/`, `packages/browser-perception/`, `Docs/research/MASTER_GAP_REGISTER.md` (INV-F, KI-16, RSS-16, COG-07/AUT-14).

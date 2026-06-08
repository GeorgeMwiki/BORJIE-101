# HANDS — Actuator & Action-Execution Code Audit (vs INV-F)

**Lane:** actuator-code-audit (REPO READ-ONLY)
**Date:** 2026-06-08 · **Branch:** integration/parity-final
**Thesis (INV-F):** Borjie/BN is a SERVICE that DOES THE ACTUAL WORK end-to-end through real-world ACTUATORS — default DO not suggest; external actions idempotent + reversible/compensable, driven to confirmed completion (closed loop), within rails (money/licence/deletion HITL on the irreversible step).
**Verdict (one line):** The *primitives* are strong — a genuinely production-grade money rail (M-Pesa Daraja STK+B2C, ledger-before-transfer + NEEDS_REVERSAL compensation) and a genuinely production-grade notification rail (durable outbox + real Twilio/WhatsApp/Africa's Talking/Resend/push). But the **generic multi-step action-execution fabric is ABSENT at runtime** (the `action_plans/action_steps` saga has a schema but **no runner**), the wired action tools are **bound to property-domain tables**, and the **Tanzania e-gov actuators (GePG/TRA/Tume ya Madini/BRELA) and e-signature are built-or-ported but NOT wired** into the gateway. We have *hands*; we do not yet have *one closed-loop arm the brain reliably drives to completion across steps*.

Legend: **PRESENT** = real adapter that performs the external side-effect AND a wired runtime call path · **PARTIAL** = real adapter exists but unwired / mock-default / domain-mismatched / no compensation · **ABSENT** = no adapter.

---

## A. Payment actuators — DISBURSE/charge, not just record

### A1. M-Pesa Daraja — **PARTIAL→PRESENT (the strongest actuator we have)**
- **Two real Daraja clients, both DO the side-effect (not just record):**
  - `services/payments-ledger/src/providers/mpesa/client.ts:159` `stkPush` (real `POST /mpesa/stkpush/v1/processrequest`), `:206` `stkQuery`, `:237` `b2c` (real `POST /mpesa/b2c/v1/paymentrequest`). OAuth token cache `:134`. Fail-loud on `ResponseCode !== '0'`.
  - `services/payments-ledger/src/providers/mpesa-provider.ts:211` `createPaymentIntent` (STK), `:362` `createTransfer` (B2C). **B2C builds the RSA `SecurityCredential`** from the initiator password (`buildSecurityCredential` `:29`, PKCS1v1.5) — this is the real disbursement path, not a stub.
- **Coverage:** STK-push (C2B-ish CustomerPayBillOnline), STK-query, B2C (BusinessPayment). **C2B register-URL and B2B are ABSENT** (`b2c` only). Webhook receiver for STK + B2C result/timeout (`server.ts`, `mpesa-webhook.middleware.ts`, HMAC + IP allowlist + replay window).
- **The PARTIAL:** **mock is the default** — `isMpesaLiveMode` (`client.ts:420`) requires `MPESA_LIVE_KEYS_PRESENT==='true'`; the provider also needs `MPESA_INITIATOR_PASSWORD` + cert (`mpesa-provider.ts:383,33`) for B2C. So "DOES the work" is gated on founder-provisioned credentials (expected) but the **default runtime DISBURSES NOTHING**. Currency is `KES` only (`mpesa-provider.ts:100`) — **a launch-in-Tanzania mismatch** (M-Pesa TZ/Vodacom uses TZS; no Tigo Pesa / Airtel Money provider exists).
- **Missing to DO THE WORK:** TZ M-Pesa/Vodacom (TZS) tenant config; Tigo Pesa + Airtel Money providers (ABSENT entirely); C2B URL registration + B2B; live credential provisioning.

### A2. Disbursement orchestration — **PRESENT (best-in-class shape)**
- `services/payments-ledger/src/services/disbursement.service.ts:152` `processDisbursement`: (a) idempotency gate by `(tenant,idempotencyKey)` `:166`; (b) **ledger-post BEFORE transfer** `:259`; (c) provider B2C transfer keyed on disbursement id `:309`; (d) on post-transfer failure leaves **`NEEDS_REVERSAL`** `:407` (money debited, transfer failed → reconciliation compensates, never blind re-transfer). `isCleanDisbursementSuccess` `:88` keeps batch accounting honest. This is exactly the INV-F "reversible/compensable, driven to completion" pattern — **for the payout actuator specifically.**
- Reconciliation job `services/payments-ledger/src/jobs/disbursement-reconciliation.job.ts` is the closed-loop sweep.

### A3. Stripe — **PARTIAL** (card rail; real provider `providers/stripe/*`, `stripe-provider.ts`) — secondary for non-TZ; not the launch actuator. Charges/transfers/refunds via real Stripe client; same provider interface.

### A4. Ledger / double-entry — **PRESENT** `LedgerService.post()` + hash-chain (`ledger.service.ts`, `ledger-hash-chain.ts`). Outbox event-publisher durability tracked separately as RSS-01 (in-memory publisher is the known gap — see MASTER_GAP_REGISTER B.1).

**Category verdict: PRESENT for the payout closed loop (M-Pesa B2C + ledger-before-transfer + NEEDS_REVERSAL), PARTIAL overall** — mock-default, KES-not-TZS, no Tigo/Airtel, no C2B-register/B2B.

---

## B. Notification SENDERS — real rail, not just a sink

### B1. SMS / WhatsApp / Email / Push senders — **PRESENT (real, production-grade)**
- **Durable outbox + worker (not a fire-and-forget sink):** `services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts` drains `notification_dispatch_log`, **atomic claim** `UPDATE … FOR UPDATE SKIP LOCKED RETURNING` (`:206`), retry/exponential-backoff/dead-letter (`MAX_ATTEMPTS=5`, `:112`), idempotency by `(tenant,idempotency_key)`. Channels: email/sms/whatsapp/app_push.
- **Real senders:**
  - SMS+WhatsApp via **Twilio** (`sms-providers/twilio.ts` — real `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`, WhatsApp via `whatsapp:` prefix `:151`) and **Africa's Talking** (`sms-providers/africastalking.ts` — real `POST https://api.africastalking.com/version1/messaging`), env-routed via `composite.ts`. Falls back to `createStubSmsProvider` (`provider_not_configured`, retryable) when no creds.
  - Email via **Resend** (`packages/notifications/src/borjie-sender.ts:121` `sendEmail`, React-Email render, throws if `RESEND_API_KEY` missing — no mock fallback) + `notification-dispatch/email-provider.ts`.
  - Push (`push-provider.ts`, `push-providers/`).
- **Wired to the brain:** the kernel agency notifications tool routes to this outbox — `services/api-gateway/src/composition/agency-port-bindings.ts:87` `createNotificationsPort` INSERTs a `notification_dispatch_log` row (`template_key='rent.reminder'`, status `pending`). So a brain reminder DOES enqueue a real send.

### B2. WhatsApp Business — **PARTIAL (INGEST-ONLY — cannot SEND)**
- `packages/connectors/whatsapp/` is **receive-only**: `client/http-client.ts` exposes `getMedia` + `downloadMediaBytes`; barrel `index.ts` exports webhook-receiver, poller, normalizer — **no `sendMessage` / template-message send**. Outbound WhatsApp exists ONLY through the Twilio `whatsapp:` rail (B1), i.e. via a BSP, not the native Cloud API send. **Native WhatsApp Business send (templated, session) is ABSENT.**

**Category verdict: PRESENT (real outbound rail with durability + retry + DLQ), with a gap on native WhatsApp Cloud send (BSP-only today).**

---

## C. E-signature — adapters built, **NOT wired**

- **Real adapters exist (two parallel stacks):**
  - `packages/document-ai/src/e-signature/`: `docusign-adapter.ts` (real DocuSign REST v2.1 `POST …/envelopes` `:81`, `pollStatus`, `downloadSigned`), `adobe-sign-adapter.ts`, `hellosign-adapter.ts`, `mock-adapter.ts`.
  - `packages/document-studio/src/esign/`: `dropbox-sign-adapter.ts` (real `https://api.hellosign.com/v3` `:40`), `port.ts`, `mock-adapter.ts`.
- **The gap: ZERO gateway wiring.** No `createDocuSignAdapter` / `requestSignature` / `ESignaturePort` call site in `services/api-gateway/src` (grep = 0 real importers; only a JSDoc mention in `ported-platform-wiring.ts:19`). So a signature request is never *issued* from any runtime path. **Two parallel e-sign stacks** (document-ai vs document-studio) → no single port of record.
- **Missing to DO THE WORK:** pick one stack, bind an adapter at composition, expose a brain tool / action step that calls `requestSignature` → persist `requestId` → poll to completion (the closed loop). Today it stops at "adapter exists."

**Category verdict: PARTIAL — real DocuSign/Dropbox-Sign/Adobe adapters, but a port-only situation at runtime (unwired, duplicated).**

---

## D. E-gov / TRA / Tume ya Madini / procurement / logistics

### D1. Real connectors that EXIST (`packages/connectors/src/adapters/`):
- **GePG (Tanzania Govt e-Payment Gateway)** — `gepg-real.ts` is REAL: `https://gepg.go.tz` / sandbox `gepg-sandbox.go.tz`, `generateControlNumber`, control-number status poll, daily reconciliation. **Exported from the barrel (`index.ts:150`) but NOT wired into the gateway** (only barrel + test reference it). → **PARTIAL.**
- **KRA eRITS (Kenya rental-income tax)** — `kra-erits-real.ts` REAL (login/session, `submitMri`, `getReceipt`, `cancelFiling`, period validation, version guard). **Wired** via Temporal: `composition/durable/temporal/kra-erits-filing-workflow.ts` + dispatcher. BUT it is **Kenya property rental tax, not the launch jurisdiction's mining tax** → domain/jurisdiction mismatch for Borjie-TZ. → **PARTIAL (wired but wrong-domain for launch).**
- **NIDA (TZ national ID)** — `nida-real.ts` + `nida-adapter.ts`, wired via `hq-tool-port-bindings.ts:116` behind `NIDA_GATEWAY_URL` (falls back to `notYetWired` stub when unset) → **PARTIAL (opt-in, env-gated).**
- **e-Ardhi (TZ land registry)** — `eardhi-adapter.ts`, same opt-in shape (`EARDHI_GATEWAY_URL`) → **PARTIAL.**
- **Credit bureau** — `credit-bureau-adapter.ts` (real connector) → PARTIAL (wiring unverified here).

### D2. ABSENT entirely (no adapter at all):
- **TRA (Tanzania Revenue Authority)** tax filing — no `tra-*` adapter (only `tra-filing-assistant` sub-MD prompt scaffold + a `regulatory-filings` schema). The KRA adapter is the Kenya analogue; **no TZ tax actuator.**
- **Tume ya Madini / Tumemadini (Mining Commission)** — licence/royalty filing actuator: ABSENT (only research feed-adapter mention KI-16; no submission adapter).
- **BRELA (business registry)**, **NEMC (environment)** — ABSENT.
- **Assay labs / refiners / offtakers / logistics / freight** — ABSENT (no connector). Marketplace is internal DB rows only (`marketplaceListings`), no external offtaker integration.

**Category verdict: PARTIAL→ABSENT — GePG (the TZ money-to-govt rail) is real but unwired; one wired e-gov actuator exists but it's the Kenya KRA one; every mining-specific TZ regulator actuator (TRA/Tume ya Madini/BRELA/NEMC) and the assay/refiner/offtaker/logistics actuators are ABSENT.**

---

## E. Action-execution / orchestration layer — the arm, not just the hands

### E1. Generic multi-step saga with compensation — **ABSENT at runtime (schema-only)**
- `packages/database/src/schemas/action-runtime.schema.ts` defines a **complete saga model**: `action_plans` (DRAFT→COMPLETED/COMPENSATED, budget micros, 72h expiry), `action_steps` (PENDING→SUCCEEDED/COMPENSATED, `attempts`, `compensationStepIndex`, kinds incl. `SEND_WHATSAPP/SEND_SMS/SEND_EMAIL/FILE_GEPG/CALL_EXTERNAL_API/EMIT_WEBHOOK/MUTATE_ENTITY/VERIFY/COMPENSATE`), `action_quotas`, `approval_matrix_dsl_compiled`. Migrations 0225–0228.
- **But there is NO runtime executor.** Grep for `actionSteps`/`action_steps`/`actionPlans` across `packages/central-intelligence` and `services/api-gateway` returns **zero non-schema, non-test references** — no code creates a plan, runs steps, retries, or runs compensation. The richest saga primitive in the repo (the one that would make `FILE_GEPG`-then-`SEND_WHATSAPP`-with-rollback real) is **dormant**. This is the single biggest INV-F hole: **no closed-loop multi-step driver exists.**

### E2. Chat action-executor — **PARTIAL (single-step DB mutations, no external actuators, no compensation)**
- `services/api-gateway/src/services/action-executor/registry.ts` dispatches verbs (`create_site`, `add_employee`, `create_licence`, `log_production`, `draft_payroll_run`, `draft_royalty_return`, update/delete/`manage_tab`). Every one is a **single DB insert/update**; **money-moving verbs are explicitly DEFERRED** (`file_royalty`/`set_payroll`/`post_ledger`, `:88`); **no external actuator (no send, no e-gov, no payment) is reachable from here**; no saga, no compensation. Confirm-gate via `requiresConfirmation` (HITL on durable mutations) is real (good rail), but it stops at "write a row."

### E3. Kernel agency action-tools — **PARTIAL (real, wired, but property-domain)**
- `packages/central-intelligence/src/kernel/agency/action-tools/real-adapters.ts` + bindings `composition/agency-port-bindings.ts`, wired in `composition/sovereign.ts:522` and `wake-loop-cron.ts:334`. Five tools DO real writes: `royalty.send-reminder`→`notification_dispatch_log` (real send via B1), `work-order.create`, `inspection.schedule`, `outstanding-royalties.escalate`, `listing.publish`. Honest `{ ok:false, 'service not yet wired' }` fallback (never fakes success — good).
- **The catch:** bound to **property tables** — `leases`, `units`, `arrears_cases`, `work_orders`, `marketplaceListings(listingKind='rent')`, `rent.reminder` template, vacancy detector. For a *mining* OS these are domain-mismatched; only `royalty.send-reminder` (renamed `rent`→`royalty`) maps cleanly. So the wired actuators **act on the wrong nouns.**

### E4. Risk-tier / autonomy HITL gate — **PARTIAL (present for chat/brain tools)**
- `services/api-gateway/src/services/orchestration/risk-tiers.ts` maps tool-prefix→`RiskTier`; `four_eye.*`/sovereign/kill_switch = high; `plan-dag.ts` `applyRiskTierPolicy`; chat confirm-gate. This is the rail INV-F wants — but it gates **brain tools + chat verbs**, not the (absent) generic saga, and the autonomy-cap kernel hook is unwired (cross-ref AUT-05/RSS-18 in MASTER_GAP_REGISTER).

### E5. Durable execution backbone — **PARTIAL (mock-default)**
- Temporal: `composition/temporal-dispatcher-wiring.ts` returns **`createMockTemporalClient` by default**; real client only when `TEMPORAL_ADDRESS` set AND `@temporalio/client` loads (`:120,142`). KRA-MRI/payout/licence-suspension dispatchers ride this → mock unless provisioned.
- Inngest: durable-runner exists but **no worker deployed**, opt-in (`DURABLE_EXEC_ENABLED`) — cross-ref RSS-23. So even the wired durable paths don't actually run durably in default prod.

**Category verdict: PARTIAL→ABSENT — single-step DB mutations and five property-bound agency tools work and are gated; the generic compensating multi-step saga (the thing that makes INV-F's "closed-loop, reversible" real) has a schema and NO runner; durable backbones default to mock.**

---

## F. Cross-cutting INV-F checks

| INV-F property | State | Evidence |
|---|---|---|
| **Idempotent external actions** | PRESENT (per-actuator) | disbursement `(tenant,idempotencyKey)` gate; notification `(tenant,idempotency_key)` + atomic claim; KRA/GePG `idempotencyKey`; Daraja originator-conversation-id derived from disbursement id |
| **Reversible / compensable** | PARTIAL | Real for payouts (`NEEDS_REVERSAL` + reconciliation); the **generic `COMPENSATE` step kind exists in schema but no executor runs it** (E1) |
| **Driven to confirmed completion (closed loop)** | PARTIAL | Closed loops exist for **disbursement** (reconciliation job) and **notification** (retry/DLQ + delivery status). KRA has poll-to-receipt. **No generic plan-level completion driver** (E1). E-sign poll-to-signed never invoked (C) |
| **DO not suggest (real side-effect, not artifact)** | PARTIAL | DOES: M-Pesa B2C, SMS/WhatsApp/email send, KRA submit. STOPS-at-artifact: e-sign (unwired), GePG control-number (unwired), every TZ-mining regulator (absent), and the chat executor (writes rows, defers money) |
| **HITL on the irreversible step (money/licence/deletion)** | PRESENT (rails), PARTIAL (coverage) | Confirm-gate + four-eye risk tiers; money verbs deferred to LedgerService four-eye; **but four-eye approval router is in-memory (RSS-21)** and autonomy-cap hook unwired (AUT-05) |
| **Receipt / dry-run capture** | PARTIAL | Receipts: Daraja `MpesaReceiptNumber`, KRA `receiptNumber`, GePG control number, e-sign `downloadSigned`. Dry-run / preview: disbursement `previewDisbursement` only; no generic plan dry-run |

---

## G. BossNyumba parity (reason from shared spine)

Same brain/wiring spine, only the domain layer differs — so the actuator posture is **near-identical, and BN is actually the *better-fit* domain for what is wired**:
- **Payments (M-Pesa/Stripe/ledger):** PARTIAL→PRESENT — shared `services/payments-ledger`; BN's KES M-Pesa + rent disbursements match the existing `KES` provider and `ownerDisbursement` template **better than Borjie** (Borjie pays the property-residue tax: KES-not-TZS, rent-not-royalty).
- **Notification rail:** PRESENT (identical substrate).
- **Action tools / agency-port-bindings:** PRESENT-for-BN — the wired tools (`leases`/`units`/`arrears`/`rent.reminder`/`listing.publish` rent) are **literally BN's domain**; in Borjie they are residue. So **BN parity on the hands is, if anything, ahead** on domain-fit.
- **E-gov:** KRA eRITS is a *Kenya rental* actuator → real value for **BN-KE**, mismatch for Borjie-mining-TZ. NIDA/e-Ardhi serve both. GePG serves both (unwired both).
- **Saga executor (E1):** ABSENT in both (shared spine) — `action_runtime` schema with no runner is a shared hole. `EA-10` (MASTER_GAP_REGISTER) already notes BN lacks the body-model layer; same applies to the action fabric.
- **E-sign:** adapters shared (document-ai/document-studio), unwired in both.

**BN verdict:** identical primitives; BN has *better domain-fit* on the wired actuators and the *same* missing generic saga + unwired e-sign/e-gov.

---

## H. Priority closure (to actually DO THE WORK end-to-end)

1. **Build the saga runner (E1)** — the `action_plans/action_steps` executor: run steps, persist tool-call refs, retry, and **execute `COMPENSATE` on failure**. This is the keystone; without it there is no closed-loop arm. (Pairs with `EXEC-saga` / RSS-01 in MASTER_GAP_REGISTER.)
2. **Wire the TZ money-out actuators for launch:** M-Pesa-TZ (TZS), Tigo Pesa, Airtel Money providers; **wire GePG** (`createGepgRealAdapter`) into composition + a `FILE_GEPG` step handler.
3. **Re-domain the wired action tools (E3)** from property nouns to mining nouns (sites/licences/royalty/shipments/assays) — or accept them as BN-only.
4. **Wire one e-signature adapter (C)** end-to-end (request→persist→poll-to-signed); retire the duplicate stack.
5. **Build the TZ-mining e-gov actuators (D2):** TRA filing, Tume ya Madini royalty/licence submission, BRELA — currently ABSENT.
6. **Make durable execution real (E5):** deploy Inngest worker / provision Temporal; **Drizzle four-eye approval router (RSS-21)**; wire autonomy-cap hook (AUT-05).
7. **Native WhatsApp Cloud send (B2)** — add outbound send to `connectors/whatsapp` (today BSP-via-Twilio only).

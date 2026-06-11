# Operational Closed-Loop Fabric — architecture, gap audit & build roadmap

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Status:** design dossier (no code, no commit)
**Inputs synthesized:** `fabric-sota.md` (2026 SOTA landscape), `fabric-code-audit.md` (repo organ map), `MASTER_GAP_REGISTER.md` (132-gap consolidated register — RSS / EA / AUT / MEM rows that touch the fabric).
**Audience:** Borjie (mining-estate OS, Mr. Mwikila brain) **and** sibling BossNyumba (real-estate OS). Same brain + same wiring spine; only the domain detector set differs. **This fabric is built once in the shared layers and serves both products.**

---

## 0. Thesis — what the fabric is, in one paragraph

A **consequential event** is any state that, left unattended, costs the estate money, a licence, a person's safety, or a relationship: a licence/KYC/cert/insurance expiry, a royalty/invoice falling due, an equipment service interval, a safety inspection deadline, an unfilled shift, an arrears slip. Today each of these is detected (or not) by a **bespoke cron** that writes into one of **two unconnected reminder rails** and stops at "sent." The fabric turns each event into a **complete, uniform, durable loop**:

```
DETECT (outbox-sourced) → REGISTER a loop for event-type E
  → SCHEDULE a durable reminder LADDER (data-defined offsets, LLM-authored within rails)
  → FIRE each rung once cluster-wide (leader-elected, idempotency-keyed, audit-chained)
  → ROUTE to the right recipient on their PREFERRED CHANNEL (WhatsApp/SMS/email/in-app/push)
      with FALLBACK + delivery + read receipt written back
  → ACT (a junior agent drafts + assigns the remediation, not just nags)
  → ESCALATE on inaction up the dynamic org/rota chain (policy is data, not code)
  → FOLLOW-THROUGH on a tracked task to CLOSURE (obligation-row clears → ladder cancels)
  → CONFIRM + AUDIT every step into the hash-chained append-only chain (at-least-once, nothing dropped)
  → LEARN — self-tune the ladder/channel/timing per recipient, as an APPEND to the rule envelope
```

The **central finding of `fabric-sota.md` is decisive for the build**: *no single 2026 vendor closes the whole loop.* Notification platforms (Novu/Knock/Courier) do routing+receipts but stop at "delivered." Durable-execution engines (Temporal/Inngest/DBOS/Restate) do survive-restart timers but have no notion of channel or recipient. Escalation engines (PagerDuty/incident.io/Rootly) do the policy ladder but are SRE-shaped. Dunning tools (Upflow/Stripe Smart Retries) close only the financial loop. **The fabric is the integration of those four primitives under ONE rails layer + ONE hash-chained audit chain — and that integration, expressed over our existing RLS-Postgres invariants, is the moat.**

The audit's verdict is equally decisive: **the organs are strong; the joints are missing.** We already have a durable outbox, a per-recipient dispatch log, atomic SKIP-LOCKED claims, exponential backoff + DLQ, real email/SMS/WhatsApp/push/Slack/calendar providers, cluster leader-election, ~20 leader-gated crons, a hash-chained audit chain, and a 4-eye + escalation table. What is missing is the **connective tissue**: a shared loop/ladder primitive, delivery-receipt write-back, channel *selection* (not just address resolution), an escalate-on-inaction control loop, and per-recipient self-tuning.

---

## 1. The fabric as a coherent, DYNAMIC architecture

### 1.1 Design tenets (non-negotiable shape)

1. **DYNAMIC, not fixed.** There is **no hardcoded list of event types**. Any event-type registers a loop through a **`loop_registry`** row (data) carrying its detector binding, default ladder, channel policy, escalation policy, and closure predicate. Adding "insurance-policy-expiry" or "tailings-dam-inspection-due" is a **registry insert + a thin detector producer**, never a new bespoke cron family. (The audit's #1 structural complaint — "Detection is a hand-coded cron per event class, not a uniform 'consequential event' registry" — is closed by this row.)
2. **Ladders/channels/escalation are DATA + LLM-authored, never hardcoded.** Today cert-expiry hard-codes `[30,14,3]` and licence hard-codes `[90,60,30,14,7,1]` in source (`ica-cert-expiry-cron.ts:32`, `licence-renewal-watcher.ts:10`). In the fabric, offsets/channels/escalation rungs are **rows**, and an LLM may *author* them from a natural-language goal ("ensure this licence renews before expiry; this owner is HITL on money; never before 6am") — but the LLM output is **constrained**: it can only compose pre-approved rungs (notify / wait / re-notify / reassign / escalate / draft-action) and can **never** author a rung that auto-executes a money/licence/deletion action.
3. **Proposal-gated where it grows the body.** Registering a *new event-type loop*, or letting an LLM *author a new ladder/escalation policy*, is a **body change** — it must flow through the body-change syscall / mutation-authority meta-rail (EA-04/AUT-01 in the register), surface as a proposal, and mutate only on approval. Per-recipient *tuning within an existing envelope* (Stage 9) is an APPEND and does not need a proposal; *adding a rung type or a new loop* does. This is the UI/Modality invariant (`MASTER_GAP_REGISTER §UI/Modality`) applied to the operational fabric.
4. **Rail-protected by construction.** Drafting is autonomous; **submitting** any money/licence/deletion action is HITL at the policy-gate. Money closure is observed **only** from the ledger (`LedgerService.post()` postings), never inferred from a message read. Predictions (predictive detection, learned channel/timing) **APPEND** to the rule-based ladder, never replace it. EN/SW is absolute — the message body is rendered single-language by the localization layer **before** it reaches the channel router, so the egress layer never mixes languages. Every step appends to the hash-chained, append-only audit chain.

### 1.2 The control plane (one engine, four collaborating planes)

```
                         ┌──────────────────────────────────────────────┐
   domain row change ───►│ DETECT plane                                 │
   (licence/invoice/…)   │  transactional outbox → loop-genesis consumer│
                         │  dedup on stable event identity              │
                         └───────────────┬──────────────────────────────┘
                                         │ registerLoop(event_key, recipient, policy refs)
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ LADDER ENGINE  (durable execution, Postgres-backed)                          │
   │  one durable workflow per loop_instance — the ladder IS the workflow         │
   │  sleep()/waitForEvent() survive restarts → FIRE-once is by construction      │
   │  each rung-fire = one idempotency-keyed, hash-chained audit row              │
   └───────┬───────────────────────────────────┬──────────────────────┬──────────┘
           │ emit RungFire(recipient,           │ on inaction           │ on closure-event
           │   channelPolicy, localizedBody)    │   advance escalation   │   cancel remaining
           ▼                                    ▼                        ▼
   ┌──────────────────────┐         ┌──────────────────────┐   ┌──────────────────────┐
   │ CHANNEL ROUTER plane │         │ ESCALATION plane     │   │ CLOSURE plane        │
   │  pick channel from   │         │  resolve next        │   │  watch source-of-    │
   │  preference+learned  │         │  recipient against   │   │  truth row via outbox│
   │  → provider port     │         │  live org/rota graph │   │  → terminate ladder  │
   │  → fallback ladder   │         │  → re-enter router   │   │  → close tracked task│
   │  ← delivery+read RX   │         │  HITL-gated for      │   │  → emit LoopClosed   │
   │    (write-back)      │         │  money/licence       │   │    (audit-chained)   │
   └──────────┬───────────┘         └──────────┬───────────┘   └──────────────────────┘
              │ delivery/read receipt                │ ack / no-ack
              ▼                                       ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ AUDIT + LEARN plane                                                          │
   │  every step → ai_audit_chain (hash-linked, gap-detectable)                  │
   │  receipt latency + response history → per-recipient ladder/channel tuner    │
   │  (offline-evaluated; APPEND to rule envelope; proposal-gated to widen body) │
   └─────────────────────────────────────────────────────────────────────────────┘
```

**Why the ladder engine collapses Stages 2+3+the FIRE-once guarantee** (key SOTA insight, adopted): a reminder ladder ("T-30, T-14, T-7, T-1, T+1, escalate at T+3") is a *months-long workflow*. A cron + DB-flag approach loses runs across pod restarts and is plagued by duplicate execution. A **durable-execution engine** encodes the whole ladder as one workflow whose `sleep()`s survive restarts — and because Temporal/DBOS/Restate make a scheduled step fire **exactly-once-in-effect** by construction, Stage 3 ("fire once cluster-wide") **disappears into Stage 2**: we stop hand-rolling Redis mutexes + Quartz leader election. For Borjie's Postgres/Supabase-centric stack the **DBOS-style "Postgres is the durable store"** model is the default (ladder state lives in the same RLS Postgres as the audit chain → the rung-fire + the audit-row write are one transaction → exactly-once effect, zero extra coordination service); **Temporal** is the fallback only where a ladder needs a multi-month horizon or massive fan-out. We already carry `inngest-client.ts` + an `inngest-executor` opt-in (`services/api-gateway/src/composition/durable/inngest-client.ts`); the recommendation is to make the loop engine durable-execution-backed rather than the current bespoke-cron-per-detector model.

---

## 2. The data substrate (RLS + FORCE + canonical GUC)

Every table below is **tenant-scoped via the canonical `app.tenant_id` GUC RLS policy with FORCE RLS enabled** (CLAUDE.md hard rule). Global ground-truth rows (cross-tenant learning, §5) use `tenant_id = NULL` with a **split `read` / `write` policy** (`USING` for read, `WITH CHECK tenant_id=GUC` for write) — DP-02 in the register flags the missing `WITH CHECK` as a BLOCKER; the fabric inherits that fix. New tables ship as forward-only numbered migrations (immutable once shipped).

### 2.1 What already exists (reuse, do not rebuild)

| Concern | Existing table | Evidence | Verdict |
|---|---|---|---|
| Durable scheduled reminder (one fire/row) | `reminders` | `owner-reminders.schema.ts:47` — `trigger_at`, `idempotency_key` UNIQUE/tenant, `attempt_count`, `status`, `dispatched_at`, `dispatch_error` | PRESENT — the durable single-fire primitive. Channels list = `email/sms/slack/calendar` only (missing `push`,`whatsapp`). |
| Transactional event bus | `event_outbox` (+ `event_dead_letter`, `event_subscriptions`) | `outbox.schema.ts:39` — status pending/processing/published/failed/dead_letter, priority, retry_count/max_retries/next_retry_at, lockedBy/lockExpiresAt, trace/correlation/causation | PRESENT — the right durable substrate; **not yet used by the reminder path** (serves domain events / payouts). |
| Per-recipient dispatch + delivery columns | `notification_dispatch_log` | `delivery_status` enum incl. `delivered`/`read`, `delivery_reported_at`, `provider_message_id`, `next_retry_at` | PRESENT schema — **delivery columns never written back** (see §4 Stage 5). |
| Per-recipient channel preference | `owner_contact_prefs` | `owner-contact-prefs.schema.ts:50` — `preferredChannel`, `phone`, `slackHandle`, `emailOverride`, `locale`, `timezone` | PRESENT — used for **address resolution**, NOT for channel **selection** (gap §4 Stage 4). |
| Escalation chain | `mining_escalations` | `mining-escalations.schema.ts:34` — directed worker→manager→owner chain, severity info/warning/critical, status open/acknowledged/resolved, `hash_chain_id` | PRESENT — **no organ advances it on reminder inaction**. |
| HIGH-stakes gate | `four_eye_requests` | `four-eye-requests.schema.ts` (payment/regulator/contract/asset/termination) | PRESENT — the HITL gate for money/licence/deletion ACT/ESCALATE. |
| Act queue | `executive_brief_actions` | drained by `executive-brief-action-runner.ts` → `executeJuniors` → `ai_audit_chain` | PRESENT — a real act-lane, **not triggered by the reminder fabric**. |
| Tracked follow-through unit | `mining_tasks` | `mining-tasks.schema.ts:40` — status lifecycle, kind, parent_rfb_id | PRESENT — the task unit; reminders don't open/close it. |
| Push registry | `device_push_tokens` | `device-push-tokens.schema.ts` | PRESENT. |
| Hash-chained audit | `ai_audit_chain` | `ai-audit-chain.schema.ts:20` — `sequence_id`, `prev_hash`, `this_hash`, UNIQUE (tenant, seq), append-only | PRESENT — the strongest stage; the dedup + proof substrate. |

### 2.2 What the fabric ADDS (the connective tissue — five tables)

> Principle: the fabric is **mostly composition over existing tables**. The new tables are the *registry* (dynamic event-types), the *loop state machine* (ties an event to its ladder/escalation/closure), and the two **policy** tables that make ladders/channels/escalation **data instead of code**. Delivery receipts reuse `notification_dispatch_log` columns; the ladder workflow state lives in the durable-execution engine's Postgres tables.

| New table | Columns (sketch) | Why | RLS |
|---|---|---|---|
| **`loop_registry`** | `id`, `event_type` (e.g. `licence.expiring`), `detector_binding` (outbox event-type or cron id), `default_ladder_policy_id`, `default_channel_policy_id`, `default_escalation_policy_id`, `closure_predicate` (outbox event-type that closes, e.g. `licence.renewed`), `hitl_class` (`none`/`money`/`licence`/`deletion`), `enabled`, `authored_by` (`seed`/`llm`/`human`), `proposal_id` | The **dynamic registry** — any event-type registers a loop here. Adding a type = insert + thin producer, not a new cron. | tenant-scoped; global seed rows `tenant_id=NULL` (read-all, service-role write). |
| **`reminder_ladder_policy`** | `id`, `name`, `offsets_days` (jsonb, e.g. `[30,14,7,1,-1,-3]`; negative = post-due), `rung_intent` per offset (`soft_notify`/`notify`/`draft_action`/`reassign`/`escalate`), `quiet_hours`, `locale_strategy` | Ladder cadence as **data**, LLM-authorable within the approved rung vocabulary. Replaces hardcoded `[30,14,3]`. | tenant-scoped. |
| **`channel_policy`** | `id`, `name`, `ordered_channels` (jsonb, e.g. `["whatsapp","sms","email","in_app","push"]`), `escalate_on` (`delivery_fail`/`not_seen`/`not_read`), `per_channel_wait`, `respect_preferred_channel` (bool) | Channel order + **cross-channel fallback** as data (Courier-style escalation + Knock-style not-seen gate). | tenant-scoped. |
| **`escalation_policy`** | `id`, `name`, `rungs` (jsonb: ordered `{role_or_user_resolver, channel_policy_id, wait_before_escalate, ack_required}`), `resolve_against` (`org_graph`/`rota`/`static`), `terminal_action` (`four_eye`/`notify_owner`/`open_case`) | Escalation ladder as **data**, resolved at fire-time against the **live org/rota graph** (reflects leave/promotion/reassignment automatically). | tenant-scoped. |
| **`loop_instance`** | `id`, `loop_registry_id`, `event_identity` (stable dedup key, e.g. `licence_id:expiry_date`), `recipient_id`, `ladder_policy_id`, `channel_policy_id`, `escalation_policy_id`, `state` (`open`/`acting`/`escalated`/`closed`/`cancelled`), `current_rung`, `tracked_task_id`, `durable_workflow_id`, `opened_at`, `closed_at`, `closure_reason`, `idempotency_key` UNIQUE/tenant | The **loop state machine** — one row per live obligation-loop. The durable workflow drives it; closure plane terminates it. | tenant-scoped; `event_identity` UNIQUE per tenant = the cross-cron dedup the audit asked for. |

Delivery receipts are **not** a new table: they are the existing `notification_dispatch_log.delivery_status` / `delivery_reported_at` columns, finally **written back** (§4 Stage 5). The ladder's per-rung *durable* state lives in the durable-execution engine's own Postgres tables (DBOS/Temporal/Inngest), keyed back to `loop_instance.durable_workflow_id`.

---

## 3. The channel router as injected ports

The strongest organ already exists: real, plural channel adapters. The router's job is to (a) **select** the channel from preference + learned order, (b) hand the **already-localized** body to the chosen provider port, (c) escalate down a **fallback ladder** on delivery failure or not-seen, and (d) ingest **delivery + read receipts** back into `notification_dispatch_log`.

```ts
// All injected ports — no provider SDK leaks into the fabric core.
interface ChannelPort {
  readonly channel: 'whatsapp' | 'sms' | 'email' | 'in_app' | 'push' | 'slack' | 'calendar';
  send(msg: LocalizedMessage, addr: Address): Promise<{ providerMessageId: string }>;
}
interface DeliveryReceiptIngress {        // provider webhooks → normalized status
  onStatus(u: { providerMessageId: string; status: 'delivered'|'read'|'failed'|'sent'; at: Date }): Promise<void>;
}
interface ChannelRouter {
  route(rung: RungFire): Promise<DispatchResult>;   // picks channel, sends, schedules fallback
}
```

| Channel | Existing port / evidence | Router gap to close |
|---|---|---|
| Email | `notification-dispatch/email-providers/{sendgrid,ses,resend,composite}.ts` | none (adapter strong) |
| SMS | `sms-providers/{africastalking,twilio,composite}.ts` | none |
| WhatsApp | via SMS port `channel='whatsapp'` (`dispatcher-worker.ts:413`) + Meta webhook (`notification-webhooks.router.ts`) | add `whatsapp` to `reminders.REMINDER_CHANNELS`; wire WhatsApp delivery+**read** (blue-tick) receipt write-back |
| Push | `push-providers/expo.ts` + `device_push_tokens` | add `push` to reminder channels |
| In-app | `buyer_notifications` + `POST /:id/read` (`routes/buyer/notifications.hono.ts:119`) — the one channel whose **read DOES close** | generalize the read-write-back pattern to the egress substrate |
| Slack | per-tenant webhook (`reminders-dispatch.worker.ts:506`) | none |
| Calendar | `calendar-providers/{google,microsoft}-provider.ts` | none |

**Three router gaps (all confirmed in audit Stage 4):**
1. **Channel selection ignores preference.** The reminders worker routes by the **row's** `channel` column (`reminders-dispatch.worker.ts:413,460,505`), resolving address from `owner_contact_prefs` — but does **not** consult `preferredChannel` to *pick* the channel (cert-expiry hard-codes `'email'`). Announcement fan-out **explicitly ignores** `preferredChannel` (`announcement-fanout.worker.ts:35-39,209`). → Router must select from `channel_policy.ordered_channels` filtered by `respect_preferred_channel`.
2. **No cross-channel fallback ladder.** Each channel fails/retries within itself; there is no push→SMS→WhatsApp→email→call escalation. Voice-call escalation exists only as a royalty-chaser tool (`escalate-to-call.ts`, 4-eye gated), not wired to dispatch failure. → Router schedules the next channel in `ordered_channels` on `delivery_fail` (immediate) or `not_seen`/`not_read` (after `per_channel_wait`).
3. **Read-receipt gate is impossible because receipts aren't persisted** (§4 Stage 5). The Knock "send email only if in-app not yet seen" pattern needs a `seen` truth; we never write it. → Close Stage 5 first; the router's not-seen escalation depends on it.

---

## 4. PRESENT / PARTIAL / ABSENT per stage — with file evidence + exact wiring

> Verdict shorthand carried from `fabric-code-audit.md`, re-expressed as **the exact joint to weld**.

### Stage 1 — DETECT — **PARTIAL**
- **Present:** real detectors, each its own cron — licence (`licence-renewal-watcher.ts:118`), cert (`ica-cert-expiry-cron.ts:32`), lease (`lease-expiry-alert-cron.ts`), compliance (`compliance-deadline-scan.worker.ts`), geofence (`geofence-watcher.ts`), cases-SLA (`cases-sla-supervisor.ts`), onboarding-gaps (`background-wiring.ts:554`), agency wake-triggers arrears/lease/vacancy (`agency-port-bindings.ts` via `wake-loop-cron.ts:347`).
- **Absent:** royalty/invoice-due, equipment-service-due, safety-inspection-due, shift-gap, KYC/insurance-expiry have **no generic detector**; no single registry enumerates "all event types that must spawn a loop."
- **Wiring:** source all detections from the **outbox** (`event_outbox`) so detection inherits the transactional guarantee; a **loop-genesis consumer** dedups on stable identity and `registerLoop()` against `loop_registry`. Existing crons become thin producers that emit `*.expiring`/`*.due`/`*.service_due` outbox events instead of writing bespoke sinks. **Beyond-today (APPEND):** a forecasting model predicts *which* obligations are at risk (this owner renews late) and pre-warms an earlier, softer rung — appended to, never replacing, the 30-day rule.

### Stage 2 — SCHEDULE the durable LADDER — **PARTIAL**
- **Present:** `reminders` (single `trigger_at`/row, idempotency_key UNIQUE) and `event_outbox` (full durable bus) are real Postgres-backed durable sinks; `notification_dispatch_log.next_retry_at` doubles as a retry queue.
- **Absent:** nothing schedules a **ladder** for one event — the ladder is synthesized by the detector cron inserting N `reminders` rows; `event_outbox` (the right substrate) is unused by the reminder path.
- **Wiring:** introduce the **durable ladder workflow** (DBOS-style over Postgres; Temporal fallback) — one workflow per `loop_instance`; its `sleep()`s ARE the ladder. Offsets come from `reminder_ladder_policy` (data), not source. Re-point cert/licence crons at the ladder engine.

### Stage 3 — FIRE once cluster-wide — **PARTIAL → collapses into Stage 2**
- **Present:** cluster leader-election (`cluster-lock.ts`, `withClusterLeader`), 20 leader-gated crons (`index.ts:682` `CLUSTER_LEADER_CRON_NAMES`), wake-loop `pg_try_advisory_lock`, idempotency keys everywhere, ON CONFLICT DO NOTHING (`announcement-fanout.worker.ts:324`). **Caveat:** `CRON_LEADER_ELECTION` defaults **OFF** → every replica runs → duplicate-fire risk until flipped (RSS-06 in register).
- **Wiring:** let the **durable-execution engine own "fire once"** (Temporal replays history / DBOS+Restate journal skip already-executed steps) → exactly-once *effect* by construction. Each rung-fire writes an **idempotency-keyed row to `ai_audit_chain` in the same transaction** as the fire → zero extra coordination. **Beyond-today:** **semantic idempotency key** = content hash of *what the recipient experiences* (this message, channel, recipient, obligation-state) → cross-loop dedup so three obligations converging on one owner one morning **collapse to one ping**.

### Stage 4 — ROUTE to preferred channel + fallback + receipts — **PARTIAL**
- **Present:** the plural channel adapters (§3) + `owner_contact_prefs.preferredChannel`.
- **Gaps:** channel **selection** ignores `preferredChannel` (uses row's fixed `channel`); announcement fan-out ignores it entirely; **no cross-channel fallback**; `reminders.REMINDER_CHANNELS` lacks `push`,`whatsapp`.
- **Wiring:** the **ChannelRouter port** selects from `channel_policy.ordered_channels`, honors `preferredChannel`, hands the **pre-localized** body to the provider port, and schedules fallback on `delivery_fail`/`not_seen`. **Beyond-today:** **learned channel order** — infer effective channel from read-receipt latency (this manager opens WhatsApp in 4 min, never email) and APPEND the inferred order to the declared preference (declared still wins if set).

### Stage 5 — CONFIRM-DELIVERY (delivery + read) — **PARTIAL → effectively ABSENT at closure** ← **the keystone joint**
- **Present:** schema supports it (`delivery_status` incl. `delivered`/`read`, `delivery_reported_at`, `provider_message_id`); webhook ingress is **real, signature-verified, idempotent** — `notification-webhooks.router.ts` normalizes Twilio/Meta/Africa's-Talking statuses (lines 311-354) and calls `deps.onDeliveryStatus(update)` at lines 488/528/561.
- **THE GAP (confirmed in this audit):** the composition-root impl at **`services/api-gateway/src/index.ts:2169-2185`** only **publishes** `eventType:'NotificationDeliveryStatus'` to the event bus — **no subscriber exists** (repo-wide search: the only references are the publisher + tests + the router interface). There is **no `SET delivery_status='delivered'/'read'`** anywhere. The dispatcher stamps `delivery_reported_at` *optimistically at send-time* (`dispatcher-worker.ts:261`) = "sent", not "delivered." Read receipts only close for the in-app `buyer_notifications` queue (`routes/buyer/notifications.hono.ts:119`), not the egress substrate. **The loop knows "sent," never "delivered/read."**
- **Wiring (single highest-leverage weld):** add a **`NotificationDeliveryStatus` subscriber** that `UPDATE notification_dispatch_log SET delivery_status=$status, delivery_reported_at=now() WHERE provider_message_id=$id` (idempotent — at-least-once webhooks), then **append the receipt to `ai_audit_chain`** and **signal the loop's durable workflow** (advances the channel-fallback/not-seen gate). This one subscriber unblocks Stages 4 (not-seen fallback), 7 (escalate-on-no-read), and 9 (learn from read latency).

### Stage 6 — ACT (draft + assign) — **PARTIAL**
- **Present:** `executive_brief_actions` queue → `executive-brief-action-runner.ts` → real `executeJuniors` → `ai_audit_chain`; dispatch-router accept-handlers draft `schedule_licence_renewal`/`open_equipment_maintenance`/`bulk_mark_licences_for_renewal` (`dispatch-router-wiring.ts:325-394`); money path → `LedgerService.post()` (`index.ts:1419`); royalty-chaser `send-reminder`+`escalate-to-call`.
- **Absent:** these act-lanes are **not triggered by the reminder fabric** — a fired cert/licence reminder notifies but does not auto-draft-and-assign.
- **Wiring:** a ladder rung whose `rung_intent='draft_action'` invokes the **relevant junior** (compliance for licence/KYC, cost-engineer for invoices, machinery-advisory for service, safety for inspections) to produce the drafted action + cited `evidence_id`, attach it to the notification, and enqueue it on `executive_brief_actions`. **Approval is the loop's closure trigger.** Rail: drafting autonomous; *submitting* money/licence/deletion is HITL at the policy-gate. **Beyond-today:** for non-HITL low-stakes classes (log the safety walk; reassign a shift gap to the next qualified worker on rota) the agent *executes + confirms* within scope/confidence/reversibility bounds — zero-touch closure.

### Stage 7 — ESCALATE on inaction (dynamic policy) — **PARTIAL**
- **Present:** `four_eye_requests`, `mining_escalations` chain (`:34`), voice-call escalation (4-eye gated), agency stall-detection (`wake-loop-cron.ts:382-492` emits `agency.goal-stalled`).
- **Absent:** **nothing reads "ladder exhausted, no recipient action → escalate up `mining_escalations`."** The stall detector watches *agency goals*, not *unanswered reminders*. No dynamic escalation policy bound to non-response.
- **Wiring:** the durable workflow, on a rung's `ack_required` timing out with no `read`/no obligation-state-change, **advances `escalation_policy.rungs`** — resolving the next recipient against the **live org/rota graph** (vision-org-graph-twin), re-entering the ChannelRouter for that recipient. HITL-gated terminal action for money/licence (jump straight to owner / four-eye). **Beyond-today:** the **LLM authors the escalation policy from the owner's NL intent** ("nag the manager twice, then it's my problem; royalty arrears jump straight to me; never before 6am"), compiled to a *constrained, validated* policy that can only escalate to *real* roles and attach *approved* actions.

### Stage 8 — FOLLOW-THROUGH to CLOSURE — **PARTIAL**
- **Present:** `mining_tasks` status lifecycle (`:40`); `licence_events` open/in_progress/closed (`licence-renewal-watcher.ts:191`); agency goals + stall model; dedup-on-open prevents re-nag (licence `:186` NOT EXISTS, cert ON CONFLICT, onboarding one-per-gap); reminder terminal states + DLQ.
- **Absent:** the fabric doesn't **open a tracked task on fire** nor **flip it on response**; closure is **per-row, not per-loop** — a ladder closes only when the underlying entity stops matching the detector query (implicit), not on an explicit "loop X closed because recipient did Y."
- **Wiring:** on first fire, `loop_instance.tracked_task_id` = a `mining_tasks` row. **Closure plane** watches the source-of-truth row via the **outbox** (`licence.renewed`/`invoice.paid`/`service.logged`/`shift.filled`/`inspection.passed`); on match it terminates the durable workflow (`waitForEvent`/Temporal signal), flips the task, sets `loop_instance.state='closed'`, and emits `LoopClosed` (audit-chained). **Money closure is observed from the ledger, never from a read.**

### Stage 9 — CONFIRM + AUDIT — **PRESENT** (strongest)
- **Present:** hash-chained `ai_audit_chain` (`:20`, UNIQUE (tenant,seq), append-only); at-least-once + idempotency everywhere (UNIQUE idempotency_key, ON CONFLICT, SKIP-LOCKED claims `reminders-dispatch.worker.ts:256`/`dispatcher-worker.ts:219`); DLQ (`event_dead_letter` + `dead_lettered_at` + webhook DLQ repo); cluster-once leader-election.
- **Minor gap:** the delivery-status receipt isn't in the chain because it's never persisted (fixed by Stage 5 weld).
- **Beyond-today:** the **audit chain is the dedup substrate** (every fire keyed+chained → no separate Redis), and being hash-chained it yields **tamper-evident SLA proof** ("we attempted to notify this owner on these 4 channels at these times — here is the cryptographic chain") = a **regulator-grade compliance artifact** in a regulated mining/RE context, not just an ops log.

### Stage 10 — LEARN (self-tune the ladder per recipient) — **ABSENT**
- **Present:** decision-level learning only — `decision-retrospective-worker.ts` grades decisions, `outcome_reconciliations` matches predictions to reality, memory-decay + belief-learning sweeps.
- **Absent entirely:** repo-wide search for `selfTune|tuneLadder|adaptCadence|learnLadder` = nothing. No organ adjusts a recipient's offsets/channel/quiet-hours from response history. Ladders are static config identical for every recipient.
- **Wiring:** §5.

---

## 5. The SELF-TUNING + agentic-follow-through frontier

**Self-tuning (Stage 10 closure).** Layer **Send-Time Optimization + offline RL** onto the ladder so it learns **per recipient**: (a) the *rung* at which they reliably act (if this manager always acts on rung 2, drop the wasted rung 1), (b) the *channel* they actually read (Stage 4 leap), (c) the *time of day* they engage. The right framing (from `fabric-sota.md`) is **not** "predict response to this notification" but "a recipient's experience depends on a *sequence* of notifications" — train a **Double-DQN offline**, evaluate with **state-marginalized importance sampling** *before* any live change so a mis-tune never spams a real owner, then launch. **Honour rail:** the learned policy **APPENDS** to the rule-based ladder — the rule guarantees the obligation is always covered; the learned layer only re-weights timing/channel/intensity *within the rule's envelope*. Widening the envelope (new rung type, new loop) is **proposal-gated**; re-weighting within it is a free append.

**Agentic follow-through (Stage 6 frontier).** The 2026 shift is from *alerting* to *acting* (incident.io / Rootly AI-SRE: investigate → draft the fix → open the PR, "never auto-remediate without sign-off"). Translated: the fabric never sends "your licence expires in 7 days" — it sends **"expires in 7 days — I've drafted the renewal (pre-filled), pre-booked the inspection slot, assigned doc-gathering to your site manager. Approve to submit."** Each rung *carries a drafted action*, evidence-cited. For non-HITL low-stakes obligations the agent **executes + confirms** within scope/confidence/reversibility bounds (zero human touch); money/licence/deletion stay HITL.

**The combined frontier** (the unit no 2026 vendor ships): the **LLM authors** the initial ladder + escalation policy from the owner's NL goal (Stages 2/6), **offline-RL re-shapes** it per recipient (Stage 10), the **hash chain proves** every change and every attempt (Stage 9), and the **honour rails** (money/licence/deletion HITL, predictions-append, EN/SW, ledger-observed closure) bound the whole thing **by construction**. Cross-tenant network effect (the "Stripe Smart Retries for business obligations" analogue): across all tenants with `tenant_id=NULL` ground-truth + privacy preservation, learn that *artisanal miners in this district renew within 48h of the 2nd WhatsApp but ignore email* and self-tune the federated channel/timing prior — while every individual nudge stays tenant-scoped under RLS.

---

## 6. Same fabric for Borjie + BossNyumba

BN shares the **identical** brain + wiring spine — the same `notification-dispatch` substrate, `event_outbox`, `notification_dispatch_log`, `reminders`, `owner_contact_prefs`, `device_push_tokens`, cluster-lock, wake-loop, `ai_audit_chain`, and channel providers all live in the **shared layers**. Therefore:

- **Same organs PRESENT** (channel adapters, durable outbox, dispatch log, leader-election, hash-chain) — domain-agnostic, shared.
- **Same joint gaps carry over verbatim** (delivery write-back open, no shared ladder primitive, no escalate-on-inaction loop, no per-recipient learn). The cluster-lock comment already references property horizons ("arrears chase 14d, maintenance 7d, lease renewal 30d", `wake-loop-cron.ts:35-41`).
- **Only the detector set + `loop_registry` seed rows differ:** Borjie seeds `licence.expiring`/`cert.expiring`/`royalty.due`/`equipment.service_due`/`safety.inspection_due`/`shift.gap`/`kyc.expiring`; BN seeds `rent.due`/`lease.renewal`/`inspection.due`/`arrears.slip`/`compliance.cert_due`. **Building the five new tables + the five welds in the shared spine fixes BOTH products at once.** The only BN-specific work is the registry seed + the thin domain detectors (and EA-10 in the register notes BN currently lacks the body-model layer the proposal-gate depends on — port it).

---

## 7. Dependency-ordered FULL-CODE roadmap (flag-default-safe)

Every wave ships behind a flag defaulting **safe (off / no-behavior-change)**; promotion is a staging canary then flip. Sequencing follows the audit's dependency spine: **close the delivery loop first (it unblocks 3 stages), then extract the shared ladder primitive, then the policies, then escalate, then learn.** Cross-references to `MASTER_GAP_REGISTER` IDs in brackets.

### Wave 0 — Close the delivery-receipt loop (the keystone weld) — flag `FABRIC_DELIVERY_WRITEBACK`
*Single highest-leverage change; unblocks Stages 4/7/9-receipt/10.*
- **W0.1** Add a `NotificationDeliveryStatus` subscriber that idempotently `UPDATE notification_dispatch_log SET delivery_status, delivery_reported_at WHERE provider_message_id` (replaces the publish-and-forget at `index.ts:2169-2185`).
- **W0.2** Append every receipt to `ai_audit_chain` (folds the receipt into the hash chain → Stage 9 minor gap closed).
- **W0.3** Add `push` + `whatsapp` to `reminders.REMINDER_CHANNELS` (`owner-reminders.schema.ts:36`); wire WhatsApp blue-tick **read** receipt.
- *Dependency:* none. *Risk:* low (additive write-back).

### Wave 1 — The dynamic substrate (registry + loop state machine) — flag `FABRIC_LOOP_ENGINE` (off)
- **W1.1** Forward migrations for `loop_registry`, `reminder_ladder_policy`, `channel_policy`, `escalation_policy`, `loop_instance` (RLS + FORCE + canonical GUC; split read/write policy on any `tenant_id=NULL` rows — pairs with **DP-02**).
- **W1.2** `loop-genesis` consumer over `event_outbox`: dedup on `event_identity`, `registerLoop()` → `loop_instance`. [**Stage 1** wiring]
- **W1.3** Seed `loop_registry` with the existing two working loops (cert-expiry, owner-reminders) as data — **prove the registry reproduces current behavior** before adding new event-types.
- *Dependency:* Wave 0 (delivery truth). Durable outbox already present (`event_outbox`); pairs with **RSS-02** (outbox drainer leader-lock) so genesis fires once.

### Wave 2 — Durable ladder engine (collapses Stages 2+3) — flag `FABRIC_DURABLE_LADDER` (off)
- **W2.1** Bind the **durable-execution engine** (DBOS-style over Postgres default; reuse existing `inngest-client.ts`/`inngest-executor` opt-in or Temporal fallback) as the ladder runner; one workflow per `loop_instance`; offsets from `reminder_ladder_policy`. [**Stages 2+3**]
- **W2.2** Each rung-fire writes an idempotency-keyed `ai_audit_chain` row **in the same transaction** as the fire (exactly-once effect). Implement **semantic idempotency key** (content hash) for cross-loop dedup.
- **W2.3** Re-point cert-expiry + licence-watcher crons to emit outbox events → ladder engine (delete the hardcoded `[30,14,3]` / `[90..1]` offset arrays; they become `reminder_ladder_policy` rows). [closes audit Stage 3 "licence ladder is cockpit-only"]
- *Dependency:* Wave 1. Requires `CRON_LEADER_ELECTION` flipped on (**RSS-06**) OR the durable engine's own fire-once.

### Wave 3 — Channel router + fallback — flag `FABRIC_CHANNEL_ROUTER` (off)
- **W3.1** `ChannelRouter` port: **select** channel from `channel_policy.ordered_channels` honoring `owner_contact_prefs.preferredChannel` (fix `reminders-dispatch.worker.ts` channel-selection + `announcement-fanout.worker.ts:35-39` preference-ignore). [**Stage 4**]
- **W3.2** Cross-channel **fallback ladder** (push→SMS→WhatsApp→email→call) keyed on `delivery_fail` (immediate) / `not_seen` (after wait) using Wave 0's receipt truth; wire `escalate-to-call.ts` as the terminal voice rung (4-eye gated).
- **W3.3** Localization boundary: body rendered single-language by the localization layer **before** the router (EN/SW absolute — no mixing at egress).
- *Dependency:* Wave 0 (receipts) + Wave 2 (rung fires).

### Wave 4 — ACT + ESCALATE control loops — flag `FABRIC_ACT_ESCALATE` (off)
- **W4.1** `rung_intent='draft_action'` invokes the relevant junior (compliance/cost/machinery/safety) → drafted action + `evidence_id` → enqueue on `executive_brief_actions`; approval = closure trigger. Money/licence/deletion HITL at policy-gate. [**Stage 6**]
- **W4.2** Escalate-on-inaction: durable workflow advances `escalation_policy.rungs` resolved against live org/rota graph → re-enters ChannelRouter; terminal four-eye for money/licence. [**Stage 7**; advances `mining_escalations`]
- **W4.3** Follow-through: open `mining_tasks` on first fire (`loop_instance.tracked_task_id`); closure plane watches outbox `*.renewed/.paid/.logged/.filled/.passed` → terminate ladder, flip task, emit `LoopClosed`. Money closure observed from ledger. [**Stage 8**]
- *Dependency:* Waves 2+3. Reuses `executive_brief_actions`, `four_eye_requests`, `mining_escalations`, `mining_tasks`.

### Wave 5 — Proposal-gated dynamic authoring — flag `FABRIC_LLM_AUTHORING` (off)
- **W5.1** Constrained LLM authoring of `reminder_ladder_policy` / `escalation_policy` from NL goal — output validated against the approved rung vocabulary; **cannot** author an auto-execute money/licence/deletion rung.
- **W5.2** Route *new-event-type registration* + *new authored policy* through the **body-change syscall / mutation-authority meta-rail** [**EA-04 / AUT-01**] → surfaces as proposal (ambient notice + Open/Undo), mutates only on approval. Per-recipient tuning within an existing envelope stays a free append.
- *Dependency:* Wave 4 + the body-change syscall composition root (EA-04 must land first).

### Wave 6 — Self-tuning + cross-tenant network effect — flag `FABRIC_SELF_TUNE` (off)
- **W6.1** Per-recipient tuner: STO + offline-RL (Double-DQN, importance-sampling offline eval) over receipt-latency + response history → re-weight offsets/channel/time as an **APPEND** to the rule envelope. [**Stage 10**]
- **W6.2** Learned channel order appended to declared `preferredChannel` (declared wins if set).
- **W6.3** Cross-tenant federated prior over `tenant_id=NULL` ground-truth (privacy-preserved; every individual nudge stays RLS-scoped). The "Smart Retries for business obligations" analogue.
- *Dependency:* Waves 0+4 (receipt + response history). Offline eval gates every live change → no mis-tune ever spams a real owner.

### Wave 7 — BossNyumba parity — flag `FABRIC_BN_LOOPS` (off)
- **W7.1** Seed BN `loop_registry` rows (`rent.due`/`lease.renewal`/`inspection.due`/`arrears.slip`/`compliance.cert_due`) + thin BN domain detectors.
- **W7.2** Port the body-model layer BN lacks (**EA-10**) so the proposal-gate (Wave 5) works for BN.
- *Dependency:* Waves 0–6 in the shared spine (already cover BN's organs).

**Critical-path one-liner:** *Wave 0 (delivery write-back) is the keystone — it is a handful of lines and unblocks three downstream stages; do it first, then the registry+loop tables (Wave 1), then the durable ladder (Wave 2) which collapses fire-once, then router/act/escalate (Waves 3-4), then the dynamic+self-tuning frontier (Waves 5-6) behind the body-change meta-rail, then BN parity (Wave 7) for free in the shared spine.*

---

## 8. Honour-rail conformance checklist (the fabric must prove all)

- **Money/licence/deletion HITL** — every `draft_action`/escalation terminal for these classes hits `four_eye_requests` / policy-gate; the LLM cannot author an auto-execute rung for them.
- **Predictions APPEND** — predictive detection (Stage 1) and learned channel/timing (Stage 10) only add/re-weight within the rule envelope; the rule always fires.
- **EN/SW absolute** — body localized single-language before the router; channel layer never mixes.
- **Multi-currency** — any money figure in a notification body uses `formatCurrency(amount, currencyCode)`.
- **Hash-chained append-only audit** — every step (detect/schedule/fire/route/deliver/read/act/escalate/close/tune) appends; nothing mutates; gaps are hash-detectable.
- **At-least-once + idempotent** — every consumer (loop-genesis, delivery subscriber, rung-fire) idempotent; semantic key for cross-loop dedup.
- **Ledger-observed closure** — money loops close from `LedgerService.post()` postings, never from a message read.
- **Proposal-gated body growth** — new event-type / new authored policy flows through the body-change meta-rail; reversible.

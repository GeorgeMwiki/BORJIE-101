# Operational Closed-Loop Fabric — Code Audit (Borjie)

**Lane:** fabric-code-audit (REPO READ-ONLY)
**Date:** 2026-06-08
**Branch:** integration/parity-final
**Scope:** Map our EXISTING organs against each stage of the closed-loop
notification fabric: detect → schedule → ladder → channel-route →
confirm-delivery → act → escalate → follow-through → closure → audit →
learn. State PRESENT | PARTIAL | ABSENT with file:line evidence and what
is missing. BossNyumba parity reasoned from the shared spine.

---

## Executive verdict

Borjie has a **real, mostly-built channel egress substrate** — durable
outbox, per-recipient dispatch log, atomic SKIP-LOCKED claim, exponential
backoff + DLQ, real email/SMS/WhatsApp/push/Slack/calendar providers,
cluster leader-election, ~20 leader-gated crons, hash-chained audit, and a
4-eye escalation table. The loop is **wired end-to-end for two narrow
domains (workforce cert-expiry, owner-authored reminders)** and detection
exists for licences/leases/compliance.

The fabric is **NOT yet a single uniform loop**. The gaps are at the
**joints**, not the organs:

1. **Confirm-delivery closure is OPEN.** Provider delivery/read webhooks
   are received and normalized, but the receipt is published to the event
   bus and **never written back** to `notification_dispatch_log`
   (`delivery_reported_at` / `delivered` / `read` columns exist but no
   subscriber sets them). The loop knows "sent", not "delivered/read".
2. **No durable reminder LADDER primitive.** Cert-expiry hard-codes
   `[30,14,3]`, licence-watcher hard-codes `[90,60,30,14,7,1]`, each as a
   bespoke cron writing into a *different* sink (`reminders` vs
   `licence_events`). There is no shared "schedule a ladder for event E,
   recipient R" abstraction. Royalty/invoice/equipment-service/safety/
   shift-gap/arrears events have **no ladder at all**.
3. **Two parallel reminder rails that don't share a recipient model.**
   `reminders` (owner-authored + cert-expiry) and
   `notification_dispatch_log` (announcement fan-out + delivery substrate)
   are separate tables with separate workers and separate idempotency.
4. **ESCALATE-on-inaction is policy-less.** 4-eye + mining-escalations
   tables exist, but no organ watches "reminder fired N times, no
   response → escalate up the chain". The agency wake-loop has stall
   detection but it scans *goals*, not unanswered reminders.
5. **LEARN/self-tune the ladder per recipient is ABSENT.** No code adapts
   cadence/channel per recipient response history.

So: organs strong, **spine present but the event→ladder→escalate→learn
control plane is the missing connective tissue.**

---

## Stage-by-stage map

### 1. DETECT — PARTIAL

Real detectors exist for several event classes, each its own cron:

- **Licence expiry** — `services/api-gateway/src/workers/licence-renewal-watcher.ts:118`
  (`fetchExpiringLicences`, 90-day horizon, 6h tick).
- **Workforce cert expiry** — `services/api-gateway/src/workers/ica-cert-expiry-cron.ts:32`
  (`REMINDER_OFFSETS_DAYS=[30,14,3]`, scans `workforce_certifications`).
- **Lease expiry** — `services/api-gateway/src/workers/lease-expiry-alert-cron.ts`
  (property-relic; mining sink mostly empty).
- **Compliance deadlines** — `services/api-gateway/src/workers/compliance-deadline-scan.worker.ts`.
- **Geofence** — `services/api-gateway/src/workers/geofence-watcher.ts`.
- **Cases SLA** — `services/api-gateway/src/workers/cases-sla-supervisor.ts`.
- **Onboarding gaps** (no sites/workers/licences) —
  `services/api-gateway/src/composition/background-wiring.ts:554`
  (`detect_onboarding_gaps`, hourly per tenant).
- **Agency wake-triggers** — arrears / leases / vacancy real detectors
  bound in `agency-port-bindings.ts`, run by `wake-loop-cron.ts:347`.

**Missing:** royalty/invoice-due, equipment-service-due, safety-inspection-due,
shift-gap, KYC-expiry are **not** covered by a generic detector. Detection
is a hand-coded cron per event class, not a uniform "consequential event"
registry. No single place enumerates "all event types that must spawn a
loop".

### 2. SCHEDULE (durable reminder) — PARTIAL

Two durable scheduling sinks exist, both real, both Postgres-backed:

- **`reminders`** table — `packages/database/src/schemas/owner-reminders.schema.ts:47`.
  Single `trigger_at` per row, `idempotency_key` UNIQUE per tenant,
  `attempt_count`, `status` (scheduled→sent|failed|cancelled). This is the
  durable scheduled-reminder primitive.
- **`event_outbox`** — `packages/database/src/schemas/outbox.schema.ts:39`.
  Full transactional outbox: status (pending/processing/published/failed/
  dead_letter), priority, retry_count/max_retries/next_retry_at,
  lockedBy/lockExpiresAt, trace/correlation/causation. **General-purpose
  durable event bus** (+ `event_dead_letter`, `event_subscriptions`).
- **`notification_dispatch_log`** — `packages/database/drizzle/_legacy_0002_notification_dispatch_log.sql`
  carries `next_retry_at`, so it doubles as a scheduled retry queue.

**Missing:** Nothing schedules a *ladder* of reminders for a single event
(see stage 3). `reminders` schedules ONE fire per row; the ladder is
synthesized by the detector cron inserting N rows. `event_outbox` is the
right durable substrate for a generic ladder but is **not** used by the
reminder path — it serves the domain event/payouts pipeline.

### 3. LADDER (escalating reminder cadence) — PARTIAL

Ladders exist but are **bespoke and hard-coded per detector**, not a
reusable primitive:

- Cert-expiry: `REMINDER_OFFSETS_DAYS = [30, 14, 3]` →
  `ica-cert-expiry-cron.ts:32`; each rung inserts one `reminders` row,
  deduped on `workforce_cert_expiry_reminders (tenant, cert, days_before)`
  then a `reminders` row keyed `cert-expiry:<tenant>:<cert>:<days>`
  (`ica-cert-expiry-cron.ts:203,225`). **This is a real, working ladder
  into the dispatch path.**
- Licence: `RENEWAL_REMINDER_OFFSETS_DAYS = [90,60,30,14,7,1]` →
  `licence-renewal-watcher.ts:10,108`. BUT this ladder writes to
  `licence_events (kind='renewal_due')` + a cockpit SSE pulse
  (`openReminderEvent`, line 155) — it does **NOT** insert a `reminders`
  row, so it never reaches the email/SMS dispatcher. It surfaces in the
  cockpit only.

**Missing:** (a) a shared `scheduleLadder(eventKey, recipient, offsets[],
channelPolicy)` abstraction; (b) the licence ladder's channel egress (it's
cockpit-only); (c) ladders for all other event classes; (d) per-recipient
cadence (every recipient gets the same fixed offsets).

### 4. CHANNEL-ROUTE (per-recipient preferred channel + fallback) — PARTIAL

Channel adapters are **real and plural** — this is the strongest organ:

- Email: `services/api-gateway/src/services/notification-dispatch/email-providers/`
  (sendgrid.ts, ses.ts, resend.ts, composite.ts).
- SMS: `sms-providers/africastalking.ts`, `twilio.ts`, `composite.ts`.
- WhatsApp: handled via the SMS provider port channel='whatsapp'
  (`dispatcher-worker.ts:413`) + Meta webhook
  (`notification-webhooks.router.ts` Meta handler).
- Push: `push-providers/expo.ts` + `device_push_tokens` registry
  (`packages/database/src/schemas/device-push-tokens.schema.ts`).
- Slack: per-tenant webhook (`reminders-dispatch.worker.ts:506`).
- Calendar: `calendar-providers/google-provider.ts`, `microsoft-provider.ts`.

Per-recipient preference store exists:
`packages/database/src/schemas/owner-contact-prefs.schema.ts:50`
(`preferredChannel`, `phone`, `slackHandle`, `emailOverride`, `locale`,
`timezone`).

**Routing gaps:**
- The `reminders` worker routes by the **row's** `channel` column
  (`reminders-dispatch.worker.ts:413,460,505`), resolving address from
  prefs — but it does **not consult `preferredChannel` to PICK the
  channel**; the channel is fixed at row creation (cert-expiry hard-codes
  `'email'`, `ica-cert-expiry-cron.ts`). So preference is honored for
  *address* but not for *channel selection*.
- The announcement fan-out **explicitly ignores `preferredChannel`** for
  `both` (`announcement-fanout.worker.ts:35-39,209` `channelsForRecipient`).
- **No automatic fallback ladder** (e.g. push → SMS → WhatsApp → call on
  non-delivery). Each channel fails/retries within itself; there is no
  cross-channel escalation. Voice-call escalation exists only as a
  royalty-chaser sub-MD tool (`escalate-to-call.ts`), 4-eye gated, not
  wired to the dispatch failure path.
- `reminders.REMINDER_CHANNELS` lacks `push` and `whatsapp`
  (`owner-reminders.schema.ts:36` = email/sms/slack/calendar only).

### 5. CONFIRM-DELIVERY (delivery + read receipt) — PARTIAL → effectively ABSENT at closure

Infrastructure is present but the **loop is open**:

- Schema supports it: `notification_dispatch_log` has `delivery_status`
  enum incl. `delivered`/`read`, `delivery_reported_at`,
  `provider_message_id` (`_legacy_0002_notification_dispatch_log.sql`).
- Webhook ingress is real + signature-verified + idempotent:
  `services/api-gateway/src/routes/notification-webhooks.router.ts`
  normalizes Twilio/Meta/Africa's-Talking statuses to delivered/read/sent/
  failed (lines 311-354) and correlates by `providerMessageId`.

**THE GAP:** the webhook handler calls `deps.onDeliveryStatus(update)`
(`notification-webhooks.router.ts:488,528,561`), and the composition-root
implementation **only publishes an event to the bus** — it does **NOT**
UPDATE `notification_dispatch_log`:
`services/api-gateway/src/index.ts:2164-2180`
(`onDeliveryStatus: async (update) => { await serviceRegistry.eventBus.publish({ eventType: 'NotificationDeliveryStatus', ... }) }`).
A repo-wide search finds **no subscriber** for `NotificationDeliveryStatus`
and **no `SET delivery_status='delivered'/'read'`** anywhere. So
`delivery_reported_at` is never stamped from provider callbacks; the row
stays at `'sent'` forever. The dispatcher itself stamps
`delivery_reported_at` at send-time optimistically (`dispatcher-worker.ts:261`),
which is "sent", not "delivered". **Read receipts for `buyer_notifications`
DO close** via `POST /:id/read` (`routes/buyer/notifications.hono.ts:119`) —
but that's an in-app at-rest queue, not the egress substrate.

### 6. ACT (draft + assign, not just nag) — PARTIAL

A real "act" lane exists, scoped to executive-brief actions:

- **`executive_brief_actions` queue** drained by
  `services/api-gateway/src/workers/executive-brief-action-runner.ts`,
  dispatching approved rows to `executeJuniors` (real Anthropic), persisting
  result_jsonb, appending to `ai_audit_chain`.
- **Dispatch-router accept-handlers** turn brain intents into drafted
  domain actions: `schedule_licence_renewal`, `open_equipment_maintenance`,
  `bulk_mark_licences_for_renewal` (mining handler set) insert into
  `tasks`/`temporal_entities`/`maintenance_events`
  (`dispatch-router-wiring.ts:325-394`). Money path → LedgerService.post()
  when DB-backed (`index.ts:1419`).
- Royalty-chaser sub-MD has `send-reminder` + `escalate-to-call` tools.

**Missing:** these act-lanes are **not triggered by the reminder fabric**.
A fired cert/licence reminder does not auto-draft-and-assign a remediation
task; it only notifies. The brain CAN draft (dispatch-router), but the loop
detect→draft is only joined for chat-initiated intents and the
executive-brief queue, not for the cron-detected events.

### 7. ESCALATE (on inaction, dynamic policy) — PARTIAL

Building blocks present, control loop absent:

- **4-eye approval** — `packages/database/src/schemas/four-eye-requests.schema.ts`
  (HIGH-stakes gate: payment/regulator/contract/asset/termination).
- **Mining escalation chain** — `packages/database/src/schemas/mining-escalations.schema.ts:34`
  (worker→manager→owner directed chain, severity info/warning/critical).
- **Voice-call escalation** — `escalate-to-call.ts` (4-eye gated).
- **Stall detection** — `wake-loop-cron.ts:382-492` emits
  `agency.goal-stalled` when a goal's last activity exceeds a category
  threshold, optionally `markStalled`.

**Missing:** nothing reads "reminder fired, ladder exhausted, no recipient
action → escalate to the next person on `mining_escalations` chain". The
stall detector watches *agency goals*, not *unanswered reminders/tasks*.
There is no dynamic escalation policy bound to reminder non-response.

### 8. FOLLOW-THROUGH (track to action) — PARTIAL

- **`mining_tasks`** — `packages/database/src/schemas/mining-tasks.schema.ts:40`
  (status pending→…, kind, parent_rfb_id). Tasks are the follow-through
  unit and have status lifecycle.
- **`licence_events`** (status open/in_progress/closed) tracks renewal
  follow-through (`licence-renewal-watcher.ts:191`).
- **Agency goals + stall detection** provide a generic
  goal-with-steps-and-staleness model (`createKernelGoalsService`,
  wake-loop stall sweep).
- `mission_steps`/`agency_missions` tables: **NOT found** in the schema —
  the follow-through model is `mining_tasks` + agency goals, not a missions
  table.

**Missing:** the reminder fabric does not open a tracked task on fire, nor
flip it on response, so there is no closed "reminder→task→done" thread for
most event classes (only RFB-fulfil and chat-drafted actions get a task).

### 9. CLOSURE (loop terminates cleanly) — PARTIAL

- Dedup-on-open prevents re-nagging: licence
  (`licence-renewal-watcher.ts:186` NOT EXISTS open/in_progress), cert
  (`ica-cert-expiry-cron.ts` ON CONFLICT), onboarding nudges (one per gap).
- `reminders` terminal states + `dispatched_at IS NULL` guard
  (`reminders-dispatch.worker.ts:284`).
- DLQ terminal: `notification_dispatch_log.dead_lettered_at`
  (`dispatcher-worker.ts:290-305`).

**Missing:** closure is per-row, not per-loop. Because confirm-delivery
(stage 5) and escalate (stage 7) are open, a ladder cannot "close on
recipient action" — it closes when the underlying entity (licence/cert)
stops matching the detector query, which is implicit, not an explicit
closure event. No "loop X closed because recipient did Y" record.

### 10. AUDIT (hash-chained, at-least-once, nothing dropped) — PRESENT

Strong:

- **Hash-chained AI audit** — `packages/database/src/schemas/ai-audit-chain.schema.ts:20`
  (`sequence_id`, `prev_hash`, `this_hash`, unique (tenant, seq) — append-only
  per CLAUDE.md). The executive-brief action runner appends every dispatch;
  decision-retrospective records hash-chained outcomes.
- **At-least-once + idempotency** everywhere: `reminders` UNIQUE
  (tenant, idempotency_key); `notification_dispatch_log` UNIQUE
  (tenant, idempotency_key) + ON CONFLICT DO NOTHING
  (`announcement-fanout.worker.ts:324`); webhook idempotency middleware;
  atomic SKIP-LOCKED claims (`reminders-dispatch.worker.ts:256`,
  `dispatcher-worker.ts:219`).
- **DLQ** — `event_dead_letter` + `notification_dispatch_log.dead_lettered_at`
  + webhook DLQ repo (`background-wiring.ts:896`).
- **Cluster-once** — `cluster-lock.ts` leader-election + ~20 leader-gated
  crons (`index.ts:680` CLUSTER_LEADER_CRON_NAMES) + wake-loop's own
  `pg_try_advisory_lock` (`wake-loop-cron.ts:104,203`).

This is the most complete stage. Minor gap: the delivery-status receipt
(stage 5) is not part of the hash chain because it's never persisted.

### 11. LEARN (self-tune the ladder per recipient) — ABSENT

- **Decision-level learning exists** — `decision-retrospective-worker.ts`
  grades decisions vs outcomes (good/bad/neutral) and writes hash-chained
  `decision_outcomes`; `outcome_reconciliations` matches predictions to
  reality; memory decay sweep + belief-learning + cognitive-memory observe.
- BUT a repo-wide search for ladder/cadence self-tuning
  (`selfTune|tuneLadder|adaptCadence|learnLadder`) returns **nothing**.

**Missing entirely:** no organ adjusts a recipient's reminder offsets,
preferred channel, or quiet-hours based on their historical response/read
latency. The ladder is static config (`[30,14,3]`, `[90,…,1]`) identical
for every recipient.

---

## Cron / leader-election control plane (cross-cutting)

- **Leader-election:** `services/api-gateway/src/composition/cluster-lock.ts`
  — dedicated session-pinned `max:1` connection, `pg_try_advisory_lock`,
  `withClusterLeader()` wrapper, env-gated `CRON_LEADER_ELECTION` (default
  OFF = every replica runs = duplicate fire risk until flipped).
- **~20 leader-gated crons** enumerated `index.ts:680` (heartbeat,
  background-supervisor, ica-cert-expiry, reminders-dispatch,
  announcement-fanout, executive-brief-action-runner, proactive-scheduler,
  decision-retrospective, mwikila-autonomous, …). These **can** drive a
  per-event ladder — the scheduling cadence and idempotency machinery is
  all there — but today each is a bespoke detector, not a generic
  ladder-runner.
- **Wake-loop** (`wake-loop-cron.ts`) self-guards with its own advisory
  lock and runs real arrears/lease/vacancy detectors + HQ triggers + stall
  sweep — the closest thing to a generic event→goal→execute engine, but it
  feeds the agency goal system, not the reminder/notification rails.
- **Proactive sink** (`composition/proactive/proactive-delivery.ts`) drains
  `tab_proposals_inbox` + `tab_event_log` proactive_nudge rows onto the
  cockpit SSE bus (in-app only) — real but in-app-only egress.

---

## BossNyumba parity (reasoned from the shared spine)

BN shares the **identical** brain + wiring spine (same `notification-dispatch`
substrate, `event_outbox`, `notification_dispatch_log`, `reminders`,
`owner_contact_prefs`, `device_push_tokens`, cluster-lock, wake-loop,
ai_audit_chain, channel providers). Therefore:

- **Same organs PRESENT** (channel adapters, durable outbox, dispatch log,
  leader-election, hash-chain) — these are domain-agnostic and live in the
  shared layers.
- **Same joint gaps** carry over verbatim: confirm-delivery closure open,
  no shared ladder primitive, no escalate-on-inaction loop, no per-recipient
  learn. The cluster-lock comment itself references property horizons
  ("arrears chase 14d, maintenance 7d, lease renewal 30d",
  `wake-loop-cron.ts:35-41`) — BN's ladders would be the property-domain
  analogues (rent-due, lease-renewal, inspection-due, arrears) and would
  reuse the exact same `reminders`/`dispatch_log` rails.
- **Domain-layer difference:** BN's detectors target leases/arrears/
  inspections (the property-relic crons `lease-expiry-alert-cron.ts` already
  present here, mostly empty for mining); Borjie's target licences/certs/
  royalty/equipment. The detector set differs; the fabric beneath is
  identical. Closing the joints (stages 5,7,11 + a shared ladder primitive)
  in the shared spine fixes BOTH products at once.

---

## What to build (the connective tissue, ranked)

1. **Close confirm-delivery:** add a `NotificationDeliveryStatus`
   subscriber that UPDATEs `notification_dispatch_log` SET
   delivery_status='delivered'/'read', delivery_reported_at=now() keyed on
   provider_message_id (the only missing line to close stage 5). Then fold
   the receipt into the hash chain.
2. **Extract a shared `ReminderLadder` primitive** over `event_outbox` (or
   a new `reminder_ladders` table): `(event_key, recipient, offsets[],
   channelPolicy, escalationPolicy)`. Re-point cert/licence crons at it;
   add royalty/invoice/equipment/safety/shift/KYC detectors as thin
   producers.
3. **Honor `preferredChannel` for channel SELECTION** (not just address)
   and add a cross-channel fallback ladder (push→SMS→WhatsApp→call) keyed on
   non-delivery from stage 5.
4. **Escalate-on-inaction loop:** a cron that reads ladders whose rungs are
   exhausted with no recipient action and advances the `mining_escalations`
   chain (HITL-gated for money/licence/deletion).
5. **Per-recipient LEARN:** feed delivery/read latency + response history
   from stage 5 back into per-recipient offset/channel tuning.

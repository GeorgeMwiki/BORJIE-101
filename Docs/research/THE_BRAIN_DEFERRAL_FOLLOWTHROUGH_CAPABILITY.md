# THE BRAIN'S DEFERRAL / FOLLOW-THROUGH CAPABILITY — prospective memory + the closed loop as ONE organ

**Document:** `Docs/research/THE_BRAIN_DEFERRAL_FOLLOWTHROUGH_CAPABILITY.md`
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Status:** deep-synthesis design — READ-ONLY research lane. No code edits, no commit. Designs the brain's SOTA deferral / follow-through capability and maps it, seam by seam, onto the live Borjie substrate.
**Bar:** SOTA, fiduciary-grade, lossless. Owner directive: *"OUR BRAIN SHOULD HAVE THE DEFERRED / TODO / DO-LATER LOGIC."*

**Reads this design builds on (all read in full this session):**
- `Docs/research/brain-deferral-sota.md` — the prospective-memory + closed-loop SOTA dossier (the four pillars, the reference architecture, the substrate inventory).
- the **Brain Deferral/TODO/Follow-Through Capability Audit (June 2026)** — verdict: the pieces exist but are SCATTERED, not COHERENT (no unified backlog, no escalation ladder, no closed-loop verification, no active resurface cadence).
- `Docs/research/MASTER_WIRING_CLOSURE_PLAN.md` — the closed-loop wiring gaps (durability is the substrate; EstateMind actuates through the arbiter; the blackboard is the spine).
- `Docs/research/THE_SOTA_WIRING_FRONTIER.md` — temporal-decay as a staleness immune system; the blackboard as a commitment/pressure store; the hormone bus.

**Scope distinction (do not conflate — stated once, binding):** this is a **product capability** of the brain — Mr. Mwikila, the veteran autonomous MD, remembering to come back and finish things on the owner's estate. It is **not** about source-code TODO/deferred debt; the codebase separately carries no such debt. Everything below is the *capability*.

---

## PART 1 — THE CAPABILITY

### 1.1 What a real Managing Director actually does

A mining-estate MD does not hold 15–20 parallel workstreams in working memory and act on all of them at once. That is not how competent executives operate, and it is not how a competent autonomous MD should operate. The real behaviour is:

> **Defer with intent, hold a durable backlog, schedule the return (by clock *and* by event), nudge on a graduated ladder, escalate when the clock runs out, follow through to confirm the thing actually happened, write closure to the record, and learn — and NEVER drop a thread, no matter how long the gap.**

Concretely, on a single day Mr. Mwikila might:

- **Defer** the royalty filing — *"handle this after the buyer's settlement lands"* (an **event** trigger, not a date).
- **Park** a wash-plant expansion — *"revisit next dry season"* (a **someday/maybe**, reviewed on cadence, never auto-fired).
- **Diary** a PML renewal — *"the licence expires in 84 days; start the ladder at T-90"* (a **time** trigger with a deadline).
- **Wait-for** an EPA effluent-permit response — *"resume the moment the regulator replies"* (an **event/condition** trigger keyed to an inbound signal, with a timer fallback so silence still surfaces).
- **Chase** an offtake confirmation that is three days late — advance it one rung up the reminder ladder.
- **Escalate** an overdue licence action to the owner with a **safe-halt** — the brain will surface and wait; it will **never** auto-file a sovereign licence action.
- **Close the loop** on yesterday's filing — confirm the regulator acknowledgement actually landed, then mark it done in the hash-chained audit trail. If it cannot confirm, it **re-opens** the commitment.

The audit's core finding: *"80% of an MD's work is started-but-deferred, waiting-for-external-info, resumed-days-later."* The deferral organ is therefore not a feature bolt-on — it is the **spine of how the MD operates at all.**

### 1.2 Why an LLM brain cannot do this natively

The 2026 consensus is blunt and structural, not a tuning problem: **LLMs have no native prospective memory.** A model not currently being prompted about a commitment will not act on it — there is no "wake me at T" or "wake me when condition C holds" inside the weights or the context window. The leading 2026 survey (*Memory for Autonomous LLM Agents*, arXiv:2603.07670) enumerates five memory mechanism families — context-resident compression, retrieval-augmented stores, reflective self-improvement, hierarchical virtual context, policy-learned management — and **every one is retrospective** (mechanisms for accessing the *past*). None is an organ for *acting in the future*. The 2026 framing names the exact failure mode: **temporal decoupling** — write and activation happen at different times, in different sessions, in different task contexts — and notes most systems lack a temporal model where facts can be superseded. A commitment that lives only in context evaporates at the next compaction, session boundary, or worker restart.

**The only reliable design** (every production durable-agent stack converges on it): externalise the intention as a **first-class durable row the moment it is formed**, with its trigger, and let an **external driver loop** bring it back at the right moment. The LLM is the *reasoner about* commitments; it is **never the store of** commitments.

### 1.3 The capability as ONE coherent organ — the closed loop

The capability is a single organ with one lifecycle, not five scattered features:

```
   DETECT ─► PERSIST ─► WAIT-FOR (time | event | condition) ─► RESURFACE
   (a commitment   (durable      (the trigger fires:                (idempotent,
    is formed)      commitment    clock T, signal E, or              re-present to
                    ledger row)   predicate P holds)                 the right channel)
                                                                          │
                                                                          ▼
   ◄─ LEARN ◄─ AUDIT ◄─ CONFIRM ◄─ FOLLOW-THROUGH ◄─ ESCALATE ◄─ REMIND (ladder rung)
   (capture    (hash-    (close    (verify it ACTUALLY    (next rung /   (in-app→email→
    override)   chained   only on   happened; re-open      safe-halt;     SMS→owner,
                closure)  positive  if it didn't)          never auto-    gated on ack)
                          proof)                           fire sovereign)
                                        ▲
   RECONCILE every cycle ───────────────┘   (EstateMind re-reads ALL open commitments
                                             each tick; nothing closes except by
                                             confirmation — "never drop a thread")
```

The four SOTA pillars the dossier names map onto the four halves of this loop:

1. **Task-ledger discipline** (Magentic-One dual ledger / Claude Agent SDK structured tasks / Manus recitation) — *holds the goal*. The MD does not trust its own context to hold the plan; it externalises a re-read backlog and a stall-counter forces re-plan rather than silent drift.
2. **Durable scheduled + event wakeups** (Temporal-class durable timers + signals + `wait_condition`) — *brings it back losslessly*. Time-based `sleep(T)`, event-based signals, and a `await_condition(predicate)` primitive, all replay-safe across worker restart.
3. **Reminder-ladder + escalation** (HITL risk-tiered SLAs) — *drives it to a human decision when needed*, with a graduated escalating reach and a defined safe-halt fallback that never silently auto-proceeds on a sovereign/money action.
4. **Reconciliation + closure-by-confirmation** (the agentic "weekly review" / GTD review cadence) — *closes the loop and proves it never forgot*. Every commitment is re-read each cycle; a thread closes only on positive confirmation, never by forgetting.

**The product promise:** the owner can hand Mr. Mwikila a deferral in plain language — *"deal with the royalty after the money lands"* — walk away for a week on a remote site with no signal, and trust that the commitment is durably tracked, fires on exactly the right trigger, climbs a reminder ladder if ignored, escalates to a safe-halt rather than acting unilaterally on anything sovereign, and is followed through to a confirmed close that is written to the audit chain. Lossless, by construction.

---

## PART 2 — THE DESIGN, MAPPED ONTO OUR SUBSTRATE

The audit is right twice: every primitive already exists, **and** they are disconnected fragments rather than one organ. The design is therefore **mostly wiring + one new durable table**, not a rebuild. Each subsection states: **the SOTA shape**, **what we HAVE** (live code, exact file + line), **what to BUILD/WIRE** (the thin new piece), and **the SEAM** (where it attaches).

### 2.0 The shape of the gap (from the audit, restated as the design targets)

| # | Gap | The design's answer |
|---|-----|---------------------|
| G1 | No unified COMMITMENT LEDGER — concept smeared across `reminders` / `pending_threads` / `mwikila_actions_inbox` / `mining_tasks` | **§2.1** new `md_commitments` table — one durable, append-only, RLS home for every deferred MD commitment |
| G2 | No event/condition trigger — only time-based `trigger_at` | **§2.2** a `WaitFor` trigger primitive (time \| event \| condition) + a projection that flips `waiting→due` on existing event sources |
| G3 | No graduated reminder ladder — flat exponential *retry* exists, not escalating *reach* | **§2.4** promote `reminders` + `user-followup` into a ladder rung engine gated on acknowledgement |
| G4 | No reconciliation sweep that closes the loop — EstateMind formulates NEW goals but never re-reads open commitments | **§2.3** the EstateMind tick becomes the reconciliation engine (re-read all open → advance ladders → re-open unconfirmed) |
| G5 | No someday/maybe review cadence — nothing distinguishes a dated item from a parked idea | **§2.1** a `class` discriminator on the ledger (`next_action`/`waiting_for`/`tickler`/`someday_maybe`) + a cadence sweep |
| G6 | No closure-by-confirmation — closure is "I sent the reminder," not "it actually happened" | **§2.5** an explicit confirm step; a commitment closes only on positive proof, else re-opens |

### 2.1 The durable COMMITMENT STORE — where the backlog lives

**SOTA shape.** One explicit, externalised, append-only **task ledger** the brain re-reads (and the loop rewrites) every cycle — Magentic-One's discipline (don't trust context to hold the plan), the Claude Agent SDK's event-per-transition (`TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` — each status change is an auditable event, not a blob rewrite), and the GTD taxonomy collapsed into one row shape (`next-action` / `waiting-for` / `tickler` / `someday-maybe`). The commitment must survive a worker restart, a model-context reset, and a week of owner silence — i.e. it lives in Postgres, not a prompt.

**What we HAVE.** Four partial homes, each with exactly the discipline we want to reuse:
- `reminders` (mig `0089`) + `reminders.attempt_count` (mig `0303`) — durable `trigger_at`, UNIQUE idempotency key, multi-channel, RLS FORCE (mig `0156`). *Time-based only; a reminder ≠ a tracked commitment with a confirm-done loop.*
- `mwikila_actions_inbox` (mig `0129`) — the closest model for the row shape: `delegation_tier T0..T3`, `proposal_ttl_at` + a TTL-due partial index, a reversal window, bilingual `summary`/`summary_sw`/`rationale`, `audit_chain_hash` + `decision_id`, a status lifecycle (`proposed→owner_approved/denied→executed→reversed/committed→blocked_by_inviolable→expired`). `license.renewal_reminder` and `royalty.monthly_filing_prep` are already first-class `action_kind`s. *It expires an action; it does not escalate up a ladder or re-open + follow through.*
- `mining_tasks` (mig `0080`) — a real task table with `due_at` + `blocked` reason. *Human-assigned operational tasks, not the brain's own commitments.*
- `@borjie/work-cycle` `WorkCycleState.pending_threads` (`packages/work-cycle/src/types.ts:139`) + the append-only `work_cycle_journal` + `resumption-brief.ts`. *`pending_threads` is literally the open-thread list — the closest analogue to a re-read task ledger — but it has no per-thread trigger / ladder / confirm fields.*

**What to BUILD/WIRE.** One new migration — `md_commitments` — modelled on `mwikila_actions_inbox`'s tier/TTL/audit discipline + `mining_tasks.due_at` + work-cycle's `pending_threads`. This is the single source of truth the audit says is missing (G1, G5). Shape (illustrative, RLS FORCE on `app.current_tenant_id`, append-only lifecycle):

```sql
CREATE TABLE md_commitments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,            -- RLS FORCE, current_tenant_id GUC
  owner_id          text NOT NULL,            -- the owner the commitment is held for
  thread_id         text,                     -- ties to a work-cycle pending_thread / chat thread
  -- GTD taxonomy as ONE discriminator (G5):
  class             text NOT NULL,            -- 'next_action' | 'waiting_for' | 'tickler' | 'someday_maybe'
  kind              text NOT NULL,            -- domain verb: 'royalty.filing' | 'licence.renewal' | 'offtake.confirm' ...
  title             text NOT NULL,
  title_sw          text NOT NULL,            -- bilingual absolutism (CLAUDE.md)
  next_action       text NOT NULL,            -- the single physical next step (Magentic-One discipline)
  rationale         text NOT NULL,
  -- The WAIT-FOR trigger (G2) — one of three, typed:
  trigger_kind      text NOT NULL,            -- 'time' | 'event' | 'condition'
  trigger_at        timestamptz,              -- time:    fire when now() >= trigger_at
  trigger_event     text,                     -- event:   fire on this signal name (e.g. 'ledger.credit')
  trigger_predicate jsonb,                    -- condition: a serialised predicate over estate state
  trigger_deadline  timestamptz,              -- event/condition FALLBACK so silence still surfaces
  -- Lifecycle (closure-by-confirmation, G6):
  status            text NOT NULL DEFAULT 'open',
                    -- open | waiting | due | reminded | escalated | confirmed | abandoned
  ladder_rung       int  NOT NULL DEFAULT 0,  -- current rung (G3): 0=in-app .. N=owner-direct/safe-halt
  channel_policy    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- allowed channels + quiet-hours + per-day cap
  sovereign         boolean NOT NULL DEFAULT false,      -- HIGH-risk: licence/royalty/money/deletion → safe-halt
  evidence_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ≥1 evidence_id (evidence-required rule)
  last_surfaced_at  timestamptz,             -- idempotent resurfacing stamp (reuse proactive pattern)
  confirmed_at      timestamptz,             -- set ONLY on positive confirmation of completion
  confirmation_kind text,                    -- 'regulator_ack' | 'ledger_entry' | 'owner_approved' | ...
  abandoned_reason  text,
  attempt_count     int  NOT NULL DEFAULT 0, -- reuse the 0303 retry discipline for delivery
  audit_chain_hash  text,                    -- hash-chained closure (append-only)
  idempotency_key   text NOT NULL,           -- UNIQUE(tenant_id, idempotency_key) — never double-create
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- mirror the proven 0129/0089 index discipline:
CREATE INDEX md_commitments_due_idx       ON md_commitments (trigger_at)
  WHERE status = 'waiting' AND trigger_kind = 'time';
CREATE INDEX md_commitments_open_idx      ON md_commitments (tenant_id, status, updated_at DESC);
CREATE INDEX md_commitments_deadline_idx  ON md_commitments (trigger_deadline)
  WHERE status = 'waiting' AND trigger_deadline IS NOT NULL;
CREATE UNIQUE INDEX md_commitments_idem_uniq ON md_commitments (tenant_id, idempotency_key);
```

The append-only discipline (status transitions are events, never blob-overwrites) follows the work-cycle journal pattern; the closure hash chains to `audit_chain_hash` exactly as `mwikila_actions_inbox` stitches to `audit_chain_hash` + `decision_id`.

**SEAM.** A new Drizzle schema `packages/database/src/schemas/md-commitments.schema.ts` + an export in `packages/database/src/schemas/index.ts`; a `CommitmentRepository` port under `services/api-gateway/src/composition/` (mirroring the work-cycle `StateRepository` two-impl pattern: in-memory for tests, Drizzle for prod). **DETECT writers** post into it from the five existing sources the dossier names: chat (`"handle after the renewal"` parsed into a commitment), EstateMind drives (a breached drive that should be *tracked*, not just nudged), kernel `proactive_nudge`, tool results, and blackboard stale slots.

### 2.2 The WAIT-FOR trigger primitive — time + event + condition

**SOTA shape.** Three trigger classes, all replay-safe:
- **time** — `sleep(T)` / durable timer; a worker restart mid-wait replays and the remaining wait continues (Temporal durable timers; the 2026 durable-execution consensus is that `workflow.sleep` survives restarts where a process `sleep` does not).
- **event** — a signal delivered into a waiting commitment ("the buyer's settlement landed"); Temporal-class `signal` / the resume-driver `WHERE status='waiting' AND wake_at <= now()` pattern generalised to events.
- **condition** — `await_condition(predicate)`: block until a business predicate holds (funds ≥ filing amount; assay = confirmed; licence age < threshold). Temporal expresses this as `workflow.wait_condition()` + a signal handler; event-sourced stacks express it as a derived projection that flips a `waiting` row to `due`. The condition wait is strictly more valuable and strictly harder, and is exactly where home-grown reminder systems fall short — it is the difference between *"remind me about the royalty on the 7th"* and *"act on the royalty the moment the buyer's money clears."*

**What we HAVE.**
- The canonical **resume-driver** is already in production: `reminders-dispatch.worker.ts` polls `UPDATE reminders ... WHERE status='scheduled' AND trigger_at <= now() ... FOR UPDATE SKIP LOCKED RETURNING ...` — atomic claim, `MAX_ATTEMPTS=5` exponential backoff (`computeNextRetryAt`), idempotency via `dispatched_at IS NULL` + the UNIQUE key, and quiet-hours deferral for the intrusive channel. **This is exactly the time-based wakeup, already lossless.** The design *reuses this poll verbatim* against `md_commitments` where `trigger_kind='time'`.
- **Event sources exist but nothing subscribes a commitment to them:** `LedgerService.post()` credits (funds-landed), settlement webhooks (offtake), the blackboard CRDT `SLOT_DELTA` broadcaster + **stale-slot decay** (a thread going quiet — mig `0319` carries `wall_clock_ms`, `version`, `updated_at`, tombstones; `THE_SOTA_WIRING_FRONTIER` §9 names `e^(−λt)` decay re-opening a "solved" region as the staleness immune system), and EstateMind's situational-model salience.
- `@borjie/workflow-engine`'s `start→propose→review→human-approval→commit` is Borjie's nearest **Temporal-signal analogue** for the human-approval wait; the unwired durable runner / Inngest backbone (`MASTER_WIRING_CLOSURE_PLAN` Wave 2 / `THE_SOTA_WIRING_FRONTIER` §2.7) is the optional industrial-strength substrate.

**What to BUILD/WIRE.** A small **`WaitFor` evaluator** — a projection that flips `md_commitments.status` from `waiting→due`:
1. **time** — the existing reminders poll, pointed at `md_commitments` (zero new mechanism).
2. **event** — a thin subscriber that maps an existing event onto a commitment: on a `LedgerService.post()` credit, on an offtake settlement webhook, or on a `SLOT_DELTA` stale-flip, look up commitments `WHERE trigger_kind='event' AND trigger_event = <name> AND status='waiting'` and flip them `due`. (Webhook consumers are already at-least-once + idempotent via `Idempotency-Key` — a hard rule — so the flip is safe to re-deliver.)
3. **condition** — evaluate `trigger_predicate` against the situational model / mining graph each reconciliation tick (§2.3); flip `due` when it holds. The `trigger_deadline` is the **fallback timer**: even if the event never arrives, the deadline surfaces the commitment so silence is never a dropped thread.

**SEAM.** The time path needs no new wire — it is the reminders poll re-aimed. The event path attaches at the existing `LedgerService.post()` post-commit hook, the settlement webhook handler, and the `blackboard-slots-wiring.ts` `SLOT_DELTA` broadcaster. The condition path attaches inside the EstateMind reconciliation step (§2.3), which already re-reads estate state every tick. **Governance note:** an event flip only moves a commitment to `due` (it makes the brain *consider* acting) — it never auto-actuates a sovereign action; that still routes through the ladder + safe-halt (§3).

### 2.3 The RECONCILE-OPEN-COMMITMENTS loop — EstateMind as the engine

**SOTA shape.** On a cadence, the agent **re-reads ALL open commitments**, recomputes which are now due / overdue / blocked, advances each one rung on its ladder, and re-plans stalled threads. This is Magentic-One's stall-driven re-plan generalised to the whole backlog, GTD's *weekly review*, and Letta/MemGPT *sleep-time* background reflection (a night-shift heartbeat that, while the owner sleeps, re-reads the backlog and stages tomorrow's nudges). This loop is what makes "lossless" *true in practice*: a thread can only be closed by confirmation, never by forgetting.

**What we HAVE.** `EstateMind.tick()` (`packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts`) already runs the structured cognitive cycle **PERCEIVE → ORIENT → MOTIVATE → PROPOSE → FORGET**, per tenant, idempotent, never-throws, durable-via-situational-model, leader-elected heartbeat. The dossier names it exactly: *"This is the engine that should resurface deferred items proactively"* — **but today the drives formulate NEW goals from current salience; they do not read a durable commitment backlog and advance it.** The proactive scheduler (`proactive-wiring.ts`) already provides the per-(tenant,owner) tick host, `withTenantContext` GUC binding per tick, idempotent delivery via `last_surfaced_at`, and the `runDeliveryOnce()` cadence — the exact harness the reconciliation sweep rides.

**What to BUILD/WIRE.** Add a **RECONCILE step** to the EstateMind tick (between ORIENT and PROPOSE), as a new injected port so the loop stays decoupled and testable:

```
RECONCILE (new step, runs every tick, per tenant):
  1. READ all md_commitments WHERE status IN ('open','waiting','due','reminded','escalated')
  2. For each commitment:
     a. WAIT-FOR eval (§2.2): time past? event fired? predicate holds? deadline passed?
            → flip waiting→due
     b. If due and not surfaced this cadence (last_surfaced_at guard):
            → advance one ladder rung (§2.4); stamp last_surfaced_at
     c. If a 'confirmed'-pending item was never positively confirmed (§2.5):
            → RE-OPEN it (status back to 'due', back on the ladder)   ← never-drop-a-thread
     d. If someday_maybe and the review cadence is due:
            → surface for review only; never auto-fire
  3. Emit the due/overdue set into PROPOSE (existing gated proposal sink) so the
     owner cockpit + resumption-brief 'awaiting_approval'/'escalation' buckets show them.
```

This makes EstateMind the "weekly review / never-drop-a-thread sweep" the dossier prescribes, hosted in its natural PERCEIVE→MOTIVATE structure (G4). The someday/maybe review cadence (G5) is just a `class='someday_maybe'` filter with a longer interval (e.g. quarterly) — reviewed, never auto-fired.

**SEAM.** A new `ReconciliationPort` injected into `EstateMindDeps` (alongside `perception`, `motivation`, `proposalSink`); the port reads/writes `md_commitments` via the `CommitmentRepository` (§2.1) and calls the ladder engine (§2.4). The tick host is the **existing** `proactive-wiring.ts` delivery cadence (or the EstateMind heartbeat already wired in composition) — no new supervisor. The resumption brief (`work-cycle/src/resumption/resumption-brief.ts`) already buckets `awaiting_approval` + `escalation`; due/overdue commitments feed those buckets so a returning owner sees them immediately.

### 2.4 The REMINDER LADDER + ESCALATION — graduated reach, not flat retry

**SOTA shape.** A deferred item that fires *once* and is ignored is still a dropped thread. The closed loop adds a **graduated reminder ladder** (multi-channel, escalating cadence and reach: in-app → email → SMS/WhatsApp → call/owner-direct, each rung firing only if the prior rung produced no acknowledgement, quiet-hours respected on the intrusive channels), **risk-tiered SLAs** (the cadence scales with stakes), and an **escalation ladder with abort criteria** (when an SLA is missed, a *defined* fallback fires: escalate to the next level, or **safe-halt** — never silently auto-proceed on a sovereign/money action). The 2026 durable-execution literature is explicit: *"without time bounds and escalation, there is no recovery path that does not require manual intervention"* — a Temporal timer at the human-handoff point + an escalation rung is the production pattern.

**What we HAVE — the ladder material is all present, just not assembled as a ladder:**
- **Flat retry** (the timer rung): `reminders-dispatch.worker.ts` `MAX_ATTEMPTS=5` exponential backoff. This is *retry of one delivery*, not *escalating reach*.
- **Channel ladder + quiet-hours + per-day cap + audit:** `@borjie/user-followup` `runSchedulerOnce` (`packages/user-followup/src/scheduler/followup-scheduler.ts`) — `resolveChannel` (preferred → email → inapp fallback), `isInQuietHours` (wrap-midnight aware), `max_per_day` cap, suppression records, and an `AuditChainPort.append` on every dispatch. This is the *exact* channel-routing engine the ladder needs.
- **The top rung / safe-halt:** `mwikila_actions_inbox` (mig `0129`) — `proposal_ttl_at` + TTL-due index = time-bounded HITL; `blocked_by_inviolable` status = the safe-halt outcome; the owner cockpit "Acting on your behalf" inbox already renders it with one-tap approve/deny.
- **The escalation lifecycle:** `mining_escalations` (mig `0081`) — `open→acknowledged→resolved`, severity, manager↔worker↔owner addressee chain, hot-path index.

**What to BUILD/WIRE.** A thin **`LadderEngine`** that maps `md_commitments.ladder_rung` → the right existing dispatcher, gated on acknowledgement:

```
rung 0  in-app   → cockpit event (publishCockpitEvent) — the proactive tray
rung 1  email    → user-followup email dispatcher (quiet-hours-respecting)
rung 2  SMS      → reminders SMS path (quiet-hours-deferred via isWithinQuietHours)
rung 3  owner-   → user-followup owner-direct + mwikila_actions_inbox row with proposal_ttl_at
        direct     (one-tap surface) — and for SOVEREIGN commitments this rung is a SAFE-HALT:
                   surface + wait, NEVER auto-file.
rung 4  escalate → mining_escalations row (owner severity) if rung 3 SLA is missed.
```

Advance one rung only when the prior rung produced **no acknowledgement** within its risk-tiered SLA (the audit's "gated on acknowledgement" requirement, G3). The SLA cadence scales with `sovereign` + urgency (e.g. a routine someday/maybe review uses a 24h+8h cadence; a T-7d licence renewal uses a tight cadence + the owner-direct rung early). Acknowledgement is recorded on the commitment (`last_surfaced_at` + an `ack_at` field, or the inbox `owner_reviewed_at`).

**SEAM.** `LadderEngine` is a pure function of `(commitment, prefs, clock)` → `{ rung, dispatcher }`, called by the RECONCILE step (§2.3). It composes the **already-wired** dispatchers: `publishCockpitEvent` (rung 0), the `user-followup` channel dispatchers + quiet-hours (rungs 1–3), the `reminders` SMS quiet-hours path (rung 2), `mwikila_actions_inbox` insert with `proposal_ttl_at` (rung 3 / safe-halt), and a `mining_escalations` insert (rung 4). No new channel code — the ladder is the *composition* of existing rungs.

### 2.5 CLOSE THE LOOP — confirm, audit, learn

**SOTA shape.** *Follow-through-to-closure is the part most systems skip.* Detection + scheduling is easy; the hard, high-value behaviour is the agent **coming back to verify the thing actually happened**, re-opening the commitment if it didn't, and marking `done` **only on positive confirmation** — recorded in the audit chain. Closure is not "I sent the reminder"; it is "the action is confirmed done (or explicitly abandoned), recorded immutably." And **capture every human correction** to evaluate the next agent version (the learning signal).

**What we HAVE.**
- **Confirmation sources** already exist as events: a regulator acknowledgement (filing webhook), a `LedgerService.post()` ledger entry (money moved), an owner one-tap approve in `mwikila_actions_inbox` (`owner_reviewed_at` + status `executed`/`committed`). These are the same event feeds §2.2 subscribes to — confirmation is just a *second* `WaitFor` on the completion signal.
- **The audit chain** is hash-chained, append-only, per-tenant — `mwikila_actions_inbox.audit_chain_hash` + `decision_id`; the work-cycle journal's `prev_hash`→`audit_hash` chain; the `user-followup` `AuditChainPort`. A closure row stitches into exactly this.
- **The learning sink:** the cognitive-reinforcement audit-chain + memory-v2 durable stores (mig `0312`) + the situational model — the existing home for "the owner overrode this" signals.

**What to BUILD/WIRE.** An explicit **confirm step** in RECONCILE:
- When a commitment's `next_action` is dispatched (e.g. the owner files the royalty after the safe-halt surface), the brain does **not** mark it done. It sets the commitment to wait on a **confirmation predicate** (`confirmation_kind` + a `WaitFor` on the regulator-ack / ledger-entry / owner-approve event).
- On positive confirmation → set `confirmed_at`, write a hash-chained **closure row** (the `audit_chain_hash` stitch), status `confirmed`.
- On confirmation deadline elapsed without proof → **re-open** (status back to `due`, back on the ladder). *An unconfirmed renewal re-opens automatically* — this is the never-drop-a-thread guarantee made concrete (G6).
- Capture any owner override / correction (denied, abandoned, re-scheduled) into the learning sink so the next deferral decision is better-calibrated.

**SEAM.** The confirm step is part of the RECONCILE port (§2.3); the closure writer is the existing audit-chain append (reuse `mwikila_actions_inbox`'s `audit_chain_hash` stitching or the work-cycle journal chain); the learning write is the cognitive-reinforcement / memory-v2 sink already wired into the brain turn.

### 2.6 The seam map, at a glance

| Loop stage | HAVE (live code) | BUILD/WIRE (thin) | SEAM (attach point) |
|---|---|---|---|
| **DETECT** | chat, EstateMind drives, `proactive_nudge`, tool results, blackboard stale slots | 5 commitment-writers | `CommitmentRepository.create()` |
| **PERSIST** | `reminders`/`mwikila_actions_inbox`/`mining_tasks`/`pending_threads` (fragments) | **new `md_commitments` table** (1 migration + schema) | `packages/database/src/schemas/` + `CommitmentRepository` |
| **WAIT-FOR** | reminders poll (time); ledger/webhook/SLOT_DELTA/decay (events) | `WaitFor` evaluator (time reused; event subscriber; condition predicate) | reminders poll re-aimed + `LedgerService.post` hook + webhook handler + `blackboard-slots-wiring.ts` |
| **RECONCILE** | `EstateMind.tick()` PERCEIVE→…→PROPOSE; proactive tick host | **RECONCILE step** (re-read all open → advance → re-open) | new `ReconciliationPort` in `EstateMindDeps`; proactive delivery cadence |
| **REMIND/ESCALATE** | reminders retry; `user-followup` channel ladder + quiet-hours; `mwikila_actions_inbox` TTL; `mining_escalations` | **`LadderEngine`** (compose existing rungs, gate on ack) | pure fn called by RECONCILE; composes existing dispatchers |
| **CONFIRM/AUDIT/LEARN** | confirmation events; hash-chained audit; cognitive-reinforcement sink | **confirm step** (close only on proof; else re-open) | RECONCILE port + audit-chain append + learning sink |

**Net new surface:** ONE table + ONE schema + ONE repository + ONE reconciliation port (with the WaitFor evaluator, LadderEngine, and confirm step inside it) + the DETECT writers. Everything else is composition of live, tested organs.

---

## PART 3 — GOVERNANCE

The deferral organ touches the estate's most consequential obligations (licences, royalties, money). It inherits the full CLAUDE.md + `THE_SOTA_WIRING_FRONTIER` §5 governance floor, with three deferral-specific invariants:

### 3.1 Deferral never drops a SOVEREIGN obligation silently

- A commitment with `sovereign=true` (licence renewal/suspension, royalty filing, money movement, deletion) is **HITL forever**. The brain may **track, schedule, remind, and escalate** it — it **never auto-actuates** it. The top ladder rung for a sovereign commitment is a **safe-halt**: surface to the owner via `mwikila_actions_inbox` (the existing time-bounded HITL inbox) and **wait**. This honours the hard rules: money path through `LedgerService.post()`; licence filing HITL; HIGH-risk policy prefixes (sovereign / kill_switch / four_eye / policy_rollout) hit literal policy with no reason-resolver generalisation and can never be "deferred-around."
- **Safe-halt is fail-closed, not fail-silent.** If a sovereign commitment goes overdue and the owner is unreachable, the escalation rung **raises the alarm louder** (owner-direct → `mining_escalations`), but it **never** flips to auto-execute on TTL expiry. An overdue licence escalates to HITL; it does not auto-file. (`mwikila_actions_inbox`'s `expired` status is the model: TTL expiry parks the action as expired and re-surfaces it — it does not execute it.)
- The temporal-decay staleness re-open (§2.2) applies **only to a decision/forecast** — it may re-open a 3-week-old price quote or a stale forecast — it **never** re-opens a *committed* money/licence fact (`THE_SOTA_WIRING_FRONTIER` Wave 6 governance invariant).

### 3.2 Honest status — no optimistic closure

- A commitment's status is always one of `open | waiting | due | reminded | escalated | confirmed | abandoned`, and it is **honest**: `confirmed` is set **only on positive proof** of completion (regulator ack / ledger entry / owner approve), never on "I sent the reminder" and never optimistically on dispatch. An unconfirmed item **re-opens** automatically — the brain reports "scheduled" / "overdue" / "awaiting confirmation" truthfully, never "done" until it is provably done. This mirrors the honest three-state billing discipline already in the codebase: the system never claims more certainty than it has.

### 3.3 Evidence-required + audited + bilingual + tenant-scoped

- Every commitment carries ≥1 `evidence_id` (the evidence-required hard rule); the Auditor rejects an empty/unsupported evidence chain — a deferral with no grounding is not created.
- Every lifecycle transition (create → wait → due → remind → escalate → confirm/abandon) is an **append-only, hash-chained audit row written before the effect** — fully reconstructable and reversible, stitched into the existing chain (`audit_chain_hash` / work-cycle journal).
- **Bilingual absolutism:** `title`/`title_sw` and all surfaced copy carry complete EN + SW; the active-locale toggle is absolute — zero EN/SW mixing in any reminder, escalation, or cockpit surface.
- **RLS FORCE** on `md_commitments` (`app.current_tenant_id`), bound per-tick by the same `withTenantContext` the proactive scheduler already uses; a commitment is never visible or actionable across the tenant boundary.
- **Kill-switch fail-closed** and **budget-aware**: the reconciliation sweep runs inside the budget envelope (its cadence degrades, like the work-cycle `observe` mode, under cost pressure — it never stops tracking, it slows the *re-surface* cadence), and the kill-switch halts actuation without being caught-and-ignored.

---

## PART 4 — THE BUILD-WAVE PLAN (dependency-ordered, real, buildable)

Five waves, strictly dependency-ordered: **the store before the trigger, the trigger before the loop, the loop before the ladder, the ladder before close-the-loop.** Each is real buildable code mapped to files. Waves run on `integration/parity-final` (or a feature branch) behind a `BORJIE_MD_COMMITMENTS` flag, defaulting OFF until Wave 5 closes the loop end-to-end.

### WAVE D1 — THE DURABLE COMMITMENT STORE (foundation; do first, alone)

**What.** The single source of truth the audit says is missing (G1, G5).
**Build:**
- New migration `packages/database/src/migrations/03NN_md_commitments.sql` — the `md_commitments` table from §2.1, RLS FORCE on `app.current_tenant_id`, the four indexes (due / open / deadline / idem-unique), append-only lifecycle. (Migrations are immutable — append a new numbered file; never edit a shipped one.)
- `packages/database/src/schemas/md-commitments.schema.ts` + export in `schemas/index.ts`.
- `services/api-gateway/src/composition/md-commitments/commitment-repository.ts` — the `CommitmentRepository` port, two impls (in-memory for tests, Drizzle for prod), mirroring the work-cycle `StateRepository` shape (`read`/`listOpen`/`create`/`transition`/`stampSurfaced`/`confirm`/`reopen`).
**Verify:** `migration-apply-check` green on fresh PG17 + pgvector; RLS isolation test (tenant A cannot read B); idempotency test (duplicate `idempotency_key` rejected); round-trip persistence test (create → restart → still there). 
**Disjoint from:** everything below (own files). **Blocks:** D2–D5.

### WAVE D2 — THE WAIT-FOR TRIGGER PRIMITIVE (time reused; event + condition added)

**What.** Make a commitment fire on clock T, signal E, or predicate P (G2).
**Build:**
- **time:** point the existing `reminders-dispatch.worker.ts` claim pattern (`status='scheduled' AND trigger_at<=now() FOR UPDATE SKIP LOCKED`) at `md_commitments WHERE trigger_kind='time' AND status='waiting'` — a sibling claim, not a rewrite. Flips `waiting→due`.
- **event:** a `WaitForEvaluator` subscriber that, on a `LedgerService.post()` post-commit credit hook, a settlement-webhook handler, or a `blackboard-slots-wiring.ts` `SLOT_DELTA` stale-flip, flips matching `trigger_kind='event'` commitments `waiting→due` (idempotent — webhooks are at-least-once).
- **condition + deadline fallback:** evaluate `trigger_predicate` against the situational model each tick (wired in D3); `trigger_deadline` is the always-on fallback timer so silence still surfaces.
**Verify:** unit tests for each trigger class; a restart-persistence proof for the time path (claim survives worker restart); an idempotent-event test (double-delivered webhook flips once).
**Depends on:** D1. **Disjoint from:** D4 (different files).

### WAVE D3 — THE RECONCILE LOOP IN ESTATEMIND (the never-drop-a-thread sweep)

**What.** EstateMind re-reads ALL open commitments each tick, advances due/overdue, re-opens unconfirmed (G4).
**Build:**
- A `ReconciliationPort` added to `EstateMindDeps` (`packages/central-intelligence/src/kernel/estate-mind/types.ts`) and a RECONCILE step in `estate-mind.ts` between ORIENT and PROPOSE (per the §2.3 algorithm), keeping the never-throws / idempotent / degraded-safe contract.
- The port reads/writes via the D1 `CommitmentRepository`, runs the D2 `WaitForEvaluator` (including the condition-predicate eval), and emits the due/overdue set into the existing `proposalSink` so it lands in the cockpit + the resumption-brief `awaiting_approval`/`escalation` buckets.
- Host the sweep on the **existing** `proactive-wiring.ts` delivery cadence (`runDeliveryOnce`) — `withTenantContext` GUC per tick already provided.
**Verify:** a tick test proving an overdue commitment is surfaced; a re-open test (a `confirmed`-pending item with no proof re-opens); a someday/maybe cadence test (parked item surfaced for review, never auto-fired).
**Depends on:** D1, D2. **Disjoint from:** D4.

### WAVE D4 — THE REMINDER LADDER + ESCALATION (graduated reach, gated on ack)

**What.** Compose the existing dispatchers into an escalating ladder with safe-halt (G3).
**Build:**
- A pure `LadderEngine` (`services/api-gateway/src/composition/md-commitments/ladder-engine.ts`): `(commitment, prefs, clock) → { rung, dispatcher }` per the §2.4 rung map, advancing a rung only on no-ack within the risk-tiered SLA.
- Compose the live rungs: `publishCockpitEvent` (0), `user-followup` channel dispatchers + quiet-hours (1–3), `reminders` SMS quiet-hours path (2), `mwikila_actions_inbox` insert with `proposal_ttl_at` (3 / **safe-halt for sovereign**), `mining_escalations` insert (4).
- Called from the D3 RECONCILE step; records `ack_at` / `last_surfaced_at`.
**Verify:** a ladder-progression test (no-ack climbs rungs); a **sovereign safe-halt test** (a sovereign commitment NEVER auto-actuates on TTL expiry — it surfaces + waits + escalates); a quiet-hours test (SMS deferred at night, no rung consumed).
**Depends on:** D1, D3. **Disjoint from:** D2.

### WAVE D5 — CLOSE THE LOOP: CONFIRM + AUDIT + LEARN

**What.** Close only on positive proof; re-open if unconfirmed; write closure to the chain; learn (G6).
**Build:**
- The confirm step in the D3 RECONCILE port (§2.5): on dispatch, set a confirmation `WaitFor`; on positive proof set `confirmed_at` + write a hash-chained closure row; on confirmation-deadline-without-proof **re-open**.
- The closure writer reuses the `mwikila_actions_inbox` `audit_chain_hash` stitching (or the work-cycle journal chain).
- The learning write: capture owner override/abandon/reschedule into the cognitive-reinforcement / memory-v2 sink already wired into the brain turn.
**Verify:** an end-to-end closed-loop test (defer → wait-for-event → due → remind → escalate → owner-acts → confirm-event → `confirmed` + closure row); an **unconfirmed-re-open test** (filing claimed but no regulator ack → commitment re-opens, never silently closes); an honest-status test (status is never `confirmed` without proof). Flip `BORJIE_MD_COMMITMENTS` ON behind a canary.
**Depends on:** D1–D4. **Closes:** the loop — the capability is live and lossless.

### Parallelism + closure

- **D1 first, alone** (the store everything reads). D2 and D4 are mutually disjoint by file (trigger evaluator vs ladder engine) and can be built in parallel once D1 lands; D3 depends on both D1+D2; D5 depends on D1–D4.
- **Done = the closed loop runs on a live path:** a deferral created in chat survives a worker restart, fires on its real trigger, climbs the ladder gated on ack, escalates a sovereign overdue to a safe-halt (never auto-fires), and closes only on confirmed proof (else re-opens) — every transition hash-chained, evidence-bearing, bilingual, tenant-scoped, budget-aware, kill-switch-fail-closed. The audit's "scattered, not coherent" finding is retired: the deferral / TODO / do-later logic is **one organ** — prospective memory + the closed loop, fused.

---

## SOURCES

**Prospective / agent memory (the named gap — confirmed June 2026)**
- *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers* — arXiv:2603.07670 — https://arxiv.org/html/2603.07670v1 (five mechanism families, all retrospective; prospective memory absent; write→manage→read loop)
- *From Recall to Forgetting: Benchmarking Long-Term Memory for Personalized Agents* — arXiv:2604.20006 — https://arxiv.org/html/2604.20006v1
- ICLR 2026 Workshop *Memory for LLM-Based Agentic Systems (MemAgents)* — https://openreview.net/pdf?id=U51WxL382H (temporal decoupling; time-bounded supersedable facts as the gap)
- *A Survey on the Security of Long-Term Memory in LLM Agents* — arXiv:2604.16548 — https://arxiv.org/html/2604.16548v1
- *A Practical Guide to Memory for Autonomous LLM Agents* — Towards Data Science — https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/

**Task-ledger / recitation (holds the goal)**
- *Magentic-One: A Generalist Multi-Agent System* — arXiv:2411.04468 — https://arxiv.org/html/2411.04468v1 (dual ledger; stall-counter re-plan = backlog reconciliation)
- *Microsoft Agent Framework — Magentic orchestration* — https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic
- *Todo Lists* — Claude Agent SDK Docs (TaskCreate/Update/Get/List) — https://code.claude.com/docs/en/agent-sdk/todo-tracking
- *Context Engineering for AI Agents: Lessons from Building Manus* — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus (recitation; filesystem-as-memory; keep-the-wrong-stuff-in)

**Durable execution / scheduled + event + wait-for-condition (brings it back losslessly)**
- *Human-in-the-Loop AI Agent* — Temporal Platform Docs — https://docs.temporal.io/ai-cookbook/human-in-the-loop-python (Signals + `workflow.sleep` durable timers + `wait_condition`)
- *Durable Execution for LLM Agents 2026: Temporal + LangGraph* — AppScale — https://appscale.blog/en/blog/durable-execution-llm-agents-temporal-langgraph-checkpointing-2026 (idle-pending cost cut 60–80%; replay-safety + idempotency)
- *Temporal and the 2026 Shift to Durable Agentic Workflows* — Olmec Dynamics — https://olmecdynamics.com/news/temporal-durable-execution-agentic-workflows-2026
- *Temporal hits 3,000 paying customers* — The New Stack — https://thenewstack.io/temporal-durable-execution-ai-workflows/ ($300M Series D, $5B; OpenAI/Replit/Lovable on Temporal)
- *Durable Execution: The Key to Harnessing AI Agents in Production* — Inngest — https://www.inngest.com/blog/durable-execution-key-to-harnessing-ai-agents
- *Checkpoints Are Not Durable Execution* — Diagrid — https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows

**GTD for agents (the taxonomy + review cadence)**
- *Getting Things Done (GTD): David Allen's Method Explained (2026)* — alfred_ — https://get-alfred.ai/glossary/getting-things-done
- *cc-gtd: Get Things Done with Claude Code* — GitHub — https://github.com/adagradschool/cc-gtd (inbox/waiting-for/someday-maybe/calendar files + weekly review; lacks an automated trigger engine)

**Reminder ladder / escalation / HITL closure (drives it to a decision)**
- *Human-in-the-Loop: A 2026 Guide to AI Oversight* — Strata — https://www.strata.io/blog/agentic-identity/practicing-the-human-in-the-loop/ (risk-tiered SLAs)
- *Human-in-the-loop patterns* — Cloudflare Agents Docs — https://developers.cloudflare.com/agents/guides/human-in-the-loop/
- *Human-in-the-Loop AI Agents: Approvals, Escalation, Safe Autonomy in Production* — Medium (Apr 2026) — https://medium.com/@arvisionlab/human-in-the-loop-ai-agents-how-to-add-approvals-escalation-and-safe-autonomy-in-production-0a21e359781c

**Sleep-time / background reconciliation (the night-shift sweep)**
- *Sleep-time agents* — Letta Docs — https://docs.letta.com/guides/agents/architectures/sleeptime/

**Borjie substrate (read this session, with exact seams)**
- `packages/database/src/migrations/0089_owner_reminders_and_tabs.sql`, `0303_reminders_retry_attempt_count.sql`, `0156_…reminders…rls…`, `0129_mwikila_actions_inbox.sql`, `0080_mining_tasks_toolbox.sql`, `0081_mining_escalations_approvals.sql`, `0319_blackboard_slots.sql`, `0312_memory_v2_durable_stores.sql`
- `services/api-gateway/src/workers/reminders-dispatch.worker.ts` (the resume-driver poll + retry ladder + quiet-hours)
- `services/api-gateway/src/composition/proactive/proactive-wiring.ts` (+ `proactive-delivery.ts`) — the tick host + idempotent delivery
- `packages/central-intelligence/src/kernel/estate-mind/{estate-mind,types}.ts`, `…/motivation/default-drives.ts` (the Slow Loop + standing drives: cash-runway, licence-currency, safety, offtake-coverage, royalty-currency)
- `packages/work-cycle/src/types.ts`, `…/state/state-repository.ts`, `…/resumption/resumption-brief.ts` (pending_threads + the journal + the resumption buckets)
- `packages/user-followup/src/scheduler/followup-scheduler.ts` (the channel ladder + quiet-hours + caps + audit)

# Brain Deferral / Prospective-Memory & Closed-Loop Follow-Through — SOTA Dossier

**Lane:** `prospective-memory-and-closed-loop-SOTA`
**Date:** 2026-06-09
**Status:** READ-ONLY research. No code edits. Survey of the 2026 state-of-the-art
for giving an autonomous agent reliable **deferred-action / prospective memory**
so it *never forgets to come back to a task*, mapped against the Borjie substrate
that already exists.

> Owner directive: *"OUR BRAIN SHOULD HAVE THE DEFERRED / TODO / DO-LATER LOGIC."*
> A real Managing Director cannot do everything at once. It **defers** ("handle
> after the licence renewal"), keeps a durable **backlog**, **schedules**
> (time- AND event-triggered), runs a **reminder ladder**, **escalates** if
> undone, **follows through to closure** (confirms done), and **never drops a
> thread**. This is *prospective memory* + the *closed loop*:
> `detect → schedule → remind → channel-route → escalate → follow-through →
> confirm → audit → learn`. The brain proactively resurfaces deferred items
> when relevant (EstateMind).

**Scope distinction (do not conflate):** this is a **product capability** of the
brain (Mr. Mwikila remembering to act later on the owner's estate). It is *not*
about source-code TODO/deferred debt; the codebase separately carries no such
debt. This dossier is about the *capability*.

---

## 0. The one-paragraph thesis

The 2026 consensus is blunt: **LLMs have no native prospective memory.** A model
that is not currently being prompted about a commitment will not act on it — there
is no "wake me at T" or "wake me when condition C holds" inside the weights or the
context window. Every reliable deferred-action system in production therefore
externalises the commitment into a **durable store** and pairs it with a
**driver loop** (cron + event + a wait-for-condition primitive) that re-presents
the commitment to the agent at the right moment. The retrospective-memory
literature (RAG, episodic stores, reflection) explicitly **does not cover this**:
the leading 2026 survey, *Memory for Autonomous LLM Agents* (arXiv:2603.07670),
enumerates five mechanism families — context-resident compression,
retrieval-augmented stores, reflective self-improvement, hierarchical virtual
context, policy-learned management — and **none** address remembering to perform
an action at a future time or on a future event. Prospective memory is the named
gap. The SOTA fills it with four cooperating pillars: (1) an explicit, re-read
**task ledger**; (2) **durable scheduled + event-triggered wakeups**; (3) a
**reminder-ladder + escalation** policy; and (4) **never-drop-a-thread
reconciliation** that sweeps open commitments every cycle and closes the loop.

---

## 1. PROSPECTIVE MEMORY for agents — remembering to act in the future

**Definition (cognitive-science origin).** Prospective memory = remembering to
perform an intended action at a future point. Two trigger classes, both load-bearing
for an MD:

- **Time-based** — "file the royalty return on the 7th." Fires on a clock.
- **Event-based** — "the moment the buyer's settlement lands, release the
  consignment." Fires on a state change / external signal.

**Why LLM agents fail at it without an external store.** The 2026 memory survey
(arXiv:2603.07670) frames agent memory as a *write → manage → read* loop coupled
to perception and action — but treats *all* of working/episodic/semantic/procedural
memory as mechanisms for accessing the **past**. There is no organ for "act in the
future." Empirically, 2026 long-term-memory benchmarks show the failure is
structural, not a tuning issue:

- *From Recall to Forgetting* (arXiv:2604.20006) and **MemoryAgentBench** probe
  retrieval, test-time learning, long-range understanding, and **selective
  forgetting** — and report systems "fail conspicuously" on the temporal/causal
  competencies that prospective memory depends on. Pure RAG over a vector store is
  "structurally incapable of forgetting," so stale commitments are retrieved and
  misused; *memory inclusion* is rewarded while *memory misuse* (acting on
  obsolete intent) is ignored.
- The blunt production summary (sitepoint *New Reality of Agent Memory*, 2026):
  "Agents that forget instructions mid-task … gradually degrade over long sessions
  are not edge cases — they are the **default outcome** when memory is treated as
  an afterthought."

**Consequence for design.** A commitment that lives only in context evaporates at
the next compaction or session boundary. The only reliable design is: **persist the
intention as a first-class row, with its trigger, the moment it is formed**, and let
an external loop bring it back. The LLM is the *reasoner about* commitments; it is
never the *store of* commitments.

**Mining-MD framing.** "Defer the royalty filing until funds land" is an
**event-based** commitment whose trigger is a ledger credit; "renew the PML before
expiry" is a **time-based** commitment with a deadline. Both must survive a worker
restart, a week of owner silence, and a model-context reset — i.e. they live in
Postgres, not in a prompt.

---

## 2. Agentic TODO / TASK-LEDGER patterns — the re-read pending/done list

The dominant pattern for in-flight goal-holding is an **explicit, externalised task
list the agent re-reads (and rewrites) each loop.** Three reference implementations:

### 2.1 Magentic-One dual ledger (Microsoft Research, arXiv:2411.04468)
The Orchestrator runs **two nested loops over two ledgers**:

- **Task Ledger (outer loop)** — facts given/verified, facts to look up, facts to
  derive, and educated guesses, plus the plan. Pre-populated on task receipt; the
  outer loop **rebuilds it and re-plans** when progress stalls for N steps.
- **Progress Ledger (inner loop)** — current progress, who is assigned what, and a
  self-reflective "is the task complete?" check at *every* step. If not complete, it
  assigns the next subtask.

The key prospective-memory property: the agent **does not trust its own context** to
hold the plan — it externalises plan + progress into ledgers it re-reads each turn,
and a stall-counter forces re-planning rather than silent drift. This is the
canonical "dual-ledger" shape for a long-running estate brain.

### 2.2 Claude Agent SDK structured task tools
Anthropic's Agent SDK (and Claude Code) replaced the single `TodoWrite` with
**structured `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList`** (TS SDK
0.3.142+, Claude Code v2.1.142): each item is created individually, each status
change is an explicit update, and the model reads the list back via `TaskList`.
Anthropic's own guidance ("Building agents with the Claude Agent SDK") frames the
agentic loop as plan → act → evaluate → continue, with the todo list as the durable
spine that "keeps the model and the user informed of task progression." The split
into discrete create/update calls is exactly so each transition is an auditable
event, not a blob rewrite.

### 2.3 Manus "recitation" (Context Engineering for AI Agents, manus.im, 2026)
The most-cited production lesson on holding a goal across a long run. A Manus task
averages **~50 tool calls**; over that span attention drifts and the model gets
"lost in the middle." Manus's fix: **continuously rewrite a `todo.md` and append it
to the END of the context** — "by constantly rewriting the todo list, Manus is
reciting its objectives into the end of the context," pushing the global plan back
into the model's recent attention window without any architecture change.
Companion lessons that matter for deferral:
- **Filesystem as externalised memory** — unlimited, restorable (drop the page body,
  keep the URL) — the same logic that says "store the commitment durably, page it in
  on demand."
- **Keep the wrong turns in** — leaving failed actions + error messages in context is
  *implicit negative feedback*; recovery, not reset, is what makes an agent agentic.
  For a closed loop this argues for retaining *why a deferred action failed* so the
  next attempt is smarter.

**Synthesis for the brain.** The task-ledger pillar gives the brain a **structured,
re-read, append-only backlog** (Magentic-One's discipline + the SDK's
event-per-transition + Manus's recitation-into-attention). For an estate MD this is
the "open commitments" list that the Slow Loop recites at the top of every tick so a
royalty deadline three weeks out is never out of mind.

**Mining-MD framing.** A single offtake deal spawns a small ledger: *facts*
(grade, tonnage, buyer KYC tier), *next-action* (await settlement), *waiting-for*
(buyer wire), *done* (assay confirmed). The brain re-reads this each cycle and
re-plans if the wire is late — exactly Magentic-One's stall-driven re-plan.

---

## 3. DURABLE deferred actions — scheduled + event-triggered + wait-for-condition

This is the **execution backbone**: the thing that actually brings a commitment
back at T or on event E and survives crashes/restarts. 2026 SOTA = **durable
execution**, and the reference platforms are Temporal, Inngest, Restate, and
LangGraph's checkpoint/interrupt model.

### 3.1 Temporal — timers, signals, and the durability spine
Temporal records every step as an **immutable event history**; if the worker dies at
step 47 of 100 it **replays the log and resumes at 48**, not 1. Three primitives map
directly onto prospective memory:
- **Durable timers** — `workflow.sleep(...)` is wired into Temporal's timer system;
  a worker restart mid-wait replays history and the remaining wait **continues from
  where it left off**. This is time-based prospective memory that cannot be lost.
- **Signals** — an external event is delivered into a *running* workflow that is
  blocked waiting; it "waits hours or days, and continues." This is event-based
  prospective memory + the human-in-the-loop approval wait.
- **The split** — deterministic *workflow* code sequences the plan; non-deterministic
  *activities* wrap LLM calls / tool calls / API requests. This is the clean mapping
  every 2026 durable-agent piece converges on.

2026 traction is real: Temporal raised a **$300M Series D at a $5B valuation
(Feb 2026, a16z-led)**; OpenAI, Replit, and Lovable build agents on it; ADP uses it
for human-in-the-loop agentic processes.

### 3.2 The "waiting-for" / resume-driver pattern (the durable poller)
Across LangGraph, Inngest, and event-sourced stacks, the common shape for
event/time wakeup is a **resume driver that polls the checkpoint store**:
`WHERE status='waiting' AND wake_at <= now()` → resume each due thread by id,
strictly sequentially. This "decouples agent lifetime from process lifetime." It is
exactly the shape Borjie already runs in `reminders-dispatch.worker.ts`
(`status='scheduled' AND trigger_at <= now()`). LangGraph's `interrupt()` treats
**pause-for-a-human and pause-for-a-clock as the same primitive** — the machinery
that waits four days for a person is the machinery that waits for a timer — and the
held draft is **checkpointed state, not a blocked thread**, so a deploy/restart
doesn't lose it. Diagrid's 2026 piece ("Checkpoints Are Not Durable Execution")
sharpens the distinction: a checkpoint that only snapshots state is **not** the same
as an append-only execution log that can deterministically replay — the latter is
what makes a deferred wakeup *truly* lossless.

### 3.3 The wait-for-condition primitive
Beyond `sleep(T)` and `signal`, the SOTA wants **`await_condition(predicate)`** —
block until a business predicate holds (funds ≥ filing amount; assay status =
confirmed; licence age < threshold). Temporal expresses this via signal-driven
condition waits; event-sourced stacks express it as a derived projection that flips
a `waiting` row to `due`. For an MD this is the difference between "remind me about
the royalty on the 7th" (timer) and "act on the royalty **the moment the buyer's
money clears**" (condition) — the second is strictly more valuable and strictly
harder, and is where most home-grown reminder systems fall short.

**Mining-MD framing.** *Defer royalty filing till funds land* = a condition wait on
a `LedgerService.post()` credit event; *follow up an offtake confirmation* = a signal
wait on the buyer's settlement webhook with a timer fallback; *escalate an overdue
licence renewal* = a durable timer at `expiry − 90/60/30/7 days` whose firing is
replay-safe across any worker restart.

---

## 4. GTD / tickler-file applied to agents — defer, someday/maybe, next-action, review

GTD supplies the **vocabulary and the review cadence** that turn a pile of deferred
rows into a disciplined system. The 2026 "GTD + AI" literature (get-alfred.ai
glossary; WorkBeaver; the open-source `adagradschool/cc-gtd` Claude system) maps the
buckets cleanly onto agent stores:

| GTD construct | Meaning | Agent realisation |
|---|---|---|
| **Inbox** | raw capture, unprocessed | append-only capture row; auto-process the obvious, queue the ambiguous |
| **Next-action** | the single physical next step | the one actionable item per thread the loop will actually do |
| **Waiting-for** | delegated / expected-from-someone | event-based commitment keyed to an external signal (buyer wire, manager reply) |
| **Tickler / calendar** | surfaces on a specific future date | time-based commitment with `trigger_at`; the durable timer |
| **Someday/maybe** | not committed now; revisit later | low-urgency backlog reviewed on cadence, never auto-fired |
| **Weekly review** | reconcile everything, nothing rots | the **reconciliation sweep** (§6) — the heartbeat that re-reads all open commitments |

The cc-gtd system keeps `inbox.md`, `waiting-for.md`, `someday-maybe.md`,
`calendar.md` as separate files and runs a **weekly review** to keep inbox at zero;
its weakness (noted in our fetch) is that it lacks an *automated* trigger engine —
the resurfacing is manual. **The lesson:** GTD gives the right *taxonomy* and the
*review discipline*, but an agent must bolt on the durable scheduler of §3 to make
the tickler fire by itself. The 2026 "GTD + AI" thesis: *"GTD gives you the map; AI
automation supplies the engine."* The AI also does the triage GTD humans dread —
classifying each captured item as reference / someday-maybe / next-action — which is
where the volume that "GTD can't handle" gets absorbed.

**Mining-MD framing.** "Open a second wash-plant next dry season" is **someday/maybe**
(reviewed quarterly, never auto-fired); "PML renewal" is **tickler** (dated);
"awaiting EPA effluent permit response" is **waiting-for** (event); the **weekly
review** is the Slow-Loop sweep that guarantees none of them silently rots.

---

## 5. REMINDER LADDER + ESCALATION + follow-through-to-closure

A deferred item that fires *once* and is ignored is still a dropped thread. The SOTA
closed loop adds a **graduated reminder ladder, an escalation path, and an explicit
confirm-done step.** The 2026 human-in-the-loop literature (Strata; Cloudflare Agents
HITL docs; Orkes; multiple Medium HITL pieces) converges on:

- **Risk-tiered SLAs.** Match the wait/timeout to the stakes: ~15-second lanes for
  low-risk, ~2-minute lanes for PII access, ~15-minute lanes for financial
  disbursement. The reminder cadence scales with urgency (e.g. 24h timeout + 8h
  reminders for low-urgency; 5-min timeout + 2-min reminders for critical).
- **Reminder ladder** — multi-channel, escalating cadence and reach: in-app →
  email → SMS/WhatsApp → call/owner-direct, each rung firing only if the prior rung
  produced no acknowledgement, with quiet-hours respected on the intrusive channels.
- **Escalation ladder + abort criteria** — when an approver misses the SLA, a
  *defined fallback* fires: escalate to the next level, or **safe-halt** (never
  silently auto-proceed on a sovereign/money action). "Define the escalation ladder,
  mission, roles, and abort criteria" is the recurring checklist.
- **Closed-loop confirmation + learning** — timestamp when a decision is produced and
  when reviewed; **alert when an SLA breach is imminent**; and **capture every human
  correction** to evaluate the next agent version. Closure is not "I sent the
  reminder" — it is "the action is confirmed done (or explicitly abandoned), recorded
  in the audit chain."

**Follow-through-to-closure is the part most systems skip.** Detection + scheduling
is easy; the hard, high-value behaviour is the agent **coming back to verify the
thing actually happened**, re-opening the commitment if it didn't, and only marking
`done` on positive confirmation. This is the difference between a reminder app and a
Managing Director.

**Mining-MD framing.** Licence renewal ladder: T-90d in-app nudge → T-60d email →
T-30d SMS + owner-direct → T-7d **escalate to owner with safe-halt** (the brain will
NOT auto-file a sovereign licence action; it surfaces and waits). After the owner
files, the brain **follows through**: confirms the regulator acknowledgement landed,
then closes the commitment and writes the closure to the hash-chained audit trail.
An unconfirmed renewal re-opens automatically.

---

## 6. "NEVER DROP A THREAD" — durability + reconciliation every cycle

The capstone property: **every commitment is persisted and reconciled each loop**, so
nothing is lost to a crash, a context reset, or owner silence. SOTA components:

- **Durable execution as the floor** — append-only event-sourced state (Temporal /
  Inngest / Restate / event-sourced Postgres). "An append-only record of every action
  the agent has taken, every tool-call result, and every state transition." Diagrid's
  point stands: **checkpoints ≠ durable execution**; only a replayable log guarantees
  a deferred wakeup survives a mid-wait deploy.
- **Reconciliation sweep (the agentic "weekly review")** — on a cadence the agent
  **re-reads ALL open commitments**, recomputes which are now due / overdue / blocked,
  advances each one rung on its ladder, and re-plans stalled threads (Magentic-One's
  stall-driven re-plan generalised to the whole backlog). This is the loop that makes
  "lossless" true in practice: a thread can only be closed by confirmation, never by
  forgetting.
- **Idempotent resurfacing** — re-presenting a commitment must not double-fire
  (stamp `last_surfaced_at`; unique idempotency key; `dispatched_at IS NULL` guards) —
  Borjie already does this in the proactive scheduler + reminders worker.
- **Sleep-time / background reflection** (Letta / MemGPT sleep-time agents) — when no
  user message is pending, a background heartbeat reorganises memory, consolidates,
  and can surface what now deserves attention. Triggered every N steps (default 5) or
  on idle. For an MD this is the night-shift that, while the owner sleeps, re-reads the
  backlog and stages tomorrow's nudges.

**Mining-MD framing.** Whatever happens — gateway redeploy, model context reset, the
owner offline for a week on a remote site with no signal — **every** open commitment
(royalty filing, three offtake follow-ups, two licence renewals, a deferred plant
order) is still in Postgres, still on its ladder, and the next reconciliation sweep
picks each one up exactly where it left off. That is "never drop a thread."

---

## 7. The SOTA reference architecture (synthesised)

```
                        ┌──────────────────────────────────────────┐
   DETECT (a commitment │ Sources: chat ("handle after renewal"),  │
   is formed)           │ EstateMind drives, kernel proactive_nudge,│
                        │ tool results, blackboard stale slots      │
                        └───────────────┬──────────────────────────┘
                                        ▼
   PERSIST  ──────────►  COMMITMENT LEDGER (durable, append-only, RLS)
   (first-class row)     { id, thread_id, kind, next_action, status,
                           trigger: {kind: time|event|condition, at|on|predicate},
                           ladder_rung, channel_policy, evidence_ids,
                           last_surfaced_at, confirmed_at, audit_hash }
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
   SCHEDULE (timer)         AWAIT (event/condition)      REVIEW (someday/maybe)
   trigger_at<=now()        signal / projection flip     cadence sweep
              └─────────────────────────┼──────────────────────────┘
                                        ▼
   RESURFACE (idempotent) ─► REMIND (ladder rung: in-app→email→SMS→owner)
                                        │  no ack?
                                        ▼
   ESCALATE (next rung / safe-halt; never auto-fire sovereign/money)
                                        ▼
   FOLLOW-THROUGH ─► CONFIRM done? ──no──► re-open commitment (back on ladder)
                                        │ yes
                                        ▼
   AUDIT (hash-chained closure) ─► LEARN (capture correction → next version)
                                        ▲
   RECONCILE every cycle ──────────────┘  (re-read ALL open commitments;
                                           nothing closed except by confirmation)
```

The four pillars: **(1)** task-ledger discipline (Magentic-One / Claude SDK / Manus
recitation) holds the goal; **(2)** durable scheduled+event wakeups (Temporal-class)
bring it back losslessly; **(3)** reminder-ladder+escalation (HITL SLAs) drives it to
a human decision when needed; **(4)** reconciliation+confirmation (never-drop-a-thread)
closes the loop and proves it never forgot.

---

## 8. Borjie substrate — what ALREADY exists (and is reusable)

The owner is right that pieces exist. Inventory of the present substrate, with the
exact role each would play in a deferral/closed-loop capability:

| Pillar | Existing Borjie substrate | What it already provides | Gap to full capability |
|---|---|---|---|
| **Durable timer / dispatch** | `reminders` table (mig **0089**) + `reminders.attempt_count` (mig **0303**) + `reminders-dispatch.worker.ts` | The canonical `status='scheduled' AND trigger_at<=now()` resume-driver poll; atomic claim via `UPDATE…RETURNING … SKIP LOCKED`; **MAX_ATTEMPTS=5 exponential backoff**; idempotency via UNIQUE key + `dispatched_at IS NULL`; quiet-hours deferral for SMS; multi-channel (email/SMS/Slack). RLS repointed to `app.current_tenant_id` (mig **0156**). | Time-based only — **no event/condition trigger**; no ladder concept (flat retry, not escalating reach); reminder ≠ commitment with a confirm-done loop. |
| **Proactive scheduler** | `services/api-gateway/src/composition/proactive/` (`proactive-wiring.ts`, `proactive-delivery.ts`, `suggester-adapters.ts`) + `tab_proposals_inbox`, `tab_event_log` (`proactive_nudge`) | Two cadences on one supervisor (SIGNAL 5min, DELIVERY 1h); per-(tenant,owner) tick; **idempotent delivery** via `last_surfaced_at`; drains kernel `proactive_nudge` rows to the cockpit tray; `withTenantContext` SET LOCAL GUC per tick; degraded-safe + Pino-only. | Surfaces *suggestions/nudges*, not *tracked commitments*; no durable backlog table; no ladder/escalation; fires on cadence, not on a per-item trigger. |
| **Task ledger (in-flight)** | `@borjie/work-cycle` — `work_cycle_state.pending_threads` (slow-burn list) + append-only `work_cycle_journal` + `resumption-brief.ts` (MemGPT-style paging, arXiv:2310.08560) | **This is the closest existing analogue to a re-read task ledger.** `pending_threads` is literally the open-thread list; the journal is the append-only spine; the resumption brief buckets `requires_owner_attention` → `awaiting_approval` and `t2-critical`/`escalation` → escalations; deterministic, token-budgeted. Cadence modes (active/idle/night/observe). | `pending_threads` has no per-thread trigger/ladder/confirm fields; the journal records ticks, not commitment lifecycle; no event-based wakeup. |
| **Slow loop / motivation** | `@borjie/central-intelligence` EstateMind (`estate-mind.ts`) + motivation (`motivation-engine.ts`, `default-drives.ts`) | PERCEIVE→ORIENT→**MOTIVATE**→PROPOSE→FORGET cycle; standing drives self-formulate goals with no incoming trigger; durable via situational model; idempotent proposal sink dedups by stable id. **This is the engine that should resurface deferred items proactively.** | Drives formulate *new* goals from current salience; they do **not** read a durable commitment backlog and advance it. EstateMind is the natural host for the reconciliation sweep but doesn't do it yet. |
| **Follow-up + escalation** | `@borjie/user-followup` (`followup-scheduler.ts`, candidate repo `scheduled_for<=now AND status='pending'`, quiet-hours, channel dispatchers, audit port) + `@borjie/employee-perf-followup` (kpi/nudge/tier/score/scheduler/audit) | Deterministic scheduler; channel routing with allowed-channels + quiet-hours + per-day caps; suppression records; audit-chain port. **The closest existing reminder-ladder substrate.** | Single-shot follow-up, not a *graduated escalating ladder* tied to a commitment's confirm-done state; scoped to user/employee follow-ups, not estate commitments. |
| **Escalation table** | `mining_escalations` (mig **0081**), status `open→acknowledged→resolved`, severity, manager↔worker↔owner chain | Real escalation lifecycle + addressee routing + hot-path index. | Human-raised escalations, not auto-fired from an overdue deferred commitment. |
| **Action inbox (HITL + TTL)** | `mwikila_actions_inbox` (mig **0129**): `proposed→owner_approved/denied→executed→reversed/committed`, **`proposal_ttl_at` + `mwikila_actions_inbox_ttl_due_idx`**, reversal window, delegation tiers, bilingual rationale | **Already has time-bounded HITL with TTL expiry and a due-index** — the safe-halt/expire half of an escalation ladder. `license.renewal_reminder`, `royalty.monthly_filing_prep` are first-class `action_kind`s. Closest thing to the "escalate to owner, safe-halt on sovereign action" rung. | TTL expires an action; it does not *escalate up a ladder* or *re-open and follow through* on expiry. |
| **Durable steps / approval** | `@borjie/workflow-engine` — start→propose→review→(AI)→human-approval→commit/reject/cancel; append-only `WorkflowRunEvent` + per-tenant hash-chained audit | Durable, auditable multi-step state machine with a **human-approval wait** — Borjie's nearest Temporal-signal analogue for HITL. | Not wired as a wait-for-condition / durable-timer backbone for arbitrary deferred commitments. |
| **Durable memory** | cognitive-memory / memory-v2 (mig 0312) + blackboard CRDT slots (mig 0319, open/stale slots) | Durable per-tenant memory + a slot model whose **stale slots** are a ready signal for "this thread has gone quiet." | Retrospective; not a prospective-commitment store. |
| **Mining tasks** | `mining_tasks` (mig **0080**): status `pending/in_progress/done/blocked/cancelled`, **`due_at`**, assignee/site indexes; `mining_toolbox_talks.scheduled_for` | A real task table with due dates + blocked-reason. | Human-assigned operational tasks, not the brain's own deferred-commitment ledger. |

### What the substrate proves
Borjie already has **every primitive** the SOTA names — a durable timer-dispatch
poller (reminders), idempotent resurfacing (proactive), an in-flight re-read thread
list (work-cycle `pending_threads` + journal + resumption brief), a self-motivating
slow loop (EstateMind), reminder-ladder material (user/employee follow-up + quiet
hours + channels + audit), an escalation lifecycle (`mining_escalations`), and
time-bounded HITL with TTL (`mwikila_actions_inbox`). They are **disconnected
fragments**, not a single **commitment ledger** with one lifecycle.

### The shape of the gap (capability, not code-debt)
1. **No unified COMMITMENT LEDGER** — one durable, append-only, RLS-scoped table
   that is the single home for every deferred MD commitment (the `next-action`,
   the `waiting-for`, the `tickler`, the `someday/maybe`), with a trigger
   (time|event|condition), a ladder rung, a channel policy, evidence ids, and a
   `confirmed_at`. Today the concept is smeared across reminders / pending_threads /
   mwikila_actions_inbox / mining_tasks.
2. **No event/condition trigger** — only time-based `trigger_at`. "Act when funds
   land" / "act when the assay confirms" has no first-class wakeup. (`LedgerService.post`
   credits and webhooks exist as *sources*; nothing subscribes a commitment to them.)
3. **No graduated reminder ladder** — flat exponential **retry** exists, but not an
   **escalating reach** ladder (in-app→email→SMS→owner) gated on acknowledgement.
4. **No reconciliation sweep that closes the loop** — EstateMind formulates *new*
   goals but does not re-read open commitments, advance their ladders, and re-open
   unconfirmed ones. Closure-by-confirmation is not enforced anywhere.
5. **No "someday/maybe" review cadence** — nothing distinguishes a committed dated
   item from a parked idea reviewed quarterly.

---

## 9. Recommendations for the capability (build order)

> Read-only lane — these are *recommendations*, not changes. Ordered to reuse the
> substrate above and minimise new surface.

1. **Define one COMMITMENT LEDGER** (new migration; RLS FORCE; append-only lifecycle)
   as the single source of truth. Model it on `mwikila_actions_inbox`'s
   tier/TTL/audit discipline + `mining_tasks`'s `due_at` + work-cycle's
   `pending_threads`. Fields: `kind`, `thread_id`, `trigger {time|event|condition}`,
   `next_action`, `status` (`open|waiting|due|reminded|escalated|confirmed|abandoned`),
   `ladder_rung`, `channel_policy`, `evidence_ids`, `last_surfaced_at`, `confirmed_at`,
   `audit_hash`. This is the GTD taxonomy collapsed into one table.
2. **Make EstateMind the reconciliation engine.** Add a sweep step to the Slow Loop
   that re-reads all `open|waiting` commitments, recomputes due/overdue, advances each
   one rung (reusing the user-followup ladder + quiet-hours + channel dispatchers),
   and **re-opens any `confirmed`-pending item that was never confirmed.** This is the
   "weekly review" / never-drop-a-thread sweep, and EstateMind's PERCEIVE→MOTIVATE
   structure is the natural host.
3. **Add an event/condition trigger.** Subscribe commitments to existing sources:
   `LedgerService.post()` credits (funds-landed), settlement webhooks (offtake),
   blackboard **stale-slot** flips (thread went quiet), and the situational model's
   salience. A small projection flips `waiting→due` — the §3.2 resume-driver pattern
   Borjie already runs for time, generalised to events.
4. **Promote reminders+follow-up into the ladder.** Keep `reminders-dispatch.worker`
   as the timer rung; layer the user-followup channel ladder (in-app→email→SMS→owner)
   gated on acknowledgement; route the top rung through `mwikila_actions_inbox`
   (safe-halt on sovereign/money) and `mining_escalations`.
5. **Enforce closure-by-confirmation + audit.** A commitment closes only on positive
   confirmation (regulator ack, ledger entry, owner approve), written to the
   hash-chained audit trail; otherwise it re-opens. Capture owner overrides as learning
   signal. (Honours the CLAUDE.md audit-chain + sovereign-safe-halt hard rules.)

---

## 10. Sources

**Prospective / agent memory (the named gap)**
- *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers* — arXiv:2603.07670 — https://arxiv.org/html/2603.07670v1 (five mechanism families; all retrospective; prospective memory absent)
- *From Recall to Forgetting: Benchmarking Long-Term Memory for Personalized Agents* — arXiv:2604.20006 — https://arxiv.org/html/2604.20006v1
- ICLR 2026 Workshop *Memory for LLM-Based Agentic Systems (MemAgents)* — https://openreview.net/forum?id=U51WxL382H
- *The New Reality of Agent Memory: Complete Guide (2026)* — SitePoint — https://www.sitepoint.com/ai-agent-memory-guide/
- *A Practical Guide to Memory for Autonomous LLM Agents* — Towards Data Science — https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/

**Task-ledger / recitation**
- *Magentic-One: A Generalist Multi-Agent System* — Microsoft Research / arXiv:2411.04468 — https://arxiv.org/pdf/2411.04468 ; https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/
- *Todo Lists* — Claude Agent SDK Docs (TaskCreate/Update/Get/List) — https://code.claude.com/docs/en/agent-sdk/todo-tracking
- *Building agents with the Claude Agent SDK* — Anthropic — https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- *Context Engineering for AI Agents: Lessons from Building Manus* — manus.im (recitation/todo.md; ~50 tool calls; filesystem-as-memory; keep-the-wrong-stuff-in) — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

**Durable execution / scheduled + event wakeup**
- *Temporal — Durable Execution* — https://temporal.io/ ; *The hero's journey to AI durability with Temporal* — https://temporal.io/blog/the-heros-journey-to-ai-durability-with-temporal
- *Temporal for AI Agents: Durable Execution Guide 2026* — Effloow — https://effloow.com/articles/temporal-ai-agents-durable-execution-guide-2026
- *Durable Execution in LangGraph* — Vadim's blog — https://vadim.blog/durable-execution-agents-that-survive-failure-and-resume-where-they-left-off
- *Durable execution* — LangChain/LangGraph Docs — https://docs.langchain.com/oss/python/langgraph/durable-execution
- *Checkpoints Are Not Durable Execution* — Diagrid — https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows
- *Durable Agent Execution in Production 2026: Temporal, LangGraph, Event-Sourced State* — AgentMarketCap — https://agentmarketcap.ai/blog/2026/04/10/durable-agent-execution-production-temporal-modal-event-sourced
- *Durable Execution: The Key to Harnessing AI Agents in Production* — Inngest — https://www.inngest.com/blog/durable-execution-key-to-harnessing-ai-agents

**GTD for agents**
- *Getting Things Done (GTD): David Allen's Method Explained (2026)* — alfred_ — https://get-alfred.ai/glossary/getting-things-done
- *The GTD Method Enhanced: Getting Things Done With AI Automation* — WorkBeaver — https://workbeaver.com/blog/the-gtd-method-enhanced-getting-things-done-with-ai-automation
- *cc-gtd: Get Things Done with Claude Code* — GitHub — https://github.com/adagradschool/cc-gtd

**Reminder ladder / escalation / HITL closure**
- *Human-in-the-Loop: A 2026 Guide to AI Oversight* — Strata — https://www.strata.io/blog/agentic-identity/practicing-the-human-in-the-loop/
- *Human-in-the-loop patterns* — Cloudflare Agents Docs — https://developers.cloudflare.com/agents/guides/human-in-the-loop/
- *Human-in-the-Loop in Agentic Workflows* — Orkes — https://orkes.io/blog/human-in-the-loop/
- *Human-in-the-Loop AI Agents: Approvals, Escalation, Safe Autonomy in Production* — Medium (Apr 2026) — https://medium.com/@arvisionlab/human-in-the-loop-ai-agents-how-to-add-approvals-escalation-and-safe-autonomy-in-production-0a21e359781c

**Sleep-time / background reconciliation**
- *Sleep-time agents* — Letta Docs — https://docs.letta.com/guides/agents/architectures/sleeptime/
- *Sleep-time Compute* — Letta blog — https://www.letta.com/blog/sleep-time-compute
- (MemGPT external-memory paging — Packer et al., arXiv:2310.08560 — referenced in work-cycle resumption-brief.ts)

**Borjie substrate (read this session)**
- `packages/database/src/migrations/0303_reminders_retry_attempt_count.sql`, `0156_…reminders…rls…`, `0089` (reminders), `0129_mwikila_actions_inbox.sql`, `0080_mining_tasks_toolbox.sql`, `0081_mining_escalations_approvals.sql`
- `services/api-gateway/src/workers/reminders-dispatch.worker.ts`
- `services/api-gateway/src/composition/proactive/proactive-wiring.ts` (+ `proactive-delivery.ts`, `suggester-adapters.ts`)
- `packages/work-cycle/src/types.ts`, `…/state/state-repository.ts`, `…/resumption/resumption-brief.ts`
- `packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts`, `…/motivation/{motivation-engine,default-drives}.ts`
- `packages/user-followup/src/scheduler/followup-scheduler.ts`, `…/types.ts`; `packages/employee-perf-followup/src/*`
- `packages/workflow-engine/src/index.ts`

# Continuous 24/7 Work Cycle — Design Specification

> Wave M1 (Pillar A of [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md)).
> Mandate: while the owner sleeps, Mr. Mwikila keeps running — anticipatory
> sweeps, telemetry review, tomorrow's briefing draft, price/regulator
> watchers, slow-burn investigations. Each tick is journaled.
> The next user touch resumes from the last journal entry.
>
> **Cross-links:** [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md),
> [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md),
> [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md),
> [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md),
> [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md),
> [`MEMORY_AMNESIA_PREVENTION_SOTA.md`](./MEMORY_AMNESIA_PREVENTION_SOTA.md).

Brand: Borjie. Persona: Mr. Mwikila (AI Mining Operations Manager). Status: design-spec.

---

## 1. Vision — founder verbatim

> "Company self-revive and complete all crashed agents to 100% — improves
> even when owners and people sleep. If a human is sleeping and work
> comes in, it starts to analyse and break down tasks, covering what it
> can while waiting for user approvals and feedback."

The work cycle is the *temporal* layer of Mr. Mwikila. Capabilities live
elsewhere; this spec defines the heartbeat that fires them at the right
cadence, journals every tick, and survives session boundaries.

---

## 2. Thesis — three concrete behaviours

A Tanzanian mining cooperative's owner sleeps roughly 22:00–06:00
Africa/Dar_es_Salaam. During those eight hours, M-Pesa SMS confirmations
arrive, regulator portals post deltas, WhatsApp Business inboxes
accumulate gold-buyer DMs, the BoT publishes the next-day FX window,
the Tumemadini cadastre updates licence statuses, equipment-telemetry
MQTT topics push readings, and the cyanide-leach pad sensor logs
moisture spikes. Mr. Mwikila must do three things in that window:

1. **Run anticipatory sweeps** at a useful cadence — telemetry review,
   price/regulator watching, slow-burn investigations.
2. **Journal every tick** so nothing is lost across crashes, restarts,
   or session boundaries.
3. **Resume seamlessly** the moment the owner returns: the next session
   reads the journal and produces a `ResumptionBrief`.

Every existing enterprise SaaS lets the night pile up. Borjie pre-classifies,
pre-summarises, pre-drafts. The 2026 enterprise-AI literature confirms
this is now table stakes:

- Anthropic Managed Agents — "a whole book of deals or overnight
  processing" — InfoQ, April 2026
  (https://www.infoq.com/news/2026/04/anthropic-managed-agents/).
- Anthropic 3-agent harness (planner/generator/evaluator) — InfoQ,
  April 2026
  (https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/).
- Anthropic *Building Effective Agents* — Dec 2024
  (https://www.anthropic.com/research/building-effective-agents).
- Replit Agent 4 (200-minute unattended sessions) — replit.com/agent4,
  April 2026.
- Notion Custom Agents on schedules & triggers — Q1 2026 recap
  (https://chloeforbesk.com/blog/notion-q1-2026-updates).
- Google Spark / Gemini Daily Brief — I/O 2026
  (https://www.explosion.com/186813/google-turns-gemini-into-a-proactive-ai-agent-with-spark/).
- OpenAI ChatGPT Tasks (scheduled prompts) — OpenAI Help Center, Jan
  2025 (https://help.openai.com/en/articles/10303002-chatgpt-tasks).
- Letta / MemGPT, *MemGPT: Towards LLMs as Operating Systems*, Packer
  et al., arXiv:2310.08560, Oct 2023
  (https://arxiv.org/abs/2310.08560) — main-context vs external-memory
  paging model.
- LangGraph durable execution / checkpointing — LangChain docs, 2025
  (https://langchain-ai.github.io/langgraph/concepts/durable_execution/).
- Reflexion: language agents with verbal RL — Shinn et al.,
  arXiv:2303.11366, March 2023
  (https://arxiv.org/abs/2303.11366) — long-horizon self-reflection.
- Voyager: open-ended embodied agent — Wang et al., arXiv:2305.16291,
  May 2023 (https://arxiv.org/abs/2305.16291) — skill-library
  accumulation while running.

The state-of-the-art is converging: a substrate that watches the world,
classifies inbound work, journals what it did, and resumes from that
journal on next contact. This spec is Borjie's vertically-specialised,
audit-anchored, owner-visible version for Tanzanian mining.

---

## 3. Tick anatomy

A *tick* is one indivisible work pulse. Every tick is the same five-step
pipeline:

```
  input  →  policy gate  →  tool call  →  quality gate  →  journal write
   │            │              │              │                  │
   │            │              │              │                  └─→ hash-chain
   │            │              │              │                      audit row
   │            │              │              └─→ Cognitive Engine §6
   │            │              │                  disciplines + the
   │            │              │                  5-layer loop quality
   │            │              │                  gates from FLLA
   │            │              └─→ tool from the toolbag (read/draft/sweep)
   │            └─→ MUTATION_AUTHORITY_SPEC.md gate
   └─→ TickInput: state snapshot + last journal hash + tenant policy
```

Step-by-step:

1. **Input** — the scheduler hands the tick runner a `TickInput`:
   tenant id, current mode, tick number, last journal hash, and the
   recall set from cognitive-memory (the top-k cells relevant to the
   *pending threads* in `work_cycle_state`).
2. **Policy gate** — confirms the proposed tool call's tier against
   `MUTATION_AUTHORITY_SPEC.md`. At night (mode `night`), the default
   is **T0 read-only** unless the owner pre-authorised a specific
   capability (e.g. "you may draft Tumemadini returns after 22:00 if a
   deadline is <12 h away").
3. **Tool call** — the runner invokes one capability from the toolbag
   (anticipatory sweep, telemetry review, briefing draft, price watch,
   investigation step). Tools are pure async functions injected at
   construction.
4. **Quality gate** — the output passes the five-layer-loop gates
   (citation, brand voice, factual, regulatory, friction). Failures
   produce a `failed` journal entry rather than silent drop.
5. **Journal write** — a `JournalEntry` is appended to
   `work_cycle_journal` with `audit_hash = sha256(prev_hash || canonical_json(payload))`.
   The hash chain is verified on every read.

The tick runner is **pure**: deps `{policyGate, toolBag, qualityGate, journalRepo, stateRepo, memoryPort, budgetGate, logger, clock}` are injected. No globals, no top-level side effects.

---

## 4. Cadence — when does the next tick fire?

| Mode | Default interval | Trigger to switch |
|---|---|---|
| `active` | 30 s | Owner actively in app (websocket open) OR a high-confidence anticipated need fires. |
| `idle` | 5 min | App closed but it's day-time and the owner is reachable. |
| `night` | 15 min | Owner-local 22:00–06:00 OR explicit DND. T0 read-only by default. |
| `observe` | 60 min | Cost cap hit OR week-day-off (Sunday in TZ by default) — observe only, no drafts, no spend. |

Cadence is computed by `tick-scheduler.ts`. It reads
`work_cycle_state.current_mode` and emits the next due `started_at`.
The scheduler is **event-driven**, not a `setInterval` — it asks "when
should the next tick fire for tenant T?" and the host (a worker
process) schedules a single `setTimeout` against that timestamp.

This is the same pattern as
`services/research-orchestrator/src/cron/continuous-watch-cron.ts` —
that cron sweeps for *due watches*; this scheduler sweeps for *due
tenants* and selects the appropriate next tick mode per tenant.

A mode transition does **not** require a tick — it can happen on any
external event (user logs in → switch to `active`; cost cap reached →
switch to `observe`). Mode transitions are themselves journaled with
`mode_transition` inputs so the audit chain shows *why* cadence
changed.

---

## 5. Journal format

The append-only `work_cycle_journal` table is the spinal column. Each
row is a `JournalEntry`:

```typescript
interface JournalEntry {
  readonly id: string;                // uuid
  readonly tenant_id: string;
  readonly tick_no: bigint;           // monotone per tenant
  readonly started_at: string;        // ISO
  readonly ended_at: string;          // ISO
  readonly mode: 'active' | 'idle' | 'night' | 'observe';
  readonly inputs: TickInput;
  readonly outputs: TickOutput;
  readonly cost_usd_cents: number;
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}
```

Properties:

- **Monotone tick_no**: per tenant, the n-th tick is `tick_no = n`.
  The `work_cycle_state.last_tick_no` advances by exactly +1 per
  successful append. The state row + journal append are a single
  transaction.
- **Hash chain**: `audit_hash = sha256(canonical_json({prev: prev_hash, payload: {tick_no, tenant_id, started_at, ended_at, mode, inputs, outputs, cost_usd_cents}}))`.
  Verification walks the chain end-to-end (see
  `@borjie/audit-hash-chain`).
- **Idempotent**: the journal table has a unique constraint on
  `(tenant_id, tick_no)`. If a worker crashes mid-tick and a second
  worker re-runs, the second write is rejected and the audit chain
  detects the duplicate.
- **Failure rows**: a failed tick (policy-blocked, budget-exhausted,
  tool-thrown) writes `outputs: { status: 'failed', reason: '...' }`
  with `cost_usd_cents = 0`. Silent failure is forbidden ("cite or
  stay silent" principle from `COGNITIVE_ENGINE_SPEC.md`).

---

## 6. Resumption protocol

On the next user touch, the API gateway calls
`buildResumptionBrief({ tenantId, tokenBudget })`. The brief is a
token-bounded MemGPT-style summary of the last N journal entries:

1. Read `work_cycle_state.pending_threads` (the slow-burn
   investigations in flight).
2. Read the last K journal entries until either K=20 or token-budget
   exhausted (default budget: 1 200 tokens, configurable per persona).
3. Bucket entries by `mode` and `outputs.kind`. Collapse repeated
   sweeps into one summary line ("ran 12 telemetry sweeps; 1 anomaly
   on the cyanide-leach pad moisture sensor at 03:14").
4. Surface anything tagged `requires_owner_attention=true` first.
5. Return a `ResumptionBrief`: `{ headline, pending_threads, completed_overnight, awaiting_approval, escalations, last_tick_at }`.

This mirrors MemGPT's main-context/external-memory paging idea
(arXiv:2310.08560): the journal is the external memory, the brief is
the main-context working snapshot loaded at session start. Letta /
MemGPT's design rationale —
https://docs.letta.com/concepts/memgpt — informs the size-budgeted
collapsing.

The brief is **deterministic given the same journal + tokenBudget** —
no LLM call required on the critical resumption path. Optional LLM
post-processing can polish the prose later, but the deterministic
core ensures resumption never blocks on a model outage.

---

## 7. Energy + cost guardrails

A tenant can burn money overnight if a tick storms. The
`night-budget.ts` gate enforces a per-tenant daily cap with three
knobs:

- `nightDailyCapUsdCents` (default 500 ¢ = $5/tenant/day in
  `night` mode).
- `idleDailyCapUsdCents` (default 2 000 ¢).
- `activeDailyCapUsdCents` (default 10 000 ¢).

`BudgetGate.canAffordTick(tenantId, mode, estimatedCostCents)`
returns `{ allowed: boolean; reason?: 'cap_reached' | 'mode_locked' }`.
On `cap_reached`, the scheduler transitions the tenant to `observe`
mode until UTC midnight. The cap reset is itself a journaled
mode-transition row.

Cost accounting is the sum of `cost_usd_cents` across journal entries
inside the rolling 24h window. The budget gate keeps an in-memory
LRU of the running sum so the hot path doesn't issue a `SUM(...)`
query per tick.

---

## 8. Authority constraint — T0 read-only at night

Per `MUTATION_AUTHORITY_SPEC.md`, the four tiers are:

- **T0** — read-only (regulator-feed fetch, sensor-log ingest,
  recall, cite, omnidata sync).
- **T1** — drafts (briefing draft, buyer reply draft, return draft).
- **T2** — decisions with external impact (send mail, file return,
  hedge FX, sign contract, kill recipe).
- **T2-Critical** — irreversible-money / regulatory-breach / killswitch.

In `night` mode, the policy gate **defaults to T0 only**. T1 drafts
are permitted only when the owner pre-authorised the capability for
night use (per-capability allowlist on the tenant row). T2 is
*never* fired at night — those events queue for the morning hand-off
even if pre-authorised. T2-Critical pages immediately per
`MUTATION_AUTHORITY_SPEC.md` §4.

This is the same envelope as the existing
`night_shift_summary` lane from earlier work-cycle prose; this spec
formalises the per-tick policy-gate machinery.

---

## 9. Data shape — TypeScript surface

```typescript
export type WorkCycleMode = 'active' | 'idle' | 'night' | 'observe';

export interface TickInput {
  readonly tenant_id: string;
  readonly tick_no: bigint;
  readonly mode: WorkCycleMode;
  readonly last_hash: string | null;
  readonly recall: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly pending_threads: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly clock_iso: string;
}

export interface TickOutput {
  readonly status: 'completed' | 'failed' | 'skipped';
  readonly kind: 'sweep' | 'review' | 'draft' | 'watch' | 'investigate' | 'mode_transition';
  readonly summary: string;
  readonly reason?: string;
  readonly artifact_refs: ReadonlyArray<{ readonly kind: string; readonly id: string }>;
  readonly requires_owner_attention: boolean;
}

export interface WorkCycleTick {
  readonly input: TickInput;
  readonly output: TickOutput;
  readonly cost_usd_cents: number;
  readonly started_at: string;
  readonly ended_at: string;
}

export interface ResumptionBrief {
  readonly headline: string;
  readonly pending_threads: ReadonlyArray<{ id: string; title: string }>;
  readonly completed_overnight: ReadonlyArray<string>;
  readonly awaiting_approval: ReadonlyArray<string>;
  readonly escalations: ReadonlyArray<string>;
  readonly last_tick_at: string | null;
  readonly token_estimate: number;
}
```

Two persistence tables (migration `0033_work_cycle.sql`):

- `work_cycle_journal` (one row per tick, hash-chained, RLS-bound).
- `work_cycle_state` (one row per tenant, holds `last_tick_no`,
  `last_tick_at`, `current_mode`, `pending_threads`).

Both use the canonical `app.tenant_id` GUC for RLS, matching the
pattern in migration `0029_cognitive_memory.sql`.

---

## 10. Anti-patterns — things that would break this

1. **Mutating tick_no out-of-band.** The state row and journal append
   MUST be one transaction. Any worker that writes a journal entry
   without advancing the state row corrupts resumption.
2. **Silent failure.** A crashed worker that does not write a
   `failed` row violates "cite or stay silent". Every worker writes
   success OR failure.
3. **Page-storming at 03:00.** T2-Critical pages should be rare
   (<1 per tenant per week). If the rate spikes, the meta-learning
   conductor (see `STRATEGIC_DIRECTION_LAYER_SPEC.md`) proposes a
   recalibration.
4. **Cadence drift.** A tenant whose `last_tick_at` is older than
   2 × the mode's interval is in crash-revival territory — surfaces
   to `wave-resilience-manager` for completion.
5. **Owner-language drift.** Overnight outputs default to the
   owner's preferred language (Swahili or English). A draft in the
   wrong language is a friction signal flagged in the next morning's
   brief.
6. **Cost-cap bypass.** A tick that runs without consulting the
   budget gate violates the night-mode contract. Every tick MUST
   call `BudgetGate.canAffordTick` first.
7. **Persona leakage.** Mr. Mwikila is the only user-facing identity.
   Internal routing metadata may reference junior specialisations
   (`junior-fx-treasury`, `junior-tumemadini-clerk`) but those names
   never surface to the user. Tests assert no junior name appears in
   `ResumptionBrief.headline` or the briefing string.

---

## 11. How this connects to existing Borjie architecture

- The existing
  [`AUTONOMOUS_LOOPS_SPEC.md`](./AUTONOMOUS_LOOPS_SPEC.md) §4 Sleep-
  Pass Loop is the *parent* of this spec. The work cycle replaces
  the ad-hoc 60-second cron with the tick model.
- The existing
  [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) 4-tier
  ladder is the *policy gate* input.
- The existing
  [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md) 6
  disciplines run inside every tick's tool call.
- The existing
  [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md)
  5 quality gates run on every tick output.
- The
  [`MEMORY_AMNESIA_PREVENTION_SOTA.md`](./MEMORY_AMNESIA_PREVENTION_SOTA.md)
  spec describes the four-tier memory stack; `work_cycle_journal` is
  *episodic* memory and `work_cycle_state.pending_threads` is the
  anti-amnesia checkpoint surface.
- The
  [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md)
  store is the *recall* input — `TickInput.recall` is the result of
  a cognitive-memory recall keyed on the pending threads.
- `services/wave-resilience-manager/` watches `work_cycle_state.last_tick_at`
  and revives stalled tenants via `agent-resumer.ts`.

The 24/7 cycle adds **zero new mutation power** — it adds *throughput*
and *temporal continuity*. T2 still requires owner approval; T2-Critical
still pages; T0/T1 still autonomous. What changes is the *time domain*
of work, not its authorisation envelope.

---

## 12. Phase 2 implementation map

- **New package** `packages/work-cycle/` (≈900 LOC):
  - `src/scheduler/tick-scheduler.ts` — cadence selection.
  - `src/tick/tick-runner.ts` — pure orchestrator.
  - `src/journal/journal-repository.ts` — in-memory + SQL impls.
  - `src/state/state-repository.ts` — in-memory + SQL impls.
  - `src/budget/night-budget.ts` — per-tenant daily $-cap gate.
  - `src/resumption/resumption-brief.ts` — token-budgeted brief.
- **New migration** `packages/database/drizzle/0033_work_cycle.sql` —
  2 tables above with idempotent `DO $$ ... $$;` blocks.
- **Drizzle schema** `packages/database/src/schemas/work-cycle.schema.ts`.
- **Estimated effort**: 1 engineer-week for the package + tests,
  another week for the SQL impl and the worker process at the host
  app boundary.

---

## 13. Cross-reference to siblings

- Loop architecture: [`FIVE_LAYER_LOOP_ARCHITECTURE.md`](./FIVE_LAYER_LOOP_ARCHITECTURE.md)
  — every tick runs all 5 layers.
- Daily user follow-up: [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md)
  — overnight ticks inform the 09:00 per-user check-in.
- Guide-vs-Learn mode: [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md)
  — morning briefing voice obeys the owner's mode toggle.
- Memory amnesia prevention: [`MEMORY_AMNESIA_PREVENTION_SOTA.md`](./MEMORY_AMNESIA_PREVENTION_SOTA.md)
  — journal + pending threads form the anti-amnesia substrate.
- Master vision: [`AI_NATIVE_OS_MASTER.md`](../STRATEGY/AI_NATIVE_OS_MASTER.md) §3.3 — the ambient layer this spec implements.

---

*The principle the founder named — "company self-revive while everyone
sleeps" — is the engineering invariant this document compiles to. The
business does not pause because the human does.*

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

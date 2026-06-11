# THE METACOGNITIVE SELF-MODEL

**The capability that makes Mr. Mwikila aware of his own gaps — and able to close them.**

**Last Updated:** 2026-06-09
**Author:** Lead Architect
**Status:** Architecture dossier (design-of-record for the metacognitive executive)
**Scope:** Borjie central-intelligence kernel + autonomy-governance + workflow-engine + dispatch-router

---

## 1. Vision (one paragraph)

Mr. Mwikila — the MD, the brain layer within Borjie — must be the first
estate OS that *knows the shape of its own ignorance* and acts on it like a
disciplined human executive rather than a fluent guesser. Two distinct
ignorances: **capability** ("I cannot do this *yet* — a tool is missing, an
organ is dark, evidence hasn't landed, an approval is pending, there's a
bug") and **understanding** ("I'm not sure what the owner actually *means* —
two readings of this instruction lead to materially different, irreversible
estate actions"). The metacognitive self-model makes both a *first-class,
durable, hash-chained register entry* keyed on the **blocker** — never a
silent failure and never a confident guess. When a capability blocker
clears (tool registers, fix deploys, evidence arrives, a flag flips, an
approval lands) the MD **autonomously resumes and completes the exact
deferred work** it parked. When an understanding gap is detected, the MD
**elicits** — a sharp clarifying question, a worked example, a
template/sample request, or a propose-then-confirm draft — but *only when
asking would change the action*, gated by value-of-information so a busy
mining owner is never nagged. The deepest design truth, drawn from the
2024–2026 frontier, is that **capability gaps and understanding gaps are the
SAME data structure**: a typed, schema-bearing, *suspended goal* that
auto-resumes when its blocker (a built organ, a granted approval, a supplied
sample) clears. One register. One suspend/resume engine. One executive that
chooses, per situation, between act, defer, and ask.

---

## 2. The unified self-model — why both loops are one organ

### 2.1 The two registers of self-knowledge

The transferable architecture from the metacognition literature is a
**two-register control loop, not a single confidence number**
(Kadavath et al., *Language Models (Mostly) Know What They Know*,
arXiv:2207.05221, Anthropic 2022):

- **Forward register — `P(IK)` / competence map** ("can I do this at all,
  given my wired organs + available evidence + approvals?"). This is the
  **capability-gap register**. Kadavath's pivotal finding: `P(IK)` *rises
  correctly when the missing context is injected*. So each row must store
  **exactly which input would flip it to confident** — and a blocker-clear
  event deterministically re-triggers completion.
- **Backward register — `P(True)` / answer-verifier** ("is this *specific*
  output correct and evidence-backed?"). This is the **Auditor** pass already
  shipped in `packages/ai-copilot/src/juniors/auditor-agent.ts` — empty
  `evidence_ids` → reject.

The understanding-gap half is governed by **expected-utility-of-clarification**
(Zhang, Knox & Choi, *Modeling Future Conversation Turns to Teach LLMs to Ask
Clarifying Questions*, ICLR 2025, arXiv:2410.13788): enumerate plausible
owner-intents, and elicit **only when those interpretations diverge enough to
change the action** — otherwise act. Ties favor a direct answer (don't
pester).

### 2.2 Why both loops collapse into one organ

A capability gap that resolves to "I lack information from the owner" is just
a **Waiting** goal whose `reconsideration_condition = 'owner answered'`. The
BDI goal life-cycle (Thangarajah, Harland, Morley & Yorke-Smith, 2011/2015)
models every goal as a tuple `<Id, intent, Rules, State, Plan>` over states
`{Pending, Waiting, Active, Suspended}`. The two seemingly different
requirements collapse into **one mechanism — a `blocked-until-condition`
goal** whose reconsideration condition *is* the blocker. Understanding-gap
handling is therefore a *special case* of deferred-goal reactivation, not a
separate subsystem. The elicitation is delivered through the same
human-in-the-loop RESPOND channel that an approval blocker uses
(LangGraph `interrupt()` / `Command(resume)`).

Borjie already owns the right primitives:

| Cognitive role | Existing Borjie organ | File |
|---|---|---|
| Durable goal/gap register (the K of MAPE-K) | `md_commitments` | `packages/database/src/schemas/md-commitments.schema.ts` |
| Reconsideration sweep (`tick()`) | `EstateMind.tick()` RECONCILE step | `packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts` |
| Priming / activation store | situational-model | `packages/central-intelligence/src/kernel/situational-model/activation.ts` |
| Standing drives (maintenance goals) | MotivationEngine | `packages/central-intelligence/src/kernel/motivation/motivation-engine.ts` |
| Verbal-RL lesson capture | reflexion-writer | `packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts` |
| Calibrated confidence gate | conformal calibrated-confidence | `packages/autonomy-governance/src/decision/calibrated-confidence.ts` |
| Event-sourced deferred execution | WorkflowRun state machine | `packages/workflow-engine/src/types.ts` |
| Append-only audit history | hash-chained audit chain (`auditChainHash`) | CLAUDE.md invariant + `md-commitments.schema.ts` |

The missing piece is **not** new infrastructure — it is the explicit
*gap_kind discriminator*, the *blocked_by* dependency edges, a
*GapRegistryWatcher*, an *UnderstandingGapDetector*, and the executive that
fuses them.

### 2.3 The non-negotiable discipline (one rule across both loops)

A low-confidence / empty-evidence / interpretation-ambiguous signal must be a
**CONTROL trigger** (defer, register, or ask) — **NEVER suppressed in favor
of emitting the object-level guess** (Nelson-Narens meta/object monitoring;
MGV pre-generation MONITOR gate, Oh & Gobet, arXiv:2511.04341, 2025).
Crucially, **AbstentionBench** (Kirichenko et al., Meta FAIR, arXiv:2506.09038,
2025) shows reasoning fine-tuning *degrades* abstention ~24%: reasoning models
**confidently hallucinate the missing context**. The MD must therefore wire
abstention/elicitation to an **explicit uncertainty signal**, not to draft
fluency — every Borjie self-knowledge check is **structural** (empty
`evidence_ids`, `NOT_YET_WIRED` organ, tool-not-found, junior disagreement,
interpretation entropy), never "does the model *feel* confused?"

---

## 3. Loop A — The Capability-Gap Register

> **Requirement:** maintain a durable org-level register of the MD's own
> capability gaps and *autonomously complete deferred work when a blocker
> clears*.

### 3.1 The row schema (SOAR impasse × BDI goal × Claude Agent SDK Task)

The register row is a fusion of three frontier data structures:

- **SOAR impasse + substate** (Laird, *The Soar Cognitive Architecture*, 2012;
  arXiv:2205.03854) — a typed "I cannot proceed here, and why" object that
  spawns a deferred substate, and **chunks** the resolution so the same gap
  never recurs.
- **BDI goal-context tuple** `<Id, intent, Rules, State, Plan>` with an
  explicit Suspended state + reconsideration condition.
- **Claude Agent SDK Task** with a stable id, a `gap_kind`, and `addBlockedBy`
  dependency edges, persisted *outside the prompt* so it survives process
  death (Anthropic Claude Agent SDK, 2025–2026).

Borjie already ships ~80% of this as `md_commitments` (migration 0321). We
**extend** it rather than fork it:

```
md_commitments  (existing — migration 0321)
  id, tenantId, ownerId, threadId
  class ∈ {next_action | waiting_for | tickler | someday}   ← GTD lifecycle
  kind  (domain verb: royalty.filing | licence.renewal | ...)
  title, titleSw, rationale
  evidenceIds[]                       ← evidence-required hard rule (>=1 id)
  triggerKind ∈ {time | event | condition}
  triggerSpec  jsonb { dueAt | eventKey | predicate }   ← the WAIT-FOR shape
  triggerDueAt                         ← silence still surfaces (fallback deadline)
  status ∈ {open | scheduled | overdue | blocked | done | reopened}  ← HONEST
  sovereign  (licence/royalty/money/deletion → HITL forever)
  confirmedAt + confirmationKind       ← done ONLY on positive proof
  idempotencyKey                       ← UNIQUE(tenant, key); never double-create
  auditChainHash                       ← hash-chained closure stitch (append-only)

  --- NET-NEW columns (migration 0326) ---
  gapKind ∈ {missing_tool | bug | unwired_organ | missing_evidence
             | needs_approval | understanding_gap | null(=GTD commitment)}
  blockedBy        uuid[]              ← DAG dependency edges (Agent SDK addBlockedBy)
  unblockTriggerPaths  jsonb           ← {kind, probePath, expectedValue}[] subscriptions
  suspendedContinuation jsonb          ← LangGraph StateSnapshot pointer / replay handle
  reflexionLessonId text               ← FK to the reflexion record for informed retry
  competenceDomain text               ← jagged-frontier coordinate (licences|royalty|treasury|…)
```

**Why extend, not fork:** the GTD `class` + honest `status` + `triggerKind` +
`evidenceIds` + `idempotencyKey` + `auditChainHash` + `sovereign` already
encode the BDI life-cycle, evidence invariant, and append-only audit rule. A
`gapKind = null` row *is* an ordinary deferral/commitment; a non-null
`gapKind` *is* a capability/understanding gap. **One table, one reconcile
sweep, one closure discipline.** (Pitfall avoided: a separate gap store would
drift from the commitment store and re-introduce the "built-but-disconnected"
class of bug Borjie has fought before.)

**The row stores which input flips it to confident.** Per Kadavath's
inject-context-raises-`P(IK)` finding, `unblockTriggerPaths` is the literal
encoding of "the missing input": a `missing_evidence` row carries the
`evidence_id`-shaped predicate that, once satisfiable against the corpus,
clears it; a `missing_tool` row carries the tool name to watch in the registry.

### 3.2 Detection points — where a gap is born

A gap row is **born** at typed impasse points, never at a `try/catch`
surprise (the self-model must *predict* darkness, per Kounev's self-aware
runtime self-model, Springer 2017). The detection seams:

1. **`NOT_YET_WIRED` organ hit** — when a brain tool resolves to a
   structurally-correct stub
   (`packages/central-intelligence/src/kernel/not-yet-wired.ts`,
   `NOT_YET_WIRED_REASON.*`). The dispatcher writes a
   `gapKind = unwired_organ` row with the organ name in
   `unblockTriggerPaths`. This is Borjie's *cleanest* capability-gap signal —
   it is already enumerated by `scripts/audit-not-yet-wired.mjs`.
2. **Empty evidence chain** — the Auditor
   (`packages/ai-copilot/src/juniors/auditor-agent.ts`) rejects an
   empty-`evidence_ids` recommendation → write `gapKind = missing_evidence`,
   `triggerKind = event`, `triggerSpec.eventKey = 'corpus.ingest'`.
3. **Tool-not-found / dispatch miss** — `dispatch-router` cannot resolve a
   handler (`packages/dispatch-router/src/dispatcher.ts`) → `missing_tool`.
4. **Stuck-loop detector** — repeated identical action/error against a dark
   organ (OpenHands stuck-detector pattern: same action+observation 4×,
   action+error 3×) → convert the thrash into a **filed** `bug` /
   `missing_tool` row instead of silent spin.
5. **Sovereign action without approval** — the four-eye gate
   (`packages/central-intelligence/src/kernel/four-eye-approval.ts`,
   `packages/workflow-engine/src/approval/`) requires HITL → `needs_approval`,
   `triggerKind = event`, `triggerSpec.eventKey = 'four_eye.approved'`.
6. **MotivationEngine maintenance violation** — a standing drive
   (`CASH_RUNWAY`, `LICENCE_CURRENCY`, `SAFETY`, `OFFTAKE_COVERAGE`,
   `ROYALTY_CURRENCY`, `EQUIPMENT_HEALTH`) breaches its threshold
   (`packages/central-intelligence/src/kernel/motivation/default-drives.ts`).
   Reactive: file a recovery gap. **Proactive** (the differentiator):
   forecast.run / anomaly-detection predict the breach *before it bites* and
   pre-stage the fix as a Pending gap (maintenance-goal `π` prediction,
   Thangarajah/Harland 2011; Anticipatory Thinking, Amos-Binks & Dannenhauer,
   arXiv:1906.12249).
7. **MGV pre-flight MONITOR gate** — before acting on any request, the MD
   computes a FOK± dual-counter over its **own capability register** (not just
   world facts): if FOK⁻ dominates (organ dark / evidence thin /
   permission absent), register the gap and defer *before* generation. (MGV's
   prefix-dominance trap: the check MUST run pre-generation; a post-hoc
   verifier on a committed answer is too late.)

### 3.3 The suspend mechanism

On detection the MD does **not** fail or guess — it `suspend()`s the in-flight
work into the register:

- The **plan/continuation** is captured into `suspendedContinuation` as a
  LangGraph `StateSnapshot` pointer (durable checkpoint per super-step), so a
  worker crash resumes losslessly via replay (Temporal-style event-sourced
  history; LangGraph `AsyncPostgresSaver`).
- The **reconsideration condition** is written into `triggerKind` +
  `triggerSpec` + `unblockTriggerPaths` — *"a sufficient condition for when
  the agent should next look at this goal."*
- An **associative cue** is stored so the gap can be *primed* back above the
  interference level when its context reappears (Altmann & Trafton,
  activation-based memory, Cognitive Science 2002) — wired into the
  situational-model's per-entity activation
  (`packages/central-intelligence/src/kernel/situational-model/activation.ts`).
  *Reactivation without a stored cue fails* — every `suspend()` MUST persist
  the cue; "I'll notice later" is not a mechanism.
- A **reflexion lesson** is written (`reflexionLessonId`) recording *why* the
  work was impossible — so the eventual retry is informed, not blind
  (Reflexion, Shinn et al., NeurIPS 2023, arXiv:2303.11366).

**Determinism caveat (hard constraint):** every LLM/tool call inside a
deferred remediation must go through a *recorded activity* so replay
reconstructs identically — never re-sample. **Idempotency-up-to-interrupt:**
any side effect (a payout, a DB write) must sit *after* the approval boundary,
because resume re-runs the interrupted node from its head. Borjie already
mandates this exact discipline as the at-least-once webhook + `Idempotency-Key`
invariant and the `idempotencyKey` UNIQUE constraint on `md_commitments`.

### 3.4 The unblock-trigger / subscription mechanism

**NET-NEW: `GapRegistryWatcher`**
(`packages/central-intelligence/src/kernel/gap-registry-watcher.ts`)

Runs on the **EstateMind slow-loop tick** (folded into the existing RECONCILE
step). For every open gap it re-evaluates the `triggerSpec` predicate /
`unblockTriggerPaths` against **live state** — re-probing, never trusting
`last_checked` (self-model staleness pitfall):

| `gapKind` | Blocker-clear probe (the "half-open circuit-breaker probe") | Signal fired |
|---|---|---|
| `missing_tool` | tool now present in the brain-tool / HQ-tool registry | `GapClearedSignal{tool}` |
| `unwired_organ` | organ now WIRED (no longer `NOT_YET_WIRED`); `scripts/audit-not-yet-wired.mjs` count dropped | `GapClearedSignal{organ}` |
| `bug` | fix deployed — typecheck + tests green on the touched path | `GapClearedSignal{commit}` |
| `missing_evidence` | `evidence_id` now resolves to a real corpus chunk | `GapClearedSignal{evidence_id}` |
| `needs_approval` | four-eye approval row exists / flag flipped | `GapClearedSignal{approval}` |

This is the **detect-diagnose-repair circuit-breaker**: a dark organ is
marked broken, routed around, and *periodically half-open-probed* by the
watcher so the gap auto-closes the moment the organ comes back (self-healing
taxonomy, arXiv:2504.20093). The probe is **GDA discrepancy-gated** — the MD
only re-deliberates the backlog when a *real state change* occurs, not on
every tick, so it never thrashes (Goal-Driven Autonomy, Klenk/Molineaux/Aha).

The watcher emits a `GapClearedSignal` onto an **event-sourced stream**, sets
`confirmedAt` + `confirmationKind`, and primes the situational-model with the
blocker-cleared timestamp.

### 3.5 The autonomous re-attempt + completion

**NET-NEW: `DeferredWorkDependencyResolver`**
(`packages/workflow-engine/src/autonomy/deferred-work-dependency-resolver.ts`)

On `GapClearedSignal`, it traverses the `blockedBy` DAG: a deferred
estate-work item whose blocker just flipped becomes **READY**. Completion is
**SOAR substate re-entry / BDI check-goal re-entry** — never a blind replay:

1. **Re-enter at `check-goal`** — re-test the success/failure conditions and
   re-validate the *original preconditions*. Between filing and clearing, the
   estate world moved (prices, KYC status, approvals revoked). *Never
   auto-execute a reactivated goal without re-confirming it is still wanted
   and still correct* — or you ship stale work autonomously (the register-
   staleness pitfall; the property→mining pivot is the live example).
2. **Re-inject the stored reflexion lesson** so the retry is informed.
3. **Resume from the LangGraph checkpoint**; idempotency-gate the resume
   (webhook pattern).
4. **Money-path completions** flow through `LedgerService.post()` (the only
   money write) with `idempotencyKey`, append-only — saga-compensated so a
   half-applied ledger action is never left inconsistent (SAFEFLOW WAL +
   rollback, arXiv:2506.07564).
5. **Gate on a REAL verifier, never self-attestation.** A blocker is only
   *cleared* when its **tool** says clean — the typecheck/migration-apply
   gate, the evidence resolver, the RLS probe, the ledger-balance check
   (CRITIC, Gou et al., ICLR 2024, arXiv:2305.11738: *LLMs cannot reliably
   verify themselves*). Borjie's own memory records a "stale-cache FALSE-green"
   incident — the same failure class. The Auditor
   (`auditor-agent.ts`) validates every completion before `status → done`.
6. **`needs_approval` gaps NEVER auto-complete.** Sovereign / kill-switch /
   RLS-touching / money-path prefixes park on a human signal forever
   (`sovereign = true` → HITL; `four-eye-approval.ts`). Higher autonomy on
   these paths raises safety risk super-linearly — keep `needs_approval` as a
   first-class, human-signalled gap kind.
7. **Chunk the resolution.** Once completed, persist the closure as a reusable
   skill in the Voyager skill library
   (`packages/skill-library/src/voyager-library/library.ts`, embedding-indexed,
   quarantine-gated) — but only after the verifier confirms (write-on-success).
   The same gap-class is then resolved reactively, never re-deliberated (SOAR
   chunking; Voyager write-on-success).

### 3.6 The org-level capability-frontier roll-up

**Never report a single global readiness %.** Capability is *jagged* —
strong in some sub-domains, dark in others (Dell'Acqua et al. 2023, jagged
frontier; AITG, arXiv:2603.13278). The roll-up is a **per-domain vector**,
each `competenceDomain` coordinate = `{covered | partially-wired | dark}`,
derived from the open-gap distribution. This is the org-level
capability-frontier dashboard and the *distance-to-frontier per domain*. It
matches Borjie's reality (green core + disconnected tails) and is surfaced via
the runtime self-model already injected into every system prompt
(`renderModuleInventoryBlock` in
`packages/central-intelligence/src/kernel/self-awareness.ts`). HIGH-risk
policy prefixes (sovereign / kill_switch / four_eye) become **tracked
categories** measured every action with armed safeguards, never
auto-generalized.

---

## 4. Loop B — The Understanding Gate

> **Requirement:** detect understanding gaps and *actively elicit* (sharp
> questions, worked examples, template/sample requests, propose-then-confirm)
> instead of guessing — without nagging.

### 4.1 Where it fires in the brain turn

**NET-NEW: `UnderstandingGapDetector`**
(`packages/central-intelligence/src/kernel/understanding-gap-detector.ts`)

It runs **BEFORE generation**, *decoupled* from the acting loop — a separate
Intent/Critic organ, never the actor policing itself. (The acting loop
rationalizes past its own gaps: *"LM Agents May Fail to Act on Their Own Risk
Knowledge"*, arXiv:2508.13465 — the agent can *name* the blocker yet plow
ahead; the mitigation is structural, an external monitor that re-injects the
gap at the decision point — UA-Multi's decoupled Intent Agent,
arXiv:2603.26233, asks on 68.8% of tasks and *resolves* 66.0% vs 55.8% for the
inline single-agent variant.)

Wiring: the detector is called in the agent-orchestrator main loop *before the
brain sensor*. If a gap is flagged, the turn emits an **elicitation schema**
instead of a full answer.

### 4.2 The ambiguity / uncertainty signal (structural, not introspective)

The detector separates **ambiguity** (multiple valid owner intents — asking
*helps*) from **ignorance** (the model just doesn't know — asking *won't*
help) — the crucial discriminator (INTENT-SIM, Zhang & Choi, arXiv:2311.09469;
CLAMBER taxonomy):

1. **Enumerate 2–3 plausible interpretations** of the owner request using
   situational-model context
   (`packages/central-intelligence/src/kernel/situational-model/`).
2. **Score interpretation divergence.** If a single action serves all
   interpretations → **ACT**. If they diverge on a *consequential/irreversible*
   action (money path, DDL apply, contract crystallize) → this is an
   understanding gap (entropy-over-simulated-intents).
3. **Cross-check with structural signals — never bare verbalized confidence**
   (RLHF makes confidence miscalibrated, ECE ≥0.30; verbal confidence can be
   *unfaithful* to the decision, arXiv:2601.07264):
   - calibrated-confidence floor
     (`packages/autonomy-governance/src/decision/calibrated-confidence.ts` —
     conformal `min(raw, coverageCeiling)`),
   - honest-uncertainty guard
     (`packages/conversation-feel/src/guards/honest-uncertainty.ts` — admits
     "I don't know" on low confidence / empty retrieval / missing required
     info),
   - **junior disagreement as an abstain signal** — when juniors (compliance,
     metallurgy, FX, cost) materially conflict on a recommendation via
     `debate.run` (`packages/central-intelligence/src/kernel/debate/`), that
     COMPETE-disagreement *is* a gap (Multi-LLM abstention, Feng et al.,
     ACL 2024, arXiv:2402.00367 — ~19% better abstain accuracy than
     self-reflection).
4. **Classify the gap via AbstentionBench's 6-way taxonomy** (arXiv:2506.09038)
   to route the *form* of the response: Underspecified Context/Intent → ask /
   request sample; False Premise → surface the bad assumption +
   propose-then-confirm; Stale → trigger fresh-evidence retrieval; Subjective →
   present options not a verdict; Answer Unknown → register a capability gap
   and defer.

### 4.3 The move-selector (governed by value-of-information)

The decision is **EVSI(clarify) − InterruptionCost > 0** (Expected Value of
Sample Information; Howard/Raiffa) — ask only when interpretations genuinely
diverge AND lead to materially different/irreversible actions AND the value of
resolving exceeds the cost of bothering the owner. Stakes lower the
ask-threshold: irreversible money/compliance → ask readily; reversible reads →
act and surface.

**NET-NEW: `VerbalizedValueFunctionGate`**
(`packages/autonomy-governance/src/decision/verbalized-value-function-gate.ts`)

Before any consequential action, it runs the **CaRT counterfactual test**
(Liu/Qu/Levine et al., arXiv:2510.08517): *"Is there a perturbation of the
missing datum X that flips my decision?"* If yes → the evidence is
load-bearing → **ask**; if no → **act**. It emits an explicit control token
`<ask>` | `<act>` | `<escalate>` + a verbalized rationale into the audit chain
(KnowSelf's fast/slow/knowledge-seek marker tokens, arXiv:2504.03553). The
rationale is a *verbalized value function* — auditable and citable. The
calibrated-confidence gate feeds the threshold: low confidence lowers the bar
to ask.

The **move** is then selected by stakes × ambiguity-form:

| Move | When | Mechanism |
|---|---|---|
| **PROPOSE-THEN-CONFIRM** | HIGH-stakes / irreversible (money path, contract crystallize, DDL) | Draft the interpretation + action ("offtake 50 MT @ USD 200/unit, TZS, 30-day"), surface, ask "Correct? Yes / Edit / Cancel" via schema-validated LangGraph `interrupt()`. **Owners correct a wrong draft far more reliably than they volunteer a full spec** (UserBench: best models elicit <30% of preferences) — so a concrete artifact beats an open question. |
| **SHARP CLARIFYING QUESTION** | interpretations diverge, no draftable artifact yet | Rank candidate questions by **Expected Information Gain over the SOLUTION space** (BED-LLM, arXiv:2508.21184; Active Task Disambiguation, arXiv:2502.04485 — score by how answers *partition end-states*, not question phrasing). Score branch-divergence with `debate.run`. Ask the ONE maximally-discriminating question: "Is this export (NEMC) or domestic (TZS)?" |
| **REQUEST TEMPLATE / SAMPLE** | gap is a missing artifact, not a missing preference | ScatterShot slice-based curation (arXiv:2302.07346): request the FEW examples covering the owner's data distribution (their assay layout, contract clause style), targeting under-represented slices; diminishing-returns stop rule says when enough grounding exists. Store exemplars under tenant RLS. |
| **ACT + SURFACE** | low-stakes / reversible, interpretations converge | Just do it; surface the result; keep it cheaply correctable. |

### 4.4 Schema-driven intake (the structured understanding-gap inventory)

Each estate object (Licence, Offtake, Royalty, Payout) is a **schema with
typed slots + NL descriptions + mandatory markers** (Schema-Guided Dialogue,
Rastogi et al.; LLM-backed DST). The MD runs slot-filling over owner free
text/uploads; **the set of still-empty mandatory slots IS the structured
understanding-gap list.** On commit intent, empty mandatory slots → file a
`waiting_for` gap (`triggerKind = condition`,
`triggerSpec.predicate = { all_slots_filled }`), surface the *exact form with
blanks* (recognition over recall — no generic "tell me more"), pause until the
owner completes. Adding a new estate object type = adding a schema, not code.

### 4.5 IP-egress-safe surfacing + the learning loop

**NET-NEW: `ElicitationActionRouter`**
(`packages/dispatch-router/src/elicitation-action-router.ts`)

Routes an `UnderstandingGapSignal` to a **schema-validated LangGraph
`interrupt()`** carrying a JSON schema for exactly the structured input needed
(`{confirm: bool}` for propose-then-confirm; `{answer}` for a question;
`{sample: File}` for a template). The work SUSPENDS as a `gapKind =
understanding_gap` row; when the owner submits the schema-matched response, the
`owner_answered_clarifying_question` trigger fires, the
`DeferredWorkDependencyResolver` unblocks, `status → scheduled`, and the
deferred turn auto-completes from the checkpoint — idempotency-gated.

- **IP-egress safety:** elicitation text is owner-facing UI copy only — never
  leaks prompt-IP, source maps, or internal reasoning (Borjie's
  client-secret-scan invariant). Owner-supplied samples are real tenant data:
  stored under RLS, residency-tagged, scoped to the right tenant.
- **Locale absolutism:** the elicitation honors the active locale — an `sw`
  reply gets a Swahili question and *zero* English (honest-uncertainty guard's
  single-locale discipline; CLAUDE.md hard rule).
- **Learning back into the model:** the reflexion writer
  (`packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts`)
  stores the elicitation outcome — *did the owner's answer actually change the
  action?* — and the nightly sleep pass
  (`packages/central-intelligence/src/kernel/reflexion/sleep/nightly-sleep.ts`)
  consolidates it into a voted rule pool (ExpeL ADD/EDIT/UPVOTE/DOWNVOTE,
  arXiv:2308.10144) so the MD asks *better* next time — and a stale asking-rule
  decays out. Score quality by realized rework-reduction minus an over-ask
  penalty (AskBench reward shape) — not by single-turn preference, which
  structurally penalizes good questions.

---

## 5. How they fuse — the Metacognitive Executive

The fusion is a **two-plane Nelson-Narens architecture** (Metamemory, 1990):
an **object plane** (juniors, tools, ledger writes, marketplace actions) and a
**meta plane** that holds a live self-model and is **the only thing allowed to
decide act-vs-defer-vs-elicit-vs-escalate**. MONITORING flows up (every
object action emits succeeded / impasse / low-evidence / low-confidence);
CONTROL flows down (the meta-plane chooses the next move). This is MIDCA's
dual-cycle made concrete: EstateMind's existing object cycle
(PERCEIVE→ORIENT→MOTIVATE→PROPOSE) **plus** a meta cycle whose percepts are the
MD's own action traces and capability register.

**The executive sits inside `EstateMind.tick()`**
(`packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts`) and the
agent-orchestrator main loop:

```
EstateMind.tick(tenant):
  PERCEIVE   → fold observations into situational-model
  ORIENT     → activated snapshot (salience)
  RECONCILE  → [EXTENDED] GapRegistryWatcher.run():
                 • re-probe every open gap's blocker (§3.4)
                 • on clear → emit GapClearedSignal
                 • DeferredWorkDependencyResolver.resolve() (§3.5):
                     traverse blockedBy DAG → mark READY
                     → re-enter check-goal → re-inject reflexion lesson
                     → resume from checkpoint → verifier-gate → done/reopen
                 • Auditor validates before status→done
                 • sovereign/needs_approval → HITL safe-halt, never auto-actuate
  MOTIVATE   → standing drives → goals (reactive + proactive maintenance gaps)
  PROPOSE    → gated proposal sink (proactive path; accept-model filtered)
  FORGET     → prune cold entities (anti-nag activation decay)

agent-orchestrator main-loop (per turn):
  turn-start → check newly-unblocked deferred tasks (Loop A resumption)
  BEFORE brain sensor → UnderstandingGapDetector.run() (Loop B, §4.1)
     if gap flagged → VerbalizedValueFunctionGate → emit <ask|act|escalate>
        <ask> → ElicitationActionRouter → schema-validated interrupt()
        <act> → proceed to generation
        <escalate> → four-eye HITL router
  generation → Auditor (P(True) verify) → policy-gate → respond
```

**Integration map (every claim grounded in a real file):**

| Fusion point | File |
|---|---|
| Register table + extension | `packages/database/src/schemas/md-commitments.schema.ts` (+ migration `0326_md_commitment_gap_kind.sql`) |
| Register repository port | `packages/database/src/repositories/md-commitment-repository.ts` |
| Reconcile sweep host | `packages/central-intelligence/src/kernel/estate-mind/estate-mind.ts` |
| GapRegistryWatcher (net-new) | `packages/central-intelligence/src/kernel/gap-registry-watcher.ts` |
| DeferredWorkDependencyResolver (net-new) | `packages/workflow-engine/src/autonomy/deferred-work-dependency-resolver.ts` |
| UnderstandingGapDetector (net-new) | `packages/central-intelligence/src/kernel/understanding-gap-detector.ts` |
| VerbalizedValueFunctionGate (net-new) | `packages/autonomy-governance/src/decision/verbalized-value-function-gate.ts` |
| ElicitationActionRouter (net-new) | `packages/dispatch-router/src/elicitation-action-router.ts` |
| Priming / activation store | `packages/central-intelligence/src/kernel/situational-model/activation.ts` |
| Standing drives (maintenance goals) | `packages/central-intelligence/src/kernel/motivation/default-drives.ts` |
| Reflexion lesson capture + sleep consolidation | `packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts`, `…/reflexion/sleep/nightly-sleep.ts` |
| Calibrated confidence (ask-threshold input) | `packages/autonomy-governance/src/decision/calibrated-confidence.ts` |
| Honest-uncertainty guard | `packages/conversation-feel/src/guards/honest-uncertainty.ts` |
| Auditor (P(True) verifier) | `packages/ai-copilot/src/juniors/auditor-agent.ts` |
| debate.run (EIG / disagreement oracle) | `packages/central-intelligence/src/kernel/debate/debate-runner.ts` |
| Four-eye HITL gate | `packages/central-intelligence/src/kernel/four-eye-approval.ts`, `packages/workflow-engine/src/approval/` |
| Dark-organ detection vocabulary | `packages/central-intelligence/src/kernel/not-yet-wired.ts` |
| Verified skill library (chunking) | `packages/skill-library/src/voyager-library/library.ts` |
| Event-sourced deferred execution | `packages/workflow-engine/src/types.ts`, `packages/workflow-engine/src/commit/committer.ts` |
| Runtime self-model injection (frontier roll-up) | `packages/central-intelligence/src/kernel/self-awareness.ts` |

---

## 6. Phased, buildable plan (each phase independently shippable + verifiable)

> **P0 ships a minimal *real* loop end-to-end; each later phase deepens it.**
> No phase depends on a future phase to be useful. Every phase ends with a
> typecheck + test + migration-gate green and a behavioral self-test (§7).

### P0 — Minimal real Loop A (capability gap → auto-complete)
- **Ships:** migration `0326_md_commitment_gap_kind.sql` adding `gapKind`,
  `blockedBy`, `unblockTriggerPaths`, `competenceDomain` (FORCE RLS,
  forward-only); schema + repository extension; **one detection seam**
  (`NOT_YET_WIRED` organ hit → write `unwired_organ` row); `GapRegistryWatcher`
  folded into `EstateMind.tick()` RECONCILE re-probing the organ registry;
  `GapClearedSignal` event stream; `DeferredWorkDependencyResolver` resolving a
  single `blockedBy` edge; verifier-gated `status → done`.
- **Organs reused:** `md-commitments`, `estate-mind`, `not-yet-wired`,
  `auditor-agent`, `four-eye-approval`.
- **Verifiable:** inject a `missing_tool`/`unwired_organ` gap, wire the organ,
  assert the watcher fires `GapClearedSignal` and the deferred work completes
  with `confirmedAt` set, append-only audit hash stitched, on a fresh DB.

### P1 — Minimal real Loop B (understanding gap → propose-then-confirm)
- **Ships:** `UnderstandingGapDetector` (2–3 interpretation enumeration +
  divergence score) called before the brain sensor; `VerbalizedValueFunctionGate`
  (CaRT counterfactual + `<ask|act|escalate>` token); `ElicitationActionRouter`
  with **propose-then-confirm only** via schema-validated LangGraph
  `interrupt()`; owner-answered trigger resumes the deferred turn.
- **Organs reused:** `calibrated-confidence`, `honest-uncertainty`,
  `dispatch-router`, `four-eye-approval`, audit chain.
- **Verifiable:** inject an ambiguous money-path request; assert the MD
  surfaces a propose-then-confirm draft (not a guess); on "Edit" it loops, on
  "Yes" it completes; assert it does NOT clarify a clear reversible read.

### P2 — Full detection surface + sharp questions + sample requests
- **Ships:** all six detection seams (§3.2) including empty-evidence,
  tool-not-found, stuck-loop detector, sovereign-without-approval; EIG-ranked
  **sharp clarifying questions** scored via `debate.run`; **ScatterShot
  template/sample requests** stored under RLS; AbstentionBench 6-way gap
  classifier routing the elicitation form; schema-driven intake for Licence /
  Offtake / Royalty / Payout (empty-mandatory-slots = gap inventory).
- **Verifiable:** junior-disagreement and empty-evidence both file gaps;
  intake surfaces the exact blank form; EIG picks the maximally-discriminating
  question.

### P3 — Proactive maintenance gaps + activation priming + reflexion learning
- **Ships:** MotivationEngine proactive mode (forecast.run / anomaly-detection
  predict a breach → pre-stage a Pending gap before it bites); associative-cue
  priming via situational-model activation so the right gap surfaces at the
  right moment (interference-level de-prioritizer + anti-nag decay); reflexion
  sleep-pass consolidation of elicitation lessons into a voted rule pool.
- **Verifiable:** a predicted cash-runway breach pre-stages a gap; a resolved
  gap decays and stops re-surfacing; a repeated elicitation pattern produces an
  upvoted rule.

### P4 — Org-level frontier roll-up + chunking + saga-safe money completion
- **Ships:** per-domain jagged capability-frontier vector surfaced via the
  runtime self-model; SOAR-style chunking of resolved gaps into the Voyager
  skill library (write-on-success, quarantine-gated); saga-compensated
  money-path completion through `LedgerService.post()`; ToolLibGen-style
  periodic register consolidation (cluster + aggregate + fidelity-review) to
  keep retrieval recall high at scale.
- **Verifiable:** dashboard shows jagged per-domain state (never one %); a
  resolved gap becomes a retrievable skill; a money-path completion is
  idempotent + rollback-safe; register retrieval recall@1 tracked as a health
  metric.

### P5 — Calibration scorecard + red-team for unknown-unknowns
- **Ships:** AUROC/ECE over the register's predicted-vs-realized completions
  (the MD's own calibration scorecard); re-calibrate ask-thresholds per
  task-type after any model swap; adversarial red-team probes (not
  self-monitoring) to surface unknown-unknowns the monitors cannot register by
  construction.
- **Verifiable:** calibration scorecard reports honest discrimination; a
  red-team probe surfaces a blind-spot the self-model missed and files it.

---

## 7. Self-tests — how we PROVE the MD is genuinely gap-aware

These are *behavioral* proofs, not unit assertions on the model's
self-report. Each maps to a frontier guarantee.

1. **Capability auto-completion (Loop A core).** Inject a request requiring a
   `missing_tool`/`unwired_organ`. Assert: (a) the MD writes a typed gap row
   with `gapKind`, the blocker, and `unblockTriggerPaths` — *and does NOT
   hallucinate a result*; (b) wire/ship the tool; (c) on the next
   `EstateMind.tick()` the `GapRegistryWatcher` fires `GapClearedSignal`, the
   `DeferredWorkDependencyResolver` re-enters check-goal, re-injects the
   reflexion lesson, and completes the deferred work; (d) `confirmedAt` +
   `confirmationKind` set *only* after the Auditor/verifier passes; (e) the
   audit hash chain is intact on a fresh-DB replay. **Negative control:** a
   `bug`/`needs_approval` gap whose blocker never clears does NOT spin — it
   backs off and stays filed (max-retry-with-backoff).

2. **Elicit-with-example, not guess (Loop B core).** Inject an ambiguous
   high-stakes request ("offtake the Geita concentrate"). Assert the MD
   surfaces a **propose-then-confirm draft or a sharp clarifying question with
   a worked example** — never a silent committed action. Assert the question
   *partitions the solution space* (EIG), e.g. "export (NEMC) or domestic
   (TZS)?" **Negative control (no over-asking):** a clear reversible read
   ("show me last month's royalty filings") is acted on directly with *zero*
   clarification — proving the no-degradation-on-clear-inputs property.

3. **Ambiguity vs ignorance separation.** Inject (a) a genuinely ambiguous
   request and (b) a request the MD simply lacks evidence for. Assert (a)
   routes to ELICIT (asking helps) and (b) routes to a `missing_evidence`
   capability gap + defer (asking the owner won't help) — proving INTENT-SIM
   separation.

4. **Sovereign never auto-actuates.** Inject a money-path / licence-suspension
   gap. Assert it is filed `sovereign = true` / `needs_approval`, parks on a
   human signal, and NEVER auto-completes even when every other precondition
   clears — only an approval row releases it through the four-eye gate.

5. **Verifier-gated, no false-green.** Inject a gap whose remediation produces
   a *plausible but wrong* artifact. Assert the Auditor/verifier rejects it,
   `status` does NOT advance to `done`, and a reflexion lesson is written —
   proving completion is gated on an external tool signal, not self-attestation
   (the stale-cache FALSE-green guard).

6. **Stale-resume safety.** File a gap, then mutate the estate world
   (revoke an approval / move a price). On blocker-clear, assert the MD
   re-validates preconditions at check-goal and *reopens* instead of shipping
   stale work.

7. **Anti-nag decay + priming.** Resolve a gap; assert it decays below the
   interference level and stops re-surfacing. Re-introduce its associative cue;
   assert a *still-open* related gap is primed back above threshold at the
   right moment.

8. **Jagged frontier honesty.** Assert the roll-up reports a per-domain vector
   with at least one `dark` coordinate — never a single global readiness %.

---

## 8. SOTA pitfalls to avoid (and how this design avoids each)

- **Systematic overconfidence (the dominant empirical finding).** Every tested
  model over-estimates success (Kadavath 2022; Barkan 2025; Ackerman 2025).
  *Avoidance:* raw self-confidence NEVER alone authorizes a consequential
  action — money/sovereign/kill-switch paths stay on literal policy rules +
  four-eyes regardless of confidence; confidence only gates effort allocation
  and the ask-threshold.

- **Over-asking destroys trust; under-asking causes silent wrong actions.**
  Prompt-level "be proactive" nudges make models over-ask on 36–95% of
  *already-clear* inputs (Ambig-SWE, arXiv:2502.13069); frontier models
  mis-time clarification in 52% of sessions (arXiv:2605.07937). *Avoidance:*
  EVSI gate + CaRT counterfactual + ties-favor-direct-answer + propose-then-
  confirm for low-ambiguity + per-gap-type clarification deadline (GOAL
  ambiguity up front, INPUT ambiguity just-in-time) — never a global ask-toggle.

- **Intrinsic self-correction DEGRADES reasoning.** Re-judging one's own
  reasoning with no new information lowers accuracy (Huang et al., ICLR 2024,
  arXiv:2310.01798). *Avoidance:* completion is gated on **external** verifiers
  (typecheck / migration-apply / evidence resolver / RLS probe / ledger
  balance), never "rev-the-engine" self-critique. Oracle-leak audit: every
  self-loop's stop-signal must be available at runtime *without the answer*.

- **Reasoning models confidently hallucinate missing context.** Reasoning
  fine-tuning degrades abstention ~24% (AbstentionBench, arXiv:2506.09038).
  *Avoidance:* abstention/elicitation is wired to **structural** signals (empty
  `evidence_ids`, `NOT_YET_WIRED`, tool-not-found, junior disagreement,
  interpretation entropy), not to draft fluency or chain-of-thought length.

- **Library/register bloat kills retrieval.** Thousands of one-off gap rows
  become un-findable; gap-detection silently degrades to "I have nothing" and
  rebuilds duplicates (ToolLibGen, arXiv:2510.07768). *Avoidance:* dedup on
  (name, arg-count), periodic cluster+aggregate consolidation (P4), and
  retrieval recall@1 tracked as a health metric.

- **Stale gaps / stale resume.** A blocker can clear while the deferred work
  became obsolete (property→mining pivot). *Avoidance:* mandatory BDI
  check-goal re-entry re-validates preconditions on resume; re-probe live
  state, never trust `last_checked`; reopen instead of shipping stale work.

- **Hallucinated capability (over-claiming the register).** If the register
  says "I have an FX organ" when it doesn't, the MD confidently mis-acts.
  *Avoidance:* prefer false-negatives (treat as gap, verify) over
  false-positives; store a `confirmedAt`/last-verified stamp; re-prove stale
  capabilities.

- **Knowing a gap ≠ acting on it.** The acting loop can name the blocker yet
  plow ahead (arXiv:2508.13465). *Avoidance:* the `UnderstandingGapDetector`
  and `VerbalizedValueFunctionGate` are **decoupled** from the actor — a
  mandatory external checkpoint, never the actor policing itself.

- **Determinism / idempotency hazards on resume.** Replay breaks if LLM/clock/
  RNG/IO are called directly; resumed nodes re-run their head (LangGraph),
  double-applying any pre-interrupt side effect. *Avoidance:* every model/tool
  call is a recorded activity; irreversible effects sit strictly *after* the
  approval boundary; money-path resume is idempotency-keyed +
  `LedgerService.post()` append-only + saga-compensated.

- **Self-verification rubber-stamping.** A critic that is the same LLM grading
  itself is over-optimistic (Voyager/Reflexion/Alita all use external ground
  truth). *Avoidance:* the Auditor + real execution + `evidence_id` resolution
  are the verifiers; HIGH-risk capabilities route to `needs_approval`, never
  auto-wire.

- **Single-number maturity lies; unknown-unknowns are unreachable by
  self-monitoring.** *Avoidance:* jagged per-domain frontier roll-up (never one
  %), plus periodic external red-teaming (P5) to surface blind spots the
  register cannot generate by construction.

---

## References (inline-cited above)

Kadavath et al. 2022 (arXiv:2207.05221); Zhang/Diao R-Tuning NAACL 2024
(arXiv:2311.09677); Shinn et al. Reflexion NeurIPS 2023 (arXiv:2303.11366);
Wang & Zhao MP NAACL 2024; Zhang/Knox/Choi ICLR 2025 (arXiv:2410.13788);
Qiao et al. KnowSelf ACL 2025 (arXiv:2504.03553); Valiente & Pilly MUSE 2024
(arXiv:2411.13537); Ackerman 2025 (arXiv:2509.21545); Barkan et al. 2025
(arXiv:2512.24661); Kaddour et al. 2026 (arXiv:2602.06948); Wang et al. Voyager
NeurIPS 2023 (arXiv:2305.16291); Qian et al. CREATOR EMNLP 2023
(arXiv:2305.14318); Cai et al. LATM ICLR 2024 (arXiv:2305.17126); Yuan et al.
CRAFT ICLR 2024 (arXiv:2309.17428); Yue et al. ToolLibGen 2025
(arXiv:2510.07768); Qiu et al. Alita 2025 (arXiv:2505.20286); Park et al.
Generative Agents UIST 2023 (arXiv:2304.03442); Qu/Levine CaRT 2025
(arXiv:2510.08517); Zhang & Choi INTENT-SIM 2023 (arXiv:2311.09469); Microsoft
info-gain RL 2025 (arXiv:2507.21389); MCP Elicitation spec 2025; Thangarajah/
Harland/Morley/Yorke-Smith BDI 2011/2015; Temporal durable execution 2024–2026;
LangGraph HITL 2024–2025; Altmann & Trafton 2002; Gou et al. CRITIC ICLR 2024
(arXiv:2305.11738); Chen et al. Self-Debugging ICLR 2024 (arXiv:2304.05128);
Bai et al. Constitutional AI 2022 (arXiv:2212.08073); Zhao et al. ExpeL AAAI
2024 (arXiv:2308.10144); Andukuri et al. STaR-GATE 2024 (arXiv:2403.19154);
Kamoi et al. TACL 2024 (arXiv:2406.01297); Huang et al. ICLR 2024
(arXiv:2310.01798); Kuhn/Gal/Farquhar CLAM 2023 (arXiv:2212.07769); Choudhury
et al. BED-LLM 2025 (arXiv:2508.21184); Hu et al. Active Task Disambiguation
2025 (arXiv:2502.04485); Andukuri/Hu CLARINET 2024 (arXiv:2405.15784); Pyatkin
et al. ClarifyDelphi ACL 2023 (arXiv:2212.10409); Vijayvargiya/Zhou Ambig-SWE
2025 (arXiv:2502.13069); Chen/Andukuri ACT ICLR 2025 (arXiv:2406.00222);
Rastogi et al. SGD/DSTC8; Li et al. Honesty survey TMLR 2025 (arXiv:2409.18786);
Shaikh et al. RIFTS 2025 (arXiv:2503.13975); Wu et al. ScatterShot IUI 2023
(arXiv:2302.07346); Horvitz Mixed-Initiative CHI 1999; Li et al. SAFEFLOW 2025
(arXiv:2506.07564); Claude Agent SDK Task tools 2025–2026; OpenHands SDK 2025
(arXiv:2511.03690); UA-Multi 2026 (arXiv:2603.26233); Ask-Early/Late/Right 2026
(arXiv:2605.07937); Cognition Devin / AskBench 2024–2026 (arXiv:2602.11199);
Laird SOAR 2012 (arXiv:2205.03854); Nelson & Narens Metamemory 1990; Oh & Gobet
MGV 2025 (arXiv:2511.04341); Cox et al. MIDCA AAAI 2016; Klenk/Molineaux/Aha GDA
2013; Kirichenko et al. AbstentionBench 2025 (arXiv:2506.09038); Anderson ACT-R;
Amos-Binks & Dannenhauer Anticipatory Thinking 2019 (arXiv:1906.12249); Kephart
& Chess MAPE-K 2003; Sanwouo/Temple/Quinton AWARE FSE 2025; Kounev et al.
Self-Aware Computing 2017; Feng et al. Multi-LLM abstention ACL 2024
(arXiv:2402.00367); Lu et al. Proactive Agent 2024 (arXiv:2410.12361);
Dell'Acqua et al. jagged frontier 2023; AITG 2026 (arXiv:2603.13278);
Self-Healing Software 2025 (arXiv:2504.20093); "LM Agents May Fail to Act on
Their Own Risk Knowledge" 2025 (arXiv:2508.13465).

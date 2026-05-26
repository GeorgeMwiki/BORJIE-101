# PRM + MCTS Reasoning Engine — Specification

> Status: P0 closure (18BB gap analysis item #1). Companion package:
> `packages/process-reward-model`. Companion wiring:
> `services/api-gateway/src/composition/mcts-tool-search.ts`. Companion
> migration: `packages/database/drizzle/0033_reasoning_traces.sql`.
>
> Sister documents: `SELF_IMPROVING_LOOPS_SPEC.md`, `COGNITIVE_ENGINE_SPEC.md`,
> `CAPABILITIES_UNIFICATION.md`.

---

## 1. The Problem — Debate/Reflexion ≠ Search-Based Reasoning

Borjie's brain-kernel currently composes responses through three reasoning
primitives:

1. **Persona routing** — picks an expert sub-persona.
2. **Tool dispatch** — runs the chosen tool, returns its output.
3. **Self-reflexion + debate** — the kernel optionally re-asks itself "is
   this output good?" and either accepts or retries.

This is a *single-trajectory* pipeline. It cannot:

- branch into multiple candidate continuations and rank them,
- score *intermediate* steps before committing to a path, or
- learn from the *process* of a successful answer — only from the outcome.

The 18BB gap-analysis founder directive named this the largest spec-vs-reality
delta: the self-improving tier shipped the chassis (memory, swarm, learning
loops) without the engine (search-based reasoning with a process-graded
reward). State-of-the-art systems — OpenAI o1 (PRM800K + process supervision),
DeepSeek-R1 (rule-based verifiable rewards as a PRM proxy), Math-Shepherd
(automated step-wise labels), AlphaCode 2 (search + rerank over 1M samples),
ReST-MCTS*, ToolTree, and Token-Level MCTS — all share the same shape:
**a tree of candidate continuations, a per-step grader, and an exploration
policy that prefers high-graded branches.**

This spec defines that engine for Borjie, scoped to regulatory-form filings
(Tumemadini mineral-rights, NEMC environmental compliance, TRA tax) as the
first measurable corpus because those are the highest-leverage,
verifiable-correctness decisions in our domain — each filing has a binary
"submitted-and-accepted" outcome and 30–120 intermediate steps (cite this
section, attach this form, compute this remittance) where step-wise grading
is feasible.

---

## 2. PRM Contract — `score(state, action) → reward ∈ [0, 1]`

A Process Reward Model is a pure function from `(reasoning_state, candidate_step)`
to a scalar in `[0, 1]`. It does **not** judge final correctness; it judges
the *potential* of the current step to lead to a correct outcome. This is the
Math-Shepherd framing — a step's quality equals its expected ability to be
completed into a correct final answer.

```ts
interface PrmInput {
  readonly state: ReasoningState;       // accumulated trajectory so far
  readonly candidateStep: ReasoningStep; // proposed next action
  readonly context: PrmContext;          // tenant, scope, domain hints
}

interface PrmOutput {
  readonly score: number;                // 0..1
  readonly confidence: number;           // 0..1 — model's self-rated certainty
  readonly signals: ReadonlyArray<PrmSignal>; // per-rule breakdown
  readonly explanation: string;
}
```

The contract is intentionally narrow so multiple PRM *implementations* can plug
in: a heuristic rule-based PRM (ships first), a learned PRM (fine-tuned
classifier over reasoning traces — covered by 19C), and a hybrid aggregator
(combines signals via weighted ensemble).

### 2.1 Heuristic PRM signals (Phase 1)

The first ships rule-based, modeled on Borjie's existing "Cite or Stay Silent"
discipline and the regulatory-form domain. Five orthogonal signal families:

1. **`cite_presence`** — does the step cite a corpus document, statute, or
   prior filing? A step that asserts a number with no citation scores ≤ 0.3.
2. **`compliance_precondition`** — for regulatory steps, does the precondition
   (licence active, prior period reconciled, scope matches) hold? Hard-zero if
   precondition violated; full score if all satisfied.
3. **`math_check`** — for numeric steps, does the arithmetic balance? Royalty
   = revenue × rate; PAYE = gross − allowances × bracket. Zero on arithmetic
   contradiction.
4. **`schema_validity`** — does the candidate emit a payload that passes the
   downstream tool's Zod schema? Pre-validates before the rollout commits.
5. **`policy_alignment`** — does the step comply with the active autonomy
   policy + killswitch state? A Tier-2 mutation without approval-grant scores
   zero by construction.

These map 1:1 onto the autonomy + uncertainty + audit ports already wired into
the brain-kernel. The heuristic PRM is therefore **fully implementable today**
without any model training — it's a deterministic projection of contracts the
kernel already enforces.

### 2.2 Learned PRM (Phase 2, stubbed)

A `learned-prm-stub.ts` defines the interface for a future learned PRM:
`load(checkpointUri) → PrmFn`. The checkpoint is trained on labeled reasoning
traces (§5). Today the stub returns `score: 0.5, confidence: 0` and emits a
"learned PRM not yet attached" signal so callers can fall back to the heuristic
without code changes. The DeepSeek-R1 lesson — that a learned PRM weaker than
the policy will be reward-hacked — is encoded as a guard: the aggregator
*never* trusts a learned-PRM signal whose confidence < 0.6 over the rule-based
baseline.

---

## 3. MCTS Contract — Selection / Expansion / Simulation / Backpropagation

Classical Monte Carlo Tree Search, adapted to LLM tool-call branching:

### 3.1 Tree shape

- A **node** is a `ReasoningState` — the trajectory of `(action, observation)`
  pairs that brought us here.
- An **edge** is a candidate `ReasoningStep` — an action the policy could take
  next (a tool call, a sub-question, an evidence lookup).
- The **root** is the initial intent (e.g., "file Q2 Tumemadini royalty").
- A **terminal** is a state that either commits the final answer or hits the
  budget.

### 3.2 Phase 1 — Selection (UCB1)

From the root, descend until we hit a node with unexpanded children. At every
internal node, pick the child maximising

```
UCB1(child) = Q(child) + c · √(ln(N(parent)) / N(child))
```

where `Q(child)` is the running mean PRM score of rollouts through that child,
`N(·)` is visit count, and `c` is the exploration constant (default `√2`,
configurable per-tenant). UCB1 is well-poised for the LLM setting because the
exploration term naturally penalises over-visited branches without requiring a
prior on action distribution.

### 3.3 Phase 2 — Expansion

The expansion policy generates K candidate continuations (default K=4) from
the LLM, *conditioned on the parent state*. These are added as children with
prior score = heuristic-PRM evaluation of the candidate (no rollout yet).
Expansion is the only step that calls the underlying LLM with sampling
temperature > 0 — this is where exploration enters the system.

### 3.4 Phase 3 — Simulation (rollout)

From the newly-expanded child, run a *short* simulated rollout: at most
`max_depth` further steps (default 4), each chosen greedily by heuristic PRM,
until either a terminal is reached or depth is exhausted. The terminal's PRM
score (or, if budget-exhausted, the depth-weighted running mean) becomes the
rollout's value.

### 3.5 Phase 4 — Backpropagation

Walk the path from leaf back to root. At each ancestor, update `N += 1` and
`Q ← Q + (value − Q) / N` (incremental mean). Visited-children statistics are
how UCB1 will route future selections.

### 3.6 Termination

Three orthogonal stopping conditions:

1. **Budget exhausted** — `rollouts ≥ budget` (default 16).
2. **Confident root choice** — the best root child's visit-share exceeds 0.6
   AND its `Q` exceeds 0.8.
3. **Time-boxed** — wall clock exceeds `max_wall_ms` (default 10s).

Whichever fires first wins; the engine returns the *best* path from root to
the highest-`Q` terminal.

---

## 4. Integration — Search over `compose_anything_v1` Tool Calls

The kernel's `compose_anything_v1` pipeline already exposes a tool-call
dispatcher. We graft MCTS onto it without modifying it: a new helper
`mctsToolSearch(intent, ctx, budget) → SelectedToolPath` lives in
`services/api-gateway/src/composition/mcts-tool-search.ts`. Internally it:

1. Builds the root state from `intent + ctx`.
2. Runs `searchDriver({ root, prm, expander, simulator, budget })`.
3. Extracts the highest-`Q` root child's principal path.
4. Replays that path through the regular tool dispatcher so audit + RLS + the
   approval matrix engage as if a single-trajectory had been chosen.
5. Persists the full search tree (or a sampled summary above the configured
   size) to `mcts_search_tree_dumps` for replay + offline analysis.

The function is **opt-in**. The kernel's existing single-trajectory pipeline is
the default. A caller (today: the regulatory-filing executor) explicitly
requests MCTS for high-leverage decisions where the wall-clock budget is
justified. This avoids the DeepSeek-R1 trap of bolting search onto every
turn — search is reserved for branches where the policy alone is known to be
brittle (multi-step compliance filings, multi-jurisdiction tax reconciliation,
multi-month arrears restructuring).

---

## 5. Training the PRM — Bootstrapping from Regulatory Filings

The PRM's learned variant is trained on labeled reasoning traces drawn from
real Tumemadini, NEMC, and TRA filings. Bootstrap process:

1. **Capture phase** — every kernel turn already emits a decision-trace
   breadcrumb. `example-recorder.ts` extends this by capturing the full
   `(state, candidateStep, finalOutcome)` triple and persisting to
   `reasoning_traces`.
2. **Label phase** — for each captured trace where the outcome is verifiable
   (filing accepted by the regulator portal / payment cleared / form returned
   without rejection), `label-collector.ts` propagates the binary outcome
   label backward through the trace using the Math-Shepherd "completer"
   technique: a step is positive iff completing the trace from that step
   yielded the correct outcome on ≥ M of N completer samples.
3. **Minimum corpus** — ≥ 200 fully-labeled traces before the learned PRM may
   ship to production. This is the empirical floor at which Math-Shepherd's
   PRM800K-class behaviour begins to dominate self-consistency baselines for
   in-domain math.
4. **Storage** — labeled positive/negative `(state, step)` pairs go to
   `prm_training_examples`. Trainer (covered by 19C) pulls from this table.

All capture is tenant-scoped, RLS-bound, and behind the same consent layer as
existing decision-traces. Training data leaves the tenant only as
hash-aggregated counts; raw spans never leave the tenant's row-level partition.

---

## 6. Inference Budget — Per-Turn, Per-Tenant, Configurable

Defaults (overridable per tenant via the existing autonomy-policy gate):

| Knob | Default | Notes |
| --- | --- | --- |
| `budget.rollouts` | 16 | Provable-scaling-law range where failure decays exponentially. |
| `budget.maxDepth` | 4 | Simulation depth, not selection depth. |
| `budget.maxWidth` | 4 | Children-per-expansion. |
| `budget.maxWallMs` | 10000 | Wall-clock kill switch. |
| `policy.explorationC` | √2 | UCB1 exploration constant. |
| `policy.minVisitShare` | 0.6 | Early-stop visit-share threshold. |
| `policy.minQValue` | 0.8 | Early-stop quality threshold. |

The budget multiplies LLM cost roughly by `1 + (rollouts × maxDepth / 4)` —
at defaults that is ~17× a single-trajectory turn. The autonomy-policy gate
rejects MCTS for intents whose forecasted reward (from the cost-meter) does
not exceed `17×` the cost of failure; in practice this restricts MCTS to
high-stakes filings + multi-step financial reconciliation, which is the
intended scope.

---

## 7. Schema — Three Tables

Migration `0033_reasoning_traces.sql` adds:

1. **`reasoning_traces`** — one row per (kernel-turn × trajectory) capture.
   Fields: `tenant_id`, `session_id`, `turn_id`, `intent_kind`,
   `trajectory_jsonb`, `outcome_label` (NULL until known), `outcome_source`
   (regulator-portal / payment / human / null), `captured_at`, `labeled_at`,
   `audit_hash`.
2. **`prm_training_examples`** — one row per `(state, step, label)` pair
   derived from labeled traces. Fields: `tenant_id`, `trace_id` FK,
   `state_jsonb`, `step_jsonb`, `label` (0/1), `completer_agreement_ratio`,
   `derived_at`, `audit_hash`.
3. **`mcts_search_tree_dumps`** — one row per MCTS invocation. Fields:
   `tenant_id`, `turn_id`, `root_intent_jsonb`, `tree_jsonb` (compressed,
   capped at 256 KB; oversize falls back to summary), `budget_jsonb`,
   `selected_path_jsonb`, `terminated_reason`, `wall_ms`, `audit_hash`.

All three are tenant-scoped, RLS-bound via `app.tenant_id` (canonical
migration-0003 pattern), and hashed into the audit chain so a regulator can
verify the reasoning trail of any accepted filing.

---

## 8. Anti-Patterns

- **Do not** call MCTS on every turn. It is opt-in. Default remains single
  trajectory.
- **Do not** ship the learned PRM without ≥ 200 labeled traces (DeepSeek-R1
  reward-hacking lesson).
- **Do not** mutate the parent state during expansion — every state is
  immutable; expansion produces *new* states.
- **Do not** persist raw LLM outputs into `mcts_search_tree_dumps` — only the
  canonical action descriptors (tool name + redacted args + PRM score). Raw
  outputs leak per-tenant content into a cross-trace asset.
- **Do not** let the heuristic PRM and the learned PRM both vote *equally*
  before the learned PRM clears its 200-trace floor — confidence-gate it.
- **Do not** silently widen the budget. Budget overrides require an explicit
  approval-matrix entry per tenant.

---

## 9. Phase 2 — SFT/DPO Loop on the PRM (Covered by 19C)

Once `prm_training_examples` accumulates, the 19C work-item attaches a
supervised-fine-tuning loop on the PRM head, and a DPO loop where preferred
trajectories are those scoring highest under the PRM and ratified by the
outcome label. Out-of-scope for this spec; called out so the schema (§7) and
the recorder (`example-recorder.ts`) can be designed for it now.

---

## 10. Acceptance Criteria

- [x] Package `@borjie/process-reward-model` exports `score`, `mcts`,
      `recordExample` with strict types, ≤ 70% coverage minimum.
- [x] `mctsToolSearch` adds opt-in search to the api-gateway composition with
      a single export, no modification to existing wirings.
- [x] Migration `0033_reasoning_traces.sql` creates the three tables with RLS.
- [x] Audit-chain link emitted for every MCTS invocation.
- [ ] (19C) Learned PRM trained on ≥ 200 labeled Tumemadini/NEMC/TRA traces.
- [ ] (19C) DPO loop on preferred trajectories.

This document, the package, the wrapper, and the migration constitute the
P0 #1 closure. The actual *reasoning engine* now exists in code; the
remaining 19C work feeds it with labels.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

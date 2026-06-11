# Durable · Dynamic · Recursive Orchestration — SOTA Dossier

**Lane:** `durable-dynamic-recursive-orchestration` — orchestration that is **RELIABLE + ADAPTIVE + SCALES**.
**Date:** 2026-06-09
**Branch:** `integration/parity-final`
**Audience:** Borjie/BossNyumba brain-layer architects — central-intelligence kernel orchestrator, workflow-engine, loop-runner, blackboard-sota slot spine, the reversibility-typed actuator/saga port, the durable-execution composition root.
**Method:** Heavy current web research (June-2026 sources cited by name + link) fused with a read of the live substrate (`packages/central-intelligence/src/durable/*`, `packages/workflow-engine`, `packages/loop-runner`, `packages/blackboard-sota`, `packages/brain-llm-router`, `kernel/sub-mds/registry.ts`, `kernel/orchestrator/{planner-dispatcher,lats-search}.ts`) and the consolidated gap registers (`MASTER_GAP_REGISTER.md`, `ORCHESTRATION_SPEC.md`, `ORCHESTRATION_FRONTIER_ADDENDUM.md`).

> **One-line thesis.** The frontier of agent orchestration in 2026 has split into three independently-maturing pillars — **DURABLE** (journal-replay execution that survives crashes and resumes a half-run orchestration), **DYNAMIC** (the orchestration graph is *planned and reshaped at runtime*, not a fixed DAG), and **RECURSIVE** (each level is itself a viable mini-orchestrator — holonic / VSM recursion). Borjie owns strong seeds of all three but has wired none of them as the live default. The *beyond-today* move — and the one frontier vendors only shipped the first primitive of in May 2026 (Cloudflare Dynamic Workflows) — is **all three at once**: a self-planning, self-healing, *resumable* orchestration graph that *nests*, where the brain writes its own durable plan, that plan is a dynamic graph, and any node of it can recursively become its own durable sub-orchestration. That is INV-C (infinite self-extending nervous system) + INV-G (uncapped/durable horizon) made operational.

---

## 0. The three pillars, and where the field actually is (June 2026)

| Pillar | What it guarantees | 2026 state-of-the-art | Borjie seed | Borjie status |
|---|---|---|---|---|
| **DURABLE** | A run resumes *exactly where it stopped* after a crash; effects fire exactly-once; horizon is unbounded (months) | Temporal, DBOS, Restate, Inngest, Hatchet, Cloudflare Workflows V2, LangGraph-checkpointer, Dapr | `central-intelligence/src/durable/inngest-executor.ts` (step-checkpointed wrapper), `workflow-engine` (hash-chained state machine), `durable/functions/licence-suspension-flow.ts` | **Built, opt-in, UNDEPLOYED** (RSS-23): `DURABLE_EXEC_ENABLED` off, no worker in k8s |
| **DYNAMIC** | The orchestration *graph itself* is chosen/reshaped per task at runtime; emergent, not pre-wired | Puppeteer (evolving orchestration), AgentNet (decentralized graph evolution), MasRouter (learned topology per query), AdaptOrch (Feb-2026 topology selector), AlphaEvolve/AFlow (offline graph search) | modality-arbiter spec (unbuilt), `planner-dispatcher.ts` (ToT/LATS picker), `blackboard-sota` (CRDT coordination spine) | **MISSING the head** — pipeline is fixed; `sub-mds/registry.ts` is static push-dispatch (O(n²) to extend) |
| **RECURSIVE** | Each level is a viable mini-orchestrator; sub-orchestrators nest to arbitrary depth | ROMA (Atomizer/Planner/Executor/Aggregator, Feb-2026), holonic recursive planning, VSM recursion, Beer's "system-in-focus" | `loop-runner` (orphan), `md-subagent-executor.runSubagentTeam` (flat fan-out) | **FLAT** — `EXEC-dag` flagged: VP sub-MD dispatch is a flat list, no DAG, no nested durable worker |

The decisive 2026 finding: **these three pillars are converging into one runtime.** Until ~Q1-2026 they were separate products (a workflow engine OR a multi-agent framework OR a router). Cloudflare's **Dynamic Workflows** (May 2026), Temporal × OpenAI-Agents-SDK durable integration (GA), Restate Virtual-Object agents, and ROMA's recursive durable tree are the first systems where *durable + dynamic + recursive* live in one substrate. Borjie's competitive position: it was **born with the governance moat** (FORCE-RLS, hash-chained audit, fail-closed kill-switch, four-eye, isolated-vm, mandatory evidence Auditor) that every one of these systems bolts on as an afterthought — so for Borjie this is a *wiring-and-fusion* program, not greenfield.

---

## 1. DURABLE orchestration — journal-replay, resume-the-half-run, exactly-once, long-horizon

### 1.1 The category and the determinism boundary
Durable execution journals **every completed step** to a persistent log *before* returning its result; on crash the function re-executes from the top, and each step already in the journal returns its cached result instantly (no re-run) until execution catches up and continues. The non-negotiable rule for an LLM agent: **a non-deterministic LLM/tool call must be wrapped as a journaled "activity"/`step.run()`/`ctx.run()` so its result is recorded on first execution and never re-run on replay** ([ZenML — where durable execution is headed](https://www.zenml.io/blog/where-durable-execution-is-headed), [Restate — what is durable execution](https://www.restate.dev/what-is-durable-execution)).

Two replay paradigms, and Borjie must pick deliberately:
- **Deterministic replay (Temporal):** the *whole* workflow re-runs against a recorded event history and must issue the same commands in the same order — forbids `Date.now()`/`Math.random()`/direct I/O outside activities. Strongest guarantees, strictest constraints.
- **Checkpoint-based (DBOS, Restate `ctx.run`, Inngest `step.run`, Cloudflare `step.do`):** only explicitly-wrapped steps are restored; code between steps may re-run. Looser, more LLM-friendly (variable results between retries don't violate the contract). Borjie's Inngest wrapper is already this model.

### 1.2 The 2026 engine landscape (pick per workload)
- **Temporal** — category leader; strongest for **months-long** workflows, 100k+ child fan-out, signals/timers at scale, first-class **per-tenant namespace isolation + event-history UI**. Cost: a 3-service cluster (Frontend/History/Matching) + worker fleets + per-action cloud pricing. Activities default **at-least-once** → you supply idempotency keys ([DBOS vs Temporal 2026](https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution)).
- **DBOS** — a *library* you import with a Postgres connection; step results commit **transactionally alongside business writes** → tightest exactly-once *when effects stay in your Postgres*. Breaks first at Postgres contention (hot fan-out hammers the status table). Best for ≤5-eng teams with Postgres depth and DB-local effects. Shipped a Go SDK + Databricks Lakebase partnership by Apr-2026, hardening the "Postgres is enough" case.
- **Restate** — modern journaling engine; **exactly-once without app-level idempotency keys** (replays skip already-executed `ctx.run` calls); **Virtual Objects** model stateful, concurrency-controlled agents keyed by session/user id — directly relevant to a per-tenant MD ([Restate × OpenAI-Agents-SDK](https://www.restate.dev/blog/durable-orchestration-for-ai-agents-with-restate-and-openai-sdk)).
- **Inngest** — event-driven `step.run` checkpointing; **what Borjie already wrote** (`inngest-executor.ts`). Memoizes by `(functionId, runId, stepId)`; default exponential-backoff retry per step.
- **Cloudflare Workflows V2** (GA May-2026) — `run(event, step)` where `step.sleep()` hibernates at zero idle cost, `step.waitForEvent()` waits indefinitely for human approval, **50k concurrent workflows**, deterministic execution ([Workflows GA](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/)).
- **LangGraph checkpointer** — persists full graph state (messages, tool outputs, control-flow position); `interrupt()` is the *same primitive* for pause-for-human and pause-for-clock ([LangChain durable execution docs](https://docs.langchain.com/oss/python/langgraph/durable-execution)).

### 1.3 The critical nuance: **checkpoints are NOT durable execution**
A state-checkpointer (LangGraph/CrewAI/Google ADK) saves state and says "you take it from here." It lacks: **automatic failure detection** (no supervisor/watchdog/heartbeat), **automatic resumption** (you must invoke resume APIs yourself), **distributed dedup/locking** (two processes can resume the same run → race), and **distributed execution** across a worker pool ([Diagrid — checkpoints are not durable execution](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows)). *"Checkpointers save state; durable execution guarantees completion."* **This is exactly Borjie's RSS-23 + RSS-21 + RSS-01 gap:** the four-eye approval queue, ledger publisher, and wake/monitor are in-memory; a checkpoint without a supervisor that *re-drives to completion* is not the at-least-once + exactly-once-effect guarantee INV-G demands.

### 1.4 Framework-native durable agents (the integration pattern Borjie should copy)
- **Temporal × OpenAI-Agents-SDK** (GA): every agent invocation runs as a Temporal **Activity**, the agent loop is a **Workflow** → automatic retries + crash-resume for free, no orchestration rewrite ([Temporal announcement](https://temporal.io/blog/announcing-openai-agents-sdk-integration)).
- **Restate × Pydantic-AI / OpenAI-SDK**: multi-tool agent loop where *each* model call, tool call, and HITL step is individually durable so a flaky LLM, tool timeout, or 24-hour approval wait loses no progress and repeats no side-effect.
- **Vercel AI SDK × Temporal**: the same pattern for TS.

**Borjie alignment:** the `inngest-executor.ts` wrapper *already* slices `TaskAgentExecutor.execute` into `validate → execute-agent → notify-completion` resumable steps with stable deterministic step ids and an idempotency `requestId`. The gap is purely **deployment + default-on + extending the pattern to the kernel main-loop**, not the money-touching task-agent only.

---

## 2. DYNAMIC / self-organizing orchestration — the graph is planned and reshaped at runtime

The fixed-DAG era is ending. Three mechanism families:

### 2.1 Centralized learned orchestrator that reshapes the graph — **Puppeteer**
**"Multi-Agent Collaboration via Evolving Orchestration"** ([arXiv:2505.19591](https://arxiv.org/abs/2505.19591)). A centralized **"puppeteer"** orchestrator, a *policy* `aₜ ∼ π(Sₜ, τ)` over a **directed graph-of-thoughts**, selects **one agent to activate per step** conditioned on global state, and terminates when a terminator agent is chosen or the budget is exhausted. Trained by REINFORCE/PPO with a reward that *subtracts a step-cost penalty* `Cₜ = F·log(1+t/φ)` (F = tokens/FLOPs) — so the orchestrator is **paid to be cheap**. The headline emergent result: under training the graph **compacts** (communication concentrates on a few hub agents) and becomes **cyclic** (Reasoner→Critic→Reasoner feedback loops for mutual verification) — and *token consumption falls while accuracy rises* (e.g. Titan pool avg 0.689→0.773 across GSM-Hard/MMLU-Pro/SRDD/CommonGen-Hard). **This is the trained form of Borjie's modality-arbiter** — and it proves the arbiter should optimize a *cost-penalized* objective, not just route.

### 2.2 Decentralized graph evolution — **AgentNet**
**AgentNet** ([arXiv:2504.00587](https://arxiv.org/pdf/2504.00587)). Nodes (agents) **and edges** (connections) adapt at runtime: frequently-useful connections *strengthen*, unused ones *atrophy*; a **dual router/controller** decouples message-routing from task-decomposition; coordination is distributed → no single bottleneck, fault-tolerant. The lesson for Borjie: the `sub-mds/registry.ts` *static push-dispatch* (the addendum's O(n²)-to-extend wiring) should become an **adaptive edge set** where the MD↔junior wiring is a *learned, evolving parameter*, not a hard-coded fan-out list.

### 2.3 Learned topology + model routing *per query* — **MasRouter / AdaptOrch**
- **MasRouter** ([arXiv:2502.11133](https://arxiv.org/abs/2502.11133), ACL-2025): a **collaboration determiner** uses a variational model to infer the best **topology** (Chain / Tree / Debate) *from query complexity*, and a **learnable complexity function on the query embedding derives the number of agents** — dynamic scaling by construction. First inductive Multi-Agent-System-Routing solution; cost-effective.
- **AdaptOrch** (Feb-2026): dynamically selects orchestration topology (parallel / sequential / hierarchical / hybrid) **from the task's dependency graph** rather than a fixed pipeline ([self-healing orchestration search results](https://arxiv.org/html/2606.01416v1)).
This is the direct answer to Borjie's UI-invariant analogue at the orchestration layer: **no fixed catalog of flow shapes** — the brain *synthesizes the orchestration topology* the need calls for (mirrors INV-C "no fixed catalog of nodes/edges").

### 2.4 Offline graph search (the slow loop that feeds the fast loop)
AFlow (MCTS over code-represented workflows, smaller models beat GPT-4o at 4.55% inference cost) and AlphaEvolve (evolutionary diff-mutation over a program archive with an automated fitness function) **discover** good graphs offline; the discovered graph is then run durably online. Borjie's `dynamic-recipe-authoring` (orphan, DOC-02/AUT-07) is the natural AFlow host; the `reflexion-sleep-canary` window is the AlphaEvolve loop slot. *(Detailed in `frontier-self-improving-orchestration.md`; cited here as the source of the dynamic graphs the durable runtime executes.)*

### 2.5 Market-based / Contract-Net task allocation (the O(n²)→O(n) waist)
Contract-Net Protocol: the manager broadcasts a task, capable agents submit **sealed bids** (confidence, evidence_count, token_cost, ETA), award goes to best expected-value-per-token; adding a 51st junior needs **zero router edits** ([apxml — coordination mechanisms in MAS](https://apxml.com/courses/agentic-llm-memory-architectures/chapter-5-multi-agent-systems/coordination-mechanisms-mas), [DEV — market-based task allocation pattern](https://dev.to/slythefox/the-5th-agent-orchestration-pattern-market-based-task-allocation-db0)). **COALESCE** ([arXiv:2506.01900](https://arxiv.org/pdf/2506.01900)) studies the economic + *security* dynamics of skill-based outsourcing among LLM agents. **Hard guardrail (from the frontier addendum's Magentic-Marketplace warning):** a naive internal market among unequal-capability juniors gets *exploited* (cheap-confident junior wins bids it can't fulfill) — so auctions MUST be gated by a **reserve-quality floor + reputation weight + Auditor-as-regulator**. Borjie already has the CNP shape in `packages/procurement-coordination/src/rfq` to reuse as the protocol.

---

## 3. RECURSIVE / hierarchical orchestration — each level is a viable mini-MD (holonic / VSM)

### 3.1 Recursive Open Meta-Agent — **ROMA** (the cleanest 2026 contract)
**ROMA** ([arXiv:2602.01848](https://arxiv.org/abs/2602.01848), Feb-2026; [github sentient-agi/ROMA](https://github.com/sentient-agi/ROMA)) standardizes recursion around **four roles**: **Atomizer** (decide: is this task atomic, or decompose?), **Planner** (build a dependency-aware subtask *tree*), **Executor** (run a leaf — *and an Executor can itself recursively spawn its own subtree*), **Aggregator** (compress + *validate* children's results before propagating upward, controlling context growth). Dependency-free siblings run **in parallel**; the recursion is **depth-adaptive**. Crucially it **separates orchestration from model selection** → each node picks its own model tier. This solves exactly Borjie's INV-G "reasoning not capped by the context window — big work DECOMPOSES into junior swarms": ROMA's Aggregator is the context-compression discipline, and its recursive Executor is the nesting INV-C demands. **It is the recursive skeleton Borjie's flat `runSubagentTeam` should become.**

### 3.2 Holonic recursion + the Viable System Model
A **holon** is simultaneously an autonomous *whole* and an *organization of holons* → **intrinsically recursive**, naturally describing hierarchical systems; "distributed, dynamic and recursive planning for holonic MAS" gives a behavioural-model approach to plan across the holon hierarchy under unpredictable sub-holon behaviour ([MDPI Electronics 12(23):4797](https://www.mdpi.com/2079-9292/12/23/4797), [Springer — Holonic Recursiveness with MAS](https://link.springer.com/chapter/10.1007/978-3-319-00563-8_13)). This maps directly onto **Beer's Viable System Model**: every recursion level (estate → subsidiary → operation → site → loop) is itself a *viable system* with its own System-1..5 (operations, coordination, control, intelligence, policy). For Borjie this is the architecture of "**each sub-MD is a full mini-Mr.-Mwikila**" — the same kernel (INV-D) at every level of the org-graph, with the parent's governor (policy-gate/kill-switch/audit) inherited but never overridable by the child (the meta-rail recursion invariant).

### 3.3 ROMA-style nesting + durable = the resumable holon
The under-appreciated 2026 synthesis: a recursive subtask tree where **every node is a durable step** means a 3-week shipment-settlement holon can sleep at any depth, survive restart, and resume the *exact* sub-sub-task that was in flight. Cloudflare Dynamic Workflows (below) is the first runtime to make nested durable plans first-class.

---

## 4. COST / LATENCY / MODEL-TIER-aware routing (route each step to the cheapest capable model)

### 4.1 The cascade + router stack
- **RouteLLM** ([arXiv:2406.18665](https://arxiv.org/abs/2406.18665), [lm-sys/RouteLLM](https://github.com/lm-sys/routellm)): trains a router to estimate `P(strong model wins | query)` and route to the weak model below threshold — **85% cost cut at 95% of strong-model quality**; the **BERT-classifier variant runs <10ms, no LLM inference to decide**. This is the right shape for Borjie's `on-device MiniLM router` (`ON_DEVICE_MINILM_ROUTER.md`) as the arbiter's cheap first pass.
- **Model cascading**: send to the cheapest model first; a lightweight verifier (regex / small-classifier confidence) escalates only "hard" inputs → **~85% of queries handled by budget models, 60–80% cost reduction** ([best LLM routers 2026](https://www.clawrouters.com/blog/best-llm-routers-2026), [LLM gateway routing guide](https://lushbinary.com/blog/llm-gateway-model-routing-cost-optimization-guide/)).
- **Speculative cascades** ([Google Research](https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/), [Faster Cascades via Speculative Decoding, arXiv:2405.19261](https://arxiv.org/html/2405.19261v2)): small model drafts, large model verifies *in parallel* with a flexible token-level **deferral rule** — cascade cost-quality with speculative speed.
- **2026 router evolution:** static classifiers (RouteLLM) → RL reasoning routers (Router-R1) → multi-agent routing (**MasRouter**) → **bandit-feedback online routers (BaRP, PILOT)** that learn from live outcomes → **MCP gateways as unified control planes** ([Zylos — AI agent model routing](https://zylos.ai/research/2026-03-02-ai-agent-model-routing/)).

### 4.2 The decisive lesson for a Tanzania-first cost target
AFlow/Puppeteer prove the cost win compounds **at the orchestration layer, by construction**: a discovered/learned graph routes *most* steps to a cheap model and reserves Opus for the one hard node — "smaller models beat GPT-4o at 4.55% of the cost." So Borjie should not bolt a router under a fixed pipeline; it should make the **orchestrator itself cost-penalized** (Puppeteer's `Cₜ` term) so cheapness is an emergent property of the graph, and let ROMA's orchestration/model separation assign a tier per recursion node.

### 4.3 Borjie substrate
`packages/brain-llm-router` has `cost-cascade` + `provider-fallback/fallback-router` + `routing-overrides` — but inspection shows this is **provider-failover and a cost ladder, not a capability cascade or a learned per-query topology router**. There is no RouteLLM-style "will the weak model win?" classifier in the decision path, and no cost-penalty term in the (unbuilt) arbiter. `EXEC-budget` (RSS) flags that TPM+cost ceilings aren't enforced across orchestrator + fan-out.

---

## 5. BEYOND-TODAY — durable + dynamic + recursive, all at once

This is the lane's mandate and the genuine frontier. Each finding below pairs a real June-2026 source with the leap past it.

### 5.1 The agent writes its own *durable* plan, and that plan is a *dynamic graph* — **Cloudflare Dynamic Workflows**
**Cloudflare Dynamic Workflows** (May-2026, [blog](https://blog.cloudflare.com/dynamic-workflows/), [InfoQ](https://www.infoq.com/news/2026/05/cloudflare-dynamic-workflows/)): durable execution that **follows the tenant/agent** — *"a `run(event, step)` function the model wrote a minute ago, where every `step.do(...)` is independently retryable, every `step.sleep()` hibernates for free, every `step.waitForEvent()` pauses indefinitely for human approval."* Per-tenant/per-agent/per-request code dispatched at near-zero idle cost (Dynamic Workers boot in single-digit ms).
**Beyond-today leap for Borjie:** this is the *exact* runtime shape of the modality-arbiter's output. When the arbiter classifies AGENT/WORKFLOW and *synthesizes* a plan, that plan should be **emitted as a durable graph** — each step a journaled checkpoint, each `waitForEvent` a HITL rail (money/licence/deletion), each `sleep` a 60-day-renewal horizon. Borjie's edge over Cloudflare: the synthesized plan passes through the **body-change meta-rail + four-eye + Auditor evidence gate** before it can self-apply — durable *and* governed. **No vendor ships durable-execution-of-agent-authored-plans-behind-an-inviolable-governor; that is the moat.**

### 5.2 A *recursive* durable holon that *self-heals* at any depth
Fuse **ROMA** (recursive Atomizer/Planner/Executor/Aggregator tree) + **Self-Healing Agentic Orchestrators** ([arXiv:2606.01416](https://arxiv.org/html/2606.01416v1)) + durable steps. The self-healing paper's reliability control plane maps **7 failure classes → targeted bounded recovery** (timeout→retry/substitute; schema-fail→arg-repair; wrong-tool→replan-this-step; stale-context→refresh; contradictory-evidence→cross-check/verifier; semantic-fail→regen-with-constraints) and reaches **98.8% task success vs 70.1% static / 94.5% retry-only**, with a verifier driving **0% silent failure**. The key principle — *"local repair beats global replan"* — is HTN plan-repair: preserve the executed prefix, fix only the unaffected subtree.
**Beyond-today leap:** make every ROMA node a durable step *and* attach the self-healing control plane *per recursion level*, so a failure in a deep sub-sub-task triggers **bounded local repair at that level** (not a top-level replan), the repair is **journaled** (resumable), and the recovered trajectory is **verified by the Auditor** before propagating up. This is `COG-13` (plan-repair node) + `EXEC-saga` (compensation) + durable, unified — a self-healing, resumable, recursive orchestration. The null-action and saga-compensation (reverse the executed prefix when repair is impossible) ride the same spine, satisfying INV-F (reversible-or-compensable actuators).

### 5.3 A cost-penalized, *evolving* orchestrator over a *durable* graph
Fuse **Puppeteer** (cost-penalized RL orchestrator that compacts the graph) + **AgentNet** (edges strengthen/atrophy) + durable execution. The orchestrator's *learned* graph is materialized as a durable workflow; the **step-cost penalty** `Cₜ` and the **EV-gate** (decision-NPV vs ~15× multi-agent token cost) are the *same* budget the durable engine enforces.
**Beyond-today leap:** Borjie's orchestrator graph becomes a **learnable, cost-penalized, durable object** that *gets cheaper and more reliable every night* — the offline AFlow/AlphaEvolve search (slow loop, `reflexion-sleep-canary` window) proposes graph diffs; the live durable runtime (fast loop) executes the current-best graph; the Puppeteer cost term + RouteLLM cheap-first cascade make Tanzania-first economics emergent. All graph mutations pass the meta-rail (mutable-layer-only, never the governor — the §13 RSI fence).

### 5.4 Holonic recursion = the org-graph twin
**Beyond-today leap (INV-B + INV-C):** because a holon is whole-and-parts and the VSM recursion repeats the same viable structure at every level, Borjie's **org-graph *is* the orchestration recursion**: estate→subsidiary→operation→site→flow each instantiate the *same* kernel (INV-D) as a viable mini-MD, durable and dynamic, with the parent's inviolable governor inherited downward and *no child able to widen its own mandate* (capability beneath autonomy — `ORCHESTRATION_SPEC §enforcement`). Lenses (INV-B) are then **roll-up/drill-down queries over the recursion tree**, and the tree auto-expands/contracts as the org grows (5 ops → 5,000) — INV-G size-uncapped by construction.

### 5.5 The durable-memory safety coupling
**Beyond-today invariant (non-negotiable):** every *durable* self-improving write (a learned graph diff, a captured skill, a distilled strategy) gets the **same shield/eval/attestation as a real-world action**, because a poisoned durable plan re-infects forever. Durable + dynamic + recursive amplifies blast-radius: a bad nested durable holon can silently re-drive to completion across restarts. So the durable runtime must journal *through* the Auditor + policy-gate, and the kill-switch must be able to **halt and compensate a half-run durable graph at any depth** (fail-closed). This is the fusion of the offense moat (durable autonomy) with the defense moat Borjie was born with.

---

## 6. Mapping to Borjie's live gaps (this lane's slice of the register)

| Gap (register) | This-lane reading | The durable-dynamic-recursive move |
|---|---|---|
| **RSS-23** (durable Inngest opt-in, no worker) | DURABLE pillar not deployed | Ship the Inngest (or Restate/DBOS) worker + `DURABLE_EXEC_ENABLED=true`; extend wrapper beyond task-agent to the kernel main-loop |
| **RSS-01 / RSS-21** (in-memory ledger publisher + four-eye queue) | "checkpoints ≠ durable" — no supervisor re-drives to completion | Durable outbox + durable approval router (the Diagrid critique applied) |
| **EXEC-saga** (sagas/compensation not wired) | self-heal/compensate the executed prefix | Saga + compensation as durable steps preserving double-entry via `LedgerService.post` |
| **COG-07 / AUT-14** (modality arbiter missing) | DYNAMIC pillar has no head | Build the arbiter as a **cost-penalized** (Puppeteer) classifier emitting a **durable dynamic graph** |
| **EXEC-dag** (flat VP sub-MD dispatch) | RECURSIVE pillar is flat | Add `dependsOn`/`level` + topological scheduler → **ROMA** Atomizer/Planner/Executor/Aggregator nesting, each node durable |
| **`sub-mds/registry.ts` static push** (addendum) | O(n²) wiring, no market | Contract-Net (reserve-floor + reputation + Auditor-regulator) → O(n) |
| **EXEC-budget** (TPM/cost not enforced) | COST pillar not in the loop | RouteLLM cheap-first cascade + Puppeteer `Cₜ` step-cost penalty + EV-gate |
| **COG-13** (no plan-repair node) | self-healing local repair | 7-class failure→bounded-recovery control plane per recursion level |
| **`loop-runner` orphan** | LOOP modality unreachable | Wire as the durable LOOP executor with `loop-quality-gates` |

---

## 7. Sequence (smallest leap → largest, each reusing a live seed)

1. **Turn DURABLE on.** Deploy the Inngest worker, default `DURABLE_EXEC_ENABLED=true`, make the four-eye queue + ledger publisher durable (kill the "checkpoint without supervisor" gap). *Seed: `durable/inngest-executor.ts`, `workflow-engine`.*
2. **Cost-penalized arbiter (the head).** Build `modality-arbiter.ts` as a RouteLLM-style <10ms classifier with a Puppeteer step-cost objective; emit a `run_modality` Decision whose AGENT/WORKFLOW output is a **durable dynamic graph**. *Seed: `planner-dispatcher.ts`, `brain-llm-router/cost-cascade`, `ON_DEVICE_MINILM_ROUTER.md`.*
3. **Recursive durable executor (ROMA).** Replace flat `runSubagentTeam` with Atomizer/Planner/Executor/Aggregator where each node is a durable step and an Executor can recurse. *Seed: `md-subagent-executor`, `loop-runner`, `blackboard-sota` (coordination).*
4. **Self-healing control plane.** 7-class failure→bounded-recovery + verifier per level; HTN local-repair (preserve prefix) + saga compensation as durable steps. *Seed: `kernel/critics`, Auditor, `LedgerService`.*
5. **Contract-Net allocation.** Reserve-floored, reputation-weighted, Auditor-regulated bidding to replace static push-dispatch. *Seed: `procurement-coordination/rfq`.*
6. **Evolving graph (slow loop).** AFlow/AlphaEvolve offline graph search in the sleep window proposing durable-graph diffs, governed by the meta-rail. *Seed: `dynamic-recipe-authoring`, `reflexion-sleep-canary`.*
7. **Holonic recursion = org-graph twin.** Same kernel at every VSM level; lenses as roll-up/drill-down over the durable recursion tree. *Seed: `system-graph`, org-graph, INV-B/C/D.*

**Invariant across all 7 (the moat):** the durable runtime journals *through* the policy-gate + Auditor; money/licence/deletion are `waitForEvent` HITL rails forever; the kill-switch can halt+compensate a half-run durable graph at any depth, fail-closed; self-improving graph mutations stay in the mutable layer and never touch the governor (`inviolable.ts`). Same for BossNyumba — identical kernel, real-estate domain layer.

---

## 8. Sources (June-2026 research)

**Durable execution**
- ZenML — Where durable execution is headed: https://www.zenml.io/blog/where-durable-execution-is-headed
- DBOS vs Temporal (2026): https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution
- Restate — What is durable execution: https://www.restate.dev/what-is-durable-execution · Restate × OpenAI-SDK: https://www.restate.dev/blog/durable-orchestration-for-ai-agents-with-restate-and-openai-sdk
- Diagrid — Checkpoints are NOT durable execution: https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows
- Temporal × OpenAI-Agents-SDK (GA): https://temporal.io/blog/announcing-openai-agents-sdk-integration
- LangChain — LangGraph durable execution: https://docs.langchain.com/oss/python/langgraph/durable-execution
- Cloudflare Workflows GA: https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/
- Spheron — Temporal/Inngest/Restate for agents (2026): https://www.spheron.network/blog/ai-agent-workflow-orchestration-temporal-inngest-restate-gpu-cloud/

**Dynamic / self-organizing**
- Puppeteer — Multi-Agent Collaboration via Evolving Orchestration: https://arxiv.org/abs/2505.19591 (html: https://arxiv.org/html/2505.19591v2)
- AgentNet — decentralized evolutionary coordination: https://arxiv.org/pdf/2504.00587
- EmergentMind — Evolving Orchestration topic: https://www.emergentmind.com/topics/multi-agent-collaboration-via-evolving-orchestration
- MasRouter — learning to route LLMs for MAS: https://arxiv.org/abs/2502.11133
- Self-Healing Agentic Orchestrators (incl. AdaptOrch ref): https://arxiv.org/html/2606.01416v1
- COALESCE — economic+security of skill outsourcing among LLM agents: https://arxiv.org/pdf/2506.01900
- Market-based task allocation pattern: https://dev.to/slythefox/the-5th-agent-orchestration-pattern-market-based-task-allocation-db0
- Coordination mechanisms in MAS (CNP/CBAA/CBBA): https://apxml.com/courses/agentic-llm-memory-architectures/chapter-5-multi-agent-systems/coordination-mechanisms-mas

**Recursive / holonic**
- ROMA — Recursive Open Meta-Agent Framework: https://arxiv.org/abs/2602.01848 · https://github.com/sentient-agi/ROMA
- Holonic distributed/dynamic/recursive planning (MDPI Electronics 12(23):4797): https://www.mdpi.com/2079-9292/12/23/4797
- Holonic Recursiveness with MAS (Springer): https://link.springer.com/chapter/10.1007/978-3-319-00563-8_13

**Cost / latency / model-tier routing**
- RouteLLM: https://arxiv.org/abs/2406.18665 · https://github.com/lm-sys/routellm · https://www.lmsys.org/blog/2024-07-01-routellm/
- Speculative cascades (Google Research): https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/ · Faster Cascades via Speculative Decoding: https://arxiv.org/html/2405.19261v2
- Best LLM routers 2026: https://www.clawrouters.com/blog/best-llm-routers-2026 · LLM gateway routing guide: https://lushbinary.com/blog/llm-gateway-model-routing-cost-optimization-guide/
- Zylos — AI agent model routing (router evolution 2024→2026): https://zylos.ai/research/2026-03-02-ai-agent-model-routing/

**Beyond-today convergence**
- Cloudflare Dynamic Workflows (durable + dynamic, May-2026): https://blog.cloudflare.com/dynamic-workflows/ · https://www.infoq.com/news/2026/05/cloudflare-dynamic-workflows/

---

## 9. Verdict

The frontier in June-2026 is not "pick a workflow engine" or "pick a multi-agent framework" — it is the **fusion of durable + dynamic + recursive into one runtime**, and the first vendor primitives for that fusion shipped only this quarter (Cloudflare Dynamic Workflows, Temporal×OpenAI-SDK, ROMA, Restate Virtual-Object agents). Borjie holds strong seeds of every pillar (`inngest-executor`, `workflow-engine`, `loop-runner`, `blackboard-sota`, `brain-llm-router`, `planner-dispatcher`) but runs **none as the live default**: durable is opt-in/undeployed, dynamic has no arbiter head, recursive is flat, cost-routing is provider-failover not capability-cascade. The buildable best-in-world target is a **cost-penalized, self-planning, self-healing, resumable orchestration graph that nests** — the arbiter writes a *durable dynamic graph*, each node a journaled step, each node recursively a ROMA sub-orchestration, each level self-healing by bounded local repair, the whole thing getting cheaper and more reliable every night via offline graph search — all journaled *through* the inviolable governor Borjie was born with (FORCE-RLS, hash-chained audit, fail-closed kill-switch, four-eye, evidence Auditor). That governor is the moat: **no frontier system ships durable-execution-of-agent-authored, dynamically-evolving, recursively-nested plans behind an inviolable, fail-closed, evidence-gated control plane.** Sequence it durable-first (turn the lights on + kill the checkpoint-without-supervisor gap), then the cost-penalized arbiter head, then ROMA recursion + self-healing, then Contract-Net + evolving graph + holonic org-twin — money/licence/deletion stay `waitForEvent` HITL rails forever.

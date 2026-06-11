# SOTA Multi-Agent Orchestration Topologies + Frameworks (June 2026)

**Lane:** orchestration-topologies — the patterns and frameworks for coordinating
dozens of agents without chaos, and which topology to use for which job.
**Date:** 2026-06-09
**Author:** research subagent (deep current web research; primary sources cited)
**Audience:** Borjie/BossNyumba brain-layer architects wiring the resident
EstateMind loop, the modality-arbiter, the juniors/agent-swarms, the
workflow-engine + loop-runner, the blackboard-sota CRDT slot spine, and the
meta/body-change rail.

> **Owner invariants honored throughout.** INV-C (infinite self-extending nervous
> system — no cap on nodes/edges; topology forms/reforms dynamically), INV-D
> (veteran kernel — disciplined, never single-shot), INV-G (uncapped + durable),
> INV-H/D (ABSOLUTE no-IP-leak — orchestration internals NEVER reach any client;
> show status + outputs only), and the HITL rails (money/licence/deletion +
> meta-rail). Every recommendation below is filtered through "we cannot be less
> than SOTA," and each finding carries a **beyond-today leap**.

---

## 0. TL;DR — the decision the brain must make every turn

There is no single "best" topology. The 2026 consensus across Anthropic,
LangChain, Microsoft, Google, OpenAI and AWS is that **topology is a function of
task structure**, and the frontier (Feb–Jun 2026 papers: AdaptOrch, HERA,
Dy-Topo, MetaGen) is a **router that picks AND reshapes the topology per task**.
Borjie's `modality-arbiter` is exactly that router in embryo — it already maps a
turn to ANSWER / SKILL / WORKFLOW / LOOP / AGENT-SWARM. The leap is to extend it
from a 5-way *modality* arbiter into a true **topology arbiter** that, for the
AGENT-SWARM modality, additionally selects orchestrator-worker vs blackboard vs
swarm-handoff vs hierarchical vs pipeline, and re-routes mid-flight on stall.

The seven canonical topologies, ranked by where they fit:

| Topology | Best for | Reliability | Cost/latency | Borjie home |
|---|---|---|---|---|
| **Deterministic pipeline** | known multi-step flows (process_royalty_payment, onboard_site) | highest (auditable, replayable) | lowest | `workflow-engine` |
| **Orchestrator-worker** | breadth-first decompose-and-fan-out (deep research, cross-domain status) | high | ~15× tokens | `md-subagent-executor` |
| **Hierarchical / supervisor** | a turn that delegates to specialist juniors then synthesizes | high, traceable | medium | juniors via supervisor |
| **Blackboard** | open-ended discovery where the lead can't know each agent's competence up front | high at scale | medium | `blackboard-sota` (THE spine) |
| **Swarm / decentralized handoff** | conversational role-transfer (sales→compliance→treasury) | medium | lowest LLM calls | `subagent-spawn` handoff |
| **Planner-executor / group-chat** | exploratory tasks where steps aren't known in advance | medium | medium-high | `loop-runner` + planner-dispatcher |
| **Network / graph** | arbitrary DAGs, fan-out/fan-in, loops, retries | high (deterministic edges) | low | `workflow-engine` graph |

---

## 1. The seven canonical topologies (what each is, when to use it)

### 1.1 Deterministic pipeline (sequential chain)
Agents run in a fixed order; output of step N feeds N+1. Google ADK's
`SequentialAgent` is the canonical primitive ("assembly line: fetch → clean →
analyze → summarize"). **Use when** the flow is known and you want auditability,
replay, and lowest cost. **Never** use a supervisor or swarm for a strictly
sequential task — they add latency and token cost for nothing (LangGraph/Focused
guidance). This is Borjie's `workflow-engine` lane; it is the highest-reliability
topology because every edge is explicit and every decision is visible in traces.

### 1.2 Orchestrator-worker (manager-agent / lead-subagent)
A lead agent analyzes the query, decomposes it, and **spawns specialized
subagents in parallel**, each with its own context window, then synthesizes.
This is **Anthropic's production Research architecture** and it is the
best-documented topology in the field:

- **90.2% improvement** over single-agent Claude Opus 4 on Anthropic's internal
  research eval — but at **~15× the tokens** of a chat (single agents already use
  ~4×). Token usage alone explains **80% of the variance** in BrowseComp scores.
- **Architecture follows task structure:** multi-agent only wins when the task
  decomposes into *independent parallel threads*. "Most coding tasks involve
  fewer truly parallelizable tasks than research." Domains needing shared context
  across all agents are a poor fit.
- **Spawn discipline (effort-scaling):** 1 agent + 3–10 tool calls for simple
  facts; 2–4 subagents for comparisons; 10+ only for deep research. Early systems
  failed by "spawning 50 subagents for simple queries" and "scouring the web
  endlessly." Borjie already encodes this rule in the modality-arbiter spec.
- **Teaching delegation is the hard part:** each subagent needs an objective,
  output format, tool/source guidance, and clear task boundaries. Vague tasks
  cause duplicated work and gaps. Anthropic "spent weeks rewriting delegation
  prompts."
- **Memory externalization:** the lead saves its plan to durable memory *before*
  context fills, then retrieves it — "externalize early, don't chase larger
  windows."
- **Synchronous bottleneck:** the lead waits for subagent batches. Async would
  add parallelism but costs "result coordination, state consistency, error
  propagation" complexity.

### 1.3 Hierarchical / supervisor
A supervisor receives the request, routes/delegates to specialist workers, and
synthesizes. **The 2026 production default** — widest native support (Claude
Agent SDK, LangGraph `langgraph-supervisor`, OpenAI Agents SDK, CrewAI
hierarchical Process, Google ADK parent→sub-agent, AWS Bedrock Supervisor). AWS
ships **two sub-modes**: *routing* (supervisor sends simple requests straight to
one specialist, bypassing orchestration) and *orchestration* (decompose →
delegate → consolidate) — a clean cheap-path/full-path split worth copying.
Easier to reason about than swarm: one routing node, clear control flow, every
decision in traces. **Don't** use it for strictly sequential work (pipeline) or
for peers that should hand off conversation autonomously (swarm).

### 1.4 Blackboard (shared-state coordination) — Borjie's spine
Specialist agents read/write a **shared blackboard**; a **control shell** decides
who acts next from current board state; agents **volunteer** based on competence
rather than being explicitly assigned. The key 2026 result
([arXiv:2510.01285](https://arxiv.org/abs/2510.01285), bMAS): a central agent
posts requests; autonomous subordinate agents volunteer to respond, **removing
the need for the coordinator to know each agent's expertise up front**. Reported
gains: **13–57% relative improvement in end-to-end success** and up to **9% F1**
on data-discovery vs strong supervisor baselines. Earlier work (Zhang et al.
2024; arXiv:2507.01701) frames LLMs as *both* knowledge sources and control
components. **Why blackboard beats supervisor at scale:** it survives when "the
main agent lacks full observability over sub-agents' knowledge"; it enforces a
single source of truth and prevents state divergence; it scales past the point
where a supervisor is "overwhelmed by large heterogeneous" inputs. This is
exactly Borjie's estate problem — dozens of juniors across 24 mining domains
where no single lead can enumerate every competence. `blackboard-sota` already
has the right organs: `posts/`, `knowledge-sources/ks-registry`, `regions/`,
`handoff/`, `control-shell` (fixture), `crossref-detector`, hash-chained audit,
and CRDT-style slot repositories.

### 1.5 Swarm / decentralized handoff
**No supervisor.** Agents hand control directly to each other via handoff tools
that carry conversation context. Born from **OpenAI Swarm** (educational, 2024)
and hardened into the **OpenAI Agents SDK** (March 2025; v0.17.x by mid-2026, 26k
stars) whose core primitive is the **handoff** (plus guardrails + tracing).
Faster — no intermediary, fewer LLM calls. LangGraph's `langgraph-swarm` returns
`Command` objects from handoff tools. **Use when** peers autonomously transfer a
conversation (sales-offtake → compliance → fx-treasury in Borjie). **The frontier
is moving toward swarm** for conversational flows, but it is harder to trace and
debug than supervisor — the no-IP-leak invariant (INV-H/D) means we must capture
handoff traces server-side only.

### 1.6 Planner-executor / group-chat (Magentic) — the dual-ledger pattern
**Magentic-One / Magentic** (Microsoft Research → now GA in Microsoft Agent
Framework, April 2026) is the most sophisticated open orchestrator pattern and
the single best template for Borjie's veteran kernel (INV-D). An **Orchestrator**
runs **two nested loops**:

- **Outer loop → Task Ledger:** facts, educated guesses, and the plan.
- **Inner loop → Progress Ledger:** per-step self-reflection — is the task done?
  is anyone stalled? — plus task→agent assignments, emitted once per coordination
  round.
- **Replanning trigger:** a new plan is produced on **stall detection** (>2
  iterations of no progress) or on human plan-review. Events are typed:
  `PLAN_CREATED`, `REPLANNED`, `PROGRESS_LEDGER_UPDATED`.

AutoGen's `GroupChat`/`SelectorGroupChat` generalizes this: a manager
dynamically selects the next speaker (auto / model-based / custom). The
**custom speaker-selection method is how you hard-code plan-then-execute** into
the conversation state machine. **Use when** steps aren't known in advance and
the natural framing is "a conversation between experts." This maps directly onto
Borjie's `loop-runner` + `planner-dispatcher` + the `situational-model` /
`stall-detector` organs the audit found as fragments.

### 1.7 Network / graph
Arbitrary directed graph of agents with explicit edges, fan-out/fan-in, loops,
retries, nested sub-graphs, HITL nodes. The **LangGraph** core model, **Google
ADK 2.0** Workflow Runtime (graph engine: routing, fan-out/fan-in, loops, retry,
dynamic nodes, HITL, nested workflows), and **MAF graph-based workflows**.
Highest determinism for complex-but-known control flow; this is the substrate
Borjie's `workflow-engine` should expose so the brain can *compose* a graph at
runtime (INV-C) rather than only pick from a fixed menu.

---

## 2. The frameworks (2026 state of the art)

| Framework | Topologies natively | Best at | Watch-outs |
|---|---|---|---|
| **LangGraph** (LangChain) | graph, supervisor (`langgraph-supervisor`), swarm (`langgraph-swarm`), pipeline | deterministic state machines, native checkpointing/persistence, durable execution | lower-level; you build the graph |
| **OpenAI Agents SDK** (Swarm lineage) | swarm-handoff, agents-as-tools, sandboxed specialists | lightweight handoffs, guardrails, end-to-end tracing | thin orchestration; you own state |
| **Microsoft Agent Framework** (AutoGen + Semantic Kernel, **1.0 GA 2 Apr 2026**) | sequential, concurrent, handoff, group-chat, **Magentic** | production convergence: checkpointing, HITL approvals, pause/resume, streaming; MCP + A2A native | newest; migration churn from SK/AutoGen |
| **CrewAI** | sequential, hierarchical Process | builder velocity (role+goal+backstory → working system in an afternoon) | coarse error handling fails in prod; ~18% token / 3× simple-task overhead |
| **Google ADK** (Python 2.0 GA) | Sequential/Parallel/Loop workflow-agents, hierarchical, **graph Workflow Runtime** | enterprise hierarchy + deterministic graph, multi-language (Py/TS/Go/Java/Kotlin) | Google-cloud gravity |
| **Anthropic multi-agent research system** | orchestrator-worker | the reference for parallel deep research + the rainbow-deploy / resume-from-error production playbook | research-shaped; not a general framework |
| **AWS multi-agent orchestrator / Bedrock AgentCore** | supervisor (routing + orchestration), + via A2A: Graph/Swarm/Workflow (Strands) | managed memory, A2A-native, two-tier supervisor | AWS lock-in |

**Benchmark reality (2026, medium-complexity 3–5 tool-call tasks):** LangGraph
**76%** reliability / **$0.08/task**, CrewAI **71%**, AutoGen **68%** (chat
overhead → 5–6× LangGraph cost). On complex tasks: LangGraph 62%, AutoGen 58%,
CrewAI 54%. **But the load-bearing finding across every comparison:** *"the gap
between a good agent system and a bad one is almost never the framework — it is
the eval pipeline, the observability setup, and the failure-recovery logic."*
This is the single most important sentence for Borjie: we already own a kernel;
the win is disciplined eval + tracing + recovery, not adopting someone's
framework.

**Reliability substrate — durable execution is now table stakes.** 2026 split the
stack: **LangGraph checkpointing** for application-level failures (bad reasoning,
HITL pauses) + **Temporal** for orchestration durability (event-history replay,
day/year-long execution). Temporal raised **$300M at $5B (Feb 2026)**, 9.1T
lifetime executions (1.86T AI-native). LangGraph, Pydantic AI and the OpenAI
Agents SDK all adopted durable execution as first-class — *"no longer optional;
a baseline requirement."* Borjie's `orchestrator/checkpoint.ts` is the seed;
this must become real save-after-every-logical-step persistence so a crashed
EstateMind loop resumes from its last slot, not from zero.

**Interop — the protocol layer is converging.** Three protocols now dominate:
**MCP** (tool/context, Anthropic), **A2A** (agent-to-agent, Google → Linux
Foundation; **150+ orgs, native in Google/MS/AWS, production by Apr 2026**), and
**ACP** (AGNTCY/Cisco/IBM, REST-over-HTTP-verbs). **Critical caveat for INV-H/D:**
A2A/ACP are for *interoperability with external opaque agents*. Borjie's internal
juniors must NEVER be exposed via A2A to any client — that would leak the
orchestration topology (the IP). Use A2A only at the *trust boundary* (e.g.
talking to a regulator's or buyer's external agent), never to expose our swarm.

---

## 3. Which topology for which job (the routing matrix)

Borjie's modality-arbiter should select like this (extends the existing 5-way
arbiter; thresholds adapted from AdaptOrch's DAG features in §4):

1. **One-shot fact / "what's my royalty due?"** → ANSWER (RAG). No topology.
2. **Known deterministic flow (royalty payment, site onboarding)** → WORKFLOW =
   **pipeline / graph** via `workflow-engine`. Highest reliability, lowest cost,
   fully auditable. Money/licence steps gate to HITL rails.
3. **Verified recipe match in skill_registry** → SKILL (retrieve-and-run). No new
   topology; a frozen mini-pipeline.
4. **Breadth-first decompose ("compare these 3 sites' viability")** →
   AGENT-SWARM as **orchestrator-worker**. Spawn 2–4 subagents (effort-scaled),
   each its own context, synthesize. Reserve 10+ only for genuine deep research.
5. **Open-ended discovery where the lead can't enumerate competences ("figure out
   why production dropped at Site B")** → **blackboard**. Post the problem;
   juniors volunteer by region/competence; control-shell `pickNext` schedules;
   cross-ref detector finds connections; converge. This is where Borjie's spine
   shines and where supervisor topologies degrade at scale.
6. **Conversational role-transfer (a buyer thread that moves sales → compliance →
   treasury)** → **swarm-handoff**. Cheapest in LLM calls; context rides the
   handoff.
7. **Exploratory, steps-unknown, high-stakes** → **planner-executor / Magentic
   dual-ledger** via loop-runner: task-ledger plan, progress-ledger reflection,
   replan-on-stall. This is the veteran-kernel default for consequential turns
   (INV-D).

**Reliability / cost / latency trade-offs to bake into the router:**
- Token cost climbs roughly: ANSWER (1×) < pipeline < supervisor < swarm <
  orchestrator-worker (~15×) < uncapped group-chat. Gate fan-out by stakes/value.
- Determinism/auditability is *inverse* to autonomy: pipeline > supervisor >
  blackboard > swarm. Money/licence/deletion must run on the auditable end.
- Latency: swarm-handoff (fewest hops) and pipeline (no LLM routing) are fastest;
  orchestrator-worker's synchronous batch-wait and group-chat's turn overhead are
  slowest.

**How to orchestrate dozens of agents without chaos (the field's hard-won rules):**
- **Effort-scale spawning** — encode the 1/2–4/10+ rule; cap by stakes×value.
- **Externalize the plan to durable memory before context fills** (Anthropic).
- **Stall-detect + replan** on >2 no-progress iterations (Magentic dual-ledger).
- **Resume-from-error, not restart** — checkpoint after every logical step;
  rainbow-deploy so code changes don't break running agents (Anthropic).
- **Blackboard as single source of truth** to prevent state divergence at scale.
- **Trace everything server-side** (decision patterns, not contents) — and never
  surface it (INV-H/D).
- **Eval from day one** with ~20 representative queries + LLM-as-judge rubrics;
  the framework matters far less than eval+observability+recovery.

---

## 4. BEYOND TODAY — the topology that selects and reshapes itself

This is the leap the owner is asking for (INV-C: topology forms/reforms with no
cap). The 2026 frontier papers make it concrete:

- **AdaptOrch** ([arXiv:2602.16873](https://arxiv.org/abs/2602.16873), Feb 2026)
  — a **Topology Routing Algorithm** that reads the task-decomposition DAG and
  picks parallel/sequential/hierarchical/hybrid in **O(|V|+|E|)** from three
  structural features: **Parallelism Width ω** (max antichain), **Critical-Path
  Depth δ** (longest weighted path), **Coupling Density γ** (0=independent →
  1=critical coherence). Decision rules: no deps / ω-ratio>50% + γ≤0.6 → parallel;
  ω=1 → sequential; γ>0.6 + |V|>5 → hierarchical; else hybrid (parallel within
  topological layers, sequential between). Its **Adaptive Synthesis Protocol**
  merges parallel outputs, and **re-routes with γ′=γ+0.2 on synthesis failure**,
  forcing hierarchical within ≤5 iterations (94% converge in ≤2). Result: **12–23%
  accuracy over static single-topology baselines with identical models**, and
  domain-specific topology mixes (SWE-bench 62% hybrid; GPQA 41% sequential/35%
  hierarchical; HotpotQA 71% hybrid).
- **Adaptive Orchestration / Self-Evolving MAS**
  ([arXiv:2601.09742](https://arxiv.org/abs/2601.09742), Jan 2026) — a
  **Meta-Cognition Engine** runs *asynchronously*, **detects capability gaps**,
  and **"hires" specialized sub-agents at runtime** via a **Dynamic Mixture of
  Experts**, with an **LRU eviction policy** to bound the active pool — high
  success at lower token cost than static swarms. (This is INV-C made operational:
  the nervous system grows new nodes on demand and prunes idle ones.)
- **HERA** (Apr 2026) — dual-level evolution: experience-guided orchestration +
  role-aware prompt adaptation, with **topology-based metrics that quantify how
  the agent interaction graph evolves over time**. Plus **Dy-Topo** (optimize
  communication topology by semantic matching) and **MetaGen** (co-evolve roles
  AND topologies via self-play).

**The Borjie design (concrete, INV-aligned):**

1. **Promote the modality-arbiter to a Topology Arbiter.** Today it picks
   ANSWER/SKILL/WORKFLOW/LOOP/AGENT-SWARM. Add a second stage: when AGENT-SWARM is
   chosen, run an AdaptOrch-style DAG read (ω, δ, γ over the decomposed subtasks)
   to pick orchestrator-worker vs blackboard vs swarm-handoff vs hierarchical vs
   hybrid — *cheaply*, with the on-device MiniLM router + LLM cascade already
   wired. The 7th `run_modality` Decision variant carries the chosen topology.
2. **Make the blackboard the meta-substrate, not one topology among many.** Every
   topology *runs on top of* `blackboard-sota` slots: a pipeline writes sequential
   slots, a swarm writes handoff slots, an orchestrator-worker writes fan-out
   slots. This unifies tracing, the CRDT shared state, the hash-chained audit, and
   the cross-surface projection — and means a flow can **morph topology mid-task**
   (start blackboard-volunteer, collapse to a pipeline once the path is known)
   without leaving the spine. This is the structural answer to "reshapes itself."
3. **Stall→replan→re-route (Magentic + AdaptOrch fused).** On >2 no-progress
   rounds, don't just replan the steps — **re-route the topology** (γ′=γ+0.2
   bias toward hierarchical/supervisor for more control), exactly AdaptOrch's
   escalation. Wire the existing `stall-detector` + `loop-quality-gates` to the
   control-shell `pickNext`.
4. **Runtime agent hiring with bounded pool (DMoE + LRU).** When a turn surfaces a
   competence gap no junior covers, the meta-rail composes a new junior
   (INV-C self-extension already exists as `self-extension.ts`), registers it as a
   blackboard knowledge-source, uses it, and LRU-evicts idle synthesized agents —
   uncapped nodes (INV-G) without unbounded cost.
5. **Durable, resumable topologies (Temporal-class).** Checkpoint each
   coordination round to the slot store so a crashed EstateMind loop resumes from
   its last progress-ledger, and rainbow-deploy the orchestrator so shipping a new
   kernel never kills an in-flight estate decision.
6. **No-IP-leak by construction.** The topology arbiter, the ledgers, the
   handoff traces, the volunteer-selection — ALL of it stays server-side. Clients
   see only status ("analyzing 3 sites…") and outputs. A2A is permitted *only* at
   the external trust boundary, never to expose the internal swarm. This makes the
   self-reshaping topology a defensible moat, not a disclosed mechanism.

**The one-sentence frontier claim Borjie can credibly chase:** a brain whose
orchestration graph is *itself a first-class, evolving artifact* — measured by
topology metrics (HERA), routed per-task from DAG structure (AdaptOrch), grown
and pruned at runtime (DMoE+LRU), all riding one blackboard spine that lets the
shape change mid-flight — is strictly beyond every shipping framework today, each
of which still asks the *developer* to choose the topology up front.

---

## 5. Sources
- Anthropic — How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- Microsoft Agent Framework (AutoGen+SK convergence, 1.0 GA): https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/ ; overview https://learn.microsoft.com/en-us/agent-framework/overview/
- Magentic / Magentic-One (dual-ledger orchestrator): https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic ; https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/
- OpenAI Agents SDK + Swarm lineage: https://openai.github.io/openai-agents-python/ ; orchestration/handoffs https://developers.openai.com/api/docs/guides/agents/orchestration ; https://github.com/openai/swarm
- LangGraph supervisor vs swarm: https://focused.io/lab/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture
- Google ADK workflow/graph agents: https://google.github.io/adk-docs/agents/workflow-agents/ ; https://developers.googleblog.com/en/agent-development-kit-easy-to-build-multi-agent-applications/
- AWS Bedrock AgentCore multi-agent (supervisor routing + A2A): https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html ; https://github.com/aws-solutions-library-samples/guidance-for-multi-agent-orchestration-using-bedrock-agentcore-on-aws
- Blackboard LLM-MAS (bMAS): https://arxiv.org/abs/2510.01285 ; advanced blackboard LLM-MAS https://arxiv.org/html/2507.01701v1
- Framework benchmarks (reliability/cost/latency): https://tensoria.fr/en/blog/multi-agent-orchestration-comparison ; https://pooya.blog/blog/crewai-vs-langgraph-autogen-comparison-2026/
- 5 patterns that work in 2026: https://www.digitalapplied.com/blog/multi-agent-orchestration-5-patterns-that-work
- Durable execution (Temporal + LangGraph): https://agentmarketcap.ai/blog/2026/04/10/durable-agent-execution-production-temporal-modal-event-sourced ; https://zylos.ai/research/2026-02-17-durable-execution-ai-agents
- A2A / interop convergence: https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year ; https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence
- **Beyond-today frontier papers:** AdaptOrch https://arxiv.org/abs/2602.16873 (full text https://arxiv.org/html/2602.16873v1) ; Adaptive/Self-Evolving Orchestration https://arxiv.org/abs/2601.09742 ; Experience-as-a-Compass (HERA-class) https://arxiv.org/html/2604.00901v1 ; Self-Evolving Agents survey https://arxiv.org/html/2507.21046v4

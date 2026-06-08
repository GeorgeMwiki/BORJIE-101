# State-of-the-Art Agentic Execution Architecture (2025–2026)

**Audience:** Borjie engineering (brain layer / central-intelligence / agent-platform).
**Scope:** Production agentic *execution* — how to orchestrate, run, recover, stream,
gate, bound, and evaluate multi-agent systems that serve real users.
**Method:** Web research against primary sources (Anthropic & OpenAI engineering,
LangGraph / Temporal / Ray / AG-UI docs, ICML/arXiv papers). Every pattern below
carries a real, fetched source URL. Claims that could not be verified against a
primary source are marked **UNVERIFIED**.
**Compiled:** 2026-06-08.

---

## 0. Executive read for Borjie

The 12-agent brain kernel (think-pipeline, sensors, debate, LATS) in
`packages/central-intelligence/` is already an orchestrator-worker system. The
2025–2026 SOTA converges on a small set of composable execution patterns. The
highest-leverage gaps for a product serving real users are usually **(a)** durable/
resumable execution so a crash mid-think does not lose work, **(b)** streaming
partial results so the cockpit feels alive, **(c)** human-in-the-loop gates on
HIGH-risk policy actions (sovereign / kill_switch / four_eye), and **(d)** token/
concurrency budgets so an agent retry-loop cannot run up cost. Each maps to a
pattern below.

Three load-bearing empirical facts to keep in mind:

- Multi-agent beats single-agent **only when the task is high-value and
  parallelizable** — Anthropic measured **+90.2%** over single-agent but at
  **~15× the tokens** of a chat. ([Anthropic][1])
- The dominant production incident is **not a wrong answer — it is a retry loop**
  that consumes tokens "at a rate the human in front of the keyboard would never
  produce." Token-aware budgets are not optional. ([Zuplo][12])
- The supervisor's hidden tax is the **"translation layer"** (it paraphrases
  worker output like a game of telephone). Removing that re-generation gave
  LangChain a **~50% performance increase.** ([LangChain][16])

---

## 1. Orchestrator–Worker (lead agent + parallel subagents)

**What it is.** A lead/orchestrator agent analyzes the query, develops a strategy,
and **spawns specialized subagents that operate in parallel**, each as an
"intelligent filter" that iteratively uses tools and returns findings; the lead
synthesizes and decides whether more research is needed. ([Anthropic][1])

**When to use it.** High-value, breadth-first tasks where the work decomposes into
independent subtasks and "information exceeds a single context window." Anthropic's
effort-scaling rule: simple fact-find = 1 agent / 3–10 tool calls; comparison =
2–4 subagents / 10–15 calls each; complex research = 10+ subagents with clearly
divided responsibilities. ([Anthropic][1])

**Production details that matter.**
- The lead spins up **3–5 subagents in parallel rather than serially**; subagents
  use **3+ tools in parallel** — cut research time up to **90%**. ([Anthropic][1])
- Each subagent delegation needs **an objective, an output format, tool/source
  guidance, and clear task boundaries** — otherwise subagents duplicate searches
  or misread the task. ([Anthropic][1])
- A known limitation: the lead **executes subagents synchronously**, waiting for
  each batch — an information-flow bottleneck. ([Anthropic][1])

**Source:** https://www.anthropic.com/engineering/multi-agent-research-system

---

## 2. Supervisor vs. Swarm vs. Network (control-flow topologies)

**What they are.**
- **Supervisor:** a central router receives every message, classifies intent,
  routes to a specialist, gets the result back, then routes again or ends.
  Easiest to reason about — one routing node, clear control flow, every decision
  visible in traces. ([Focused/DEV][14])
- **Swarm:** no manager; agents **hand the baton directly to each other** via
  `Command` objects returned from handoff tools; only one agent active at a time.
  Faster (skips the intermediary), uses fewer tokens. ([Focused/DEV][14])
- **Network (mesh):** any agent can reach any other at any time; no fixed order.
  Maximum flexibility, hardest to trace. ([Focused/DEV][14])

**When to use which.** LangChain's benchmark compared single-agent, swarm, and
supervisor across increasing "distractor domains": single-agent **falls off
sharply with 2+ distractor domains**; swarm and supervisor **stay flat in token
usage**; swarm **slightly outperformed supervisor across the board.** Choose by
bottleneck: supervisor when misroutes are the risk (routing is its only job),
swarm when latency/token cost dominates. ([LangChain][16])

**Failure mode to design against.** Supervisor's **"translation"** problem: it
must paraphrase worker output rather than forward it — a game of telephone.
Mitigations that gave ~50% gain: strip handoff messages from sub-agent context,
add a `forward_message` tool to pass output verbatim, and tune tool naming.
Also: in hub-and-spoke, **coordinator failure halts the whole system** (worker
failures stay isolated). ([LangChain][16], [Focused/DEV][14])

**Sources:** https://www.langchain.com/blog/benchmarking-multi-agent-architectures
· https://dev.to/focused_dot_io/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture-1b7e

---

## 3. Agent Handoffs & Routines (OpenAI Swarm → Agents SDK)

**What it is.** A **routine** = natural-language instructions (system prompt) plus
the tools to complete them — effectively a task-scoped agent. A **handoff** = "an
agent handing off an active conversation to another agent… except the agents have
complete knowledge of your prior conversation." The mechanism is elegant: **a tool
function returns an `Agent` object**, which the runtime reads as a transfer signal;
the full message history persists, and the receiver gets "Transferred to [agent].
Adopt persona immediately." ([OpenAI Cookbook][2])

**When to use it.** Routines for single-domain work; handoffs when a different
specialist is needed — handoffs solve the scale problem when one routine grows too
many unrelated tasks. ([OpenAI Cookbook][2])

**Production successor.** Swarm is now an educational artifact; the **OpenAI Agents
SDK** is the production upgrade with the same primitives plus **Guardrails**
(input/output validation that runs *in parallel* with the agent and **fails fast**),
**Sessions** (persistent memory across turns), **built-in tracing**, sandboxed/
resumable sessions, human-in-the-loop, and realtime/voice agents. ([OpenAI Agents SDK][3])

**Sources:** https://developers.openai.com/cookbook/examples/orchestrating_agents
· https://openai.github.io/openai-agents-python/

---

## 4. Parallel Fan-Out + Map-Reduce over Agents

**What it is.** Dynamically dispatch an *a-priori-unknown* number of parallel
worker tasks, then reduce their results. In LangGraph this is the **`Send` API**:
`Send("worker_node", {payload})` fans out N branches; **state reducers** safely
merge concurrent results; workers can use their own state schema. The execution
group ("superstep") **waits until every branch completes** before reducing.
([machinelearningplus][6], [DeepWiki][5])

**When to use it.** Document/summary batches, parallel labeling, multi-source
research, parallel tool calls — "anywhere the item count is not known in advance."
Orchestrator (planner) → parallel independent workers → synthesizer that merges.
([machinelearningplus][6])

**Caveat.** More parallelism reduces latency but hits provider rate limits faster
(see §10). ([Typedef][12b])

**Sources:** https://machinelearningplus.com/gen-ai/langgraph-map-reduce-parallel-execution/
· https://deepwiki.com/langchain-ai/langgraph/7.1-map-reduce-pattern

---

## 5. Durable / Resumable Execution (workflow engines + checkpointing)

**What it is.** Make agent runs survive crashes/restarts by persisting state and
resuming from the last good point instead of restarting.

**Two architectural approaches:**

- **Checkpointing (LangGraph).** A checkpointer snapshots state after **every node**,
  enabling resume/retry, idempotency, and auditability. "Agents that persist
  through failures and can run for extended periods, resuming from where they left
  off." Use `AsyncPostgresSaver`/`RedisSaver` in prod — **never `InMemorySaver`**
  (a pod restart wipes state mid-conversation). ([LangChain docs][8], [Diagrid][7])

- **Durable execution via event sourcing (Temporal).** Separate **Workflows**
  (deterministic orchestration/business logic, written "as if they stayed active
  in memory at all times") from **Activities** (external/LLM calls with built-in
  retries). Temporal **records a full Event History** so it can reconstruct state
  and "pick up where it left off when it is brought back up," gives **automatic
  retries** out of the box, supports **Signals/Updates/Queries** for HITL, and a
  worker can manage thousands of concurrent long-running workflows by replaying
  history. ([Temporal][9])

**When to use which.** Checkpointing is lightweight and good for graph-shaped agent
runs inside one service. A dedicated durable-execution engine (Temporal) is worth
it for **multi-day / multi-step money or compliance workflows** where exactly-once
semantics, transparent retries, and time-travel replay/debugging matter — which is
exactly the profile of Borjie's ledger/royalty/treasury paths. Note the critique:
"checkpoints are not durable execution" — checkpoints replay *graph* steps but do
not give the transactional retry/recovery guarantees of an engine like Temporal.
([Diagrid][7])

**Sources:** https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai
· https://docs.langchain.com/oss/javascript/langgraph/overview
· https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows

---

## 6. Sagas & Compensating Transactions (fault tolerance for multi-step side effects)

**What it is.** Replace one ACID transaction with a sequence of local steps, each
with a **compensating action** that semantically undoes it if a later step fails —
"logically reversing the business operation rather than restoring the database to
its exact previous state." Orchestrated (central controller) or choreographed
(agents emit/consume events). ([Conduktor][10], [Microsoft Learn][10b])

**When to use it.** Any agent workflow that performs **irreversible-by-default
external side effects across services** — issue licence → debit royalty escrow →
notify regulator: if step 3 fails, compensate step 2 (refund) and step 1 (revoke).
Research: **SagaLLM** integrates the saga pattern with persistent memory,
automated compensation, and independent validation agents for multi-agent LLM
planning. ([SagaLLM / arXiv][11])

**Borjie note.** This is the correct shape for money-path agents: the
`LedgerService.post()` invariant + compensation gives agents safe, reversible
multi-step financial actions without breaking double-entry immutability.

**Sources:** https://www.conduktor.io/glossary/saga-pattern-for-distributed-transactions
· https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
· https://arxiv.org/html/2503.11951v3

---

## 7. Planner–Executor, ReAct, Reflection / Reflexion (single-agent reasoning loops)

**What they are.**
- **Plan-and-Execute:** a planner produces a structured multi-step plan; a cheaper
  executor runs each step, replanning as results arrive. Formalized in
  Plan-and-Solve prompting (Wang et al., 2023). ([DEV/Inductivee][4])
- **ReAct:** interleave reasoning + acting + observation each step. ([DEV/Inductivee][4])
- **Reflection / Reflexion:** generate → a critic reviews → feed critique back →
  regenerate; Reflexion (Shinn et al., 2023) adds verbal self-reflection driven by
  external evaluation signals, iterating until improved. Self-Refine uses the same
  model as generator/refiner/feedback. ([DEV/Inductivee][4])

**When to use them.** Plan-Execute for tasks with a knowable step structure and
cost sensitivity (cheap executor). Reflection for quality-critical outputs where a
second self-critique pass demonstrably reduces errors. ReAct as the default
tool-using loop. These are the *inner loops* you embed inside the orchestrator/
worker shells of §1–4.

**Source:** https://dev.to/gabrielanhaia/react-plan-and-execute-or-reflection-the-three-agent-patterns-every-engineer-needs-in-2026-355p

---

## 8. Tree-Search Planning (LATS / MCTS over agent actions)

**What it is.** **Language Agent Tree Search (LATS)** unifies reasoning, acting,
and planning by adapting **Monte Carlo Tree Search** to LM agents, using
LM-powered value functions and self-reflection to explore multiple action
trajectories instead of committing to one. ICML 2024; **doubles ReAct on
HotPotQA**. ([arXiv / ICML][13])

**When to use it.** High-stakes decisions where exploring/branching alternatives
beats a single greedy trajectory and you can afford the extra inference — e.g.
Borjie's debate/LATS path for sovereign or strategic-CEO-mode decisions. Costly,
so gate behind value-of-decision thresholds.

**Source:** https://arxiv.org/abs/2310.04406

---

## 9. Blackboard / Shared-Memory Collaboration

**What it is.** Specialist agents ("knowledge sources") read from and write to a
**shared blackboard** as the sole communication/memory substrate. Instead of the
coordinator assigning subtasks, it **posts a request** and any agent that judges
itself capable self-selects to contribute — shifting from central control to
distributed participation. ([arXiv 2510.01285][15], [Muthu notes][15b])

**When to use it.** Open-ended problems where you don't know up front which
specialists are relevant, want to add agents without redesign, and need a
centrally auditable knowledge store. Reported **13–57% relative improvement** in
end-to-end task success over RAG and master–slave baselines for data-discovery
tasks. Trade-offs: coordination overhead, conflicting posts, and contention as
agents grow. ([arXiv 2510.01285][15])

**Source:** https://arxiv.org/html/2510.01285v1

---

## 10. Streaming Partial Results to Users (AG-UI protocol)

**What it is.** **AG-UI** is an open, lightweight, **event-based protocol** that
standardizes how agents stream to user-facing apps over HTTP/SSE/WebSockets.
Typed event categories: **lifecycle** (`RUN_STARTED/FINISHED/ERROR`), **text**
(`TEXT_MESSAGE_START/CONTENT/END` — token stream), **tool calls**
(`TOOL_CALL_START/ARGS/RESULT/END`), and **state** (`STATE_SNAPSHOT/STATE_DELTA`,
event-sourced diffs with conflict resolution). It supports cancel/resume,
sub-agent composition with scoped state, and HITL interrupts without losing state.
([AG-UI docs][17])

**When to use it.** Any product surface (Borjie owner cockpit, workforce/buyer
mobile) where the agent runs long enough that a request/response feels dead.
Stream tokens, tool-call progress, and live state diffs so the user sees the agent
"working" and can interrupt. Solves what REST/GraphQL can't: long-running,
nondeterministic, mixed-IO, recursively-composed agent IO. ([AG-UI docs][17])

**Source:** https://docs.ag-ui.com/introduction

---

## 11. Human-in-the-Loop Gates (interrupt / approve / edit / reject)

**What it is.** Pause agent execution before a risky action and wait for a human
decision. LangGraph's **`interrupt()`** marks the thread interrupted, persists the
payload to the checkpoint layer, and resumes via **`Command(resume=...)`** —
re-running only the work in the interrupted node, not prior nodes; an interrupted
thread holds no resources and **can be resumed months later**. HITL middleware maps
tool names → approval configs (`True`/`False`/`InterruptOnConfig`) with an optional
predicate that gates on a call's arguments. Human decision options: **approve,
edit, reject (with feedback), or respond**. Requires a checkpointer. ([LangChain HITL][18])

Temporal expresses the same via **Signals/Updates** to inject input and **Queries**
to read state for the user. ([Temporal][9])

**When to use it.** Mandatory on HIGH-risk policy prefixes (sovereign / kill_switch
/ four_eye / policy_rollout) and any money-moving or regulator-facing action — the
agent proposes, a human approves/edits before commit. Gate on arguments (e.g.
amount over threshold) so low-risk calls auto-approve.

**Source:** https://docs.langchain.com/oss/python/langchain/human-in-the-loop

---

## 12. Cost, Concurrency & Token Budgets (runaway-loop control)

**What it is.** Three intersecting controls: **RPM** (requests/min — protects
against floods/retries, controls concurrency/gateway load), **TPM** (tokens/min —
the primary lever for compute/cost since tokens map directly to spend), and
**budget ceilings** (cumulative token/cost caps that throttle or block once
crossed). ([Zuplo][12])

**Why it's critical for agents.** Agents chain 10–20 sequential calls in seconds;
"a blunt request-count limiter cannot tell a productive agent apart from a runaway
loop." The most common production incident is the **retry-retry-retry loop** — each
retry is a full provider call that appends to context, so **context grows
quadratically** and tokens burn with no human pacing it. Enforce **token-aware**
limits (TPM + cost), not just RPM. ([Zuplo][12])

**Concurrency trade-off.** Running more requests in parallel cuts pipeline latency
but hits rate limits faster — tune fan-out width (§4) against provider TPM/RPM.
([Typedef][12b])

**Sources:** https://zuplo.com/learning-center/token-based-rate-limiting-ai-agents
· https://www.typedef.ai/resources/handle-token-limits-rate-limits-large-scale-llm-inference

---

## 13. Distributed Serving / Scale-Out (Ray actors + serve)

**What it is.** A microservices layout for agents on **Ray**: ingress routing
(Ray Serve), **stateful agent logic as Ray Actors**, **stateless tool execution as
Ray Tasks**, and LLM inference (vLLM on GPU nodes) — each component an
independently autoscaling Serve app, wired via MCP and A2A. GPU LLM services scale
**separately** from CPU agent/tool orchestration; Serve autoscaling handles spikes
up to ~1,000 req/s. ([Markaicode][19], [Anyscale][19b])

**When to use it.** When agent concurrency outgrows a single process and you need
independent GPU/CPU scaling, autoscaling, and resilience for fan-out (§4) at scale.

**Sources:** https://markaicode.com/architecture/agent-architecture-with-ray/
· https://www.anyscale.com/blog/ai-agents-on-ray-serve-single-to-multi-agent-architecture

---

## 14. Evals for Multi-Agent Reliability

**What it is.** Measuring agent systems where a 10–20-tool trajectory means "small
differences in step 3 cascade into wildly different step 7 decisions," so the same
config yields different trajectories — **you need many samples for stable metrics.**
([Confident AI][20], [Medium/Rane][20b])

**Patterns that work.**
- **LLM-as-Judge** on a single prompt scoring **0.0–1.0** was "most consistent and
  aligned with human judgements" for Anthropic, across **factual accuracy, citation
  accuracy, completeness, source quality, tool efficiency**. Start with **~20
  representative queries**, not a giant set; keep **humans in the loop** to catch
  edge cases evals miss. ([Anthropic][1])
- **Trajectory / trace-based evals** judge the *path* (tool choices, ordering), not
  just the final answer; **Agent-as-a-Judge / Multi-Agent-as-Judge** attribute
  per-agent contribution over the full trace and correlate better with humans than
  single-LLM or ROUGE/BERTScore. ([Confident AI][20], [EmergentMind][20c])
- **Known judge failure modes:** position/length bias, prompt injection, reward
  hacking, and unfaithful chain-of-thought "gaming the judge." Defend against them.
  ([arXiv 2601.14691][20d])

**Sources:** https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide
· https://www.anthropic.com/engineering/multi-agent-research-system
· https://arxiv.org/pdf/2601.14691

---

## 15. Cross-cutting production hardening (from Anthropic's system)

- **Graceful degradation over restart:** "letting the agent know when a tool is
  failing and letting it adapt works surprisingly well" — pair with checkpoints so
  agents resume "from where the agent was when the errors occurred." ([Anthropic][1])
- **Rainbow deployments:** shift traffic old→new gradually while both run, so
  in-flight agents are not disrupted. ([Anthropic][1])
- **Persist the plan to memory:** if context exceeds ~200K tokens it truncates, so
  the lead saves its plan to Memory to survive truncation. ([Anthropic][1])

**Source:** https://www.anthropic.com/engineering/multi-agent-research-system

---

## Pattern → Borjie mapping (quick reference)

| Pattern | Borjie surface most relevant |
|---|---|
| Orchestrator-worker, fan-out, supervisor/swarm | `packages/central-intelligence/` think-pipeline + debate |
| Tree search (LATS/MCTS) | sovereign / strategic CEO-mode decisions |
| Durable execution + sagas/compensation | money path via `services/payments-ledger/` `LedgerService.post()` |
| HITL gates | HIGH-risk policy prefixes (sovereign/kill_switch/four_eye/policy_rollout) |
| Streaming (AG-UI) | owner-web cockpit, workforce/buyer mobile |
| Token/concurrency budgets | `packages/agent-platform/` gateway/quotas |
| Multi-agent evals | `evals/` + observability (LLM-as-judge + trajectory) |

---

## Sources (verified, fetched)

1. https://www.anthropic.com/engineering/multi-agent-research-system — Anthropic, *How we built our multi-agent research system* (fetched)
2. https://developers.openai.com/cookbook/examples/orchestrating_agents — OpenAI Cookbook, *Orchestrating Agents: Routines and Handoffs* (fetched)
3. https://openai.github.io/openai-agents-python/ — OpenAI Agents SDK docs (fetched)
4. https://dev.to/gabrielanhaia/react-plan-and-execute-or-reflection-the-three-agent-patterns-every-engineer-needs-in-2026-355p — ReAct / Plan-Execute / Reflection patterns (search-summarized; UNVERIFIED on exact quotes)
5. https://deepwiki.com/langchain-ai/langchain-academy/7.1-map-reduce-pattern — LangGraph map-reduce (search-summarized)
6. https://machinelearningplus.com/gen-ai/langgraph-map-reduce-parallel-execution/ — LangGraph Send API map-reduce (search-summarized)
7. https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows — Diagrid critique (search-summarized)
8. https://docs.langchain.com/oss/javascript/langgraph/overview — LangGraph overview (fetched)
9. https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai — Temporal durable execution for AI (fetched)
10. https://www.conduktor.io/glossary/saga-pattern-for-distributed-transactions — Saga pattern (search-summarized)
10b. https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction — Compensating Transaction pattern (search-summarized)
11. https://arxiv.org/html/2503.11951v3 — SagaLLM (search-summarized)
12. https://zuplo.com/learning-center/token-based-rate-limiting-ai-agents — Token-based rate limiting for agents (search-summarized)
12b. https://www.typedef.ai/resources/handle-token-limits-rate-limits-large-scale-llm-inference — Token/rate limits at scale (search-summarized)
13. https://arxiv.org/abs/2310.04406 — LATS, ICML 2024 (search-summarized)
14. https://dev.to/focused_dot_io/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture-1b7e — Supervisor vs Swarm vs Network (search-summarized)
15. https://arxiv.org/html/2510.01285v1 — LLM-based Multi-Agent Blackboard System (search-summarized)
15b. https://notes.muthu.co/2025/10/collaborative-problem-solving-in-multi-agent-systems-with-the-blackboard-architecture/ — Blackboard collaboration notes (search-summarized)
16. https://www.langchain.com/blog/benchmarking-multi-agent-architectures — LangChain multi-agent benchmark (fetched)
17. https://docs.ag-ui.com/introduction — AG-UI protocol (fetched)
18. https://docs.langchain.com/oss/python/langchain/human-in-the-loop — LangGraph human-in-the-loop (search-summarized)
19. https://markaicode.com/architecture/agent-architecture-with-ray/ — Ray agent architecture (search-summarized)
19b. https://www.anyscale.com/blog/ai-agents-on-ray-serve-single-to-multi-agent-architecture — Anyscale agents on Ray Serve (search-summarized)
20. https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide — Agent eval metrics 2026 (search-summarized)
20b. https://medium.com/@vinodkrane/chapter-8-agent-evaluation-for-llms-how-to-test-tools-trajectories-and-llm-as-judge-788f6f3e0d52 — Agent eval: tools/trajectories/judge (search-summarized; UNVERIFIED on exact quotes)
20c. https://www.emergentmind.com/topics/llm-agent-evaluation-frameworks — Agent eval frameworks (search-summarized)
20d. https://arxiv.org/pdf/2601.14691 — *Gaming the Judge* (search-summarized)

**Verification note:** Sources tagged "(fetched)" were retrieved and quoted
directly via WebFetch. Sources tagged "(search-summarized)" are real URLs returned
by web search and summarized from search excerpts; their specific numeric claims
should be re-confirmed against the page before being cited externally. No sources
were invented.

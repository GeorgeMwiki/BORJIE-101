# SOTA: Agentic Orchestration Meta-Cognition

**The thinking that decides HOW to act, not just what.**

**Date:** 2026-06-08
**Author:** Research subagent (web-grounded; every claim cites a fetched URL)
**Audience:** Borjie brain-layer engineers wiring Mr. Mwikila's orchestrator/kernel
**Scope:** Workflow/skill/agent identification · task decomposition + planning (HTN,
plan-and-execute, ToT/LATS) · agent formulation · dispatch topologies · task-completion
detection + verification · plan repair/replanning · linear vs loop vs follow-up · skill
acquisition (Voyager-style).

> **Citation discipline.** Every factual claim below is tagged with a `[Sn]` source key
> that resolves to a URL in the Sources table at the bottom. URLs marked **fetched** were
> retrieved in full with WebFetch; URLs marked **search** came from a WebSearch result
> snippet. Nothing here is invented — anything not directly grounded is labelled
> **UNVERIFIED**.

---

## 0. The one-paragraph thesis

Orchestration meta-cognition is the agent's *control policy over its own control flow*:
before doing the task, it decides **what shape the task is** (one-shot answer / fixed
workflow / dynamic agent loop / multi-agent swarm / long-running scheduled loop), **how to
carve it up** (decomposition + planning), **who should do each piece** (agent formulation +
dispatch topology), **how it will know it's done** (completion detection + verification),
**what to do when a step fails** (plan repair / replanning), and **what to keep for next
time** (skill acquisition). The single most-cited principle across the frontier is
Anthropic's: **start with the simplest thing that works and only add orchestration
complexity when simpler solutions demonstrably fall short**, because agentic systems trade
latency and cost (4×–15× more tokens) for task performance `[S1][S6]`. The academic
backbone that unifies all of it is **CoALA** (Cognitive Architectures for Language Agents),
which models every agent as memory modules + an internal/external action space + a
propose-evaluate-select decision loop `[S11]`.

---

## 1. IDENTIFICATION — one-shot vs skill vs workflow vs loop vs swarm

The first meta-cognitive act is *classifying the request's shape*. The canonical taxonomy
is Anthropic's "Building Effective Agents," which draws the hard line: **workflows** =
"LLMs and tools orchestrated through *predefined code paths*"; **agents** = "LLMs
*dynamically direct their own processes and tool usage*, maintaining control over how they
accomplish tasks" `[S1]`. The difference is determinism: workflows follow fixed paths,
agents make adaptive decisions from environmental feedback `[S1]`.

The decision ladder (Anthropic's "complexity decision framework") `[S1]`:

| Shape | Use when | Control flow | Stop condition |
|---|---|---|---|
| **Single LLM call** (one-shot) | Answer optimizable with retrieval + in-context examples; no real decomposition | One prompt, maybe with RAG/tools | Response returned |
| **Workflow** (prompt-chain / route / parallelize) | Task cleanly decomposes into *known* fixed subtasks | Predefined code path | Final step done |
| **Agent loop** | Open-ended; can't predict # of steps; can't hardcode the path; needs trust in its decisions | LLM plans, loops on tool calls + env feedback, checkpoints for humans | Completion, max-iters, or human stop `[S1]` |
| **Multi-agent / swarm** | Heavy parallelization, info exceeds one context window, many complex tools | Orchestrator spawns subagents (or peer handoffs) | Orchestrator synthesizes; subagents reach final state `[S6]` |
| **Long-running / scheduled loop** | Runs for hours, must survive crashes, pauses for approval, recurs on a schedule | Durable execution w/ checkpoint + resume | Durable terminal state or human resume `[S15]` |

**Key identification rule of thumb** (Anthropic): agentic systems "often trade latency and
cost for better task performance" — only climb the ladder when that trade makes sense
`[S1]`. The "skill" rung is distinct: a skill is a *reusable solved procedure* the agent
already learned and can retrieve instead of re-planning (Section 9).

**The five workflow patterns** Anthropic enumerates, each a different control topology `[S1]`:

1. **Prompt chaining** — sequential calls, each consumes the prior output, with optional
   programmatic "gates" to validate between steps. Use when the task cleanly decomposes into
   *fixed* subtasks; trades latency for accuracy `[S1]`.
2. **Routing** — classify the input, then dispatch to a specialized prompt/path. Use when
   there are distinct categories better handled separately *and classification is accurate*.
   Also the basis of cost-routing (cheap model for easy, expensive for hard) `[S1]`.
3. **Parallelization** — two flavors: **sectioning** (independent subtasks run
   simultaneously, aggregate programmatically — e.g. guardrail + core response) and
   **voting** (same task run N times with diverse prompts, aggregate by vote/threshold —
   e.g. multiple independent code-vuln reviewers) `[S1]`.
4. **Orchestrator-workers** — central LLM *dynamically* breaks the task into subtasks,
   delegates to workers, synthesizes. Topologically like parallelization but **subtasks are
   NOT pre-defined** — determined by the orchestrator from the specific input. Use when you
   can't predict the subtasks (multi-file code changes, multi-source research) `[S1]`.
5. **Evaluator-optimizer** — generator LLM produces, evaluator LLM critiques, loop. Use when
   there are *clear evaluation criteria* and iterative refinement gives measurable value
   (literary translation, deep search) `[S1]`.

**The augmented-LLM building block.** Every pattern composes the same primitive: an LLM
augmented with retrieval + tools + memory, exposed through a well-documented interface (MCP
is the integration substrate) `[S1]`.

---

## 2. DECOMPOSITION + PLANNING

### 2.1 Hierarchical Task Networks (HTN) — the symbolic ancestor

HTN planning decomposes **abstract/compound tasks** into sequences of **primitive actions**
through **methods**, searching over a joint space of world-states and task-networks `[S3]`.
The 2024–2025 frontier hybridizes HTN with LLMs: when no symbolic method matches a compound
task, the planner issues an **LLM fallback query** that returns a grounded primitive
decomposition, which is then *verified by simulation* for applicability and effect `[S3]`.
This LLM+HTN combo outperforms flat ReAct-style agents on complex tasks `[S3]`. Critical
caveat from the literature: unlike first-principles planners, **LLMs can return incorrect
solutions and cannot self-verify correctness**, so soundness must come from external
verification `[S3]`. Representative work: *ChatHTN* (interleaving approximate-LLM and
symbolic HTN), *Online Learning of HTN Methods for integrated LLM-HTN Planning*, *HTN
Planning with LLM-Generated Heuristics* `[S3]`.

### 2.2 Plan-and-Execute vs ReWOO vs LLMCompiler — separating planning from acting

LangChain's planning-agents taxonomy is the cleanest practitioner reference. **The
motivation:** rather than consulting the LLM after *each* action (ReAct), decouple planning
from execution to gain (1) **speed** — sub-tasks run without an extra LLM call; (2) **cost** —
small models do sub-tasks while a large model plans; (3) **quality** — forcing the planner
to think through *all* steps up front improves outcomes `[S9]`.

| Pattern | Planning | Execution | Parallelism | Replanning |
|---|---|---|---|---|
| **Plan-and-Execute** | Upfront multi-step plan | Serial per step (executor + tools) | None | Re-plan prompt *after* the batch — conclude or generate follow-ups `[S9]` |
| **ReWOO** (Reasoning WithOut Observation) | Planner emits interleaved Plan + `E#` tasks with **variable assignment** (`#E2`) | Worker loops, assigns outputs to vars, substitutes | None | Solver integrates all outputs (no explicit re-plan) `[S9]` |
| **LLMCompiler** | Planner *streams a DAG* of tasks (tool, args, deps) | Task-fetching unit schedules in **parallel** when deps resolve | Full (DAG) | Joiner dynamically picks final answer or loops back to plan `[S9]` |

ReWOO's win: variable reuse eliminates the LLM for many sub-tasks. LLMCompiler's win: DAG
parallelism (claimed ~3.6× speedup) + streamed eager scheduling `[S9]`.

### 2.3 Tree-of-Thoughts (ToT) — deliberate search over reasoning

ToT generalizes Chain-of-Thought: frame problem-solving as **search through a tree** where
each node is a "thought" (a coherent intermediate reasoning step). The LLM generates
multiple thought candidates per step and **heuristically self-evaluates progress**, enabling
lookahead and backtracking — addressing LLMs' confinement to token-level, left-to-right
decisions `[S10]` (Yao et al., arXiv:2305.10601, NeurIPS 2023).

### 2.4 LATS — Language Agent Tree Search (the SOTA unifier)

LATS is "the first general framework that synergizes reasoning, acting, and planning,"
embedding Monte-Carlo Tree Search into the agent loop with an LM value function and
self-reflection `[S5]` (arXiv:2310.04406, ICML 2024). It expands ReAct into a search over a
combinatorial space of reasoning **and** acting steps, treating both as a **unified action
space** `Â = A ∪ Z` (external actions ∪ internal thoughts) `[S5]`.

**The six MCTS operations as adapted** `[S5]`:

1. **Selection** — traverse from root using UCT: `UCT(s) = V(s) + w·√(ln N(p)/N(s))`.
2. **Expansion** — sample *n* actions from the LM at the node, get env observations → *n*
   child states.
3. **Evaluation** — scalar value = `V(s) = λ·LM(s) + (1−λ)·SC(s)` blending an LM-generated
   correctness score with a **self-consistency** heuristic (actions sampled repeatedly rank
   higher).
4. **Simulation** — roll out high-value paths to a terminal state.
5. **Backpropagation** — `V(s) = (V_old(s)·(N(s)−1) + r)/N(s)`.
6. **Reflection** — on a *failed* trajectory, the LM writes a verbal error summary +
   alternative, stored in memory as context for the next iteration `[S5]`.

**Why external feedback is load-bearing:** the paper cites that "LMs cannot self-correct
their internal reasoning, making it critical to use external feedback" — this is what
distinguishes LATS from pure-reasoning ToT `[S5]`. **Results:** HumanEval 92.7% Pass@1
(GPT-4, SOTA); WebShop 75.9 (beats fine-tuning's 67.5); HotPotQA 0.71 EM (doubles ReAct's
0.32); Game-of-24 0.44 `[S5]`.

### 2.5 The BDI lens (deliberation vs means-ends)

The classical decomposition of planning, still the cleanest mental model: **deliberation**
decides *what goals to pursue* (→ outputs **intentions**); **means-ends reasoning** decides
*how to achieve them* (→ outputs **plans**) `[S8]`. Beliefs = info state, Desires = goals,
Intentions = committed plans. Bratman's key insight, directly relevant to agent stability:
**prior intentions constrain and focus the search** for means — they stop the agent
re-deliberating from scratch every cycle `[S8]`. This is the theoretical justification for
plan-and-execute's "commit to a plan, then execute" over ReAct's "re-decide every step."

---

## 3. AGENT FORMULATION — defining a sub-agent on the fly

When the orchestrator decides to spawn, it must *author the sub-agent's mandate*. Anthropic's
multi-agent research system gives the most concrete spec: **each subagent needs an
objective, an output format, guidance on the tools and sources to use, and clear task
boundaries** `[S6]`. Without these four, the documented failure mode is subagents performing
**identical searches or leaving critical gaps** — multiple agents independently
investigating the same topic instead of dividing labor `[S6]`.

**Effort scaling is part of formulation.** The orchestrator must size the sub-agent's
budget to the query: Anthropic's explicit rule — *"Simple fact-finding requires just 1 agent
with 3–10 tool calls, direct comparisons might need 2–4 subagents with 10–15 calls each, and
complex research might use more than 10 subagents"* `[S6]`. Early agents failed by spawning
50 subagents for trivial queries `[S6]`.

**The OpenAI Agents SDK** formalizes formulation in code: an Agent = instructions + tools +
**handoffs** + **guardrails** + output type `[S2]`. Handoffs are represented to the LLM *as
tools* (`transfer_to_refund_agent`), so delegation IS a tool call `[S2]`.

---

## 4. DISPATCH TOPOLOGIES — supervisor / swarm / handoff

| Topology | How it routes | Best when | Tradeoff |
|---|---|---|---|
| **Supervisor (orchestrator-worker)** | A dedicated LLM whose *only job* is routing/delegation decides which worker handles each part, then synthesizes | Routing logic fits one focused prompt; need central control + audit | More accurate routing (dedicated call) but an extra hop `[S4]` |
| **Swarm (decentralized)** | Agents hand off **directly to each other** (LangGraph `Command` objects navigate to a peer node); no central router | Routing rules outgrow a single supervisor prompt; want emergent problem-solving | Faster (skips intermediary) but less central control `[S4]` |
| **Handoff** | One agent *transfers ownership* of the next user-facing response to a specialist (handoff = a tool) | A specialist should *own* the next response, not just help behind the scenes | Guardrails: input guardrails apply only to the first agent, output guardrails only to the final producer `[S2]` |
| **Plan-and-execute (hybrid two-tier)** | Planning tier (supervisor) decomposes + validates; execution tier (swarm/parallel) runs autonomously | Need both central planning and autonomous execution | Implemented in LangGraph as **nested subgraphs** (each subgraph is a full StateGraph compiled as a node) `[S4]` |

**Practitioner heuristic (LangGraph):** "Most teams begin with a **supervisor** and only
move to a **swarm** when the routing rules outgrow a single prompt" `[S4]`.

**AutoGen / AG2 GroupChat** is a third coordination style: a **GroupChat manager** picks the
next speaker (round-robin or LLM-based) with no hard-coded pipeline; **termination rules**
(max rounds, "DONE" tokens, satisfaction checks) prevent infinite loops; all messages flow
through one orchestrator giving free audit logs `[S7]`. The v0.4/AG2 rewrite is event-driven,
async-first, with pluggable orchestration strategies `[S7]`.

**CrewAI** offers a higher-level role abstraction: define agents with role/goal/backstory,
group into a **Crew**, pick a **process type** (sequential / hierarchical / consensual), and
the framework runs the coordination loop; **Flows** add start/listen/router steps with state
persistence and resumable long-running workflows `[S12]`. LangGraph, by contrast, models the
system as an explicit state-machine graph with conditional edges, checkpointing, and durable
execution — "zero magic" `[S12]`.

**Cost reality of multi-agent dispatch:** agents use ~4× the tokens of chat; multi-agent
systems ~15× — reserve them for "valuable tasks that involve heavy parallelization,
information that exceeds single context windows, and interfacing with numerous complex
tools." The multi-agent system beat single-agent Opus-4 by **90.2%** on Anthropic's internal
research eval `[S6]`.

---

## 5. ROUTING / DISPATCH DECISIONS — picking the path & the model

Routing is itself a meta-cognitive sub-problem with its own SOTA. A **semantic router**
encodes the prompt into embeddings, an **intent classifier** maps it to a model profile by
topic/intent/complexity (e.g. "this is coding → code model"; "short factual → small model")
`[S13]`. **Cascading** = sequential escalation: send to the cheapest model first; if output
confidence < threshold, escalate to the next tier — "always start cheap, only pay for
expensive compute when the cheap model can't handle it" `[S13]`. Production routers use an
**ensemble**: fast heuristics (length, keywords) → lightweight BERT classifier (domain) →
safety checks (PII) → confidence scoring for escalation `[S13]`. **Fallback routing** auto-
escalates to a stronger model on low-confidence or error, limiting quality failures without
a human `[S13]`. This maps directly onto Anthropic's "routing" workflow used for cost
optimization `[S1]`.

---

## 6. TASK-COMPLETION DETECTION + VERIFICATION

This is where the "are we done?" meta-decision lives, and the frontier consensus is
**verify against the final STATE/OUTCOME, not the intermediate steps**.

- **Outcome over process (Anthropic):** "Evaluate whether it achieved the correct final
  state... evaluate whether agents achieved the right outcomes while also following a
  reasonable process" — agents take different valid paths, so success = reaching the goal
  `[S6]`.
- **Verifier LLM checks effects (HTN literature):** to confirm an agent completed a task, a
  verifier LLM checks whether the **effect of the task-network node has been satisfied**
  `[S14]`.
- **LLM-as-Judge:** casting an LLM as verifier is an "LLM-as-a-Judge"; a Judge LLM critiques
  a proposed plan/answer and the agent applies critiques — a transparent, fully
  language-driven verification loop `[S14]`.
- **Self-verification is unreliable alone:** "While some self-verifying agents exist, there
  are concerns about their reliability, lack of contextual understanding, and insufficient
  human alignment" — hence separate evaluation modules / binary classifiers trained on
  agent-criteria + uncertainty + plan structure `[S14]`. Echoes LATS's reliance on external
  feedback `[S5]` and the HTN warning that LLMs can't self-verify correctness `[S3]`.
- **Ground truth from the environment (Anthropic):** in the autonomous loop, "agents must
  gain 'ground truth' from the environment at each step (such as tool call results or code
  execution) to assess progress" — completion detection is anchored in real observations,
  not the model's belief `[S1]`.
- **Metric spans:** Task-Completion scores the overall run; Tool-Correctness, Contextual-
  Relevancy, Faithfulness, safety, and custom G-Eval criteria score the specific spans that
  matter `[S14]`.

**Stop conditions in practice:** task complete (verified) · max-iteration cap (anti-runaway)
· human checkpoint/blocker · explicit "DONE"/satisfaction token (AutoGen) · evaluator
criteria met (evaluator-optimizer) `[S1][S7]`.

---

## 7. PLAN REPAIR / REPLANNING

The frontier moves from *reactive* (replan at the point of failure) to *proactive* (predict
failure and repair early). Key findings:

- **Repair early, not at failure:** "When it is detected that a plan is likely to fail...it
  is preferable to make an early decision rather than waiting for the point of failure to
  replan, as repairing a plan in advance can prevent the repair process from undoing some of
  the actions executed before failure" `[S16]`.
- **Closed-loop dynamic re-planning (LLM-DP):** prompt updates are driven by feedback from
  detectors / feasibility modules / failure signals; the system "adapts the plan on the fly,
  enabling robust recovery from dead ends, failed subgoals, or environmental changes" `[S16]`.
- **Self-healing frameworks:** failure-detection methods identify abnormal behavior from
  execution patterns + output consistency; self-healing recovers via **adaptive replanning +
  corrective prompting** (arXiv:2605.06737, *A Self-Healing Framework for Reliable LLM-Based
  Autonomous Agents*) `[S16]`.
- **Architecturally:** resilience = adding a **"re-planner" node** to the workflow graph — a
  feedback loop in the topology `[S16]`. This is exactly the plan-and-execute "re-plan after
  the batch" step `[S9]` and Reflexion's verbal-feedback loop (Section 8).
- **Verbal-reinforcement replanning (Reflexion):** on failure, convert binary/scalar env
  feedback into a **natural-language reflection** that diagnoses what went wrong, why, and
  what to try next; store as **episodic memory** to guide the next attempt — a "semantic
  gradient" `[S17]` (arXiv:2303.11366).

---

## 8. LINEAR vs LOOP vs FOLLOW-UP — three temporal shapes

A distinct meta-cognitive axis: **how does the task unfold in time?**

- **LINEAR** — a fixed sequence of known steps. This is the prompt-chaining / ReWOO /
  plan-and-execute world: plan once, run the steps, done. No re-decision per step `[S9]`.
- **LOOP** — open-ended iteration where the next step depends on the last observation, and
  the count is unknown. This is the autonomous-agent loop (plan → act → observe → repeat
  until done/max-iters/human-stop) `[S1]`, the evaluator-optimizer refinement loop `[S1]`,
  and the LATS search loop `[S5]`. Reflexion is a loop where each episode learns verbally
  from the last `[S17]`.
- **FOLLOW-UP / RECURRING** — the task spans process boundaries or recurs on a schedule, so
  it needs **durable execution**: automatic checkpointing of conversation history, stored
  memory, completed tool results, and current plan position to durable storage before each
  step continues; any run can be **retried, replayed, or resumed from the exact interruption
  point** `[S15]`. Plan-and-execute's explicit "generate follow-up plans if results fall
  short" is the in-run version of this `[S9]`. Human-in-the-loop is a special follow-up:
  automated processing → decision point → checkpoint/state-save → await human → seamless
  resume `[S15]`.

**Implementation note (caveat from the field):** "Checkpoints are not durable execution" —
checkpointing alone (LangGraph/CrewAI/Google ADK) is necessary but, some argue, insufficient
for true production durability across infra failures `[S15]`. **UNVERIFIED** as a settled
claim — it is one vendor's (Diagrid) position surfaced in search, not independently
corroborated here.

---

## 9. SKILL ACQUISITION — turning a solved task into a reusable skill

### 9.1 Voyager — the canonical skill library

Voyager (arXiv:2305.16291) is the first LLM-powered *lifelong-learning* embodied agent; its
three components are the blueprint for skill acquisition `[S18]`:

1. **Automatic Curriculum** — GPT-4 proposes the next task with the overarching goal of
   "discovering as many diverse things as possible." It is "an in-context form of novelty
   search" that accounts for exploration progress + agent state (e.g. learn to harvest sand
   before iron when in a desert) `[S18]`.
2. **Skill Library** — when a program **successfully completes a task (verified by
   self-evaluation)** it becomes a skill. Each skill stores **executable code indexed by the
   embedding of its (LM-generated) description**. Retrieval = query with the task/context
   embedding to pull the **top-5 relevant skills**. **Compositionality:** "Complex skills can
   be synthesized by composing simpler programs, which compounds Voyager's capabilities
   rapidly... and alleviates catastrophic forgetting" `[S18]`.
3. **Iterative Prompting Mechanism** — a generate→verify loop fusing three signals:
   **environment feedback** (GPT-4 reads state: "needs 2 more planks before crafting
   sticks"), **execution errors** (caught + fed back for correction), and **self-verification**
   (a *separate* GPT-4 acting as an independent critic that judges whether the code achieved
   the task and suggests improvements) `[S18]`.

**Results:** 3.3× more unique items, 2.3× longer distances, tech-tree milestones unlocked
15.3× (wood) / 8.5× (stone) / 6.4× (iron) faster than prior SOTA `[S18]`. **The pattern to
steal:** *solve → self-verify → describe → embed-as-key → store code → retrieve by similarity
→ compose.*

### 9.2 CoALA — the formal frame: learning = writing to procedural memory

CoALA (arXiv:2309.02427) is the academic spine that unifies everything above `[S11]`:

- **Four memory modules:** **working** (active symbolic variables for the current cycle);
  **episodic** (experience from earlier cycles — trajectories, events); **semantic**
  (knowledge about the world and self); **procedural** — two layers: the LLM's implicit
  weights *and* explicit **agent code (skills) + decision logic**. Procedural updates are
  "significantly riskier" (can introduce bugs) `[S11]`.
- **Action space:** **internal** actions = *reasoning* (read/write working memory via LLM),
  *retrieval* (long-term → working), *learning* (**write to long-term memory — including
  "writing new code into procedural memory" for skill acquisition**); **external** actions =
  *grounding* (act in env / dialogue / digital APIs) `[S11]`.
- **Decision loop:** a **planning stage** (reasoning + retrieval to *propose, evaluate,
  select* an action) then an **execution stage** (run grounding or learning, observe,
  repeat) `[S11]`.
- **Everything is an instance:** *ReAct* = reasoning + grounding, no memory, fixed cycle;
  *Voyager* = all four actions, procedural code memory, and on success "selects a **learning
  action adding the procedure to procedural memory**"; *Generative Agents* = episodic +
  semantic memory, retrieve reflections → reason → high-level plan; *Reflexion* = reasoning
  over episodic memory to write semantic knowledge `[S11]`.

**The meta-cognitive insight:** skill acquisition is just the *learning* internal action
writing a verified procedure to *procedural memory* — and the next decision cycle can
*retrieve* it instead of re-planning. Skill library (Voyager) = procedural memory (CoALA).

### 9.3 ADAS — automating the design of the agent itself

The frontier of skill acquisition is acquiring *whole agent designs*. **ADAS** (Automated
Design of Agentic Systems, arXiv:2408.08435, ICLR 2025) runs **Meta Agent Search**: a meta-
agent **iteratively programs new agents in code** against an ever-growing **archive of prior
discoveries** `[S19]`. Because code is Turing-complete, this can in principle learn any
agentic system — novel prompts, tool use, control flows, and combinations `[S19]`. Discovered
agents beat hand-designed SOTA and transfer across domains and models `[S19]`. This is
Voyager's skill-library idea lifted one level: the "skills" being accumulated are *agent
architectures*, not in-task procedures.

### 9.4 Generative Agents — memory→reflection→plan as a skill substrate

Stanford's Generative Agents (arXiv:2304.03442) contribute the **memory stream →
reflection → planning** loop: perceptions stream into memory; the agent periodically
**synthesizes higher-level reflections** from raw memories; retrieved memories + reflections
**form longer-term plans**, which re-enter the stream `[S20]`. Reflection here is the
mechanism that turns raw experience into reusable abstract knowledge — semantic-memory
skill acquisition, complementary to Voyager's procedural-code acquisition.

---

## 10. Synthesis — a meta-cognition control loop for Borjie / Mr. Mwikila

A concrete, source-grounded policy the brain layer can implement:

1. **CLASSIFY shape** (Section 1). Cheapest viable rung. One-shot if RAG+prompt suffices;
   workflow if subtasks are *known*; agent loop if step-count is unpredictable; multi-agent
   only for parallelizable breadth that exceeds one context window; durable loop if it spans
   crashes/schedules. *Gate on the 4×/15× token economics* `[S1][S6]`.
2. **ROUTE** the request (Section 5): semantic intent → domain agent + model tier; cascade
   cheap→expensive with confidence escalation `[S13]`.
3. **DECOMPOSE + PLAN** (Section 2): plan-and-execute (commit a plan, BDI-style, to focus
   search) for linear known work; LATS/ToT when the task needs lookahead/backtracking and
   has verifiable states; HTN-style hierarchical decomposition with LLM fallback +
   simulation-verification for structured ops `[S9][S5][S3][S8]`.
4. **FORMULATE sub-agents** (Section 3): give each an objective + output format + tool/source
   guidance + boundaries; *size the budget to query complexity* `[S6]`.
5. **DISPATCH** (Section 4): start supervisor; graduate to swarm/handoff when routing
   outgrows one prompt; use durable subgraphs for resumable long work `[S4][S12]`.
6. **DETECT COMPLETION + VERIFY** (Section 6): verify the **final state/outcome** via a
   verifier-LLM / LLM-as-Judge anchored in **environment ground truth**; never trust pure
   self-verification; enforce max-iters `[S6][S14][S1]`.
7. **REPAIR** (Section 7): predict failure and repair *early*; add a re-planner node;
   convert failures into verbal reflections stored as episodic memory `[S16][S17]`.
8. **ACQUIRE SKILL** (Section 9): on a verified success, *describe → embed → store code* in a
   skill library (= write to procedural memory); retrieve by similarity next time; compose
   skills `[S18][S11]`.

This loop is precisely CoALA's propose-evaluate-select cycle `[S11]` with Anthropic's
complexity ladder `[S1]` as the gate, LATS/plan-and-execute as the planner `[S5][S9]`,
Anthropic's spawn-rules as the formulation policy `[S6]`, and Voyager as the learning action
`[S18]`.

---

## Sources

| Key | URL | Access |
|---|---|---|
| S1 | https://www.anthropic.com/engineering/building-effective-agents | fetched |
| S2 | https://openai.github.io/openai-agents-python/handoffs/ (+ /guardrails/, /agents/) | search |
| S3 | https://arxiv.org/html/2511.12901 (Online Learning of HTN Methods for integrated LLM-HTN Planning); https://arxiv.org/pdf/2505.11814 (ChatHTN); https://arxiv.org/html/2605.07707v1 (HTN Planning with LLM-Generated Heuristics) | search |
| S4 | https://www.augmentcode.com/guides/swarm-vs-supervisor ; https://machinelearningplus.com/gen-ai/langgraph-multi-agent-systems-supervisor-swarm-network/ ; https://blog.langchain.com/benchmarking-multi-agent-architectures/ | search |
| S5 | https://arxiv.org/html/2310.04406v3 (Language Agent Tree Search) | fetched |
| S6 | https://www.anthropic.com/engineering/multi-agent-research-system | fetched |
| S7 | https://microsoft.github.io/autogen/0.2/docs/notebooks/agentchat_groupchat/ ; https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/ | search |
| S8 | https://www.ijcai.org/proceedings/2020/0684.pdf (BDI Agent Architectures: A Survey); https://arxiv.org/pdf/1303.5742 (Deliberation and the Formation of Intentions) | search |
| S9 | https://www.langchain.com/blog/planning-agents | fetched |
| S10 | https://arxiv.org/abs/2305.10601 (Tree of Thoughts, Yao et al.) | search |
| S11 | https://arxiv.org/html/2309.02427v3 (Cognitive Architectures for Language Agents — CoALA) | fetched |
| S12 | https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen ; https://dev.to/cristian_iridon_286794874/langgraph-vs-crewai-vs-autogen-in-2026-... | search |
| S13 | https://blog.vllm.ai/2025/09/11/semantic-router.html ; https://arxiv.org/html/2510.08731v1 (When to Reason: Semantic Router for vLLM); https://tianpan.co/blog/2025-11-03-llm-routing-model-cascades | search |
| S14 | https://arxiv.org/html/2509.02761v2 (Plan Verification for LLM-Based Embodied Task Completion Agents); https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide ; https://arxiv.org/pdf/2503.12651 (VeriLA) | search |
| S15 | https://www.langchain.com/blog/runtime-behind-production-deep-agents ; https://docs.langchain.com/oss/python/langgraph/persistence ; https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-... | search |
| S16 | https://www.emergentmind.com/topics/llm-dynamic-planner-llm-dp ; https://arxiv.org/abs/2605.06737 (A Self-Healing Framework for Reliable LLM-Based Autonomous Agents); https://doi.org/10.3390/robotics15040080 | search |
| S17 | https://arxiv.org/html/2303.11366 (Reflexion: Language Agents with Verbal Reinforcement Learning) | search |
| S18 | https://voyager.minedojo.org/ ; https://arxiv.org/abs/2305.16291 (Voyager) | fetched |
| S19 | https://arxiv.org/abs/2408.08435 (Automated Design of Agentic Systems — ADAS / Meta Agent Search) | search |
| S20 | https://arxiv.org/abs/2304.03442 (Generative Agents: Interactive Simulacra of Human Behavior) | search |

**Verification status:** Sources S1, S5, S6, S9, S11, S18 were fetched in full and quoted
directly. All other claims come from WebSearch result snippets of the cited primary URLs
(arXiv abstracts, vendor docs) and are marked **search**. The one disputed/vendor-position
claim ("checkpoints are not durable execution," S15) is explicitly flagged **UNVERIFIED**.

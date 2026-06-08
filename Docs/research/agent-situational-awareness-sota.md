# Agent Situational Awareness + Proactive Cognition — SOTA Dossier

**Date:** 2026-06-08
**Audience:** Borjie brain-layer engineers (`packages/central-intelligence`, `packages/ai-copilot`)
**Question:** How does an autonomous MD agent ALWAYS know — what has happened, what is being done, what needs to be done, what could matter in the future, plus its blind spots and caveats?

This dossier is the frontier-research backbone for Mr. Mwikila's *situational
awareness* faculty: the continuously-maintained world-model, the episodic +
semantic memory that tracks "the situation," the data-routing decision when a
new document/datum arrives, anticipatory/proactive triggers, blind-spot
detection, uncertainty surfacing, and continuous re-prioritization.

Every claim below cites a URL that was actually fetched during research.
Items marked **UNVERIFIED** could not be confirmed against a primary source.

---

## 0. The shape of the problem (frontier framing)

The capability we want is *not* reactive Q&A. It is **proactive problem
solving across many sources over long time horizons** — and the field's own
benchmark shows this is the hard frontier, not a solved problem.

The **PROBE benchmark** (Proactive Resolution Of BottlEnecks, Oct 2025)
decomposes proactivity into a three-stage pipeline and finds even GPT-5 and
Claude Opus 4.1 cap out at **40% end-to-end**:

1. **Search** — retrieve the documents that *contain evidence of a bottleneck*
   the user never named (F1: GPT-5 0.65, Opus 4.1 0.51).
2. **Bottleneck identification** — pinpoint the issue and its **root cause**
   (score ~0.42–0.43).
3. **Task execution** — pick the right action and fill every parameter (~0.40).

The dominant failure is **root-cause identification: 73.8% of identification
errors**; even Opus fails root cause in ~2/3 of cases. Each instance averages
**107,641 tokens across 79.3 documents** — i.e. the situation is *distributed*
and the agent must synthesize it. Human annotators (master's-level) managed only
**2.17 samples/hour**, evidence of the genuine cognitive load.
Source: https://arxiv.org/html/2510.19771v1

**Design implication for Borjie:** situational awareness is a *pipeline with a
weakest link at root-cause reasoning*, not a memory-lookup. Wire explicit
search → diagnose → act stages, instrument each, and treat root-cause synthesis
as the place to spend the most reasoning budget and the most evidence citations.

---

## 1. World-model / state-of-the-world maintenance

### 1.1 BDI — the classical control loop for "knowing the world"
The Belief-Desire-Intention model (Bratman → PRS/AgentSpeak) is the canonical
architecture for an agent that maintains a revisable picture of the world and
acts on it. Its interpreter cycle is:

> initialize → repeat { generate options from event queue → deliberate (select)
> → update intentions → execute plans → retrieve new external events → drop
> unsuccessful attitudes → drop impossible attitudes }

- **Beliefs** = the *informational state* about the world (deliberately
  "belief," not "knowledge," because it may be false); can carry inference
  rules for forward chaining.
- **Desires** = candidate goals the desire-generator produces from beliefs.
- **Intentions** = the committed subset the deliberation/filter selects.
- **Commitment** is what distinguishes desire from intention, giving *temporal
  persistence* (agents don't re-plan on every perturbation; they hold an
  intention "while conditions hold") and *hierarchical planning*.
- Data structures: **belief base, event queue, plan library, intention stack.**

The core tension the literature names: balancing *time spent deliberating*
(choosing what to do) vs *executing* — over-deliberation wastes resources,
over-commitment ignores a changed world.
Sources: https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model
and https://jumpcloud.com/it-index/what-is-bdi-belief-desire-intention-architecture

> Commitment-strategy taxonomy (blind / single-minded / open-minded
> commitment) is canonical BDI theory but was **not** confirmed in the fetched
> Wikipedia body — treat that specific taxonomy as **UNVERIFIED** pending the
> IJCAI BDI survey (https://www.ijcai.org/proceedings/2020/0684.pdf).

**Borjie mapping:** the existing `world-model.test.ts` /
`memory-hierarchy.test.ts` modules in `packages/central-intelligence` are the
belief base; the kernel think-pipeline is the deliberate→execute cycle; the
"persist intention while conditions hold" rule is the antidote to thrash when
new documents arrive mid-task.

### 1.2 Context is a finite resource — the world-model must be externalized
Anthropic's context-engineering guidance is the operational doctrine for *where*
the world-model lives. LLMs have an **"attention budget"**; every token depletes
it; long context causes **"context rot."** Therefore the durable state-of-the-
world should live *outside* the window:

- **Structured note-taking / external memory:** persistent notes outside the
  context window, retrieved later. The Claude-plays-Pokémon example "maintains
  precise tallies across thousands of game steps" and "develops maps of explored
  regions" via notes that **survive context resets.**
- **Memory tool (file-based):** "build up knowledge bases over time, maintain
  project state across sessions, and reference previous work without keeping
  everything in context."
- **Just-in-time retrieval:** keep *lightweight identifiers* (file paths, stored
  queries, links) and load data at runtime — "progressive disclosure" that
  "mirrors human cognition" rather than pre-loading everything.
- **Compaction:** summarize as you approach the limit, but "overly aggressive
  compaction can result in the loss of subtle but critical context."
- **Sub-agents with isolated context** return distilled 1,000–2,000-token
  summaries to the coordinator.
Source: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

### 1.3 Long-horizon "always knows what's happening" via durable artifacts
Anthropic's long-running-agent harness shows the concrete machinery for an agent
that re-orients itself after every reset:

- **Progress file** (`claude-progress.txt`) read at session start as durable
  state; **git log** as checkpoint history with descriptive commits enabling
  rollback to known-good states.
- **Feature/requirement registry** (a JSON file, "over 200 features" for big
  projects) with explicit **pass/fail status** — this *is* the re-prioritization
  index (pick the highest-priority not-yet-done item).
- **Re-orientation ritual:** `pwd` → read git logs + progress files → read the
  feature list → pick highest-priority undone item.
- **Verification before new work:** run a basic end-to-end test to "quickly
  identify if the app had been left in a broken state."
- **Single-feature focus** to avoid the "one-shot the app" failure mode.
Source: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

**Borjie mapping:** the estate's durable world-model = a per-tenant "estate
state" artifact (open licences, royalty due, workforce roster, treasury
position, open bids, pending compliance) that the MD *reads first* every turn —
the equivalent of the progress file + feature registry — backed by the audit
chain as the immutable git-log analogue.

---

## 2. Episodic + semantic memory for situation tracking

### 2.1 CoALA — the reference memory taxonomy
**Cognitive Architectures for Language Agents** (Sumers, Yao, Narasimhan et al.,
2023) is the unifying frame. It splits storage into **working** vs **long-term**
memory and long-term into the classic triple:

- **Working memory** — "active and readily available information as symbolic
  variables for the current decision cycle" (perceptions, retrieved knowledge,
  carried-over goals). The LLM input is built from working-memory variables; its
  output is parsed back into working memory.
- **Episodic memory** — "experience from earlier decision cycles" (event
  sequences, past trajectories); retrieved during planning, written as learning.
- **Semantic memory** — "an agent's knowledge about the world and itself"
  (databases, manuals, *self-generated inferences*); read to ground reasoning,
  written when new knowledge is derived.
- **Procedural memory** — implicit (LLM weights) + explicit (agent code/skills);
  "updating procedural memory through code modification carries significant
  risks."

Action space = **internal** (reasoning, retrieval, learning) + **external**
(grounding). Decision loop = **planning {proposal → evaluation → selection}**
then **execution** then observe-and-loop. Learning is the write-back that makes
the agent "increasingly informed... grounded in their history and self-generated
understanding."
Source: https://arxiv.org/html/2309.02427v3

### 2.2 Generative Agents — the production-grade memory mechanics
Park et al. (2023) give the most-copied concrete recipe for *tracking a
situation over time*: the **memory stream** + scored retrieval + reflection.

**Retrieval score** = sum of three min-max-normalized-to-[0,1] components, all
weights = 1 in the released implementation:

`score = α_recency·recency + α_importance·importance + α_relevance·relevance`

- **Recency** = exponential decay, factor **0.995** over hours since last access.
- **Importance** = LLM-rated *poignancy* on a **1–10** scale (1 = brushing
  teeth, 10 = a breakup), assigned at creation.
- **Relevance** = cosine similarity between the query embedding and each memory
  embedding.
Top-ranked memories that fit the context window are injected.

**Reflection** (this is the situation-synthesis engine) fires when the cumulative
importance of recent observations exceeds **~150** (roughly 2–3×/day):
1. Feed the LLM the **100 most recent** records, ask for the **3 most salient
   high-level questions.**
2. Use those questions as retrieval queries.
3. Ask the LLM to extract insights **citing the supporting records**
   ("insight (because of 1, 5, 3)").
4. Store each insight as a reflection-type memory with pointers — building a
   **reflection tree** (leaves = observations, higher nodes = abstractions).

**Planning + reacting:** top-down plan (5–8 daily chunks → hour blocks → 5–15
min steps); at each timestep, perceive → store → decide *continue vs react*; on
reaction, **regenerate the plan from that moment forward.**
Source: https://ar5iv.labs.arxiv.org/html/2304.03442

**Borjie mapping:** this maps almost 1:1 onto the existing `memory-hierarchy` +
`consolidation-cycle` tests. Borjie's mandatory **evidence_id citation rule**
(every junior recommendation cites ≥1 evidence) is exactly the Generative-Agents
"insight (because of 1,5,3)" pattern enforced as a hard invariant — the Auditor
Agent is the empty-evidence-chain rejecter.

### 2.3 Reflexion — turning failure into episodic situational lessons
Reflexion (Shinn et al., NeurIPS 2023) reinforces an agent **via language, not
weights**: convert environment feedback (scalar or free-form) into a *verbal
self-reflection*, store it in an **episodic memory buffer**, and feed it as
context on the next attempt. Self-reflection gives an **8% absolute boost over
plain episodic-memory replay**; pushed HumanEval pass@1 to **91%** vs GPT-4's
80%. The key claim: *refinement-only* is weaker than *self-reflection-guided
refinement*.
Source: (search) https://arxiv.org/abs/2303.11366

### 2.4 Sleep-time compute — consolidating the situation while idle
Letta's **sleep-time compute** (Apr 2025) splits the agent in two:
- **Primary agent** — handles live interaction; *cannot* edit memory.
- **Sleep-time agent** — runs asynchronously, "reason[s] through the information
  in advance," converting **"raw context" → "learned context,"** and refines the
  primary agent's core memory so it stays "clean, concise, and detailed."
Benefits: lower live latency (heavy analysis happens offline) + higher quality
(it has *already reflected* before being asked) — a claimed *Pareto improvement*.
Source: https://www.letta.com/blog/sleep-time-compute

Reinforced by the broader memory-consolidation literature (hippocampus→neocortex
replay, "fragile recent experiences → stable long-term knowledge"; replay also
serves planning + generalization).
Source: (search) https://fastcompanyme.com/technology/why-sleep-time-compute-is-the-next-big-leap-in-ai/

**Borjie mapping:** the `consolidation-cycle` + `reflexion-sleep-canary.yml`
nightly job *is* this pattern. The MD should run a nightly sleep pass that
re-derives "estate situation" insights from the day's events and rewrites the
durable estate-state artifact, so the morning briefing is pre-computed.

### 2.5 Durable state across resets — LangGraph persistence
The production substrate for "the agent never forgets where it was":
- **Checkpointer** saves a StateSnapshot **after every node** (not just at the
  end) → fault tolerance + resumption; `PostgresSaver` for prod/horizontal scale.
- **thread_id** = persistent cursor; reuse resumes, new value = empty state.
- **Store** = key-value long-term memory *separate* from execution state,
  namespaced by `(user_id, "memories")` — survives across threads ("User prefers
  concise Python code").
- **interrupt()** persists state and waits **indefinitely** (minutes→days,
  zero compute) for a human — the HITL substrate.
Source: (search) https://docs.langchain.com/oss/python/langgraph/interrupts

---

## 3. The data-routing decision: a datum arrives — where does it belong, why, and does it need a follow-up?

This is the operational heart of the MD's "always knows" promise: a captured
document/photo/message/number arrives, and the agent must *triage* it.

### 3.1 The triage as a classify-then-act pipeline (proactive-agent design)
Proactive-agent architecture frames the inbound-datum decision as: **monitor →
detect condition → LLM evaluates context against goals/conditions → decide if
action is warranted → choose action level.** Key building blocks:
- **Persistent memory/state** is *prerequisite* — you can only route a new datum
  if you have a baseline to compare it against and a structured log to file into.
- **Two trigger families:** scheduled (cron) vs event-driven (email receipt,
  form submission, **threshold breach**).
- **Decision is LLM-mediated**, not a script: "an LLM evaluating the current
  context against a set of goals or conditions" decides whether acting is
  warranted — "this distinguishes intelligent agents from simple scheduled
  scripts."
- **Action-level ladder:** inform / draft  vs  fully automated; pick the level
  by confidence and reversibility.
- **Low false-positive tolerance** for signal quality; observability + override
  controls mandatory.
Source: https://www.mindstudio.ai/blog/what-is-proactive-ai-agents-shifting-reactive-anticipatory

### 3.2 Where does it belong? — CoALA's write actions answer the "WHERE"
The routing target is exactly CoALA's *learning* action choosing a memory bank:
- A **fact about the world** (new royalty rate, a permit expiry date) → **semantic
  memory** (update the belief base / estate-state).
- **An event that happened** (a delivery, a payment, a safety incident) →
  **episodic memory** (the timeline).
- **A reusable how-to** (a working procedure) → **procedural memory** (skill
  library, see §6).
- Transient/in-progress → **working memory** for the current cycle.
Source: https://arxiv.org/html/2309.02427v3

### 3.3 Why + does it need a reminder/workflow? — importance + reflection trigger
Generative-Agents importance scoring is the "WHY does this matter / how loud"
signal: rate the datum's poignancy 1–10; high-importance arrivals push the
cumulative counter toward the reflection threshold and *should* spawn a
follow-up. The reflection step ("what are the 3 most salient questions given
recent records?") is precisely the mechanism that turns a pile of new documents
into "here is what now needs doing."
Source: https://ar5iv.labs.arxiv.org/html/2304.03442

**Borjie routing rubric (synthesized):** for every captured datum, the MD emits a
structured triage record —
`{ belongs_to: semantic|episodic|procedural, why: <root-cause/significance>,
importance: 1–10, action: none|file|remind|draft|workflow,
reversibility: low|high, evidence_id: ... }` — written to the audit chain. High
importance + low reversibility + threshold breach ⇒ schedule a follow-up or
spawn a workflow; otherwise file + note. This is the codebase's existing
`proactive-nudge.ts` formalized as a routing classifier.

---

## 4. Anticipatory + proactive trigger reasoning

- **Reactive vs anticipatory:** classic systems are "stateless and prompt-bound";
  proactive agents "monitor data sources on a schedule or in real time," detect
  conditions, and *initiate*. Trigger families = **cron** (with job queuing,
  retry, conditional execution) + **event-driven** (threshold breach, inbound
  message). A monitor agent can trigger a research agent which triggers a
  coordinator — cascading, no human in the loop.
  Source: https://www.mindstudio.ai/blog/what-is-proactive-ai-agents-shifting-reactive-anticipatory

- **Anticipate *what you'll need next*** — Voyager's **automatic curriculum**:
  rather than fixed goals, the agent proposes its next task from "the exploration
  progress and the agent's state to maximize exploration" — an "in-context form
  of novelty search," prioritizing what it currently lacks (e.g. desert
  harvesting before forest skills if the environment demands it). This is the
  forward-looking "what could matter in the future" engine.
  Source: https://voyager.minedojo.org/

- **Pre-compute the anticipated answer** — sleep-time compute reflects on
  available information *in the user's absence* so the morning answer is ready.
  Source: https://www.letta.com/blog/sleep-time-compute

- **The frontier caveat:** PROBE proves anticipatory action is the *unsolved*
  part — searching for unspecified issues + root-causing them is where SOTA fails.
  Don't over-trust proactive output; gate it.
  Source: https://arxiv.org/html/2510.19771v1

**Borjie mapping:** the existing `proactive-nudge.ts` + the live follow-up
schedulers (commit 959d0459) are the trigger substrate; add a curriculum-style
"what does this estate lack / what's coming up" planner that runs each
consolidation cycle (licence renewals, royalty filing windows, seasonal mining
cycles, bid expiries).

---

## 5. Gap / blind-spot detection — what is the agent NOT seeing?

- **PROBE's "search" stage is the blind-spot test:** the issue is in the
  datastore but *unspecified*; the agent must *go find evidence of a bottleneck
  nobody named.* SOTA search F1 ≤0.65 means agents miss the documents that would
  reveal the problem. **Root-cause errors (73.8%)** are blind-spots of
  *reasoning*, not retrieval — "right for the wrong reasons" doesn't fix
  anything. Build explicit coverage checks: did I look at every relevant source?
  Source: https://arxiv.org/html/2510.19771v1

- **Observability as the structural blind-spot detector:** OpenTelemetry GenAI
  semantic conventions (GenAI SIG, formed Apr 2024; v1.41 defines **agent /
  workflow / tool / model spans** + required latency & token metrics) let you see
  *where reasoning diverges from expected paths*, watch tool error rates, and
  correlate across session boundaries. "Step-level tracing — not pass/fail health
  checks — is the minimum viable signal for an agent in production."
  Sources: https://opentelemetry.io/blog/2025/ai-agent-observability/
  and (search) https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions

- **Reflection's "salient questions" double as a gap scan:** asking "what are the
  3 most salient high-level questions about recent events?" surfaces what the
  agent *should* be wondering about but hasn't resolved.
  Source: https://ar5iv.labs.arxiv.org/html/2304.03442

- **Self-verification as a "did I actually achieve this?" check** — Voyager's
  critic LLM asks "whether the program achieves the task," catching silent
  failures.
  Source: https://voyager.minedojo.org/

**Borjie mapping:** wire a per-turn "coverage assertion" — before the MD answers,
it lists the data sources it *should* have consulted (estate-state, corpus,
LMBM, recent events) and flags any it could not reach as an explicit blind-spot
caveat. The OTel decision-trace (`decision-trace.ts`) is the audit substrate.

---

## 6. Uncertainty / caveat surfacing

- **Calibration is the named problem:** "a calibrated model... stated 80%
  confidence corresponds, empirically, to being correct 80% of the time," but
  "after instruction tuning, models often become overconfident," and
  log-probability "is a proxy for the model's internally represented uncertainty,
  not necessarily its epistemic state about the real world."
  Source: (search) https://arxiv.org/abs/2503.15850

- **Semantic entropy** (Farquhar/Kuhn/Gal, *Nature* 2024) is the SOTA
  hallucination/confabulation detector: sample multiple answers, **cluster by
  meaning**, compute entropy **over the clusters** — high semantic entropy ⇒
  likely confabulation. This is meaning-level, not token-level, so it survives
  paraphrase.
  Sources: https://www.nature.com/articles/s41586-024-07421-0
  and https://oatml.cs.ox.ac.uk/blog/2024/06/19/detecting_hallucinations_2024.html

- **Act on uncertainty instead of bluffing forward:** production pattern is to
  "defer, clarify, or abstain rather than hallucinate forward"; methods include
  verbalized confidence, temperature scaling, conformal prediction (SConU),
  CoT-UQ, confidence tokens / routing.
  Source: (search) https://arxiv.org/html/2503.15850

- **LangGraph interrupt()** is the substrate for "I'm not sure — pausing for a
  human": persist state, wait indefinitely at zero compute.
  Source: (search) https://docs.langchain.com/oss/python/langgraph/interrupts

**Borjie mapping:** the MD should attach a confidence band + caveat list to every
high-stakes recommendation, run semantic-entropy on multi-sample answers for
HIGH-risk policy prefixes (sovereign/kill_switch/four_eye), and *abstain →
escalate via interrupt* rather than guess. This complements the existing
sycophancy-probe + intent-verification gates.

---

## 7. Continuous re-prioritization

- **BDI intention reconsideration:** drop/suspend/replace intentions when
  triggering conditions or context change, but otherwise *persist* — the
  deliberation-vs-execution balance is the re-prioritization governor.
  Source: https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model

- **Feature-registry ordering:** the long-running harness re-prioritizes by always
  picking "the highest-priority feature that's not yet done" from a pass/fail
  registry, after re-reading progress + verifying nothing is broken.
  Source: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

- **Plan repair > replan-from-scratch on change:** when execution monitoring
  detects a precondition failure (exogenous event or another agent's action),
  *plan repair* "can provide new plans faster and with fewer revisions than
  replanning from scratch" — preserve the already-executed prefix, jump back to
  the unaffected state. Execution monitoring checks preconditions before and
  effects after each action and "detect[s] link failures as soon as they occur."
  Source: (search) https://arxiv.org/html/2504.16209v1
  and (search) https://arxiv.org/pdf/2403.12162

- **Replan-from-the-moment-forward** — Generative Agents regenerate the plan from
  the reaction point when a perception warrants it (don't rebuild the whole day).
  Source: https://ar5iv.labs.arxiv.org/html/2304.03442

- **CoALA evaluation** assigns values to candidate actions via heuristics / LLM
  scores / learned functions / internal simulation, then selects via
  argmax/softmax/voting — the formal re-ranking step.
  Source: https://arxiv.org/html/2309.02427v3

**Borjie mapping:** maintain a live priority queue of estate intentions
(royalty-due > expiring-licence > open-high-value-bid > maintenance) re-ranked
each cycle by CoALA-style evaluation; use *plan repair* (not full replan) when a
new datum invalidates a precondition, preserving committed work — directly mirrors
BDI commitment + the workflow-engine.

---

## 8. Synthesis — the Borjie "always knows" loop (recommended composite)

```
PERCEIVE  every inbound datum → triage record {belongs_to, why, importance,
            action, reversibility, evidence_id}                      (§3)
   │
FILE      route to semantic / episodic / procedural memory           (§2,§3)
   │
CONSOLIDATE (sleep-time, nightly) → reflection tree of "estate situation"
            insights; rewrite durable estate-state artifact          (§2.4,§2.2)
   │
ORIENT    each turn: read estate-state + progress + recent events;
            verify nothing is broken                                 (§1.3)
   │
SCAN GAPS  coverage assertion (sources I should have hit) +
            3-salient-questions + self-verification                  (§5)
   │
ANTICIPATE curriculum planner: licence renewals, filing windows,
            seasonal cycles, bid expiries                            (§4)
   │
PRIORITIZE live intention queue, CoALA-evaluated, BDI-committed;
            plan-repair on change                                    (§7)
   │
ACT/ABSTAIN action-level ladder by confidence × reversibility;
            semantic-entropy gate; interrupt→human on HIGH-risk      (§6,§3.1)
   │
TRACE      OTel agent/workflow/tool/model spans + audit chain        (§5)
   └──────────────────────────────── loop ─────────────────────────────────┘
```

This composite is *already 70% present* in the repo
(`world-model`, `memory-hierarchy`, `consolidation-cycle`, `proactive-nudge`,
`self-awareness`, `decision-trace`, the reflexion-sleep canary, live follow-up
schedulers). The missing frontier pieces are: (a) the explicit **triage/routing
classifier** for inbound data (§3), (b) a **coverage/blind-spot assertion** per
turn (§5), (c) **semantic-entropy** uncertainty gating on HIGH-risk output (§6),
and (d) a **curriculum-style anticipatory planner** (§4).

---

## Sources (all fetched/searched during this research)

**Fetched (full-content):**
- Anthropic — Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic — Effective harnesses for long-running agents: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Generative Agents (ar5iv full text): https://ar5iv.labs.arxiv.org/html/2304.03442
- PROBE benchmark (arXiv HTML): https://arxiv.org/html/2510.19771v1
- CoALA (arXiv HTML): https://arxiv.org/html/2309.02427v3
- Voyager (project page): https://voyager.minedojo.org/
- BDI software model (Wikipedia): https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model
- OpenTelemetry — AI agent observability: https://opentelemetry.io/blog/2025/ai-agent-observability/
- Letta — Sleep-time compute: https://www.letta.com/blog/sleep-time-compute
- Semantic entropy (Nature 2024): https://www.nature.com/articles/s41586-024-07421-0
- Proactive AI agents (MindStudio): https://www.mindstudio.ai/blog/what-is-proactive-ai-agents-shifting-reactive-anticipatory

**Search-surfaced (abstract/summary level — primary PDFs cited but not full-fetched):**
- Reflexion (arXiv): https://arxiv.org/abs/2303.11366
- UQ & calibration survey (arXiv): https://arxiv.org/abs/2503.15850
- HTN plan-repair comparison (arXiv): https://arxiv.org/html/2504.16209v1
- Intelligent execution through plan analysis (arXiv): https://arxiv.org/pdf/2403.12162
- LangGraph interrupts/persistence docs: https://docs.langchain.com/oss/python/langgraph/interrupts
- OTel GenAI semantic conventions (Greptime): https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions
- BDI agent architectures survey (IJCAI 2020): https://www.ijcai.org/proceedings/2020/0684.pdf
- Semantic entropy (OATML blog): https://oatml.cs.ox.ac.uk/blog/2024/06/19/detecting_hallucinations_2024.html
- Sleep-time compute (Fast Company): https://fastcompanyme.com/technology/why-sleep-time-compute-is-the-next-big-leap-in-ai/

**UNVERIFIED:** BDI commitment-strategy taxonomy (blind/single-minded/open-minded)
— canonical theory, not confirmed in fetched Wikipedia body; see IJCAI survey.

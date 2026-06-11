# Graduated Autonomy & Human-Gating for Agentic Systems — SOTA Dossier

**Date:** 2026-06-08
**Author:** Research subagent (real web research; every claim cites a fetched URL)
**Audience:** Borjie architecture — the Mr. Mwikila brain layer and its junior agents
**Owner directive being answered:** "Everything is USER-GATED by default. When a NEW flow is
created the system asks once whether it runs AUTO or stays gated. Once a flow is AUTO it runs
autonomously." This dossier researches how frontier systems do exactly this, and recommends a
concrete model for Borjie.

> Verification note: Every source below was fetched via WebFetch or surfaced via WebSearch during
> this research pass. Where a specific numeric claim could not be confirmed against the primary
> document text, it is marked **UNVERIFIED**. Nothing here is invented.

---

## 0. Executive answer (the recommended model in one screen)

Borjie should implement **per-flow autonomy policies on top of a per-action capability layer**,
governed by a **5-level autonomy ladder**, with **earned promotion** from gated → auto and a
**fail-closed kill switch**. Concretely:

1. **Default = gated (HITL).** Every new flow starts at autonomy level "ASK" — the agent pauses
   and the MD approves/edits/rejects each consequential action. This matches Claude Code's
   read-only-by-default, approve-before-write posture
   ([Anthropic — How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude)).

2. **One-time auto/gated decision at flow creation.** When a *new flow* is first defined, the
   system asks once: "Run this AUTO, or keep it GATED?" This is a per-flow autonomy policy — the
   same idea as LangChain's `interrupt_on` mapping (per-tool: `True` / `{allowed_decisions}` /
   `False`) and OpenAI's `needs_approval` (bool or per-call function)
   ([LangChain HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop);
   [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-python/human_in_the_loop/)).

3. **Auto ≠ unbounded.** Even an AUTO flow keeps three escape hatches required by EU AI Act
   Art. 14 and NIST AI RMF: (a) a per-action **risk tripwire** that re-gates HIGH-risk actions
   (deletions, money movement, irreversible/external effects), (b) a **stop button / interrupt**,
   and (c) **override/reverse** of any output
   ([EU AI Act Art. 14](https://artificialintelligenceact.eu/article/14/)).

4. **Earned autonomy is the safe path to "AUTO".** Rather than only asking the human to choose,
   offer **promotion-by-evidence**: a flow that has run N times gated with low error/escalation
   rates earns a suggestion to flip to AUTO. This is the production "progressive autonomy" pattern
   (shadow → assist → bounded-auto → scoped-auto) gated on empirical performance
   ([MindStudio — Progressive Autonomy](https://www.mindstudio.ai/blog/progressive-autonomy-ai-agents-safe-deployment)).

5. **Capability-based authorization underneath.** Autonomy policy decides *whether to pause*;
   capabilities decide *what is even reachable*. Each junior agent holds an unforgeable,
   least-privilege capability set (tool + parameter scope + read/write/execute + TTL), so an
   AUTO flow still cannot exceed its granted authority
   ([Capability-based security — Wikipedia](https://en.wikipedia.org/wiki/Capability-based_security);
   [NIST — least privilege](https://csrc.nist.gov/glossary/term/least_privilege)).

The rest of the dossier is the evidence and the detailed mechanism.

---

## 1. The autonomy spectrum: HITL / HOTL / HOOTL

The foundational vocabulary. Three loop postures, chosen per action by reversibility and stakes:

- **Human-in-the-loop (HITL):** the agent pauses at a checkpoint and *waits* for a human to
  approve before executing. "HITL requires a human to approve an action before it executes — the
  agent pauses and waits." Appropriate for "high-consequence, irreversible, or regulated actions."
- **Human-on-the-loop (HOTL):** the agent acts autonomously while a human *monitors* and can
  intervene *after the fact*. Appropriate for "faster-moving, lower-risk work where delay costs
  more than the occasional reversible error."
- **Human-out-of-the-loop (HOOTL):** "the system functions completely autonomously within
  predefined boundaries, with humans defining the objectives, constraints, and success criteria
  but not intervening in routine operations."

Source: [Waxell — HITL vs HOTL](https://www.waxell.ai/blog/human-in-the-loop-vs-human-on-the-loop-ai-agents),
[Iquall — HITL → HOTL → HOOTL](https://iquall.net/insights/navigating-the-loop-hitl-hotl-hootl-in-autonomous-networks/).

**Academic root.** The loop taxonomy descends from the classic levels-of-automation literature:
Sheridan & Parasuraman, and Parasuraman, Sheridan & Wickens (2000), plus the **automation
complacency / automation bias** findings (Parasuraman & Riley, 1997) showing humans over-rely on
automation — the exact failure mode a gating UX must fight.
Source (secondary citation of these works): [arXiv 2504.19678 — From LLM Reasoning to Autonomous AI Agents](https://arxiv.org/pdf/2504.19678).
*(Primary Parasuraman/Sheridan papers were referenced but not directly fetched — **UNVERIFIED** at
the primary-source level; treat the secondary citation as the fetched evidence.)*

**Borjie mapping:** "user-gated by default" = HITL. "Set a flow to AUTO" = move that flow to HOTL
(monitored) or HOOTL (bounded), per its risk class.

---

## 2. Discrete autonomy levels (a ladder, not a switch)

Two complementary taxonomies. Use the academic one for vocabulary, the production one for the
promotion ladder.

### 2a. Academic five-level ladder (user-role centric)

From the peer-reviewed-style taxonomy "Levels of Autonomy for AI Agents" — levels are defined by
*who initiates*, *who has final say*, and *what oversight remains*:

| Level | Name | Who initiates | Final say | Oversight |
|------|------|--------------|-----------|-----------|
| L1 | **Operator** | User drives | User | "Agent requires explicit approval before taking action" |
| L2 | **Collaborator** | Both | Shared; user edits outputs | Rich back-and-forth; user can take control anytime |
| L3 | **Consultant** | Agent plans over extended horizons | Agent decides, consults user | User input is indirect |
| L4 | **Approver** | Agent autonomous | User approves only at blockers / consequential actions | "User is only required to interact … when the agent encounters a blocker" |
| L5 | **Observer** | Agent fully autonomous | Agent decides all | Monitor via logs; "emergency off-switch only" |

Source: [Knight First Amendment Institute — Levels of Autonomy for AI Agents](https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1)
(also [arXiv 2506.12469](https://arxiv.org/pdf/2506.12469)).

This is the cleanest mapping to the owner's intent: **gated-by-default = L1 (Operator)**, and
"flip to AUTO" = promote that flow toward **L4 (Approver, still gates blockers/HIGH-risk)** or
**L5 (Observer)** for the lowest-risk flows.

### 2b. SAE-style L0–L5 (operational-risk centric)

A parallel industry taxonomy inspired by SAE J3016 (self-driving levels). "Autonomy levels are
formal classifications of operational risk, cognitive load distribution, and architectural
guardrails rather than metrics of model intelligence." The hard jump is **L2→L3**, "where the
agent moves from suggesting actions to executing them with limited supervision," and **L3
conditional autonomy is the current production ceiling.**
Source: [ASDLC — Levels of Autonomy L1–L5](https://asdlc.io/concepts/levels-of-autonomy/),
[Data Agents L0–L5 tutorial (SIGMOD'26)](https://luoyuyu.vip/files/SIGMOD26-Tutorial-DataAgents.pdf).

**Trust reality check:** "only 27% of organizations trust fully autonomous AI agents, down from
43% just one year earlier" (Capgemini, cited by ASDLC). Conclusion for Borjie: **L5/HOOTL should
be rare and earned, never the default.** The MD's estate (money, royalties, licences) is
high-stakes — most flows belong at L1–L4.

---

## 3. Per-action / per-flow autonomy policy — how frontier frameworks encode it

This is the technical core of "the system asks once whether a flow runs auto or stays gated."

### 3a. LangChain / LangGraph — the `interrupt_on` policy map + `interrupt()`

- **Policy as a per-tool map** (this is exactly the owner's per-flow auto/gated switch):
  ```python
  interrupt_on={
      "write_file":  True,                                   # gate, all decisions allowed
      "execute_sql": {"allowed_decisions": ["approve","reject"]},  # gate, no editing
      "read_data":   False,                                  # AUTO, never pause
  }
  ```
- **Four decision types** when gated: **approve** (run as-is), **edit** (run with modified args),
  **reject** (don't run, explanation added to conversation), **respond** ("ask-user" tools —
  human's message becomes the tool result).
- **Conditional gating** via a `when` predicate — e.g. only pause writes outside `/workspace/`.
  This is how you make AUTO flows still re-gate HIGH-risk parameter values.
- **Durable pause/resume:** `interrupt()` halts the node, state is persisted by a **checkpointer**
  keyed by `thread_id`, and you resume with `Command(resume={"decisions":[{"type":"approve"}]})`.
  Approvals survive process restarts.

Source: [LangChain — Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop),
[LangChain blog — building HITL agents with interrupt](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt),
[LangGraph static breakpoints how-to](https://langchain-ai.github.io/langgraph/cloud/how-tos/human_in_the_loop_breakpoint/).

### 3b. OpenAI Agents SDK — `needs_approval` (bool or per-call function) + sticky decisions

- **Per-tool or per-call policy:** `@function_tool(needs_approval=True)` always gates; or pass an
  **async callable `(run_context, params, call_id) -> bool`** that decides *per invocation* (so the
  same flow can be AUTO for small amounts, gated for large). Supported on `function_tool`,
  `Agent.as_tool`, `ShellTool`, `ApplyPatchTool`, and MCP servers.
- **Pause/inspect/resume:** when it pauses, `RunResult.interruptions` holds `ToolApprovalItem`
  entries (`agent.name`, `tool_name`, `arguments`). Convert via `result.to_state()`, call
  `state.approve(...)` / `state.reject(...)`, resume with `Runner.run(agent, state)`.
- **Sticky / remembered decisions:** `always_approve=True` / `always_reject=True` are "stored in
  the run state" and survive serialization (`to_json`/`from_json`) — i.e. "approve this kind of
  action from now on," which is precisely a *promotion to AUTO for that action class*.
- **Guardrails vs approvals are separate layers:** guardrails are automatic input/output/tool
  checks; approvals are the human path. "Together, they define when a run should continue, pause,
  or stop."

Source: [OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/),
[OpenAI — Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals),
[OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/).

### 3c. AutoGen — three coarse modes (the simplest model)

`ConversableAgent.human_input_mode`: **NEVER** (fully auto), **TERMINATE** (default — ask only at
termination), **ALWAYS** (ask every turn; human may skip, intervene, or terminate). A
`UserProxyAgent` represents the human as a first-class participant in the chat loop.
Source: [AutoGen — Allowing Human Feedback in Agents](https://microsoft.github.io/autogen/0.2/docs/tutorial/human-in-the-loop/).

### 3d. CrewAI — per-task review gate

`human_input=True` on a task turns it into "a formal review gate." Internally it is event-driven:
"an agent might raise a 'needs approval' event, and the system will wait until a human responds."
Source (secondary, framework comparison): [ZenML — CrewAI vs AutoGen](https://www.zenml.io/blog/crewai-vs-autogen).

**Synthesis for Borjie:** the strongest model is LangChain's **policy-map + four decisions +
predicate `when`** combined with OpenAI's **per-call function + sticky/remembered decisions**.
Borjie's "ask once at flow creation" is literally writing one row into such a policy map; "flip to
AUTO" sets that flow's entry to `False`/`NEVER` *except* where the risk predicate forces a re-gate.

---

## 4. Capability-based authorization (the layer beneath autonomy policy)

Autonomy policy answers "pause or not?"; capabilities answer "is this even allowed?". The two are
orthogonal and must both be present — an AUTO flow must still be unable to exceed least privilege.

- **Capability = unforgeable token of authority.** "A capability … is a communicable, unforgeable
  token of authority that refers to a value which references an object along with an associated set
  of access rights." Design shifts from *"who are you"* to *"what can you do,"* which "naturally
  support[s] least privilege and clean delegation."
  Source: [Capability-based security — Wikipedia](https://en.wikipedia.org/wiki/Capability-based_security).
- **Least privilege (PoLP / PoLA):** "every module must be able to access only the information and
  resources that are necessary for its legitimate purpose."
  Source: [Principle of least privilege — Wikipedia](https://en.wikipedia.org/wiki/Principle_of_least_privilege),
  [NIST CSRC glossary — least privilege](https://csrc.nist.gov/glossary/term/least_privilege).
- **For AI agents specifically:** model "each agent's authority as a capability set — a collection
  of unforgeable tokens, each granting access to a specific tool with specific parameters,
  including parameter restrictions, operation scope (read, write, execute), time-to-live, and
  cryptographic signatures," so "a compromised tool cannot escalate privileges."
  Source: [SoK — Security and Safety in the MCP Ecosystem (arXiv 2512.08290)](https://arxiv.org/pdf/2512.08290),
  [Formal Security Framework for MCP-Based AI Agents (arXiv 2604.05969)](https://arxiv.org/pdf/2604.05969).

**Borjie mapping:** each junior (compliance, FX-treasury, sales-offtake, metallurgy, safety, etc.)
already maps to a bounded domain — give each a capability set scoped to its tools + parameter
ranges + TTL. AUTO promotion *widens the autonomy policy*, never the capability set; the capability
set changes only via an explicit, separately-authorized grant. This keeps Borjie's hard rules
intact (money path through `LedgerService.post()`, RLS, kill-switch) regardless of autonomy level.

---

## 5. Trust calibration & earned / promoted autonomy

This is the science behind "auto only after N successful gated runs."

### 5a. Why calibration matters (the failure modes)

- **Trust calibration** = "alignment between a human user's subjective trust and the system's
  objective trustworthiness … minimizing both overtrust and undertrust."
- **Overtrust** = automation *misuse* — relying on automation where it's ill-suited; "associated
  with severe performance degradation when the human is using faulty automation."
- **Undertrust** = automation *disuse* — "when people reject the capabilities of automation,"
  causing "inefficiencies and higher costs."
- Calibration "can be achieved by varying the automation's transparency — the amount and utility
  of information provided to the human."

Source: [Emergent Mind — Trust Calibration in AI](https://www.emergentmind.com/topics/trust-calibration-in-ai),
[Space Trusted Autonomy Readiness Levels (arXiv 2210.09059)](https://arxiv.org/pdf/2210.09059),
[Human Trust-based Feedback Control (arXiv 2006.16353)](https://arxiv.org/pdf/2006.16353),
[Calibrating workers' trust in intelligent automated systems (Patterns / PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11573890/).

**Design consequence:** a one-time "AUTO?" prompt at flow creation risks *overtrust* (the MD says
yes before evidence exists). Pair it with *earned promotion* so AUTO is offered when evidence
supports it, and with transparency (show the track record) at the moment of asking.

### 5b. Progressive / earned autonomy — the production pattern

Phased deployment, gated on measured performance:

- **Shadow mode (observe):** "the AI does not act. It only observes … generates internal
  recommendations — but nothing is executed," creating a baseline of "what the AI would have done
  vs what actually happened."
- **Assist mode (human control):** "the AI drafts actions … Humans approve, modify, or reject
  every action." (= Borjie's default gated state.)
- **Bounded / scoped auto:** "start AI agents with narrow, low-risk permissions and expand them
  gradually as the agent demonstrates it can be trusted. High-stakes decisions route to humans;
  routine, well-understood tasks run automatically."
- **Promotion criteria (concrete):** complete "a meaningful sample of tasks (typically 100–500
  instances depending on stakes)" with "error rates below a defined threshold and low
  false-escalation rates" before promotion. *(The 100–500 figure is from the MindStudio
  source's FAQ — treat as an industry heuristic, not a law.)*
- **A four-rung autonomy ladder** in the same model:
  - L0 — human reviews/approves everything
  - L1 — auto on low-stakes; above a risk threshold pauses for review
  - L2 — handles most tasks; humans *notified* but don't approve (HOTL)
  - L3 — independent within a defined scope; anomalies trigger alerts

Source: [MindStudio — Progressive Autonomy for AI Agents](https://www.mindstudio.ai/blog/progressive-autonomy-ai-agents-safe-deployment),
[Elixir Data — Progressive Autonomy: Four Phases](https://www.elixirdata.co/blog/progressive-autonomy),
[AWS SageMaker — shadow deployment](https://docs.aws.amazon.com/sagemaker/latest/dg/model-shadow-deployment.html).

### 5c. Anthropic's empirical evidence on gating UX (the most important real-world data here)

Anthropic's own product telemetry — directly relevant to Borjie's confirmation UX:

- **Approval fatigue is real and dangerous:** Claude Code's "allow reads, require approval for
  write, bash, and network" model "triggered approval fatigue — users approved **roughly 93% of
  permission prompts**, reducing their attentiveness over time."
- **Default-deny beats per-action prompting:** moving to OS-level sandboxing (Seatbelt/bubblewrap)
  that "allow[s] reads, allow[s] writes inside the workspace, but network is denied by default …
  **reduced permission prompts by 84%**."
- **Trust is graduated by user expertise:** "experienced users auto-approve roughly twice as often
  as new users, but they also interrupt the agent mid-execution more frequently."

Source: [Anthropic — How we contain Claude](https://www.anthropic.com/engineering/how-we-contain-claude).

**Lesson for Borjie:** if you prompt on every action, the MD will rubber-stamp ~93% and oversight
becomes theater. The fix is (a) **gate by risk class, not by every action**, (b) **default-deny
the dangerous surface (money, deletions, external comms)** so AUTO is safe-by-construction, and
(c) **let trusted/earned flows go AUTO** to cut prompt volume — the same 84%-reduction logic.

---

## 6. Governance & regulatory grounding (what the gate must satisfy)

### 6a. EU AI Act, Article 14 — Human Oversight (the legal floor for high-risk)

Mining-estate decisions (compliance, financial, safety) plausibly fall in high-risk territory.
Article 14 *mandates* the exact controls Borjie's AUTO mode must retain:

- §1 — systems "designed … that they can be effectively overseen by natural persons during the
  period in which they are in use."
- §3 — oversight measures must be "**commensurate with the risks, level of autonomy and context of
  use**" (i.e. higher autonomy → stronger oversight — directly supports a risk-tiered ladder).
- §4 — overseers must be able to: understand capabilities/limitations & detect anomalies; **remain
  aware of automation bias**; correctly interpret output; **"decide … not to use … or to otherwise
  disregard, override or reverse the output"**; and **"intervene … or interrupt the system through
  a 'stop' button or a similar procedure."**
- §5 — biometric ID systems require **two-person verification** (a template for Borjie's
  four-eyes / dual-control on the very highest-stakes actions).

Source: [EU AI Act — Article 14 Human Oversight](https://artificialintelligenceact.eu/article/14/),
[AI Act Service Desk — Article 14](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14).

### 6b. NIST AI RMF — Govern/Map/Measure/Manage + the agentic gap

- Four functions: **Govern** (cross-cutting center), **Map, Measure, Manage**.
- For agentic systems, effective oversight "requires **interrupt conditions** — predefined
  thresholds at which agent execution is paused and human review is required — combined with
  real-time monitoring infrastructure capable of detecting anomalous action patterns."
- **Identified gap:** the RMF "does not differentiate between AI systems based on their degree of
  operational autonomy" — a recommendation engine and a multi-day autonomous workflow "are both
  treated generically." Borjie's per-flow autonomy level *is* the missing differentiator.

Source: [CSA — NIST AI RMF Agentic Profile](https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/),
[CSA — Agentic AI Governance: NIST Standards (PDF)](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/03/governance-nist-ai-agent-standards-agentic-governance-v1-csa-styled.pdf),
[AAGATE — NIST AI RMF-aligned governance platform (arXiv 2510.25863)](https://arxiv.org/pdf/2510.25863).

### 6c. Approval matrices / RACI / delegation-of-authority (the org pattern)

The auto-vs-gated decision is, organizationally, a **delegation-of-authority / approval matrix**:

- **RACI**: Responsible (does the work), **Accountable** (signs off; exactly one per item),
  Consulted, Informed. "Especially useful for … approval-heavy workflows and complex handoffs."
- Money/risk alignment: "Who is legally liable, who has contractual authority to approve changes,
  and who bears financial risk should all align with **Accountable** designations."

Source: [Atlassian — RACI chart](https://www.atlassian.com/work-management/project-management/raci-chart),
[Asana — RACI](https://asana.com/resources/raci-chart),
[Responsibility assignment matrix — Wikipedia](https://en.wikipedia.org/wiki/Responsibility_assignment_matrix).

**Borjie mapping:** the MD is the **Accountable** party for every flow; a junior agent is
**Responsible** for execution. AUTO = the MD has *pre-delegated* approval authority for that flow
within thresholds; gated = approval authority is retained per-instance. Encode this as an
**approval matrix keyed by (flow, action-risk-class, amount/threshold)**.

---

## 7. Cognitive-architecture & agent-paper grounding (why "auto flows" can be durable skills)

The owner's "once a flow is AUTO it runs autonomously" is, architecturally, a **learned, reusable
skill** that has been *promoted*. The literature gives this real foundations:

- **Voyager (skill library):** "an ever-growing skill library of executable code for storing and
  retrieving complex behaviors"; skills are "temporally extended, interpretable, and
  compositional," reused in new contexts, learned "without human intervention." A promoted AUTO
  flow in Borjie *is* an entry in such a skill library — verified, named, reusable.
  Source: [Voyager (arXiv 2305.16291)](https://arxiv.org/abs/2305.16291).
- **Reflexion (verbal RL / self-improvement):** agents "verbally reflect on task feedback signals,
  then maintain their own reflective text in an episodic memory buffer to induce better
  decision-making in subsequent trials" — no weight updates. This is the engine for *earning*
  promotion: a flow that reflects on failures and stops escalating is a flow ready to go AUTO.
  Source: [Reflexion (arXiv 2303.11366)](https://arxiv.org/abs/2303.11366).
- **Generative Agents (memory stream + reflection + planning):** the architecture "store[s] a
  complete record of the agent's experiences … synthesize[s] those memories over time into
  higher-level reflections, and retrieve[s] them dynamically to plan behavior." The **track record**
  that justifies AUTO promotion lives in exactly this kind of memory stream.
  Source: [Generative Agents (arXiv 2304.03442)](https://arxiv.org/abs/2304.03442).
- **BDI / HTN planning (classical autonomy):** Belief–Desire–Intention agents and Hierarchical
  Task Network planners decompose goals into sub-tasks with explicit commitment points — the
  natural place to insert a gate is *between* an intention and its execution, and an AUTO flow is
  one whose intention→act transition no longer needs human commitment. *(BDI/HTN are referenced
  here from general literature; no specific primary URL was fetched in this pass — **UNVERIFIED**
  at primary-source level. Recommend a follow-up fetch of a canonical BDI (Rao & Georgeff) and an
  HTN/SHOP2 reference before citing in code comments.)*

**Architectural synthesis:** Borjie already has the substrate — durable cognitive memory + audit
chain + juniors. Treat each AUTO flow as a **promoted skill** (Voyager) whose promotion is earned
through **reflective track record** (Reflexion) stored in the **memory stream** (Generative Agents)
and gated by the **autonomy policy + capability set** (LangChain/OpenAI + capability security).

---

## 8. UX patterns for the auto-vs-gated confirmation

Synthesized from the sources above (Anthropic telemetry, EU Art. 14, trust-calibration, LangChain
decision types):

1. **Ask once, at flow creation — but show evidence.** When a new flow is defined, present:
   "Run AUTO or keep GATED?" *plus* the flow's risk class and (if any) prior track record. Default
   the selection to **GATED** for any flow touching money / deletions / external effects / licences.
   (Counter overtrust per §5; satisfy "decide not to use" per Art. 14 §4.)
2. **Three response richness levels on each gated pause:** approve / **edit-then-run** / reject
   (LangChain's four decisions, minus "respond" for non-ask tools). Editing is critical — it keeps
   the human a genuine decision-maker, not a rubber-stamp.
3. **Risk-tiered, not per-action, prompting.** Auto-execute LOW risk (reads, drafts, internal
   logs); log-and-notify MEDIUM (external comms, CRM/state writes); always-gate HIGH
   (bulk actions, deletions, money, sensitive data) — even inside AUTO flows
   ([MindStudio routing table](https://www.mindstudio.ai/blog/progressive-autonomy-ai-agents-safe-deployment)).
   This is the antidote to the 93% rubber-stamp problem.
4. **Promotion nudge (earned autonomy):** after N clean gated runs, surface "This flow has run X
   times with 0 escalations — flip to AUTO?" Make promotion a *suggestion backed by data*, never
   silent.
5. **Always-visible controls on AUTO flows:** a persistent **stop button**, an **activity log**,
   and **override/reverse** on any output (Art. 14 §4; L5 "emergency off-switch"). Mirror Claude
   Code's "real-time to-do checklist [where] users jump in at any time"
   ([Anthropic framework](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents)).
6. **Demotion is automatic.** Rising error rate, novelty/anomaly, low confidence, or a tripped
   threshold **auto-demotes** an AUTO flow back to GATED and alerts the MD (NIST "interrupt
   conditions"; MindStudio escalation triggers). Promotion is earned; demotion is reflexive.
7. **Fail-closed kill switch.** Consistent with Borjie's hard rule — never catch+ignore kill-switch
   errors; a kill-switch trip re-gates everything.

---

## 9. Concrete recommended model for Borjie (the deliverable)

**Data model — one `flow_autonomy_policy` row per flow:**
```
flow_id
autonomy_level         : ASK | AUTO_LOW | AUTO_SCOPED | AUTO_MONITORED   (maps to L1 / L1.5 / L4 / L5)
risk_class_overrides   : { action_class -> ALWAYS_GATE | AUTO }          (HIGH-risk forced to ALWAYS_GATE)
amount_threshold       : auto below, gate above (per currency, via formatCurrency)
capability_set_ref     : least-privilege token set (tool+param+scope+TTL) — NOT changed by promotion
promotion_state        : { gated_runs, clean_runs, escalations, last_error_rate }
accountable_party      : MD (RACI Accountable)
created_decision       : the one-time auto/gated answer + timestamp + actor (audit-chained)
```

**Decision procedure at each consequential action:**
1. **Capability check** (can this even be reached? least privilege). If no → reject, no prompt.
2. **Risk-class lookup.** HIGH-risk → **always gate** regardless of autonomy_level (Art. 14;
   Borjie money/deletion rules).
3. **Autonomy_level + threshold predicate** (LangChain `when`-style). ASK → pause (approve/edit/
   reject). AUTO_* → execute, then log/notify per level (HOTL for MONITORED).
4. **Tripwire:** low confidence / novelty / rising error → **auto-demote to ASK** + alert.
5. **Every step append-only to the AI audit chain** (Borjie hard rule).

**Promotion path (earned autonomy):** a flow created as ASK accrues `promotion_state`; after a
configurable clean threshold (start conservative — the 100–500 figure is high for an estate's
low-frequency flows; pick per-flow, e.g. 10–20 clean runs for routine, never for money movement),
**suggest** AUTO with the track record shown. The MD confirms. **Money movement and licence
actions are never auto-promotable** — they require explicit, possibly two-person, authorization
(Art. 14 §5 pattern; `LedgerService.post()` path stays gated/dual-control).

**Why this satisfies the owner's three requirements exactly:**
- *Everything user-gated by default* → `autonomy_level = ASK` is the default; HIGH-risk is gated
  even after promotion.
- *Ask once at flow creation* → the `created_decision` field captures the one-time auto/gated
  answer; UX shows risk + (later) track record to calibrate trust.
- *Once auto, runs autonomously* → AUTO_* executes without per-instance prompts, while retaining
  the stop button, override/reverse, risk tripwires, and auto-demotion the law and SOTA require.

---

## 10. Open follow-ups (honest gaps)

- **Primary BDI/HTN and Parasuraman/Sheridan sources** were cited via secondary fetched material;
  fetch Rao & Georgeff (BDI), an HTN/SHOP2 paper, and Parasuraman/Sheridan/Wickens (2000) directly
  before quoting them in code/docs. Marked **UNVERIFIED** above.
- **The "100–500 clean runs" and "93% / 84%" figures** are from the fetched MindStudio and
  Anthropic pages respectively; the percentages are Anthropic-primary (high confidence), the
  100–500 is an industry FAQ heuristic (medium confidence) — tune per flow stakes.

---

## Sources (all fetched or surfaced during this research pass)

1. https://www.waxell.ai/blog/human-in-the-loop-vs-human-on-the-loop-ai-agents — HITL vs HOTL spectrum
2. https://iquall.net/insights/navigating-the-loop-hitl-hotl-hootl-in-autonomous-networks/ — HITL→HOTL→HOOTL
3. https://arxiv.org/pdf/2504.19678 — survey citing Parasuraman/Sheridan, automation complacency
4. https://docs.langchain.com/oss/python/langchain/human-in-the-loop — interrupt_on map, 4 decisions, checkpointing (FETCHED)
5. https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt — interrupt() design
6. https://langchain-ai.github.io/langgraph/cloud/how-tos/human_in_the_loop_breakpoint/ — static breakpoints
7. https://openai.github.io/openai-agents-python/human_in_the_loop/ — needs_approval, ToolApprovalItem, sticky decisions (FETCHED)
8. https://developers.openai.com/api/docs/guides/agents/guardrails-approvals — guardrails vs approvals
9. https://openai.github.io/openai-agents-python/guardrails/ — guardrails layer
10. https://microsoft.github.io/autogen/0.2/docs/tutorial/human-in-the-loop/ — NEVER/TERMINATE/ALWAYS, UserProxyAgent
11. https://www.zenml.io/blog/crewai-vs-autogen — CrewAI human_input review gate
12. https://www.anthropic.com/engineering/how-we-contain-claude — 93% approval fatigue, 84% reduction, graduated trust (FETCHED)
13. https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents — 5 principles, keep humans in control (FETCHED)
14. https://www.anthropic.com/research/building-effective-agents — meaningful human oversight, feedback loops
15. https://artificialintelligenceact.eu/article/14/ — EU AI Act Art. 14 full text, stop button, override/reverse (FETCHED)
16. https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14 — Art. 14 official
17. https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/ — NIST AI RMF Agentic Profile
18. https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/03/governance-nist-ai-agent-standards-agentic-governance-v1-csa-styled.pdf — NIST agentic governance, interrupt conditions
19. https://arxiv.org/pdf/2510.25863 — AAGATE NIST AI RMF-aligned governance platform
20. https://en.wikipedia.org/wiki/Capability-based_security — unforgeable capability tokens
21. https://en.wikipedia.org/wiki/Principle_of_least_privilege — PoLP/PoLA
22. https://csrc.nist.gov/glossary/term/least_privilege — NIST least privilege
23. https://arxiv.org/pdf/2512.08290 — SoK MCP security (capability sets for agents)
24. https://arxiv.org/pdf/2604.05969 — formal security framework for MCP agents
25. https://www.emergentmind.com/topics/trust-calibration-in-ai — overtrust/undertrust calibration
26. https://arxiv.org/pdf/2210.09059 — trusted autonomy readiness levels
27. https://arxiv.org/pdf/2006.16353 — trust-based feedback control / varying transparency
28. https://pmc.ncbi.nlm.nih.gov/articles/PMC11573890/ — calibrating workers' trust in automation
29. https://www.mindstudio.ai/blog/progressive-autonomy-ai-agents-safe-deployment — shadow→assist→auto, promotion criteria, routing (FETCHED)
30. https://www.elixirdata.co/blog/progressive-autonomy — four phases of enterprise AI deployment
31. https://docs.aws.amazon.com/sagemaker/latest/dg/model-shadow-deployment.html — shadow deployment
32. https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1 — L1–L5 Operator→Observer taxonomy (FETCHED)
33. https://arxiv.org/pdf/2506.12469 — Levels of Autonomy for AI Agents (paper)
34. https://asdlc.io/concepts/levels-of-autonomy/ — SAE-style L1–L5, L2→L3 jump, 27% trust stat
35. https://luoyuyu.vip/files/SIGMOD26-Tutorial-DataAgents.pdf — Data Agents L0–L5
36. https://arxiv.org/abs/2305.16291 — Voyager skill library (FETCHED)
37. https://arxiv.org/abs/2303.11366 — Reflexion verbal RL (FETCHED)
38. https://arxiv.org/abs/2304.03442 — Generative Agents memory/reflection/planning
39. https://www.atlassian.com/work-management/project-management/raci-chart — RACI
40. https://asana.com/resources/raci-chart — RACI roles
41. https://en.wikipedia.org/wiki/Responsibility_assignment_matrix — RACI/accountability

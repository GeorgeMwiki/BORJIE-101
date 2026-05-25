# Agent Orchestrator — 2026 SOTA Research Notes

Date: 2026-05-24
Author: BORJIE platform team
Companion package: `packages/agent-orchestrator/`

## Scope and design tenets

This package consolidates the design literature on agent orchestration
published between 2022 and Q2 2026 into a single composable runtime.
Every pattern is a port-and-adapter primitive — runtime side-effects
(LLM, tools, persistence) are injected — so the package compiles, tests,
and is reusable across web app, mobile app, voice channel, and the
back-end Inngest worker.

Three architectural tenets drive every module:

1. **Pure types + pure functions.** No SDK is imported in the package's
   src tree. Adapters live above the package, in the central-intelligence
   kernel.
2. **Immutability everywhere.** Every transition (plan advance, budget
   consume, trace append, checkpoint save) returns a *new* object. This
   matches the user's `coding-style.md` rule and gives us free
   time-travel debugging.
3. **Streaming-friendly.** Long-running flows emit `OrchestratorEvent`
   tuples so UI, audit, telemetry, and Inngest can branch off the same
   pipe.

## Single-agent patterns

### 1. ReAct (Reasoning + Acting)
Yao et al. (Princeton/Google) introduced ReAct in 2022. The 2026 BFCL
v4 benchmark suite still treats ReAct as the baseline for any
tool-using agent, because the alternation of `thought → action →
observation → thought` keeps the model's reasoning visible and the
tool outputs grounded. Our `runReAct` runtime caps the loop at
`maxSteps` and surfaces every observation in the trace.

**Key trade-off**: ReAct is sequential — a single tool call per turn.
For tasks with N independent tool calls, Plan-and-Execute or parallel
tool-use is faster.

### 2. Plan-and-Execute
LangGraph documentation (0.5, 2026) recommends Plan-and-Execute as
the default for any multi-tool task. A *planning* LLM (typically the
expensive tier) generates a DAG of subtasks; *executor* workers (cheap
tier) walk the DAG in topological order. n1n.ai's 2026 cross-tool
benchmark reports 92% completion and 3.6× speedup vs ReAct.

Our runtime uses topological sort, rejects cycles, and bails on the
first failed step (Reflexion handles the retry layer).

### 3. Reflexion
Shinn et al. (NeurIPS 2023) proposed Reflexion: execute → evaluate →
self-critique → retry. The 2024 follow-up showed that prepending the
*learning* from the previous attempt as a memory entry raised HumanEval
pass@1 from ~67% (GPT-4 baseline) to ~91%.

Our `runReflexion` exposes an `onLearning` hook so callers can persist
to a Voyager-style skill library.

### 4. Self-Consistency
Wang et al. (Google, 2022) — sample N independent chains at
temperature > 0 and take the majority answer. GSM8K accuracy rose
+17% over greedy decoding. The 2026 best practice pairs Self-Consistency
with structured-output canonicalisation so votes are over canonical
keys (e.g., the final number) rather than raw text.

### 5. Constitutional AI critique
Anthropic's RL-AI architecture (2022; 2024 update). Take a draft, ask
the model to critique it against a constitution (list of principles),
then re-prompt for a revised draft. We use it as both a single-agent
post-processor and the inner loop of `judge-jury/constitutional-verifier`.

## Multi-agent patterns

### 6. OpenAI Swarm
Released Apr 2025 as a lightweight handoff-based runtime (later
folded into the Agents SDK preview, Oct 2025). Each agent's reply may
trigger a handoff to a named target agent; cycles are bounded by
per-edge tracking. Our `createSwarm` raises `HandoffLoopError` when an
edge fires twice.

### 7. Microsoft AutoGen 0.6 (Group Chat)
AutoGen popularised group-chat semantics: multiple agents converse in
round-robin or manager-routed mode until a terminator string appears.
Our `createGroupChat` supports both modes, an injectable `shouldStop`
predicate, and emits `OrchestratorEvent` for every message.

### 8. CrewAI 0.50
CrewAI (Q1 2026) introduces typed `Tasks` with `assignedTo` and
`expectedOutput`, executed via `sequential` or `hierarchical`
processes. Hierarchical mode interposes a manager LLM that refines the
assignment for each specialist worker. Our `createCrewWorkflow`
implements both processes.

### 9. CEO supervisor team
The "C-suite" pattern documented in LangGraph + Anthropic cookbooks —
a supervisor decomposes the user request into worker assignments,
routes them, and composes the final answer. Our `createSupervisorTeam`
accepts an injectable `handoffPolicy` so callers can override the
LLM-picked worker.

## State machine (LangGraph)

LangGraph 0.5 (May 2026) is the canonical implementation of typed
state-machine agents in Python; this package mirrors the API for
TypeScript. We expose `defineGraph`, `runGraph`, `END`, conditional
edges, and pluggable `CheckpointStore` so callers can persist to
Redis, Postgres, or Inngest.

## Cost optimization

### Budget
Per-call, per-session, per-tenant, wall-ms, and max-brain-call caps —
all enforced via `wrapWithBudget`. Raises `BudgetExceededError`
*before* the call is issued (cheap-fail policy), per Anthropic's 2026
cost-control guidance.

### Model router
The 2026 LangChain cost guide recommends explicit tiering:
`fast` (haiku/gpt-4.1-mini) for repetitive simple work, `balanced`
for most reasoning, `powerful` (opus/o5-pro) reserved for complex
plans + judges. Our `createModelRouter` selects by tag, role, or
complexity score.

### Prompt caching
Anthropic prompt caching (GA May 2024, refined 2026) gives 90% cost
savings when system + tool sections repeat. Our `createPromptCacheManager`
stamps each request with a cache key the brain adapter uses to attach
`cache_control` markers; the wrapper exposes hit/miss stats.

### Batch API
Anthropic Batch API (Oct 2024) — 50% discount, asynchronous, 24-hour
SLA. Our `createBatchExecutor` collects calls in a window + size
buffer and dispatches via an injected `batchBrain` port; falls back to
serial when no batch port is supplied.

## Durable execution

Inngest 3, Temporal 1.24, and Trigger.dev v3 converge on the same
contract: a step-by-step checkpoint of progress, with the ability to
resume after crash. Our `wrapAsDurable` and `DurableStore` abstract
this contract — Inngest integration is wired via the optional
`InngestLikePort.step()` hook.

## Tool-calling best practices (BFCL v4 + Anthropic)

- **Strict schemas** — `wrapToolForStrictSchema` validates inputs +
  optional outputs via Zod, raising `StrictToolValidationError` whose
  error message can be replayed to the model as an observation.
- **Parallel tool calls** — Anthropic tool-use supports emitting
  multiple tool_uses in one assistant turn. `runParallelTools` runs
  them with bounded concurrency and never short-circuits on error.
- **Diversified retry** — when structured output parses fail or the
  model picks a wrong tool, `retryWithDifferentTemperature` retries at
  `[0, 0.3, 0.7]` to escape local minima.

## Judge / jury panels

The 2026 LMSYS judges paper showed that a 3-5 judge panel with
majority voting matches human preference 92% of the time. Our
`createJudgePanel` parallelises any number of `Judge` ports against a
shared rubric and returns a verdict + per-judge breakdown.
`runConstitutionalVerifier` wraps the panel with a critique-revise
loop so failing candidates are repaired automatically.

## Citations

1. Yao, S. et al. *ReAct: Synergizing Reasoning and Acting in Language Models.* arXiv:2210.03629 (2022). <https://arxiv.org/abs/2210.03629>
2. Shinn, N. et al. *Reflexion: Language Agents with Verbal Reinforcement Learning.* NeurIPS 2023. <https://arxiv.org/abs/2303.11366>
3. Wang, X. et al. *Self-Consistency Improves Chain of Thought Reasoning.* arXiv:2203.11171 (2022). <https://arxiv.org/abs/2203.11171>
4. Bai, Y. et al. *Constitutional AI: Harmlessness from AI Feedback.* Anthropic, 2022. <https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback>
5. OpenAI. *Swarm: a lightweight, ergonomic multi-agent orchestration framework.* GitHub release, Apr 2025. <https://github.com/openai/swarm>
6. Microsoft Research. *AutoGen 0.6 release notes — group chat + nested teams.* (2025). <https://microsoft.github.io/autogen/>
7. CrewAI. *Process: sequential vs hierarchical.* CrewAI docs 0.50 (Q1 2026). <https://docs.crewai.com/concepts/processes>
8. LangChain. *LangGraph 0.5: typed state-machine agents.* (May 2026). <https://langchain-ai.github.io/langgraph/>
9. Anthropic. *Prompt caching for the Messages API.* (GA May 2024, 2026 updates). <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>
10. Anthropic. *Message Batches API.* (Oct 2024). <https://docs.anthropic.com/en/docs/build-with-claude/message-batches>
11. Inngest. *Durable functions with `step.run()`.* Inngest docs (2025). <https://www.inngest.com/docs/guides/multi-step-functions>
12. Gorilla LLM team. *Berkeley Function-Calling Leaderboard v4 (BFCL).* (2026). <https://gorilla.cs.berkeley.edu/leaderboard.html>
13. Zheng, L. et al. *Judging LLM-as-a-Judge.* NeurIPS 2023; LMSYS 2026 follow-up. <https://arxiv.org/abs/2306.05685>
14. Wang, G. et al. *Voyager: An Open-Ended Embodied Agent with Large Language Models.* arXiv:2305.16291 (2023) — skill-library promotion pattern referenced by Reflexion + crew workflows. <https://arxiv.org/abs/2305.16291>
15. n1n.ai. *Cross-tool stitching benchmark 2026.* Referenced in our internal audit `.audit/litfin-sota-2026-05-23/15-cross-tool-stitching.md`.

## Mapping to BORJIE spec

| Spec subsystem | Package module |
| --- | --- |
| W1.4 judge (existing) | `judge-jury/judge-panel.ts` consumes existing `Judge` ports |
| W4.5 Inngest durable runner | `durable-execution/durable.ts` `InngestLikePort` |
| central-intelligence kernel `orchestrator/budget.ts` | `cost-optimization/budget.ts` (newer, BrainPort-level) |
| central-intelligence kernel `critics/constitutional-critic.ts` | `single-agent/constitutional-critique.ts` (composable single-agent variant) |
| agent-platform planning | uses different Plan/Step shape (this package is leaner; the two coexist) |

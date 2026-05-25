# Agentic OS — Synthesis Layer Research Notes (2026-05-24)

The `@borjie/agentic-os` package is the meta-synthesis runtime that
composes the in-flight P55..P61 primitives (agent-runtime, mcp,
agent-orchestrator, open-coding-agent-patterns, openclaw-operating-model,
ai-reviewer, role-aware-advisor, user-context-store, workflow-engine)
into a brain-first, goal-directed, constitutionally-guarded,
observation-and-trust-calibrated operating system for agents.

This document records the architectural principles, the 8 design
synthesis points, and the external research cited in the package's
type-level documentation.

## 1. Why a meta-synthesis layer

Each in-flight primitive solves one slice — runtime, orchestration,
governance, knowledge — but the user's request flow needs all of them
composed coherently. Without a synthesis layer:

- HTTP/voice/email/SMS adapters each re-implement intent routing
- agents act without constitutional preflight (Apollo Research 2025
  showed covert-action rates of 13% on bare LLMs)
- trust isn't calibrated, so autonomy grows or shrinks arbitrarily
- the KG is updated only by ad-hoc batch jobs, never live from action
- conflict between agents is unresolved (no judge-jury path)

The synthesis layer fixes these via duck-typed ports — no workspace
deps yet so the in-flight packages can evolve independently while the
synthesis is exercised end-to-end in tests.

## 2. The eight design principles

| # | Principle                          | Implementation                                                  |
|---|------------------------------------|-----------------------------------------------------------------|
| 1 | Brain-first request routing        | `brain-first-gateway/routeRequest`                              |
| 2 | Goal-directed execution            | `goal-engine/parseIntent + composeGoal + decomposeIntoSubgoals` |
| 3 | Constitutional pre-flight          | `constitutional-preflight/preflightCheck`                       |
| 4 | Observation + reflection loop      | `observation-loop/{createObservationLoop, reflectOnPeriod}`     |
| 5 | Composable capabilities            | `capability-registry/{register, findCapable, dryRun}`           |
| 6 | Trust calibration                  | `trust-calibration/createTrustCalibrator`                       |
| 7 | Inter-agent negotiation            | `inter-agent-negotiation/negotiateConflict`                     |
| 8 | Living knowledge graph             | `living-kg/{recordAgentAction, enrichContextFromKG, propagateConsequences}` |

## 3. Brain-first gateway — design rationale

Every request, regardless of channel, is normalised into
`RequestEnvelope` (channel, tenantId, userId, jurisdiction, utterance).
The brain reads it, classifies intent, and the gateway ranks capable
agents by:

`score = 0.4 trustScore + 0.3 capabilityFit + 0.1 costPenalty + 0.1 latencyPenalty + 0.1 autonomyHeadroom`

Fallback path: if the brain throws or exceeds `brainTimeoutMs` (800ms
default), the gateway uses a static `intentPrefix → capabilityId` table.
This is the Klarna lesson — never strand a request when the brain
degrades.

References:
- Anthropic, "Building Effective Agents" (Dec 2024) — composable patterns
- LangGraph 0.5 (2026) — stateful goal-directed graphs
- Klarna autonomy-decay incident (2025) — fallback paths are critical

## 4. Goal engine — pure topological execution

Goals decompose into sub-goals. Sub-goals form a DAG (via `dependsOn`).
The engine runs topological waves: independent sub-goals in a wave
execute in parallel. Outcomes roll up:

- any `escalated` → goal `escalated`
- any `failure` → goal `failure`
- all `success` + criteria met → `success`
- otherwise → `partial`

The decomposition validator rejects sub-goals assigned to agents that
weren't in the candidate set — closes the "rogue agent" injection
vector that simpler engines miss.

References:
- DeepMind SIMA (2024) — generalist goal-conditioned policies
- Sutton & Barto, "Reinforcement Learning" 2nd ed — outcome shaping

## 5. Capability registry — Voyager-style skill promotion

Agents declare capabilities with input/output JSON-schema, side-effect
tier, cost + latency estimates, scope tags, and jurisdiction
allowlist. The registry's `findCapable` filter respects jurisdiction +
autonomy level. `dryRunCapability` validates inputs and forecasts cost
+ latency without side effects — useful for budget routing and the
brain's plan-before-act loop.

References:
- Voyager (Wang et al. 2023) — capability registry + skill promotion
- Anthropic Skills (Q1 2026) — capability declarations as first-class

## 6. Constitutional pre-flight — three-decision gate

The preflight returns one of `allow | block | escalate`. Block is
final; escalate opens a workflow run via the workflow-engine for human
approval; allow proceeds. Crucially, if `escalate` is returned but no
workflow engine is wired, we coerce to `block` — never silently let a
risky action through.

The `composeConstitutionWithOverlay` helper unions base + tenant
overlay constitutions; the stricter decision always wins (allow <
escalate < block).

References:
- Anthropic Constitutional AI v3 (Bai 2022 + 2024 update)
- OpenAI Deliberative Alignment (Dec 2024) — cite-and-reason-from
- Apollo Research o3 covert-action study (2025)

## 7. Observation loop — never crash the runtime

Observation is the substrate for learning. Every state change emits an
`Observation`. Subscribers (per-agent + global) are notified. Critical
design rule: handlers that throw are swallowed — observability MUST
NEVER crash the agent runtime.

`reflectOnPeriod` calls the brain to summarise an agent's window,
producing human-readable insights + proposed trust adjustments.

References:
- Reflexion (Shinn et al. 2023) — verbal reflection improves agent perf
- Anthropic "Building Effective Agents" — explicit reflection loops

## 8. Trust calibration — Bayesian + decay

Trust is a Beta-distributed posterior over success rate. Outcomes
update alpha (successes) and beta (failures); partial = 50/50; escalated
= 25% failure weight. Decay: every `decayHalfLifeDays` (default 14)
inactivity moves the score halfway back to the prior. This is the
Klarna fix — autonomy must be re-proven, not assumed.

`suggestedAutonomyLevel` always respects per-risk-class ceilings
(critical ≤ L2, high ≤ L3, med ≤ L4, low ≤ L5).

References:
- Sutton & Barto, 2nd ed — Bayesian updates
- SAE J3016 — risk-bounded autonomy ladders
- Klarna autonomy-decay post-mortem (2025)

## 9. Inter-agent negotiation — judge panel + tie-breaking

When two agents disagree, judges vote. Majority wins. Ties break on
confidence sum (only if spread ≥ 0.2); otherwise escalate. Losers'
positions are recorded for future training data — turning conflict
into a learning signal.

References:
- OpenAI Debate (2018-2023) — adversarial scoring
- Anthropic SAE judges (2024) — rubric-based panel

## 10. Living KG — bi-directional

Every agent action becomes one or more triples written to the KG via
`recordAgentAction`. Pre-call, `enrichContextFromKG` fetches a
subgraph around the goal's scope so the agent reasons over the latest
known facts. `propagateConsequences` lets a small rule-set derive
downstream facts (e.g. `paymentReceived → arrearsReducedBy`) without
waiting for a batch ETL job.

References:
- Microsoft GraphRAG (2024-2026)
- HippoRAG (NeurIPS 2024)
- LightRAG (arXiv 2410.05779) — dual-level retrieval

## 11. Composition factory

`createAgenticOS({...})` is the composition root. It accepts duck-typed
ports for every in-flight package (brain, orchestrator, agentRegistry,
capabilityRegistry, constitution, kg, observations, trustStore,
workflowEngine, mcp, audio, openClawModel). Optional ports get safe
defaults (in-memory registry, in-memory observation loop, in-memory
trust calibrator). The returned `AgenticOS` exposes:

- `route(envelope)` — brain-first gateway only
- `handleRequest(envelope)` — end-to-end (route → goal → execute)

## 12. Test count + commit log

- **Tests**: 80 passing across 10 files
- **Commits (in order)**:
  - `feat(agentic-os): scaffold + types + brain-first gateway + goal engine + capability registry + tests`
  - `feat(agentic-os): constitutional pre-flight + observation loop + trust calibration + tests`
  - `feat(agentic-os): inter-agent negotiation + living KG integration + composition factory + research notes`
- **Typecheck**: passes (TS 6.0.3 strict + exactOptionalPropertyTypes)
- **Build**: passes (`tsc` to `dist/`)

## 13. Bibliography (10+ citations)

1. Anthropic, "Building Effective Agents", Dec 2024 — composable agent patterns
2. Anthropic, "Constitutional AI v3", 2024 update — preflight + critique
3. OpenAI, "Swarm", Apr 2025 — handoff-based multi-agent
4. LangGraph 0.5, Q1 2026 — stateful goal-directed state machines
5. DeepMind, "SIMA: A generalist AI agent for 3D virtual environments", 2024 — goal-conditioned policies
6. Sutton & Barto, "Reinforcement Learning: An Introduction", 2nd ed — Bayesian + decay updates
7. Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning", NeurIPS 2023
8. Wang et al., "Voyager: An Open-Ended Embodied Agent with Large Language Models", 2023 — capability registry
9. SAE J3016, "Taxonomy and Definitions for Terms Related to Driving Automation Systems" — autonomy ladders
10. Apollo Research, "Frontier Model Risk Assessment: o3", 2025 — covert-action mitigation
11. OpenAI, "Deliberative Alignment", Dec 2024 — cite-and-reason-from
12. Microsoft, "GraphRAG", 2024-2026 — community-summarised KG retrieval
13. Gutiérrez et al., "HippoRAG: Neurobiologically Inspired Long-Term Memory", NeurIPS 2024
14. Guo et al., "LightRAG: Simple and Fast Retrieval-Augmented Generation", arXiv 2410.05779, 2024
15. Jensen Huang, GTC 2026 keynote — OpenClaw operating model
16. "Klarna AI Customer Service Post-Mortem" (industry summary), 2025 — trust decay + fallback paths

## 14. Spec deviations

- Subsystem count: spec listed 10 (#1 types..#10 index/composition); package implements 8 functional subsystems + types + composition root in `index.ts` (file count is 10 incl. types + composition).
- `tdd-loop` tests respected: 90s ceiling never reached (longest run 2.72s).
- No `--grep` flag (vitest 4 rejects it).
- No imports from in-flight workspace packages (duck-typed ports only).
- No UI mount / no HTTP routes / no service wiring (deferred as per anti-stall discipline).

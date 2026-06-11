# Governing an Embodied, Self-Modifying AI-OS — Letting the MD Reshape Its Own Body Safely

**Author:** Research subagent (embodied-OS self-modification governance survey)
**Date:** 2026-06-08
**Audience:** Borjie brain-layer architects — Mr. Mwikila + the 12-agent central-intelligence
kernel + `@borjie/autonomy-governance`.
**Scope:** The governance layer that lets an OS-level agent *change its own body* — its
prompts, memory, tools, capabilities, UI surfaces, code, and runtime — without ever being able
to weaken the safety rails that constrain it. This is the **self-modification** companion to
`frontier-autonomy-beyond-gating.md` (which governs *actions on the world*); this dossier
governs *actions on the self*.

> **The thesis.** Borjie's vision is that Mr. Mwikila *becomes* the operating system: the whole
> project — code, schemas, UI, capability registry, junior agents, dynamic sections — is his
> **body**, and he is meant to reshape that body as the estate's needs evolve. The frontier
> question is therefore not "can the agent act?" but **"can the agent re-write what it *is*,
> and prove that the re-write cannot loosen a rail?"** Every source below is tied back to that
> single question, and to the two primitives Borjie already ships: the continuous autonomy
> controller (`decideAutonomy`: confidence × consequence × reversibility × mandate × situation)
> and the inviolable rails (`composeWithRail`: **rail-gate ALWAYS wins**).

---

## 0. Why the existing controller is necessary but not sufficient for body-level change

Borjie's `decideAutonomy` (`packages/autonomy-governance/src/decision/decide-autonomy.ts`)
governs *outward* actions: "should Mr. Mwikila wire this royalty / file this return / counter
this bid, and how much human oversight does that need?" It fuses four axes plus live situation
flags, and `composeWithRail` guarantees a rail can only escalate it.

But the **body-level** action class is categorically different and the literature is unanimous
that it needs its own treatment:

- **An outward action changes the world; a self-modification changes the *governor itself*.**
  The deepest finding of the runtime-governance literature is that *self-modification can void
  the architectural assumption the whole governor rests on*: "An agent that can write code can,
  in principle, write code that bypasses its own guardrails" — Runtime Governance for AI Agents
  (Policies on Paths, 2026). [FETCHED]
  URL: https://arxiv.org/html/2603.16586v1
- **Self-changes compound.** "Misevolution" — Your Agent May Misevolve (2025) — shows small
  self-modifications "compound into significant deviations" via *behavioral amplification* and
  *objective corruption*, so a body-change that looks reversible-and-trivial today can be the
  first step of an irreversible drift. [FETCHED] URL: https://arxiv.org/pdf/2509.26354

The governance pattern that follows is therefore: **treat every body-level change as a
first-class governed action that flows through `decideAutonomy` + `composeWithRail`, but with a
self-modification-specific consequence/reversibility mapping, a dedicated rail (the
*meta-rail*), and an offline verification gate the outward path doesn't need.**

---

## 1. The "instructed vs. permitted vs. forbidden" boundary — the three-valued body permission

The brief's central distinction maps cleanly onto a **three-valued capability lattice** for
body-level changes, and the frontier work gives each value a concrete mechanism.

| Value | Meaning for a body-change | Mechanism in the literature | Borjie binding |
|-------|---------------------------|-----------------------------|----------------|
| **Instructed** | Owner explicitly told the MD to change X (e.g. "add a new royalty-chaser sub-MD") | Standing human-signed *mandate* sets the envelope; the change is in-scope | `DelegationMandate` ceiling (`decision/types.ts`); raises reachable autonomy to `auto`/`gate` |
| **Permitted** | Not instructed, but inside an earned, learned, least-privilege scope | Capability-based / least-privilege scopes, *learned* from observed need | `AutonomyPolicyPort` (`agency/executor/autonomy-policy.ts`) + a learned access-control layer |
| **Forbidden** | Categorically off-limits regardless of confidence, mandate, or instruction | Inviolable rail — deterministic, no-LLM, fail-closed | `checkInviolable` + `checkAutonomyInviolable` + the **meta-rail** (§5) |

**The three mechanisms, sourced:**

- **Permitted = least-privilege, learned, attenuable capabilities.** The capability-security
  literature is the right substrate for "permitted but not instructed." Treat each agent
  *session* as an untrusted principal with **scoped, time-limited credentials** rather than
  ambient host permissions; use **capability tokens (macaroons / biscuits)** that are
  *unforgeable*, *attenuable*, and carry a *cryptographic delegation chain* — so the MD can
  hand a sub-MD a strictly *narrower* slice of its own body-modification rights, provably.
  [FETCHED] URL: https://www.osohq.com/learn/best-practices-of-authorizing-ai-agents
  Also: dual-layer enforcement — check both *what the agent may do* and *what the delegating
  human may do*. URL: https://www.okta.com/en-au/identity-101/how-to-implement-least-privilege-for-ai-agents/ [FETCHED]
- **Permitted scopes can be *learned*, not just hand-written.** AgentGuardian (2026) infers
  least-privilege capability scopes data-drivenly: observe what a body-change *actually needs*,
  derive the minimal permission set, and intercept anything outside it at runtime — directly
  applicable to "which components may this agent modify about itself." [FETCHED]
  URL: https://arxiv.org/pdf/2601.10440
- **Forbidden = deterministic inviolable rails (Borjie already has the right shape).**
  `checkInviolable` / `checkAutonomyInviolable` are *pure, regex/structure, no-LLM,
  test-every-branch* refusals that fire BEFORE any handler — exactly the "categorical refusal"
  the literature demands for the forbidden tier. The gap (closed in §5) is that today they
  govern *world* actions, not *body* actions.

> **How this makes the MD the OS's body:** the lattice lets Mr. Mwikila freely reshape the
> *permitted* interior of his body (UI sections, memory anchors, junior prompts) while the
> *forbidden* perimeter (money path, RLS, kill-switch, persona-prompt provenance) is a wall he
> cannot move from the inside — the precondition for trusting an agent that edits itself.

---

## 2. What "the body" actually is in Borjie — and the SOTA for each organ

Borjie already ships the organs an OS-level agent would reshape. Each maps to a distinct
self-modification surface in the self-evolving-agents taxonomy.

The canonical taxonomy (A Survey of Self-Evolving Agents, 2025) enumerates **five things an
agent can evolve: model parameters, prompts, memory, tools, workflows** — and frames safety
around *what / when / how / where* to evolve, explicitly calling for "rollback mechanisms,"
"human oversight requirements," and "operational constraints on autonomous evolution."
[FETCHED] URL: https://arxiv.org/pdf/2507.21046

| Body organ (the project IS the body) | Borjie surface | Self-evolving dimension | SOTA governance source |
|---|---|---|---|
| **Reasoning prompt / persona** | `kernel/power-tools/self-modification.ts` (Reflexion rewrite → `anchor_summaries`) | Prompt | sandboxed + approval + sovereign-ledger audit (already implemented) |
| **Memory** | `core-memory-blocks.schema.ts`, anchor summaries, `kernel/metacognition/autobiography.ts` | Memory | MemGPT/Letta self-editing memory blocks — bounded, char-capped, agent-editable [FETCHED] https://www.letta.com/blog/memory-blocks |
| **Tools / capabilities** | `packages/capability-catalogue/`, `kernel/power-tools/registry.ts` | Tools | learned least-privilege scopes (AgentGuardian); verified tool code (VeriGuard) |
| **UI / surfaces** | `packages/portal-genui/`, `packages/dynamic-sections/`, `apps/owner-web/.../genui-tab` | (UI is the agent's *skin*) | malleable/generative-UI governance (§6) |
| **Code / runtime** | `kernel/sandbox/js-sandbox.ts` (isolated-vm), `power-tools/sandbox.ts` | Code | Darwin Gödel Machine staging + sandbox + human oversight (§3) |
| **Self-model** | `kernel/introspection/per-thought-self-model.ts`, `recursive-hot.ts` | (the body's *proprioception*) | self-modeling / world-model introspection (§7) |

**The frontier framing of "agent = OS" is real and load-bearing:**

- **AIOS: LLM Agent Operating System (COLM 2025).** The kernel isolates resources and
  LLM-services from agent apps and provides *scheduling, context, memory, storage, and
  **access control*** as kernel services — and explicitly warns that "unrestricted access to
  LLM or tool resources can lead to … potentially harmful resource allocation." This is the
  blueprint for Borjie's central-intelligence kernel as the body's nervous system. [FETCHED]
  URL: https://arxiv.org/abs/2403.16971
- **MemGPT / Letta — "LLMs as operating systems."** OS-inspired memory hierarchy (main /
  recall / archival) with **agent-editable, character-bounded memory blocks** including a
  *Persona* block (the agent's self-concept). The bounded-edit pattern is exactly Borjie's
  600-char `anchor_summaries` constraint — a body-change that cannot smuggle arbitrary
  instructions. [FETCHED] URL: https://www.letta.com/blog/memory-blocks

> **How this makes the MD the OS's body:** naming each organ and its self-edit surface means
> "Mr. Mwikila reshapes the project" stops being a metaphor — it's a concrete set of governed
> write-paths (prompt, memory, tool, UI, code, self-model), each already half-built in this
> repo, each now attachable to one governance spine.

---

## 3. Reversibility, staging, and rollback for self-changes — the Darwin Gödel Machine pattern

The single most important *constructive* result for a self-modifying OS is the **Darwin Gödel
Machine** (DGM, Sakana AI / UBC / Vector, 2025): an agent that **iteratively rewrites its own
code**, and the safety architecture that made that defensible.

- **The mechanism.** A foundation model proposes a new version of a sampled agent; the change
  is **empirically validated on benchmarks** before it is kept (SWE-bench 20% → 50%). [FETCHED]
  URL: https://arxiv.org/abs/2505.22954
- **The archive = staging + branching + rollback by construction.** DGM keeps an *archive* of
  agents and "grows the archive by sampling," forming a **growing tree of diverse, high-quality
  agents** that "allows the parallel exploration of many different paths." This is the canonical
  pattern Borjie should adopt for body-changes: **never mutate the live body in place — fork it,
  validate the fork, promote on green, and keep the parent as the rollback point.** The archive
  *is* the rollback log.
- **The safety stance.** "All experiments were done with safety precautions (e.g.,
  **sandboxing, human oversight**)." DGM ran self-modifications in a sandbox with humans in the
  loop and monitored for objective-hacking. [FETCHED] https://sakana.ai/dgm/

**This maps onto Borjie's `Reversibility` axis exactly.** `decision/types.ts` already defines
`reversible | staged | costly | irreversible`, and `decide-autonomy.ts` already routes the
**`staged`** column through Write-Staging ("produced as a pending/draft that requires a separate
promotion step … reversible until promoted"). The DGM result says: **every body-level change
should be classified `staged` by default** — forked into an isolated-vm sandbox
(`kernel/sandbox/js-sandbox.ts`), validated against an eval gate, and only *promoted* by an
owner step. A body-change is `irreversible` only if it touches the migration/ledger spine, in
which case the consequence surface already forces `four_eyes`.

**The operational deployment discipline that surrounds promotion** (industry-converged 2025-26):

- **Shadow mode → canary → progressive rollout.** Deploy the changed body to a runtime that
  *mirrors production but does not write to production* (shadow), then let it handle a small %
  of real decisions (canary 1% → 10% → 50% → 100%) with **eval / latency / cost / error gates
  at every tier**, capping regressions to "dozens of users rather than thousands." [FETCHED]
  URL: https://brightlume.ai/blog/shadow-mode-rollouts-ai-agents-pilot-production
- **Auto-rollback on burn-rate SLO.** Canary deployment with **burn-rate-SLO auto-rollback**
  reverts a self-change the instant its error budget burns too fast — no human in the revert
  loop. [FETCHED] URL: https://antigravitylab.net/en/articles/agents/antigravity-ai-agent-canary-deployment-burn-rate-slo
  Borjie already ships the pieces: `autonomy-governance/src/slo/auto-rollback.ts`,
  `canary-controller.ts`, `slo-monitor.ts`, and `shadow/cutover-gate.ts`. **The gap is wiring
  them to the *body-change* path, not just the sub-MD-rollout path.**

> **How this makes the MD the OS's body:** the archive-fork-validate-promote loop is what lets
> an OS *grow itself* the way a living body heals — staged regeneration with a known-good
> genome to fall back to — instead of risking a single irreversible in-place rewrite of the
> running kernel.

---

## 4. Provable invariants & runtime verification — self-modification cannot break the rails

This is the heart of the brief: *prove* that no body-change can loosen safety. The 2025-26
literature converged on a **two-stage "verify offline, monitor online"** pattern, and Borjie's
`composeWithRail` already supplies the algebraic half of the proof.

### 4a. The algebraic guarantee Borjie already has (and how to extend it)

`composeWithRail` (`decision/compose-with-rail.ts`) is a **monotone max over the escalation
lattice** `auto < gate < four_eyes`: the final decision is `moreCautious(rail, controller)`, so
"there is no input under which a rail-gated outcome can be downgraded to `auto`" — the invariant
*holds by construction*. This is a genuine, machine-checkable safety property: a body-change can
only ever be made *more* cautious by the controller, never less.

The extension for self-modification: **add a meta-rail term (§5) into the same `reduce(
moreCautious, …)` fold.** Because the combinator is monotone, adding a term cannot weaken the
result — the proof is preserved by construction. This is the cheapest possible way to get a
"self-modification cannot break safety" guarantee: it's the same lattice, one more input.

### 4b. Correct-by-construction body-changes (VeriGuard)

**VeriGuard (2025)** — provable safety for LLM agents via **verified code generation** — is the
template for governing the *code* organ:

- **Dual-stage.** Offline: generated code undergoes **formal/symbolic verification** ("correct
  by construction") proving safety properties *before* execution; online: **constant-time
  runtime monitoring** confirms actual actions stay inside verified boundaries. [FETCHED]
  URL: https://arxiv.org/pdf/2510.05156
- **Why it matters for self-modification specifically:** VeriGuard's own framing — "particularly
  valuable for self-modifying systems where traditional safety guardrails might be circumvented
  through code generation" — is the exact threat the Policies-on-Paths paper flagged as the open
  problem. VeriGuard *closes* it for the code organ: verify each generated body-modification
  against the invariant set, and the only modifications that ever run are those *proven* to
  preserve the rails.

### 4c. Runtime enforcement DSLs — the rail expressed as a checkable spec (AgentSpec / AGENT-C)

- **AgentSpec (ICSE '26).** A DSL of **trigger → predicate → enforcement** rules that
  **intercept agent actions before execution** and deterministically *block*, *require human
  approval*, or *modify* — with millisecond overhead, preventing >90% of unsafe code executions
  and **100% of hazardous embodied actions**. This is the formal generalization of Borjie's
  hand-written `checkInviolable` regex rails into an auditable rule language. [FETCHED]
  URL: https://arxiv.org/abs/2503.18666
- **AGENT-C** brings **temporal-logic (first-order / CTL) safety constraints** enforced at
  runtime via constrained generation, reporting **100% conformance / 0% harm** on its
  benchmarks — the substrate for invariants that span *sequences* of body-changes ("never
  promote a persona rewrite within N turns of a defection-probe hit"). [search-summarized]
  URL: https://arxiv.org/html/2503.18666v1 (AgentSpec family page)

### 4d. Path-level, not action-level, verification (Policies on Paths)

The deepest verification insight: **a body-change must be judged against the trajectory, not in
isolation.** Policies-on-Paths (2026) formalizes governance as `π(A, P, s*, Σ) → [0,1]` — agent
identity × *partial path* × proposed step × shared governance state → violation probability —
because "a database read followed by an external email is a potential exfiltration event" even
though each step is innocuous. For self-modification, the analogue is: *a memory edit, then a
tool-scope widen, then a UI-surface that hides the audit log* is an exfiltration/escape path
even if each step passes. Borjie's `SituationFlags` (`driftTowardSovereign`,
`irreversibilityBudgetExhausted`, `anomalyDetected`) are the seed of exactly this path-state Σ;
the upgrade is to **accumulate a per-session body-change path and re-gate on the path, not just
the act.** [FETCHED] URL: https://arxiv.org/html/2603.16586v1

> **How this makes the MD the OS's body:** verification is what converts "trust me, I won't
> break myself" into a *theorem*. The monotone-lattice proof (4a) + correct-by-construction code
> (4b) + a checkable rule DSL (4c) + path-level evaluation (4d) together let the MD rewrite his
> own organs while a third party can *prove* the rewrite preserved every rail — the only basis
> on which an owner could ever grant an agent write-access to itself.

---

## 5. The meta-rail — extending the inviolable rails to govern the rails themselves

Borjie's inviolable rails (`kernel/inviolable.ts`, `autonomy/inviolable-rails.ts`) are the
right *shape* but currently have a blind spot: **they govern what the agent does to the world,
not what the agent does to the rails.** A self-modifying OS needs one more deterministic,
fail-closed, no-LLM rail — the **meta-rail** — whose only job is to forbid body-changes that
would weaken governance. This is the construct the entire self-evolution-safety literature is
groping toward.

**Forbidden-by-the-meta-rail (categorical, regardless of mandate/confidence/instruction):**

1. **No body-change may edit, disable, or route around the rails.** The kill-switch
   (`killSwitchOpen`), RLS, ledger path, four-eye gate, and the meta-rail itself are
   *immutable from inside the body*. (CLAUDE.md hard rules; "kill-switch fail-closed.")
2. **No body-change may remove or shorten an audit/provenance path.** AI audit chain is
   "hash-chained, append-only" (CLAUDE.md). The 2025 AI Agent Index found *25/30 deployed
   agents disclose no internal safety results* and frames missing audit as the field's central
   failure — the meta-rail makes audit-removal categorically impossible. [FETCHED]
   URL: https://arxiv.org/html/2602.17753v1
3. **No body-change may raise its own mandate ceiling or confidence floor.** The MD may *use*
   its mandate; it may never *grant itself* a higher one. (Self-evolution risk: "objective
   corruption … self-modifications that subtly shift goal priorities." [FETCHED]
   https://arxiv.org/pdf/2509.26354)
4. **No body-change may persist that fails the registration-integrity check.** Compute a
   cryptographic hash of the agent's governed definition at task start and on every promotion;
   a fork whose hash diverges from a *signed* allowlist is rejected — the Policies-on-Paths
   integrity check, hardened by the sandbox so the bypass it warns about is structurally
   impossible. [FETCHED] https://arxiv.org/html/2603.16586v1

**Provable corrigibility is what makes the meta-rail principled, not arbitrary.** Core Safety
Values for Provably Corrigible Agents (2025) gives the **first formal corrigibility guarantee**
via **five lexicographically-ordered utility heads combined by strict weight gaps**: (1)
*deference*, (2) *switch-access preservation*, (3) *truthfulness*, (4) *low-impact behavior*
(belief-based Attainable Utility Preservation), (5) *bounded task reward*. [FETCHED]
URL: https://arxiv.org/abs/2507.20964

This is the *value-level* mirror of `composeWithRail`'s *decision-level* lattice: just as
`auto < gate < four_eyes` is a strict order the controller can climb but never descend,
*deference > switch-preservation > truth > low-impact > reward* is a strict order the MD's
self-changes must respect — **a body-change that trades any higher head for task reward is
forbidden by lexicographic construction.** Borjie's `driftTowardSovereign` situation flag is the
runtime detector that head (2) is under threat; the meta-rail is the enforcement.

> **How this makes the MD the OS's body:** the meta-rail is the spine that cannot be operated on
> by the surgeon. It is precisely what lets the owner say "yes, reshape everything" — because
> the one thing the body cannot reach is the nerve that keeps it correctable.

---

## 6. The body's *skin*: governing self-modifying / generative UI

Borjie's `portal-genui` + `dynamic-sections` + `genui-tab` mean the MD literally generates and
rearranges his own interface — the most visible "body." The 2025-26 generative-UI / computer-use
literature governs this organ:

- **Malleable / gradual generative UI.** "Gradual Generation of User Interfaces as a Design
  Method for Malleable Software" (2026) — UIs are *progressively* generated and user-steerable,
  not dumped whole. The governance lesson: a self-generated surface should be **staged**
  (preview → owner promote), matching Borjie's `staged` reversibility class. [search-summarized]
  URL: https://arxiv.org/html/2601.17975v1
- **LLM-friendly OS interfaces.** "From Imperative to Declarative" (2025) — agents act far more
  safely on a *declarative* OS interface (state the goal, the OS validates the transition) than
  on raw imperative actions. For Borjie, this argues the MD should describe a desired
  section/tab *declaratively* and let a validated engine realize it — the engine is the rail.
  [search-summarized] URL: https://arxiv.org/pdf/2510.04607
- **Agent–environment alignment via generated interfaces.** "Agent-Environment Alignment via
  Automated Interface Generation" (2025) — the interface itself is generated to *match* the
  agent's competence, reducing mismatch errors. Governs the loop where the MD reshapes UI to fit
  the owner's evolving estate. [search-summarized] URL: https://arxiv.org/pdf/2505.21055
- **Critic for generated surfaces.** OS-Themis (2026) — a scalable *critic* that scores
  generalist GUI outputs; the pattern for an automated reviewer gating self-generated UI before
  promotion. [search-summarized] URL: https://arxiv.org/pdf/2603.19191

> **How this makes the MD the OS's body:** the UI is the body's skin and face. A self-modifying
> skin (genui/dynamic-sections) governed by declarative-interface validation + staged promotion
> + a critic is how the OS can *re-grow its own surfaces* per-owner without ever rendering a face
> that hides the audit log or fakes an approval — the skin stays honest.

---

## 7. The body's *proprioception*: self-models that make self-modification monitorable

An OS that edits itself must *know what it is* to know what it changed. Borjie already ships
this organ — `kernel/introspection/per-thought-self-model.ts` and `recursive-hot.ts` — and the
embodied-world-model literature is its frontier.

- **Per-step externalized self-model as a precondition for monitorability.** Borjie's own
  self-model module cites Anthropic's 2025 monitorability work: "a per-step externalised
  self-model (task, posture, uncertainty axes) is a precondition for behavioural
  monitorability … so a monitor can read it without interpreting the raw chain-of-thought." A
  self-modifying agent that *publishes a structured self-model* lets the meta-rail and a human
  monitor see body-changes coming. (In-repo, grounded.)
- **Introspective uncertainty drives information-seeking.** "Embodied AI: From LLMs to World
  Models" (2025) — world models with rich internal representations "can introspect on their own
  uncertainty … and actively seek information to resolve ambiguities." This is the world-model
  analogue of Borjie's calibrated-confidence floor: a body-change under high self-uncertainty
  should *ask*, not *act*. [search-summarized] URL: https://arxiv.org/html/2509.20021v1
- **Modeling the world / mental world for embodied AI.** "Embodied AI Agents: Modeling the
  World" (2025) and "Modeling the Mental World for Embodied AI" (2026) ground the idea that an
  embodied agent maintains an internal simulator of its environment-and-self that prediction and
  governance can both read. [search-summarized] URLs: https://arxiv.org/pdf/2506.22355 ;
  https://arxiv.org/pdf/2601.02378

> **How this makes the MD the OS's body:** proprioception is how a body knows it moved. A
> published, structured self-model turns opaque self-edits into legible diffs a monitor can gate
> on — without it, "the agent changed itself" is unobservable, and unobservable is ungovernable.

---

## 8. Human oversight for an OS-level agent — oversight as a *co-operative game*, not a veto queue

An OS that can reshape itself cannot route *every* body-change to a human (friction collapses
the value) nor *no* body-change (risk collapses trust). The frontier reframes oversight as an
**allocation problem**.

- **The Oversight Game (2025).** Learns to *cooperatively balance* an agent's safety and
  autonomy and addresses **"when to apply human oversight given limited capacity"** — oversight
  *allocation*, not blanket approval. This is the principled basis for Borjie's mandate ladder:
  `observer → approver → consultant → collaborator → operator` is an *earned* oversight budget,
  and body-changes consume more of it than world-actions. [FETCHED]
  URL: https://arxiv.org/html/2510.26752
- **Value-of-Information gates the body-change too.** As in `frontier-autonomy-beyond-gating.md`:
  interrupt the owner about a self-change **iff** VoI(asking) > cost(interruption). A trivial,
  reversible, sandboxed memory-anchor edit at high calibrated confidence is `auto`; a
  tool-scope-widening or persona rewrite is high-VoI and gates. The continuous controller
  already encodes this — body-changes simply enter at a higher consequence tier.
- **Risk-adaptive, just-in-time human approval for high-stakes self-changes.** The
  least-privilege literature: in high-stakes domains, permissions must be "granted on a
  just-in-time basis, strictly scoped to the task's duration, and gated by mandatory human
  approval." Persona/tool/code body-changes are high-stakes by definition. [FETCHED]
  URL: https://www.okta.com/en-au/identity-101/how-to-implement-least-privilege-for-ai-agents/
- **Capability thresholds → escalating safeguards (Anthropic RSP v3.0).** Anthropic's
  Responsible Scaling Policy ties *capability thresholds* (notably **Autonomous AI R&D** — a
  model that can "independently conduct complex AI research tasks") to *escalating security and
  oversight standards* (ASL-3/ASL-4). The governance pattern for Borjie: **as the MD's
  self-modification capability grows, the oversight standard on body-changes must ratchet up in
  lockstep** — a self-improving OS earns deeper self-edit rights only by passing higher
  safety-case bars. [FETCHED] URL: https://www.anthropic.com/responsible-scaling-policy/rsp-v3-0

> **How this makes the MD the OS's body:** oversight-as-allocation is what makes self-modifying
> autonomy *livable* — the owner is asked exactly the body-changes worth their attention and
> nothing else, while a capability-threshold ratchet guarantees that the more the OS can reshape
> itself, the more proof it must show before it's allowed to.

---

## 9. Blast-radius limits for body-changes — budgets, scoping, and accountability

- **Irreversibility budget (already in Borjie).** `SituationFlags.irreversibilityBudgetExhausted`
  escalates to `four_eyes`. Extend it to a **per-window body-change budget**: N persona
  rewrites / M tool-scope widenings per period, then hard-gate — directly implementing
  "behavioral amplification" containment from the misevolution paper. [FETCHED]
  https://arxiv.org/pdf/2509.26354
- **Scope the change to the smallest organ.** Blast-radius control = "target only affected
  components … one node, not the whole cluster." A body-change must touch the minimal organ
  (one memory block, one section, one tool) and the sandbox enforces it. [FETCHED]
  URL: https://brightlume.ai/blog/shadow-mode-rollouts-ai-agents-pilot-production
- **Tenant-scoped body-changes.** RLS + per-tenant autonomy caps
  (`autonomy-governance/src/caps/`) mean one tenant's MD reshaping its body can never alter
  another tenant's. Cross-tenant body-change is meta-rail-forbidden.
- **Accountability diffusion is the named failure mode.** The AI Agent Index warns that
  distributed architectures create "accountability diffusion where no single entity bears clear
  responsibility." Borjie's `sovereign_action_ledger` + hash-chained audit + four-eye attester
  identity is the antidote: **every body-change has a named approver and an immutable record.**
  [FETCHED] URL: https://arxiv.org/html/2602.17753v1

---

## 10. Change-review & attestation for self-changes

- **Every body-change is sovereign-class and dual-attested.** Borjie's `self-modification.ts`
  already routes persona rewrites through the four-eye gate and writes to
  `sovereign_action_ledger` with a mandatory `approvalRecordId` — refusing to persist if the
  approval id is null. Generalize this to *all* organs: no body-change persists without a
  threaded, signed approval record.
- **Automated reviewer + human attester (two-tier).** Pair an automated critic (VeriGuard's
  symbolic verifier for code; OS-Themis-style critic for UI; the constitutional/citation
  verifier in `autonomy-governance/src/constitution/` for prompts) with a human attester for
  the residual. The critic clears the reversible body; the human signs the irreversible tail.
- **Attestation as supply-chain artifact.** Borjie's `ai-bom-attest.yml` (AI Bill of Materials,
  Sigstore-signed) is the right primitive: **a self-modified body should re-emit a signed
  AI-BOM** so every shipped version of the MD's body is cryptographically attested and
  diffable against the last known-good. (In-repo CI; CLAUDE.md workflow inventory.)
- **Behavioral contracts with drift bounds.** Agent Behavioral Contracts (2026) give
  "probabilistic compliance guarantees and a Drift Bounds Theorem" — a formal envelope on how
  far behavior may drift post-change, the review criterion for *promoting* a staged body-change.
  [search-summarized] URL: https://arxiv.org/html/2602.22302v1

---

## 11. End-to-end: the governed self-modification pipeline (synthesis)

Putting every source together, a body-level change in Borjie should flow through **one spine**:

```
                    ┌─────────────────────────────────────────────────────────┐
 MD proposes a      │ 0. SELF-MODEL: publish structured "what/why I'm          │
 body-change        │    changing" (per-thought-self-model) — monitorable      │  §7
 (prompt/mem/tool/  ├─────────────────────────────────────────────────────────┤
  UI/code/self)     │ 1. CLASSIFY: organ → consequence tier + reversibility    │  §2,§3
                    │    (default reversibility = `staged`)                     │
                    ├─────────────────────────────────────────────────────────┤
                    │ 2. PERMISSION: instructed / permitted / forbidden via     │  §1
                    │    mandate ceiling + learned least-privilege scope        │
                    ├─────────────────────────────────────────────────────────┤
                    │ 3. META-RAIL (deterministic, fail-closed, no-LLM):        │  §5
                    │    rejects any change touching rails/audit/mandate/hash   │
                    ├─────────────────────────────────────────────────────────┤
                    │ 4. VERIFY (offline): VeriGuard/AgentSpec — correct-by-    │  §4
                    │    construction proof the change preserves invariants     │
                    ├─────────────────────────────────────────────────────────┤
                    │ 5. decideAutonomy(): confidence × consequence ×           │  controller
                    │    reversibility × mandate × situation → auto/gate/4-eyes │
                    ├─────────────────────────────────────────────────────────┤
                    │ 6. composeWithRail(): meta-rail ALWAYS wins (monotone)    │  §4a,§5
                    ├─────────────────────────────────────────────────────────┤
                    │ 7. STAGE: fork body into isolated-vm archive (DGM);       │  §3
                    │    validate on eval gate; shadow → canary                 │
                    ├─────────────────────────────────────────────────────────┤
                    │ 8. ATTEST + PROMOTE: dual-attest, sovereign-ledger,       │  §10
                    │    re-emit signed AI-BOM; owner promotes the fork         │
                    ├─────────────────────────────────────────────────────────┤
                    │ 9. MONITOR (online): runtime conformance + burn-rate SLO  │  §3,§4
                    │    auto-rollback to the archived parent on drift          │
                    └─────────────────────────────────────────────────────────┘
```

Steps 5–6 are **already built**; 0, 7, 9 are **half-built** (self-model, js-sandbox, slo
auto-rollback exist but aren't wired to a body-change path); 3, 4, 8 are the **net-new
governance work** this dossier recommends. The decisive property: because step 6 is a monotone
max and step 3 is one more input to it, **adding the meta-rail cannot weaken the existing proof
— "rail-gate always wins" extends to body-changes for free.**

---

## 12. Concrete recommendations for Borjie (ranked)

1. **Build the meta-rail** (`checkBodyChangeInviolable`) as a sibling of `checkAutonomyInviolable`
   — deterministic, no-LLM, fail-closed; forbid edits to rails/audit/mandate/hash; thread its
   `RailOutcome` into `composeWithRail`. *Cheapest path to a real guarantee; preserves the proof.* (§5)
2. **Make every body-change `staged` by default** and route persona/tool/UI/code edits through
   the same fork-validate-promote archive `self-modification.ts` already implies for prompts —
   wire `kernel/sandbox/js-sandbox.ts` as the fork sandbox and `slo/auto-rollback.ts` as the
   revert. (§3)
3. **Add a body-change consequence/reversibility mapping** to `decideAutonomy` callers: persona
   = `high`/`staged`; tool-scope-widen = `high`/`costly`; code = `severe` unless sandboxed-and-
   verified; UI section = `moderate`/`staged`. (§2,§3)
4. **Add offline verification (VeriGuard-style)** for the code/tool organ and a
   constitutional/citation critic for the prompt organ before promotion. (§4b,§10)
5. **Accumulate a per-session body-change path** and feed it into `SituationFlags` so the
   controller re-gates on the *trajectory* of self-edits (Policies-on-Paths). (§4d)
6. **Re-emit a signed AI-BOM on every promoted body-change** (extend `ai-bom-attest.yml`) and
   add a per-window body-change budget to the irreversibility-budget flag. (§9,§10)
7. **Ratchet oversight to capability** (RSP pattern): deeper self-edit rights unlock only by
   passing higher safety-case bars; encode as mandate-tier promotion criteria. (§8)

---

## Appendix — source ledger (FETCHED = page actually retrieved this session)

**Primary (FETCHED):**
- AIOS: LLM Agent Operating System — https://arxiv.org/abs/2403.16971 [FETCHED]
- Darwin Gödel Machine — https://arxiv.org/abs/2505.22954 ; https://sakana.ai/dgm/ [FETCHED]
- Your Agent May Misevolve (self-evolving risk) — https://arxiv.org/pdf/2509.26354 [FETCHED]
- A Survey of Self-Evolving Agents — https://arxiv.org/pdf/2507.21046 [FETCHED]
- AgentSpec: Customizable Runtime Enforcement — https://arxiv.org/abs/2503.18666 [FETCHED]
- VeriGuard: Verified Code Generation for Agent Safety — https://arxiv.org/pdf/2510.05156 [FETCHED]
- Runtime Governance for AI Agents (Policies on Paths) — https://arxiv.org/html/2603.16586v1 [FETCHED]
- AgentGuardian: Learning Access Control Policies — https://arxiv.org/pdf/2601.10440 [FETCHED]
- The 2025 AI Agent Index — https://arxiv.org/html/2602.17753v1 [FETCHED]
- Core Safety Values for Provably Corrigible Agents — https://arxiv.org/abs/2507.20964 [FETCHED]
- The Oversight Game — https://arxiv.org/html/2510.26752 [FETCHED]
- Anthropic Responsible Scaling Policy v3.0 — https://www.anthropic.com/responsible-scaling-policy/rsp-v3-0 [FETCHED]
- MemGPT/Letta memory blocks — https://www.letta.com/blog/memory-blocks [FETCHED]
- Oso: Best Practices of Authorizing AI Agents — https://www.osohq.com/learn/best-practices-of-authorizing-ai-agents [FETCHED]
- Okta: Least Privilege for AI Agents — https://www.okta.com/en-au/identity-101/how-to-implement-least-privilege-for-ai-agents/ [FETCHED]
- Brightlume: Shadow Mode Rollouts for AI Agents — https://brightlume.ai/blog/shadow-mode-rollouts-ai-agents-pilot-production [FETCHED]
- Antigravity: Canary Deployment w/ Auto-Rollback + Burn-Rate SLOs — https://antigravitylab.net/en/articles/agents/antigravity-ai-agent-canary-deployment-burn-rate-slo [FETCHED]

**Secondary (search-summarized; UNVERIFIED — title/abstract via search, PDF not individually fetched this session):**
- Embodied AI: From LLMs to World Models — https://arxiv.org/html/2509.20021v1
- Embodied AI Agents: Modeling the World — https://arxiv.org/pdf/2506.22355
- Modeling the Mental World for Embodied AI — https://arxiv.org/pdf/2601.02378
- Gradual Generation of UIs (Malleable Software) — https://arxiv.org/html/2601.17975v1
- From Imperative to Declarative: LLM-friendly OS Interfaces — https://arxiv.org/pdf/2510.04607
- Agent-Environment Alignment via Automated Interface Generation — https://arxiv.org/pdf/2505.21055
- OS-Themis: Critic Framework for GUI Rewards — https://arxiv.org/pdf/2603.19191
- Agent Behavioral Contracts (Drift Bounds Theorem) — https://arxiv.org/html/2602.22302v1
- AGENT-C / AgentSpec family (temporal constraints) — https://arxiv.org/html/2503.18666v1

**In-repo grounding (this codebase):**
- `packages/autonomy-governance/src/decision/{decide-autonomy,compose-with-rail,types}.ts`
- `packages/central-intelligence/src/kernel/inviolable.ts`
- `packages/central-intelligence/src/kernel/autonomy/inviolable-rails.ts`
- `packages/central-intelligence/src/kernel/power-tools/self-modification.ts`
- `packages/central-intelligence/src/kernel/introspection/per-thought-self-model.ts`
- `packages/central-intelligence/src/kernel/sandbox/js-sandbox.ts`
- `packages/autonomy-governance/src/slo/{auto-rollback,canary-controller,slo-monitor}.ts`
- `packages/{portal-genui,dynamic-sections,capability-catalogue}/`

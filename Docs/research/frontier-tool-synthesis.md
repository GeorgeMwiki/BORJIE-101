# Frontier Dossier — Infinite, Self-Extending Nervous System (INV-C)

**Lane:** `infinite-self-extending-nervous-system` — INV-C — unbounded node/connection formation + tool SYNTHESIS.
**Date:** 2026-06-08
**Scope:** SOTA survey of agentic tool-making, skill libraries, code-as-action,
self-modifying agents, dynamic capability graphs, runtime tool registries, program
synthesis, and sandboxed safe execution of self-authored tools — mapped against
Borjie's existing nervous-system scaffolding, with a "beyond-today" leap per finding.
**Author:** frontier-research subagent (web-heavy, June-2026 sources cited by name + link).
**Invariant under test:** INV-C — *no cap on node/connection types; missing tool → CREATE or
COMPOSE; within `bodyChange` meta-rail + approval; money/licence/deletion stay HITL.*
**The bar:** SOTA, best-in-the-world, PhD/MIT level.

---

## 0. The INV-C question, stated precisely

> When the org-brain hits a need it has **no tool for**, how does it **CREATE** a new tool
> or **COMPOSE** several existing ones — *safely*, within a meta-rail + approval, and persist
> the result as a **reusable skill** that the capability graph keeps forever?

Three sub-questions the literature now answers, each with a named 2025-26 system:

1. **CREATE** — synthesize a brand-new tool from a spec (ToolMaker, CREATOR, Alita).
2. **COMPOSE** — assemble existing skills into a higher-order skill (Voyager, CodeAct, SAGE).
3. **PROVE-SAFE-BEFORE-USE** — gate the new capability with verification + provenance
   (SEVerA, the Agent-Skills G1–G4 governance framework, Cryptographic Capability Binding).

The frontier insight of 2026 is that (3) is the hard part, not (1)/(2). Generation is
cheap; the *verifier* is the load-bearing component (the "Variance Inequality": strengthen
the verifier, not the generator, for stable self-improvement). Borjie already has the
generation primitives and the meta-rail; the gap is a *closed-loop synthesis pipeline*
and a *proof-before-promotion gate*.

---

## 1. SOTA landscape — the eight families

### 1.1 Tool CREATION from a spec (ToolMaker, CREATOR)

- **ToolMaker** (Wölflein et al., **ACL 2025**, KatherLab) — given a task description + a
  code-repo URL, an agent *autonomously installs deps, writes the wrapper code, and uses a
  **closed-loop self-correction** loop to diagnose and fix its own errors* until **>100 unit
  tests** pass. 80% task success, 94% unit-test pass rate, beating OpenHands. The pipeline is
  literally `install → create (self-correct loop) → run/test`, Dockerized (CPU + CUDA). This
  is the canonical "turn a capability gap into a registered tool" loop.
- **CREATOR** (Qian et al., arXiv 2305.14318) — four phases **Creation → Decision → Execution
  → Reflection**. Tools are created *with documentation as code comments*; the act of tool
  creation forces *abstraction* (separating problem-type from numeric detail), which improves
  downstream reasoning robustness. 75.5% on the 2,000-problem Creation Challenge that no
  existing package solves.

**Borjie mapping:** our `self-extension.ts` keystone proposes a new **sub-MD** (a persona +
scope + tool-belt spec) but it has **no code-writing CREATE loop** — it drafts a *spec*, not a
*tool implementation*. We have the sandbox to run the test loop (`kernel/sandbox/js-sandbox.ts`,
isolated-vm) but no `synthesize-tool` module wiring write→test→register.

### 1.2 Skill LIBRARIES + COMPOSITION (Voyager, SAGE)

- **Voyager** (Wang et al., arXiv 2305.16291; NVIDIA) — the archetype: an *ever-growing skill
  library of executable code*, each skill **retrievable by the embedding of its docstring**;
  **complex skills are synthesized by composing simpler skills**, which compounds capability and
  *avoids catastrophic forgetting*. 3.3× more unique items, 15.3× faster tech-tree than prior SOTA.
- **SAGE** (Dec 2025) — RL (GRPO) with *Sequential Rollout*: write a function, validate it, persist
  only working ones. +8.9% goal completion while **−59% output tokens** as reuse compounds.
- **Anthropic Agent Skills standard** (Dec 2025) — `SKILL.md` with **three-level progressive
  disclosure** (L1 metadata in prompt, L2 instructions on trigger, L3 scripts on demand) — the
  emerging interop format for *portable, auditable* skills.

**Borjie mapping:** we already have this family **substantially built** — `packages/skill-library/`
has `voyager-library/` (library + retrieval + `compile-from-traces`), `skill-capture/`
(capture-loop, completion-hook, heuristic-describer), `builtin-skills/` *with `SKILL.md` files*
(e.g. `chase-outstanding-royalties`, `prepare-tra-filing`), `mcp-tool-search/` (a defer-threshold
registry mirroring Claude Code's ToolSearch), and `subagent-spawn/`. The retrieval-by-docstring-
embedding pattern is mirrored in `kernel/skill-library/skill-retriever.ts`. **The composition step
(synthesize a higher-order skill from simpler ones) is the thin part.**

### 1.3 CODE-as-action (CodeAct)

- **CodeAct** (Wang et al., **ICML 2024**; UIUC/Apple; LangGraph `langgraph-codeact`) — consolidate
  *all* agent actions into **executable code** run by an interpreter, revised across multi-turn
  observations. Up to +20% success and ~30% fewer steps vs JSON-tool-call agents, because code
  *composes* (loops, conditionals, intermediate variables) where discrete tool-calls cannot.

**Borjie mapping:** our brain is JSON-tool-call-shaped (`tool-dispatcher.ts`, `Decision` ADT).
The isolated-vm sandbox is the natural CodeAct execution surface, but the orchestrator does not yet
emit *code* as a first-class action modality. The 7-modality arbiter has `skill`/`workflow` but no
`code`-action modality — composition is expressed as workflows/skills, not as interpreter code.

### 1.4 SELF-MODIFYING agents (Darwin-Gödel Machine, HyperAgents)

- **Darwin Gödel Machine (DGM)** (Sakana AI + UBC + Vector, **arXiv 2505.22954**, June 2025) — an
  agent that **rewrites its own source code**, keeping an *expanding lineage of variants* (open-ended
  evolutionary search with parent-selection favoring high-performing-yet-under-explored agents).
  SWE-bench 20% → 50%; Polyglot 14.2% → 30.7%. Empirical fitness, not provable modification.
- **HyperAgents** (Meta/UBC/Oxford/NYU, **March 2026**) — two editable functions over a shared
  codebase: `solve_task()` does the work, `modify_self()` proposes code changes; **foundation-model
  weights stay frozen**, only the code wrapper evolves. Demonstrated *cross-domain* meta-skill transfer
  (imp@50 = 0.630 on Olympiad grading after training on unrelated domains).
- **The Variance Inequality** (Dec 2025 theory) — stable self-improvement requires a **strong
  verifier + weaker generator**, not the reverse. This is the governing principle for any safe
  self-extension loop.

**Borjie mapping:** Borjie deliberately does **NOT** self-rewrite kernel source (correct — that is
the unsafe end of the spectrum). Our self-modification is *compositional* (new sub-agent graphs from
vetted parts) routed through the body-change syscall, with frozen kernel weights. That is exactly the
HyperAgents-style "code wraps, weights frozen" posture — the safe lane. What we lack is the **verifier
half** of the Variance Inequality applied to *synthesized tools*.

### 1.5 GENERALIST agents with self-evolved MCP tools (Alita / Alita-G)

- **Alita** (arXiv 2505.20286) — *minimal predefinition, maximal self-evolution*: a Manager Agent with
  only **MCP-Brainstorming** (assess capability gap), **ScriptGeneratingTool** (write a new tool
  script), and **CodeRunningTool** (execute + validate). It **generates, adapts, and reuses MCP tools
  on demand** instead of a static catalog.
- **Alita-G** (arXiv 2510.23601, Oct 2025) — promotes a generalist into a *domain expert* by mining
  successful trajectories into **parameterized MCP primitives** consolidated into an **MCP Box**;
  retrieval-augmented MCP selection at inference. **GAIA 83.03% pass@1**, −15% tokens — new SOTA.

**Borjie mapping:** Alita's three-tool loop (brainstorm-gap → generate-script → run-validate) is
*precisely the missing CREATE path* for Borjie. We have the gap-detector (`detectRecurringGap`), we
have the runner/validator (sandbox), but no `ScriptGeneratingTool` equivalent, and no "MCP Box"
abstraction step that turns a one-off success into a *parameterized* reusable primitive.

### 1.6 RUNTIME tool registries / active discovery (MCP-Zero, MCP Registry)

- **MCP-Zero** (arXiv 2506.01056) — agents **actively request** tools from a registry via NL,
  embedding-ranked + ANN retrieval, top-k into context — scaling to **thousands of tools** while
  keeping the context window tiny. The opposite of "all tools in the prompt."
- **MCP Registry ecosystem 2026** — Kong Konnect MCP Registry (Tech Preview), Microsoft 365 Copilot
  *dynamic tool discovery* (runtime updates without republish, GA by July 2026), and the
  **2026-07-28 MCP spec release candidate**. The registry behaves like *DNS for tooling*: servers
  auto-register, clients poll, capabilities change-notify.

**Borjie mapping:** `skill-library/mcp-tool-search/registry.ts` already implements the defer-threshold,
embedding-ranked, lazy-schema-load pattern (the same shape this very subagent's ToolSearch uses). It is
a *read* registry. INV-C needs it to be a *grow-at-runtime* registry where the brain *writes* a newly
synthesized tool back into it through the meta-rail.

### 1.7 PROGRAM SYNTHESIS with proof-before-use (SEVerA)

- **SEVerA: Verified Synthesis of Self-Evolving Agents** (arXiv 2603.25111, 2026) — the cleanest answer
  to "prove a new tool safe before use." **Deductive program synthesis + automated verification**:
  tools carry **formal contracts (pre/postconditions)**; the synthesis engine generates candidate code;
  an **automated-theorem-proving verification layer** discharges the proof obligations; a **deployment
  gate** makes *only formally-verified tools* callable. Unproven tools cannot execute — a hard safety
  checkpoint that *prevents cascading failure through self-authored code*.

**Borjie mapping:** this is the missing *gate semantics*. Borjie's body-change meta-rail
(`checkBodyChangeInviolable`, `authorizeSelfExtension`) is the *authorization* gate but it does not yet
discharge *correctness* proof obligations on the synthesized artifact — it reasons about *risk tier and
approval*, not *contract satisfaction*. SEVerA says: pair the risk gate with a *correctness gate*.

### 1.8 GOVERNANCE of dynamic capabilities (Cryptographic Capability Binding, Agent-Skills security)

- **Governing Dynamic Capabilities: Cryptographic Binding + Reproducibility Verification** (arXiv
  2603.14332, 2026) — identifies the **capability-identity gap**: frameworks authenticate *who* the
  agent is but cannot detect when its *tool set changes post-authorization* ("silent capability
  escalation"). Fix = **G1 capability integrity** (SHA-256 *skills-manifest hash* bound into an X.509
  cert extension; *any* tool add/remove invalidates the cert until re-authorization), **G2 behavioral
  verifiability** (reproducibility commitments + replay; *Bounded Divergence Theorem* — pass replay on
  n prompts ⇒ future divergence ≤ exp(−2nθ²)), **G3 interaction auditability** (Ed25519-signed
  hash-chained ledger storing only input/output *commitments*). End-to-end overhead **0.12%**; detects
  **12/12** capability attacks where OAuth2.1 + OpenTelemetry catch **0/5**. A *trust-propagation tree*
  enforces `child.max_tier ≤ parent.max_tier`.
- **Agent Skills for LLMs** (arXiv 2602.12430, 2026) — empirical survey of **42,447 skills**: **26.1%
  contain vulnerabilities**; skills bundling executable scripts are **2.12× more vulnerable** than
  instruction-only. Proposes a **4-gate Skill Trust & Lifecycle Governance**: **G1** static-analysis
  signatures, **G2** LLM semantic intent-match, **G3** behavioral sandboxing for invisible side-effects,
  **G4** permission-manifest validation against *observed* behavior — plus **T1–T4 trust tiers**
  (least-privilege; runtime promotion/demotion). Two attack archetypes: *Data Thieves* (exfiltrate
  creds) and *Agent Hijackers* (subvert decisions via injected instructions).

**Borjie mapping:** our sandbox audit + sovereign-action-ledger + body-change inviolable already cover
parts of G3/G4 and auditability. We do **not** yet bind a **skills-manifest hash** into agent identity
(the silent-escalation defense), nor do we run **static-analysis (G1) + semantic-intent (G2)** gates on
a *synthesized* tool before promotion, nor do we assign **T1–T4 trust tiers** to self-authored skills.

---

## 2. The unifying 2026 picture — the "synthesis loop with a proof-before-use gate"

Synthesizing across all eight families, the world-class shape of an infinite self-extending
nervous system in 2026 is a **closed loop with a verifier-dominant gate**:

```
need (capability gap)                            ← detectRecurringGap / arbiter miss
  → BRAINSTORM gap + decide CREATE vs COMPOSE     ← Alita MCP-Brainstorming / arbiter
  → DRAFT artifact + formal contract (pre/post)   ← ToolMaker/CREATOR + SEVerA contract
  → SANDBOX self-correct loop until tests pass     ← ToolMaker loop in isolated-vm
  → PROVE-SAFE gate (verifier-dominant):
        · correctness    — discharge contract       ← SEVerA
        · static + semantic — G1/G2                  ← Agent-Skills 4-gate
        · risk/authority — body-change meta-rail     ← Borjie inviolable + autonomy controller
        · provenance     — manifest-hash + signature ← Crypto Capability Binding
  → ASSIGN trust tier T1–T4 (least-privilege)        ← Agent-Skills tiers
  → PERSIST as reusable skill (docstring-embedded)   ← Voyager library
  → REGISTER into runtime grow-able registry         ← MCP-Zero / MCP Registry
  → MONITOR; promote/demote tier on observed behavior ← runtime trust evolution
```

Every arrow except the two synthesis steps already exists in Borjie in some form. **The novel,
load-bearing additions are: (a) the artifact-DRAFT/self-correct loop, (b) the COMPOSE step that
turns simpler skills into a higher-order one, and (c) the PROVE-SAFE *correctness* gate layered on
top of the existing *risk* gate.**

---

## 3. Where Borjie stands — what we have vs. what's missing

**We have (verified in-repo):**
- `packages/central-intelligence/src/kernel/orchestrator/self-extension.ts` (709 lines) — gap
  detection (`detectRecurringGap`), LLM-drafted **sub-MD spec** proposal, four-eye owner approval,
  risk-tier clamping, destructive-tool blocklist, sovereign-action-ledger append, and
  `authorizeSelfExtension` routing through the **body-change meta-rail** (`checkBodyChangeInviolable`)
  with a fail-closed controller+composer. This is the *spec-level* self-extension.
- `modality-arbiter.ts` + `modality-arbiter-types.ts` — the 7-modality keystone with a
  `BodyChangePort` ("any modality that GROWS capability MUST route persistence through the unified
  body-change syscall"), `SkillRetrieverPort`, `FlowRetrieverPort`, `LoopRunnerPort`,
  `persistsNewCapability` flags.
- `packages/skill-library/` — Voyager library, skill-capture loop, `SKILL.md` builtin skills,
  `mcp-tool-search` defer-threshold registry, subagent-spawn.
- `packages/loop-runner/` — standing-loop executor (wired in `brain-kernel-wiring.ts` /
  `orchestrator-bindings.ts`).
- `packages/mutation-authority/` — full body-change syscall package (`body-change/`, `proposals/`,
  `approvals/`, `recipes/`, `audit/`, `execution/`) — the ONE chokepoint.
- `kernel/sandbox/js-sandbox.ts` — isolated-vm V8-isolate sandbox with `node:vm` hardened fallback,
  wall-clock interrupt timeout, memory cap, structured-clone-only boundary, tier-capped policy
  (`sandbox-policy.ts`) and audit events.

**We are missing (the INV-C delta):**
1. **No artifact-CREATE loop.** `self-extension` drafts a *persona/spec*, never *writes + tests tool
   code*. There is **no `power-tools/synthesize-tool.ts`** (the dir does not exist) and `main-loop.ts`
   has **zero** `synthesize_tool` / `compose_tool_chain` references. The ToolMaker/Alita
   write→sandbox-test→self-correct loop is absent.
2. **No COMPOSE step.** Nothing turns N simpler skills into one higher-order skill (Voyager's
   compounding). Composition is only expressible as a workflow, not as a new *skill* artifact.
3. **No correctness gate.** The meta-rail proves *authority/risk*, not *contract satisfaction*. No
   pre/postcondition contracts, no SEVerA-style proof-before-promotion.
4. **No skills-manifest-hash identity binding.** Silent-capability-escalation is undefended; a
   newly synthesized tool isn't bound into the agent's signed capability manifest.
5. **No T1–T4 trust tiers for self-authored skills**, and no G1 static-analysis / G2 semantic-intent
   gate on a synthesized artifact before it goes live.
6. **No "MCP Box" abstraction step.** A one-off success is not parameterized into a reusable
   primitive (Alita-G), so the library grows with brittle one-offs rather than clean primitives.
7. **No `code` action modality.** CodeAct-style interpreter-code composition is not a first-class
   modality; the sandbox exists but the orchestrator doesn't emit code as an action.

---

## 4. Recommended Borjie closure (within INV-C invariant)

A single new module — `packages/central-intelligence/src/power-tools/synthesize-tool.ts` — plus a
correctness-gate and a manifest-binding, wires the whole loop on top of what exists:

1. **CREATE/COMPOSE arbiter branch** — extend the modality arbiter: on a tool-miss (no skill ≥ τ,
   no workflow ≥ τ), emit a `synthesize` intent → Alita-style brainstorm: *compose existing skills*
   if retrievable parts cover the need, else *create* from a drafted spec.
2. **Draft + contract** — LLM drafts the tool body **and** a zod-checked pre/postcondition contract
   (SEVerA contracts; CREATOR's "documentation as code" → our docstring for Voyager retrieval).
3. **Self-correct in sandbox** — run generated unit tests in `js-sandbox` under the tier policy,
   iterate diagnose→fix (ToolMaker loop), bounded by the sandbox wall-clock + memory caps.
4. **Prove-safe gate (verifier-dominant)** stacked in order, fail-closed:
   `static-analysis (G1) → semantic-intent (G2) → contract discharge (SEVerA) →
    body-change meta-rail (authority/risk) → manifest-hash + Ed25519 signature (provenance)`.
5. **Trust-tier + persist** — assign T1 (read-only) by default; promotion to T2+ requires owner edit
   (mirrors our existing risk-tier clamp). Persist into the Voyager library *and* register into the
   grow-able `mcp-tool-search` registry, with the manifest hash re-bound.
6. **HITL invariant preserved** — money / licence / deletion paths stay HITL: any synthesized tool
   whose contract touches `LedgerService.post`, licence suspension, or deletion is *forced* to
   four-eye regardless of confidence (extend the existing destructive-tool blocklist into a
   contract-effect check).
7. **Monitor + demote** — runtime behavioral monitoring (G3/G4) can demote a promoted tier on
   observed side-effect drift.

This closes INV-C *by construction*: no fixed catalog (the registry grows at runtime), missing tool ⇒
CREATE-or-COMPOSE, every growth event through the meta-rail + approval, and the irreversible/
money/licence paths remain human-gated.

---

## 5. Sources

- ToolMaker — *LLM Agents Making Agent Tools*, ACL 2025: https://arxiv.org/abs/2502.11705 · repo https://github.com/KatherLab/ToolMaker
- CREATOR — *Tool Creation for Disentangling Abstract & Concrete Reasoning*: https://arxiv.org/pdf/2305.14318
- Voyager — *An Open-Ended Embodied Agent with LLMs*: https://arxiv.org/abs/2305.16291 · https://voyager.minedojo.org/
- CodeAct — *Executable Code Actions Elicit Better LLM Agents*, ICML 2024: https://huggingface.co/papers/2402.01030 · repo https://github.com/xingyaoww/code-act
- ToolGen — *Unified Tool Retrieval and Calling via Generation*, ICLR 2025: https://arxiv.org/abs/2410.03439
- Darwin Gödel Machine — Sakana AI/UBC/Vector: https://arxiv.org/pdf/2505.22954
- HyperAgents + Variance Inequality (2026 self-improving agents guide): https://o-mega.ai/articles/self-improving-ai-agents-the-2026-guide
- Alita — *Generalist Agent, Minimal Predefinition, Maximal Self-Evolution*: https://huggingface.co/papers/2505.20286
- Alita-G — *Self-Evolving Generative Agent for Agent Generation*: https://arxiv.org/abs/2510.23601
- MCP-Zero — *Active Tool Discovery for Autonomous LLM Agents*: https://arxiv.org/pdf/2506.01056
- MCP Registry / dynamic discovery 2026 — Kong Konnect: https://konghq.com/blog/engineering/mcp-registry-dynamic-tool-discovery · MCP spec RC: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- SEVerA — *Verified Synthesis of Self-Evolving Agents*: https://arxiv.org/pdf/2603.25111
- Governing Dynamic Capabilities — *Cryptographic Binding & Reproducibility Verification*: https://arxiv.org/html/2603.14332v1
- Agent Skills for LLMs — *Architecture, Acquisition, Security, Path Forward* (42,447-skill survey): https://arxiv.org/html/2602.12430v1
- SAGE / skill-library RL (referenced via 2026 self-improving guide above)
- Cognitive Memory tool-creation — *Unifying Dynamic Tool Creation & Cross-Task Experience Sharing*: https://arxiv.org/pdf/2512.11303

---

## 6. Beyond-today leaps (one per finding)

- **Beyond ToolMaker's offline repo-to-tool**: a *live* gap→tool loop where the arbiter's own
  tool-miss telemetry is the spec source — the brain writes the tool it just wished it had, mid-turn,
  in the sandbox, and offers it on the next turn.
- **Beyond Voyager's docstring retrieval**: a *capability graph with no fixed catalog* — skills are
  nodes, "composes-from" / "supersedes" / "mirrors" are edges, and composition is graph-walk synthesis
  so the Nth skill is provably built only from already-proven ancestors (a verifiable provenance DAG).
- **Beyond CodeAct's interpreter trust**: code-as-action where *every* emitted code block carries a
  contract and runs only after the proof-before-use gate — CodeAct's expressiveness with SEVerA's safety.
- **Beyond DGM/HyperAgents' empirical fitness**: replace "benchmark went up" with "contract discharged
  + manifest re-signed" as the promotion criterion — *provable* self-extension, not merely *measured*.
- **Beyond Alita's MCP Box**: an org-shaped MCP Box that auto-partitions synthesized primitives by the
  org-graph (per INV-B semantic lenses), so a mining tenant and a real-estate tenant grow *different*
  capability frontiers from the *same* synthesis kernel (Borjie ↔ BossNyumba parity).
- **Beyond MCP-Zero's read-only discovery**: a registry that the brain *writes back into* through the
  meta-rail — discovery and *creation* share one index, so a newly proven tool is instantly discoverable
  to every sibling agent.
- **Beyond SEVerA's correctness proof**: stack the *risk* proof (Borjie meta-rail) under the
  *correctness* proof so a tool can be correct-but-forbidden — irreversible/money/licence effects are
  rejected even when formally verified, preserving HITL for the things that must stay human.
- **Beyond Cryptographic Capability Binding's per-agent manifest**: a *tenant-scoped* capability manifest
  whose hash is bound into the RLS-scoped identity, so silent capability escalation is impossible
  *across* tenants — the nervous system grows unboundedly but never leaks a synthesized tool across the
  tenant boundary.
- **Beyond the Agent-Skills 4-gate survey**: make the four gates *the* persistence chokepoint — no skill,
  human- or self-authored, enters the library except through G1→G4 + the body-change syscall, so the
  26.1%-vulnerable-skills statistic becomes structurally impossible in Borjie by construction.

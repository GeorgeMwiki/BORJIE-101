# MD Self-Model + Body Schema — SOTA Dossier

**Topic:** Agent self-modeling & self-awareness so Mr. Mwikila (the MD) holds a
**live model of its own body** — where "its body" is *the entire Borjie system*:
every surface, screen, capability, data-flow, component, and its health.

**Date:** 2026-06-08
**Author:** research subagent (parity-final workstream)
**Audience:** Claude Code / Cursor / any LLM agent working the brain layer.
**Status:** deep web research complete — every external item below cites a URL
that was actually fetched in this session, or is marked UNVERIFIED.

---

## 0. Why this matters — the thesis

A normal app *has* features. An **operating system** *knows its own body*: which
processes are running, which devices are attached, which calls are available,
what is healthy, and what it is allowed to do where. Today Mr. Mwikila is closer
to the first than the second. The repo already has the seeds —
`packages/central-intelligence/src/kernel/self-awareness.ts` ships a **static**
`BRAIN_MODULES` inventory of ~36 modules and a `renderModuleInventoryBlock()`
that injects "BRAIN SELF-AWARENESS" into every prompt; `packages/org-graph`
materialises a denormalised edges graph; `packages/capability-catalogue`
measures competence/calibration/utility per capability; the kernel has a
`world-model/` directory. **The gap is that these are not unified into one live,
self-updating self-model the MD reasons over.**

The frontier research below converges on one design: **a self-model is a
continuously-updated internal representation of one's own structure,
capabilities, state and limits, and it confers compression, prediction, anomaly
detection, and planning** (Premakumar & Lipson, *On the Origins of
Self-Modeling*, fetched). For an AI-native OS, that self-model is best
materialised as a **system-graph (nodes = components/surfaces/capabilities/
data-flows; edges = dependencies/data-flows/calls; node-attached health +
competence telemetry) + a live capability catalogue the agent queries** — i.e.
a **body schema** for software. This is precisely the pattern that
digital-twin-as-self-model (PMC, fetched), topology-aware observability agents
(dev.to, fetched), AIOS (arXiv 2403.16971, fetched), and ScaleMCP (arXiv
2505.06416, fetched) have each, independently, landed on.

The MD *becomes* the OS exactly when (a) it can answer "what surfaces/screens/
capabilities/data-flows exist, what can I do where + why" from a **live graph,
not a hand-maintained string**, and (b) that graph **updates itself** as the
codebase, schema, deploys, and health change — so the self-knowledge can never
go stale, by construction.

---

## 1. The foundations — what a self-model *is* and why agents build one

### 1.1 Self-modeling machines (the canonical line)
- **What:** Lipson/Chen/Kwiatkowski/Vondrick — *Full-Body Visual Self-Modeling
  of Robot Morphologies* (Science Robotics) and the **task-agnostic** /
  **egocentric** follow-ups: a machine learns a forward model of *its own body*
  from interaction data, with **no prior knowledge of its morphology**, then
  uses that self-image to plan, detect damage, and adapt.
- **The load-bearing claim:** "Self-modeling is a primitive form of
  self-awareness; if a robot has an accurate self-model it can function better,
  make better decisions, and has an evolutionary advantage."
- **Source:** https://neurosciencenews.com/robotic-awareness-21047/ (fetched —
  the Columbia/Lipson summary) and search-surfaced primaries arXiv 2111.06389
  (Full-Body Visual Self-Modeling), 2207.03386 (egocentric), 2209.02010 (Origins
  of Self-Modeling), nature.com s44182-025-00031-6 (UNVERIFIED — surfaced not
  fetched).
- **Body-application:** The MD's "morphology" is the project tree: packages,
  services, routes, surfaces, schemas. The self-model should be learned/
  derived from **interaction + introspection data** (route manifests, the
  capability-catalogue's invocation/outcome telemetry, the org-graph edges, OTel
  spans) — not hand-authored. **Damage detection** maps directly to: "the
  `bids.hono.ts` route is 500-ing / the `metallurgy-agent` capability dropped
  below competence threshold → my body has an injured limb; route around it,
  flag it, and tell the owner."

### 1.2 Origins of self-modeling — *why* it pays
- **What:** Self-models emerge when environmental complexity is high because they
  give four concrete returns: **compression** (focus on task-relevant aspects of
  self), **prediction** (anticipate consequences without trial-and-error),
  **anomaly detection** (a baseline of "normal me" makes deviation legible), and
  **planning** (forward-simulate actions before executing). Self-awareness here
  is *computational, not phenomenological*.
- **Source (fetched):** https://arxiv.org/pdf/2209.02010
- **Body-application:** These four returns are the MD's spec. Compression →
  the body schema is a *summary* of 180 packages, not the raw tree.
  Prediction → before the MD promises "I can do X on the owner cockpit," it
  checks the schema. Anomaly → the health layer flags an unhealthy component as a
  deviation from baseline-self. Planning → the MD plans cross-surface workflows
  by traversing the system-graph (which surface, which capability, which
  data-flow).

### 1.3 Sensorimotor self-recognition in an LLM-driven robot
- **What:** A multimodal LLM (Gemini) in a mobile robot builds an **evolving
  internal body representation** by fusing proprioception (wheel encoders), IMU,
  vision, and LiDAR; it learns self-vs-environment via **sensorimotor
  contingencies** ("my actions produce predictable sensor changes"). The
  decisive finding: **episodic memory is what makes the self-model coherent over
  time** — ablate memory and self-recognition oscillates 0–5; ablate vision and
  it mis-identifies its own body type.
- **Source (fetched):** https://arxiv.org/html/2505.19237v2
- **Body-application:** The MD's "proprioception" = telemetry it generates by
  *acting on its own body* (route calls, capability invocations, migrations,
  deploys). The lesson "**memory is the binding agent**" tells us the body
  schema must be **persisted and carried turn-to-turn** (Borjie already has
  `cognitive-memory` / `persistent-memory` / `memory-v2` — wire the schema
  through them) so the MD's self-knowledge is temporally stable, not re-derived
  cold each turn.

### 1.4 Active inference / Free-Energy self-model (the unifying theory)
- **What:** Friston's Free-Energy Principle frames every adaptive system as
  minimising the divergence between its **generative self/world model** and
  reality, via perception (update the model) and action (change the world to fit
  the model). The self-model and the world-model are the same machinery.
- **Source (fetched):** https://pmc.ncbi.nlm.nih.gov/articles/PMC8871280/ ;
  engineering view arXiv 2603.20927 (UNVERIFIED — surfaced not fetched);
  XAI-via-active-inference arXiv 2306.04025 (UNVERIFIED — surfaced not fetched).
- **Body-application:** This is the *principle* behind "self-model that updates
  as the system changes." Treat divergence between the body schema and ground
  truth (the actual route table, actual capability health, actual deploy state)
  as **prediction error to be minimised**: every drift between "what the MD
  thinks its body is" and "what its body actually is" should trigger either a
  model update (re-derive the schema) or an action (raise an incident). Borjie
  already has a `world-model/` and `belief-engine` package — the body schema is
  the *self-directed* half of the same loop.

---

## 2. Machine introspection — what the LLM can/can't know about itself (the honesty constraint)

### 2.1 Anthropic — *Emergent introspective awareness in LLMs*
- **What:** Via **concept injection** (recording an activation pattern for a
  concept, then adding that vector into a later layer mid-generation), Claude
  Opus 4/4.1 can *sometimes* (≈20% of the time, at a "sweet-spot" strength)
  notice and name an injected internal state, distinguish injected
  representations from input text, and modulate "thinking about X" on
  instruction. **But it is unreliable, context-dependent, and far from
  human-like.** Caveat the team stresses: models could "selectively misrepresent
  or conceal" — validate introspective reports, don't trust them blind.
- **Sources (fetched):** https://www.anthropic.com/research/introspection ;
  arXiv mirror 2601.01828 + transformer-circuits.pub/2025/introspection
  (surfaced).
- **Body-application — THE design rule:** **Do not let the MD introspect its own
  body from the weights.** Self-knowledge must be **grounded in an external,
  inspectable artifact** (the system-graph + capability catalogue), and the
  prompt-time self-awareness block must be **generated from that artifact**, not
  hallucinated. This is already the right instinct in `self-awareness.ts`
  (`renderModuleInventoryBlock` injects a real list) — the fix is making the list
  *live and machine-derived* instead of a hand-edited constant.

### 2.2 Limited metacognition / privileged self-access
- **What:** Ackerman, *Evidence for Limited Metacognition in LLMs* (fetched) —
  models express confidence on wrong answers, can't reliably identify what they
  don't know, lack privileged access to their own computation; **agents cannot
  rely on LLM confidence signals** and need **independent verification**. Echoed
  by *Privileged Self-Access Matters for Introspection* (2508.14802),
  *Minimal/Mechanistic Conditions for Behavioral Self-Awareness* (2511.04875),
  *Me, Myself, and π* (2603.20276) — all surfaced, not fetched.
- **Source (fetched):** https://arxiv.org/pdf/2509.21545
- **Body-application:** This is *why* Borjie's `capability-catalogue` measuring
  **calibration error** per capability (`measurement/calibration.ts`) is exactly
  right and ahead of the pack. The MD's self-knowledge of "how good am I at X"
  must come from **observed outcomes** (the `Outcome` + `Measurement` rows),
  never from the model's verbal self-report. Wire calibration into the body
  schema so the MD says "I can do offtake settlement, competence 0.91 over 28d,
  calibration error 0.04" — grounded, not vibes.

### 2.3 Spontaneous metacognition when left alone
- **What:** Szeider, *What Do LLM Agents Do When Left Alone?* (fetched) —
  autonomous agents spontaneously self-monitor, self-organise, track goals,
  detect their own errors, express uncertainty, and **construct internal models
  of their own capabilities and limits** without being told to.
- **Source (fetched):** https://arxiv.org/pdf/2509.21224
- **Body-application:** Validates building this as **scaffolding the model wants
  to use**. The MD's idle/sleep cycles (Borjie has reflexion sleep-consolidation)
  are the natural place to run **self-model maintenance**: reconcile the schema,
  re-measure capability health, flag injured limbs.

---

## 3. The OS pattern — how an agent OS represents and reasons over its own body

### 3.1 AIOS — the LLM-agent operating-system kernel
- **What:** AIOS (COLM 2025) isolates resources into a kernel with **named
  modules**: LLM Core (CPU analog), **Scheduler** (FIFO/RR over syscalls),
  **Context Manager** (snapshot/restore), **Memory Manager** (LRU-K eviction,
  RAM↔disk swap), **Storage Manager** (files + vector DB), **Tool Manager**
  (standardized loading interface; dynamically loads a tool by name; hashmap of
  live instance counts for concurrency), **Access Manager** (privilege control +
  user-confirm on destructive ops). Component state is tracked via thread-bound
  syscalls carrying status/response/timing; agents discover tools via the
  AIOS-Agent SDK.
- **Sources (fetched):** https://arxiv.org/abs/2403.16971v4 and
  https://arxiv.org/html/2403.16971v5 ; repo https://github.com/agiresearch/AIOS
  (surfaced).
- **Body-application:** This is the **taxonomy for the MD's body schema's
  "organ systems."** Map Borjie's real packages onto AIOS organs:
  `central-intelligence` = LLM Core + Scheduler; `cognitive-memory`/`memory-v2` =
  Memory Manager; `database`/`storage-adapter` = Storage Manager;
  `mcp`/`tool-dispatcher`/`power-tools` = Tool Manager; `authz-policy`/
  `policy-gate`/`four-eye` = Access Manager. The crucial AIOS idea for the body
  schema: **the kernel keeps live per-component state (instance counts, queue
  status, health), and that state is first-class** — exactly what the static
  `BRAIN_MODULES` list lacks.

### 3.2 Declarative OS interfaces for agents (imperative → declarative)
- **What:** *From Imperative to Declarative: LLM-friendly OS Interfaces* — the OS
  should expose its **complete state and available actions as structured data**
  (capabilities described with preconditions/parameters/effects upfront,
  hierarchically grouped, with explicit constraints/dependencies), so the agent
  **reasons about** the system instead of probing it. "Recognition over recall."
- **Source (fetched):** https://arxiv.org/pdf/2510.04607
- **Body-application:** This is the **interface spec for the capability
  catalogue.** Each Borjie capability/route/surface should be declared with: what
  it does, where it lives (which surface/screen), preconditions (auth tier,
  jurisdiction, feature-flag), parameters, effects, and dependencies — so the MD
  can answer "what can I do where + why" by *reading its own declarative body*,
  not by trial-and-error. Borjie's `capability-catalogue` `CapabilityContract`
  (input/output schema, cost class, latency budget, dependencies) is already a
  declarative contract — extend it with **surface/screen placement + preconditions
  + effects** to complete the body schema.

### 3.3 MemGPT — the OS-style self-managed memory hierarchy
- **What:** MemGPT gives a fixed-context LLM **OS-style virtual memory**: it
  self-edits and pages data between main context and external archival/recall
  stores via function calls, OS-page-fault style.
- **Source (fetched):** https://arxiv.org/abs/2310.08560 (and ar5iv mirror).
- **Body-application:** The body schema will be too big to hold in-context whole.
  MemGPT's pattern says: keep a **compressed self-summary in core context** (the
  top-level organ map + currently-relevant surfaces) and **page in detail**
  (a specific route's contract, a capability's health history) **on demand** via
  a `query_body_schema(...)` tool. This is the scalable rendering strategy for
  `renderModuleInventoryBlock` once the inventory is hundreds of nodes.

---

## 4. Keeping the self-model accurate as the system changes (the hardest requirement)

### 4.1 ScaleMCP — auto-synchronizing capability registry
- **What:** ScaleMCP keeps the agent's view of available tools **automatically in
  sync** with a dynamically-changing tool ecosystem: tools are discovered at
  runtime (not pre-registered), a registry tracks availability in real time,
  changes propagate automatically, and the agent does **hierarchical/semantic
  retrieval** over the (large, changing) registry instead of holding all tools in
  context. Builds on MCP's `listChanged: true` notification → re-list pattern.
- **Sources (fetched):** https://arxiv.org/pdf/2505.06416 ; MCP dynamic-discovery
  semantics surfaced via the MCP cheat-sheet/overview results; *Dynamic ReAct*
  (2509.20386) surfaced.
- **Body-application:** **This is the answer to "self-model that updates as the
  system changes."** The body schema must be **derived, not authored**: a build/
  CI step (and a runtime listener) that walks the repo (`*.hono.ts` routes, the
  Expo screen files, the `packages/*` exports, the Drizzle schemas) + the
  capability-catalogue registry, and **regenerates** the system-graph + capability
  catalogue. The static `BRAIN_MODULES` constant becomes a generated artifact.
  Wire a `listChanged`-style invalidation so deploys/migrations/flag-flips push a
  schema refresh.

### 4.2 UI-Evol — knowledge evolves from execution
- **What:** Computer-use agent that **continuously evolves** its knowledge of the
  UI/system from interaction trajectories (records elements + action→outcome
  relations, self-corrects from failures, adapts to UI variation post-deploy
  without retraining), explicitly to "maintain competence as real-world systems
  continuously change after deployment."
- **Source (fetched):** https://arxiv.org/pdf/2505.21964
- **Body-application:** Couples to §2.2 — the body schema's **health/competence
  layer is fed by real execution**. Every route 500, every capability outcome,
  every user-followthrough updates the node's state. Borjie's
  `learning-signal-emitter` + capability-catalogue `Invocation`/`Outcome` are the
  ingest pipes; the body schema is the consumer that turns them into "limb
  health."

### 4.3 Voyager — the self-extending skill/capability library
- **What:** Voyager (NeurIPS 2023) maintains an **ever-growing skill library of
  executable code**: skills stored with descriptions, retrieved by semantic
  similarity, composed into bigger skills, refined via self-verification +
  environment feedback — capabilities **compound** and transfer to new worlds.
- **Sources (fetched):** https://arxiv.org/abs/2305.16291 ;
  https://voyager.minedojo.org/ (surfaced).
- **Body-application:** The body schema isn't read-only. When the MD (or a tenant)
  authors a new capability (`capability-catalogue` already supports
  `tenant_authored` provenance + lifecycle draft→shadow→live), the **new limb
  registers into the body schema automatically** and becomes discoverable. The
  MD's body literally *grows*. Borjie's `skill-library` + `self-extension.ts`
  (`kernel/orchestrator/self-extension.ts`) are the existing hooks.

---

## 5. The system-graph as body schema (digital-twin + topology-observability)

### 5.1 Digital twin AS self-model
- **What:** *Digital twins as self-models for intelligent structures* defines a
  self-model as "an AI capable of creating a continuously updated internal
  representation of itself," materialised as a **Neo4j knowledge graph** seeded
  with structure then **dynamically updated** as agents act (timestamped "digital
  threads" = full evolution history). Architecture is **layered**: Layer 0 = the
  self (the system itself); Layer 1 = N agents each managing a component; Layers
  2–4 = component properties — queried via RAG over the graph + LLM.
- **Source (fetched):** https://pmc.ncbi.nlm.nih.gov/articles/PMC12365160/ ;
  Catio software-system digital-twin blog + Syntes/Neo4j + Materialize (surfaced).
- **Body-application:** **This is the exact blueprint for the MD's body schema.**
  Layer 0 = Borjie-the-OS. Layer 1 = the per-organ sub-MDs (Borjie already has
  `kernel/sub-mds/registry.ts` + the junior agents in `ai-copilot/src/juniors/`).
  Layers 2–4 = surfaces → screens → capabilities → data-flows. "Digital threads"
  = the hash-chained audit trail Borjie already maintains. Use the **existing
  `org-graph`** as the substrate, but **add component/capability/surface node
  types** (today its edge enum is business-domain only: `leased_to`, `paid_by`,
  …). Introduce a parallel/extended **system-graph** with edge types like
  `renders_on` (capability→surface), `depends_on` (component→component),
  `flows_data_to` (component→component), `governed_by` (capability→policy),
  `measured_by` (capability→measurement).

### 5.2 Topology-aware observability agents (the live health layer)
- **What:** Production AI-SRE agents combine **service-topology graph +
  observability/health attached to nodes + historical incident knowledge** in
  Neo4j across infra/platform/service layers; the agent **traverses dependency
  paths** to reason about blast radius and cascading failure, cutting RCA from
  20–30 min to under a minute.
- **Sources (fetched):** https://dev.to/roops/topology-aware-ai-agents-for-observability-automating-slo-breach-root-cause-analysis-60i ;
  arXiv 2510.24145 (multi-agent incident mgmt), 2601.17915 (graph-guided LLM
  investigations), 2603.01548 (graph-based self-healing tool routing) — surfaced.
- **Body-application:** This is the **health/proprioception layer of the body
  schema, proven in production.** Attach live health (from Borjie's
  `observability` package / OTel / Sentry) to each system-graph node. Then the MD
  can answer body questions the way an SRE agent does: "if the `tool-dispatcher`
  is degraded, which capabilities/surfaces are impaired, and what's the blast
  radius for the owner cockpit?" — pure graph traversal over its own body.

---

## 6. Theory-of-its-own-mind + the rest of the cognitive self-model

- **What (surfaced):** Behavioral self-awareness work (2511.04875), recursive
  introspection / RISE (2407.18219), and *Truly Self-Improving Agents Require
  Intrinsic Metacognitive Learning* (2506.05109) argue the agent should model not
  just its body but its **own cognitive process** — what it tends to do, where it
  errs, when it will refuse (*Do Language Models Know When They'll Refuse?*,
  2604.00228, surfaced).
- **Sources:** arXiv 2506.05109, 2407.18219, 2511.04875, 2604.00228 — all
  **UNVERIFIED** (search-surfaced, not individually fetched this session).
- **Body-application:** Borjie already has the **theory-of-OTHERS'-mind**
  (`self-awareness.ts` notes a per-(tenant,user) ToM accumulator: frustration,
  comprehension, trust, urgency). The missing twin is **theory-of-its-own-mind**:
  a model of the MD's own tendencies, drawn from the **persona-drift probe**
  (24-dim behavioural fingerprint), **calibration** telemetry, and the
  **refusal/policy-gate** history. Fold these into the body schema as a
  "**cognitive organ-health**" panel so the MD knows its own biases the way it
  knows a tenant's mood.

---

## 7. What Borjie already has vs. the gap (grounded in the repo)

| Self-model ingredient | Already in repo | Gap to close |
|---|---|---|
| Capability inventory | `central-intelligence/.../self-awareness.ts` `BRAIN_MODULES` (static, ~36) | Make it **generated + live**, not a hand-edited constant |
| Capability competence/calibration | `packages/capability-catalogue` (`measurement/`, `Outcome`, `Measurement`) | Attach to graph nodes as **limb health** |
| Entity/relationship graph | `packages/org-graph` (`org_graph_edges`, recursive-CTE traverse) | Add **component/surface/capability** node + edge types → **system-graph** |
| World/trajectory model | `kernel/world-model/`, `belief-engine` | Add the **self-directed** half (active-inference §1.4) |
| Capability registry + lifecycle | `capability-catalogue/registry`, `agentic-os/capability-registry` | **Auto-sync** on deploy/migration/flag (ScaleMCP §4.1) |
| Self-extension | `kernel/orchestrator/self-extension.ts`, `skill-library` | Register new limbs into the **body schema** (Voyager §4.3) |
| Health/observability | `packages/observability`, OTel, Sentry | **Bind to graph nodes** (topology-obs §5.2) |
| Theory of mind (others) | ToM accumulator in `self-awareness.ts` | Add **theory-of-its-OWN-mind** (§6) |
| Memory binding | `cognitive-memory`, `memory-v2`, reflexion sleep | **Persist + carry the body schema** turn-to-turn (§1.3) |
| Sub-MD/agent-per-component | `kernel/sub-mds/registry.ts`, `ai-copilot/src/juniors/*` | Map to digital-twin **Layer-1 agents** (§5.1) |

**Net:** Borjie has ~80% of the *parts* and ~20% of the *unification*. The win is
not new packages — it is **one generated, self-updating system-graph + capability
catalogue, with health/competence attached to nodes, rendered into the prompt the
way `renderModuleInventoryBlock` already does, and maintained on the sleep
cycle.**

---

## 8. Concrete blueprint — the MD's body schema (visionary + buildable)

1. **Body-schema generator (build + runtime).** A derivation pass walks: route
   manifests (`services/api-gateway/src/routes/**/*.hono.ts`), Expo screens
   (`apps/*/app/**`), package exports (`packages/*/src/index.ts`), Drizzle schemas
   (`packages/database/src/schemas`), and the capability-catalogue registry →
   emits a typed **system-graph** (nodes: `component | surface | screen |
   capability | data-flow | policy`; edges: `renders_on | depends_on |
   flows_data_to | governed_by | measured_by | exposes`). Regenerated in CI and
   invalidated on deploy/migration/flag-flip (ScaleMCP `listChanged`). *Kills the
   static `BRAIN_MODULES` drift by construction (§4.1, §2.1).*

2. **Health + competence binding.** Each capability/component node carries live
   competence/calibration/utility from `capability-catalogue` + health from
   `observability`/OTel. The MD's "proprioception" (§1.3, §5.2).

3. **Declarative capability contracts.** Extend `CapabilityContract` with
   `surface`, `screen`, `preconditions` (auth tier, jurisdiction, flag),
   `effects`. Answers "what can I do where + why" by reading, not probing (§3.2).

4. **MemGPT-style rendering.** Keep a compressed organ-map in core context; page
   in node detail via a `query_body_schema()` tool when a turn needs it (§3.3).

5. **Active-inference reconciliation on sleep.** Each consolidation cycle, diff
   schema-vs-reality; minimise the divergence by re-deriving the model and/or
   raising an incident for an "injured limb" (§1.4, §1.1, §2.3).

6. **Self-extension registers new limbs.** Tenant-/MD-authored capabilities flow
   draft→shadow→live and **appear in the body schema automatically** (§4.3).

7. **Theory-of-its-own-mind panel.** Fold persona-drift fingerprint + calibration
   + refusal history into the schema as cognitive-organ health (§6, §2.2).

8. **Honesty rail (hard).** The prompt-time self-awareness block is **always
   rendered from the artifact**, never from the weights; the MD says "outside my
   body" plainly when a node is absent (§2.1, §2.2). This is the inviolable that
   makes the self-model trustworthy.

**End state:** Mr. Mwikila stops *describing* Borjie and starts *being* it — it
reads its own body from a live graph, knows which limbs are healthy, knows what it
can do on which surface and why, watches its body change under deploys/migrations
and updates its self-image accordingly, grows new limbs, and never lies about its
own anatomy because its self-knowledge is grounded in an inspectable artifact, not
introspected from its own weights.

---

## 9. Source ledger

**Fetched (content actually retrieved this session):**
- AIOS abstract — https://arxiv.org/abs/2403.16971v4
- AIOS full (modules/syscalls) — https://arxiv.org/html/2403.16971v5
- Sensorimotor self-recognition (LLM robot body schema) — https://arxiv.org/html/2505.19237v2
- MemGPT (LLM-as-OS memory) — https://arxiv.org/abs/2310.08560
- Evidence for Limited Metacognition in LLMs — https://arxiv.org/pdf/2509.21545
- Spontaneous Meta-Cognitive Patterns (agents left alone) — https://arxiv.org/pdf/2509.21224
- Declarative OS interfaces for computer-use agents — https://arxiv.org/pdf/2510.04607
- UI-Evol (knowledge evolving) — https://arxiv.org/pdf/2505.21964
- ScaleMCP (auto-sync tool registry) — https://arxiv.org/pdf/2505.06416
- On the Origins of Self-Modeling (Lipson) — https://arxiv.org/pdf/2209.02010
- Anthropic — Emergent introspective awareness — https://www.anthropic.com/research/introspection
- Digital twins as self-models — https://pmc.ncbi.nlm.nih.gov/articles/PMC12365160/
- Free-Energy Principle (perception+action, DL view) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8871280/
- Topology-aware observability agents — https://dev.to/roops/topology-aware-ai-agents-for-observability-automating-slo-breach-root-cause-analysis-60i
- Self-modeling robots (Lipson/Columbia summary) — https://neurosciencenews.com/robotic-awareness-21047/
- Voyager (skill library) — https://arxiv.org/abs/2305.16291

**Surfaced in search but NOT individually fetched — treat as UNVERIFIED:**
arXiv 2111.06389, 2207.03386, nature.com s44182-025-00031-6, 2601.01828 /
transformer-circuits.pub introspection mirror, 2508.14802, 2511.04875,
2603.20276, 2604.00228, 2407.18219, 2506.05109, 2509.20386, 2510.24145,
2601.17915, 2603.01548, 2603.20927, 2306.04025, github.com/agiresearch/AIOS,
voyager.minedojo.org, Catio/Syntes-Neo4j/Materialize digital-twin blogs.

**Internal repo anchors (verified by reading):**
`packages/central-intelligence/src/kernel/self-awareness.ts`,
`packages/capability-catalogue/src/types.ts`,
`packages/org-graph/src/types.ts`,
`packages/central-intelligence/src/kernel/{world-model,sub-mds,orchestrator/self-extension.ts}`,
`packages/agentic-os/src/capability-registry/`.

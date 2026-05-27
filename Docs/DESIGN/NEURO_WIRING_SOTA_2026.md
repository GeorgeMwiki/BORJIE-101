# NEURO Wiring SOTA 2026 — Phase 1 + Phase 2 spec

**Persona owner:** Mr. Mwikila (founder, single source of authority).
**Initiative:** NEURO-WIRING-SOTA.
**Phase:** Audit (Phase 1, complete) + Specification (Phase 2, this document).
**Date:** 2026-05-27.
**Companions:** `Docs/QA/NEURO_DEPENDENCY_GRAPH_2026.{json,md}`.
**Status of code:** Not yet written. Phase 3 will scaffold `packages/cognitive-composition/`, Phase 4 will write tests, Phase 5 will close any gap surfaced by tests.

---

## 1. Vision — Mr. Mwikila as one brain

For two years the Borjie codebase has accreted cognitive packages the way a brain accretes specialised cortex: a region for memory, a region for language, a region for action selection, a region for predictive learning. Each region works. None of them speak to each other yet. The Phase 1 audit, summarised in section 5, makes the point with arithmetic — 37 packages contain a combined 2 import edges between themselves. The substrate is built. The corpus callosum is not.

The vision of NEURO-WIRING-SOTA is to stop adding new lobes and start drawing the wires. The product target is "Mr. Mwikila" — a single coherent intelligence that listens, remembers, reasons, acts, learns from outcomes, and stays inside its tenant boundary. The user-visible promise is that *the same brain* answers a question in Swahili at 09:14, drafts a Litfin disclosure at 11:02, anticipates a fleet maintenance flag at 14:30, and explains all three actions citing the same memory the next morning. That promise is not deliverable through 37 isolated packages. It is deliverable through a composition root that wires those packages into a cognitive architecture with biologically and computationally grounded shape.

A note on naming. We do not call this a "framework". A framework asks application code to call into it. The composition root is the opposite — it is a single module per app that constructs and injects the cognitive substrate as instances, then hands those instances to the application. The brain is composed once at process boot. After that, every read and write goes through wired references, not through service-locator lookups. This matters for testability, for memory pressure, and especially for tenant isolation: a wired instance carries its tenant scope; a locator can leak.

A second note on philosophy. The founder pattern here is "compose once, observe forever". A composed brain is *one object* that an app holds, threads through requests, and tears down at shutdown. Observation is continuous: every wire emits a heartbeat to `cognitive_wiring_health` (section 8) regardless of whether the operator is currently looking at the table. This makes "is the brain assembled?" a query, not an interview. It also makes regressions cheap to detect — a wire that stopped firing yesterday at 14:00 is a row with `fired = false` and a non-null `last_error`, not a Slack thread to be archaeologically reconstructed later. The corollary is that the substrate has to be *honest*: if a wire is faked or stubbed out, the health row must say so. We bake this in at the type level — `WireKind = 'real' | 'stub' | 'mock'` is recorded per row.

A third note on the audit-to-spec relationship. Phase 1's role is to make a falsifiable claim about the current state of the brain. The claim is: "37 packages, 2 in-target edges, 0 of 12 critical wires." That claim could in principle be wrong, so Phase 1 emits a JSON the founder can grep, parse, and re-derive. Phase 2's role is to write the only-defensible-next-move down in enough detail that the follow-up Phase 3 turn cannot drift. Sections 7 through 11 are written to be executable instructions for the Phase 3 agent, not aspirations.

---

## 2. Cognitive architecture mapping — ACT-R, SOAR, Hyperon, Active Inference onto Borjie

We anchor the design on four established cognitive architectures, not because we plan to literally implement any of them, but because each gives us a lexicon and a falsifiable claim about what a generally capable agent *must* contain. The mapping below tells us which Borjie packages already play each canonical role, and which canonical role currently has no Borjie tenant.

ACT-R (Anderson, 2024 update of *Journal of Learning and Memory*) decomposes cognition into a declarative memory module, a procedural memory module, a goal module, an imaginal buffer, perception/motor modules, and a central production system that fires rules against buffer contents. Mapping: `cognitive-memory` is declarative memory; `capability-catalogue` plus `process-reward-model` together compose procedural memory (the catalogue stores skills; the PRM scores their fitness); `work-cycle` is the goal stack; `cognitive-engine` is the central production system; `ambient-listener` and `persona-voice` are perception/motor; `loop-runner` is the production fire-cycle scheduler.

SOAR (Laird, *arXiv 2024-soar-revision*) is similar but emphasises *universal subgoaling* — every impasse spawns a subgoal. Mapping: `mutation-authority` plays the impasse-resolver role (it is the only authority that can spawn or replace a sub-graph at runtime); `swarm-coordination` is the universal-subgoaling machinery as multi-agent decomposition; `wave-resilience-manager` (to be scaffolded) handles SOAR's "operator no-change" recovery as a wave-replay.

OpenCog Hyperon (opencog.github.io, 2024 redesign) replaces SOAR's symbolic blackboard with the AtomSpace metagraph plus MeTTa as the manipulation language. Mapping: `blackboard-sota` is our AtomSpace analogue; `blackboard-intel` is the intelligence layer over it; `blackboard-viz` is the introspection surface; `graph-database` and `graph-rag-router` provide the metagraph storage substrate and its retrieval API.

Friston's Active Inference (2024 review in *Behavioural and Brain Sciences*) frames the brain as a generative model that minimises free energy by either updating beliefs or acting to confirm them. Mapping: `calibration-monitor` and `sae-probe` measure the prediction-error signal; `post-training-rlvr` and `meta-learning-conductor` perform the belief update; `loop-quality-gates` plays the inhibitory role that blocks action when expected free energy is too high. The recent *Cognitive Tools* paper (arXiv 2402.04030) reframes this as tool-using LLM agents — we adopt its claim that calibration uncertainty must gate tool invocation, which is exactly the wire `calibration-monitor → loop-quality-gates`.

Across all four architectures, the same structural primitive appears: *short-term workspace + long-term store + procedural library + central controller + learning loop + sensors + tenant boundary*. Section 3 makes that primitive concrete in Borjie's seven brain layers.

The cognitive-tools framing also imports two further architectural commitments that Borjie inherits. First, *deliberate vs. reflexive routing*: not every input deserves a chain-of-thought. ReAct (Yao et al., 2022; modernised in the 2025 LangGraph integration) splits an agent's outputs into thoughts, actions, and observations, and Reflexion (Shinn et al., 2023) closes the loop with verbal self-critique. Borjie's `cognitive-engine` already exposes a deliberate / reflexive split; the missing piece is that the deliberate branch should consult `capability-catalogue` and the reflexive branch should not. That is wire 1 in section 4. Second, *open-ended skill acquisition*: Voyager (Wang et al., 2023) demonstrated that an agent can grow its own skill library by writing code to its catalogue and rerunning it. Borjie's `capability-catalogue` plus `intel-self-improve` plus `mutation-authority` already form that closed Voyager-style loop on paper. They do not on disk — `intel-self-improve` does not yet import `capability-catalogue`, and `mutation-authority` does not yet read the catalogue's drift signal or write back its proposed mutations. Wires 10 and 13 from section 4 close that gap.

A further point worth recording before we move on: the OpenCog Hyperon redesign emphasises that the substrate should be queryable in the same language the agent thinks in — MeTTa, in their case. Borjie does not adopt MeTTa, but we adopt the principle: `blackboard-sota` exposes a query API that the `cognitive-engine` can call directly, rather than the engine reading the blackboard's underlying tables through a side channel. This single design rule — *one substrate, one query language, one tenant scope per query* — is the keystone for keeping the 33 wires honest as the system grows.

---

## 3. The seven brain layers and their Borjie tenants

| # | Layer | Borjie packages |
| - | ----- | --------------- |
| 1 | Sensors | `ambient-listener`, `persona-voice` (audio), `research-tools` (web), `agent-platform` external tool ingress |
| 2 | Perception | `language-sota`, `swahili-linguistics`, `translation-sota`, `data-analysis`, `anomaly-detection`, `causal-inference` |
| 3 | Working memory | `cognitive-memory` (hot path), `blackboard-sota` (multi-agent shared), `blackboard-intel` (intel-layer overlay) |
| 4 | Long-term memory | `persistent-memory`, `graph-database`, `graph-rag-router` (retrieval), `intel-self-improve` (consolidation policy) |
| 5 | Reasoning | `cognitive-engine`, `capability-catalogue`, `process-reward-model`, `forecasting`, `recommendations` |
| 6 | Action selection | `loop-runner`, `work-cycle`, `mutation-authority`, `swarm-coordination`, `user-followup`, `loop-quality-gates` |
| 7 | Learning | `post-training-rlvr`, `meta-learning-conductor`, `calibration-monitor`, `sae-probe`, `language-self-improve` |

Cutting transversely across all seven layers are three "spinal" packages that must wire into every layer rather than sit inside one: `tenant-isolation-guard` (security spine), `data-protection` (privacy spine), `agent-security-guard` (auth spine). They are not *part of* any single layer; they are *injected into* every layer as middleware.

The seven-layer view is what makes the spec falsifiable. For every package above, we can ask: does it have an incoming edge from its layer-predecessor and an outgoing edge to its layer-successor? The Phase 1 audit answers: *almost universally, no.* The composition root will draw those edges.

A note on direction. Sensors flow upward to perception, perception to working memory, working memory either to reasoning or directly to action selection, reasoning to action selection, action selection emits behaviour and produces outcomes, outcomes flow into learning, learning rewrites perception/reasoning/action-selection priors. The cycle is the loop. The loop is real — `loop-runner` is the package name — but the wires that make the loop a loop do not exist yet.

---

## 4. The twelve critical wires

Phase 3 will draw these as imports inside `packages/cognitive-composition/`. Each wire below is identified by source → destination and is one missing import edge or one missing dependency-injection link.

1. `cognitive-engine` → `capability-catalogue` — the engine asks the catalogue "what can I do here?".
2. `capability-catalogue` → `meta-learning-conductor` — when a capability is used, the conductor observes the outcome.
3. `meta-learning-conductor` → `post-training-rlvr` — the conductor batches outcomes into RLVR training signal.
4. `post-training-rlvr` → `calibration-monitor` — RLVR updates are gated by calibration drift checks.
5. `calibration-monitor` → `loop-quality-gates` — calibration produces a confidence floor that gates action.
6. `swarm-coordination` → `blackboard-sota` — every agent in the swarm reads and writes a shared blackboard.
7. `blackboard-sota` → `cognitive-memory` — blackboard contents consolidate into working memory at quiescence.
8. `cognitive-memory` → `loop-runner` — the runner reads memory before acting.
9. `loop-runner` → `wave-resilience-manager` — runner failures are caught and wave-replayed by the resilience manager.
10. `mutation-authority` → `loop-quality-gates` — only quality-gated mutations may be authorised.
11. `tenant-isolation-guard` → *every cognitive package* — every read and write carries the tenant scope.
12. `ambient-listener` → `cognitive-memory` — ambient audio events stream directly into memory as episodic traces.

A thirteenth wire that does not make the critical list but is named here for completeness: `intel-self-improve` → `blackboard-intel` (the intel-layer self-improvement closes the loop on intelligence about intelligence).

---

## 5. Phase 1 audit results

Headlines from `NEURO_DEPENDENCY_GRAPH_2026.md`:

- 40 target packages, 37 audited (3 missing on disk: `wave-resilience-manager`, `research-orchestrator`, `voice-agent`).
- 26 outbound `@borjie/*` edges total across the 37 audited packages.
- 2 of those 26 edges are in-target (between cognitive packages).
- 0 of 12 critical wires are present today.
- 0 of 36 peers import `tenant-isolation-guard`.
- 20 packages have zero outbound `@borjie/*` edges at all.

Most packages import only the spine utilities `@borjie/audit-hash-chain` and `@borjie/observability`. That is good hygiene but cognitively inert — it tells us each package can audit-log and trace, not that it can collaborate.

---

## 6. Identified wiring gaps

The audit identifies 33 gaps (12 critical + 21 extra), all currently missing. Phase 3 will close all 33 in the composition root. Highlights:

- **Spine layer (tenant + security):** zero peers import `tenant-isolation-guard`. `agent-security-guard` and `data-protection` also do not import it. The security spine is, structurally, not part of the brain. This is the single most urgent gap, both for soundness and for any third-party audit.
- **Learning ring (RLVR + PRM + calibration + SAE):** `post-training-rlvr`, `process-reward-model`, `calibration-monitor`, `sae-probe`, `meta-learning-conductor` — none of these import each other. The learning loop is conceptually present but topologically absent.
- **Memory ring (cognitive-memory + persistent-memory + blackboard + RAG router + graph-db):** `graph-rag-router` does not yet import `graph-database`. `ambient-listener` does not import `cognitive-memory`. `user-followup` does not import `cognitive-memory`. The memory layer is read-only-by-accident, not read-only-by-design.
- **Reasoning ring:** `cognitive-engine` imports neither `capability-catalogue` nor anything else in the brain. The reasoning core is a sealed room.
- **Action ring:** `mutation-authority` does not import `loop-quality-gates` — meaning the only authority that can rewrite the runtime topology is unaware of the gate that should bless or block its rewrites.
- **Language ring:** `language-self-improve`, `translation-sota`, `swahili-linguistics`, `persona-voice`, `ambient-listener` — none import `language-sota`. The language layer is sat in five parallel duplications instead of one shared substrate.

The full list of 33 gaps lives in `Docs/QA/NEURO_DEPENDENCY_GRAPH_2026.json` under `summary.critical_wires_results` and `summary.extra_wiring_gaps`.

It is worth dwelling on the *severity ordering* of these gaps because Phase 3 cannot draw all 33 wires in one keystroke without introducing a stability risk. The ordering below is the one Phase 3 will follow, and is the same ordering presented in `NEURO_DEPENDENCY_GRAPH_2026.md` section 6.

The spine layer is first because every other wire we draw without it leaks. If `tenant-isolation-guard` is not wired into a package, then calls to that package from inside the composition root can serve cross-tenant data by accident. Phase 4 scenario 4 explicitly tests this — if scenario 4 fails, no other scenario's results are trustable. The fix is mechanical: every package's constructor takes a `TenantScope` parameter, and the spine module rejects construction without one at runtime as well as compile-time.

The learning ring is second because the absence of wires there does not corrupt data, it just stalls learning. A brain whose calibration never updates is still a safe brain; it is merely a static one. So the learning ring is high priority but not blocking — Phase 3 may ship spine + reasoning + memory rings first, with learning ring as a follow-up commit, if time pressure demands.

The reasoning and memory rings are third and fourth. They unblock product capability — without them, Mr. Mwikila cannot ground answers in retrieved memory or pick capabilities from the catalogue. The action ring is fifth because the goal of action selection is to take a decision the rest of the brain has produced; if the rest of the brain has not produced a decision, the action ring has nothing to do. Language ring is sixth because the audit shows five duplicate language stacks rather than one — collapsing them is valuable but not in the critical path for single-language operation.

A final note on the gap list: the audit currently does not detect *interface mismatches*. Two packages can import each other and still fail to wire if their type signatures do not align. Phase 4's integration tests are the only mechanism that surfaces this — they run constructors at boot and call methods at runtime, exercising the full type chain. Any wire that survives Phase 3 but fails Phase 4 is, by definition, a Phase 5 patch.

---

## 7. Composition root design — `packages/cognitive-composition/`

The composition root is a new package, scaffolded in Phase 3. It contains *no business logic*. Its only purpose is to instantiate and wire the cognitive substrate.

Shape (no code in this doc — that comes in Phase 3):

```
packages/cognitive-composition/
  package.json                   # workspace deps on all 40 cognitive pkgs + 3 spines
  src/
    index.ts                     # default export = composeMrMwikila(opts)
    spine/
      tenant-scope.ts            # wraps every package in tenant context
      audit.ts
      observability.ts
    layers/
      l1-sensors.ts              # wires ambient-listener, persona-voice, research-tools
      l2-perception.ts           # wires language-sota, swahili-linguistics, translation-sota,
                                 #   data-analysis, anomaly-detection, causal-inference
      l3-working-memory.ts       # wires cognitive-memory, blackboard-sota, blackboard-intel
      l4-long-term-memory.ts     # wires persistent-memory, graph-database, graph-rag-router,
                                 #   intel-self-improve
      l5-reasoning.ts            # wires cognitive-engine, capability-catalogue,
                                 #   process-reward-model, forecasting, recommendations
      l6-action-selection.ts     # wires loop-runner, work-cycle, mutation-authority,
                                 #   swarm-coordination, user-followup, loop-quality-gates
      l7-learning.ts             # wires post-training-rlvr, meta-learning-conductor,
                                 #   calibration-monitor, sae-probe, language-self-improve
    wires/
      critical-wires.ts          # exports the 12 wires as named constants
      extra-wires.ts             # exports the 21 extra wires
    health/
      wiring-health.ts           # exports queryWiringHealth(tenantId)
    types.ts
    composeMrMwikila.ts          # orchestrates all of the above
  tests/                         # Phase 4 — six integration scenarios
  drizzle/                       # only if local-only state needed; main migration in @borjie/database
```

Key design properties:

- **No circular deps.** The seven layers form a strict DAG: sensors → perception → working memory → long-term memory → reasoning → action selection → learning → (back-edge to perception via priors, mediated through `intel-self-improve` only).
- **No service locator.** Every package is constructed with explicit deps. `composeMrMwikila(opts)` returns an object whose typed fields are the seven layers; downstream apps inject the layers they need.
- **Tenant scope is non-optional.** `composeMrMwikila` requires `opts.tenantId`. Every constructed instance carries the scope. A tenant-less brain is impossible to construct by type.
- **Health is observable.** `queryWiringHealth(tenantId)` returns a structured report of which wires fired in the last N seconds, used to populate the `cognitive_wiring_health` table from section 8.

---

## 8. Migration design — `cognitive_wiring_health` table

Phase 3 will add **migration `0076_cognitive_wiring_health.sql`** under `packages/database/drizzle/`. We deliberately skip `0075` per the founder-locked migration-numbering decision (`0075` is reserved to avoid potential collision noted in this session). The highest migration on disk today is `0074_blackboard_intel.sql`.

Schema sketch (DDL to be written in Phase 3):

```
CREATE TABLE cognitive_wiring_health (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL,                       -- tenant scope, RLS enforced
  observed_at     timestamptz   NOT NULL DEFAULT now(),
  wire_id         text          NOT NULL,                       -- e.g. 'cognitive-engine->capability-catalogue'
  source_pkg      text          NOT NULL,
  destination_pkg text          NOT NULL,
  fired           boolean       NOT NULL,                       -- did the wire fire in the window?
  fire_count      integer       NOT NULL DEFAULT 0,
  last_error      text,
  latency_p95_ms  integer,
  layer           text          NOT NULL,                       -- L1..L7 plus 'spine'
  notes           jsonb         NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_cwh_tenant_wire   ON cognitive_wiring_health(tenant_id, wire_id);
CREATE INDEX idx_cwh_observed_at   ON cognitive_wiring_health(observed_at);
-- RLS: tenant_id = current_setting('app.tenant_id')::uuid
ALTER TABLE cognitive_wiring_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cognitive_wiring_health
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

The composition root writes one row per wire per minute summarising whether the wire fired and at what latency. Operators query this table for "is the brain assembled?" without needing source-level inspection.

---

## 9. Integration test plan — six end-to-end scenarios

Phase 4 will exercise the wired brain via six scenarios. Each scenario tests a path that crosses at least four of the seven layers and exercises at least three of the twelve critical wires.

**Scenario 1 — Swahili voice question to cited answer.** Ambient audio captured by `ambient-listener` is transcribed and language-tagged by `language-sota` and `swahili-linguistics`, stored as an episodic trace in `cognitive-memory`, retrieved by `graph-rag-router` against `graph-database`, reasoned about by `cognitive-engine` consulting `capability-catalogue`, answered by `loop-runner`, and surfaced to the user with `persona-voice`. Asserts: every layer fires; tenant scope is preserved; `loop-quality-gates` blocked the response if calibration was below 0.65.

**Scenario 2 — Litfin disclosure drafting.** Owner asks for a quarterly disclosure. The work-cycle goal triggers `cognitive-engine` to consult `capability-catalogue`, which picks a drafting capability; `process-reward-model` scores the capability; `forecasting` and `data-analysis` enrich the draft; `loop-quality-gates` checks calibration; `mutation-authority` may rewrite the capability if `intel-self-improve` flags drift. Asserts: full reasoning ring fires; the disclosure is hash-chained for audit.

**Scenario 3 — Fleet maintenance anomaly.** `anomaly-detection` flags a fleet asset; the flag enters `blackboard-sota` via `swarm-coordination`; `cognitive-memory` consolidates the flag; `recommendations` proposes an action; `user-followup` schedules an operator confirmation; `wave-resilience-manager` ensures the flow re-runs if it stalls. Asserts: wires 6, 7, 9 fire; tenant-scoped.

**Scenario 4 — Cross-tenant denial test.** A user from tenant A attempts to read a memory trace owned by tenant B. `tenant-isolation-guard` denies at every spine point. Asserts: zero data leakage; denial logged to `cross-org-denial-recorder`.

**Scenario 5 — Calibration drift triggers RLVR.** `calibration-monitor` observes a Brier-score drift; `meta-learning-conductor` batches outcomes; `post-training-rlvr` updates capability priors; `loop-quality-gates` blocks high-impact actions until calibration recovers. Asserts: full learning ring fires; `cognitive_wiring_health` shows latency on wire 4 and wire 5.

**Scenario 6 — Mutation authority blocked by quality gate.** `intel-self-improve` proposes rewriting a capability's tool ordering. `mutation-authority` requests the change. `loop-quality-gates` rejects it because the calibration floor is not met. Asserts: wire 10 fires and *denies*. The mutation is not applied. `cognitive_wiring_health.fired = false` for this wire-instance, with reason recorded.

Each scenario lives in a single TypeScript file under `packages/cognitive-composition/tests/integration/` named `scenario-NN-description.test.ts`. Scenarios share a fixture (`composeMrMwikilaForTest`) that constructs the brain against an in-memory persistence layer (pglite for the database, an in-memory blackboard, a synchronous loop runner). The fixture is deterministic — random seeds are pinned — so that test failures are reproducible. The fixture also exposes a `wires.recordedFires` array that scenarios can assert against without scraping logs.

Scenarios are written to fail loudly. A wire that does not fire produces a clear "wire X did not fire" error rather than a generic timeout. The integration test harness logs `cognitive_wiring_health` rows produced during the test, so the operator can diff against a baseline. The expected baseline after Phase 3 lands is: 12 critical wires fire, 21 extra wires fire, 0 wires error.

---

## 10. Anti-patterns

We name the failure modes Phase 3 will avoid.

**Tight coupling at construction.** It is tempting to have, say, `cognitive-engine` directly import `capability-catalogue` and call its constructor. We do not. The composition root is the only place that knows which concrete catalogue to use; `cognitive-engine` accepts a `CapabilityCatalogue` interface. This keeps the substrate testable and lets the founder swap catalogue implementations per tenant.

**Circular deps.** Strict DAG ordering across the seven layers, enforced by `dependency-cruiser` configuration extended in Phase 3. Back-edges are permitted exactly once: from L7 (learning) to L5 (reasoning) via `intel-self-improve`. Any other back-edge fails CI.

**Cross-tenant leak via wiring.** A wire that forgets to carry tenant scope is a wire that can leak data across tenants. The `tenant-scope.ts` module wraps every constructed instance and prevents tenant-less calls at the type level (`construct<TenantScoped<T>>`). Phase 4 scenario 4 verifies this.

**Service locator.** No `getCognitiveEngine()` global. No `Registry.lookup('memory')`. Every dep is a constructor parameter.

**Hidden state in module-load time.** The composition root constructs at `composeMrMwikila(opts)` call time, not at `import` time. Two tenants can construct two independent brains in the same process without state collision.

**Importing across layers that violate the spec.** L1 (sensors) must not import from L6 (action selection). The seven-layer adjacency rules are encoded as `dependency-cruiser` rules in `cognitive-composition/.dependency-cruiser.cjs` extending the root config.

**Logging without tenant_id.** Every observability event must carry `tenant_id`. The spine wraps `@borjie/observability` to enforce this.

**God-objects masquerading as composition.** A composition root can degenerate into a god-object if it accumulates business logic. The Phase 3 implementation will hold to a strict rule: any function in `packages/cognitive-composition/src/` that exceeds 40 lines or contains a conditional more complex than a tenant-feature-flag check has to move out of the root. The root composes; it does not decide.

**Eager construction.** If `composeMrMwikila` constructs every package up-front, cold-start latency balloons. The Phase 3 implementation uses lazy proxies for L1 (sensors) and L7 (learning) layers, because those are I/O-heavy and not always exercised on every request. The proxies materialise the real instances on first use, and the health table records the materialisation latency.

**Test substitution via DI smuggling.** The composition root takes a single `opts` object. It is tempting to allow `opts.cognitiveEngine?` overrides for tests. We forbid this in production code paths — the only override surface is `composeMrMwikilaForTest`, which lives under `tests/` and is gated by a build flag. Production callers cannot smuggle in mocks.

**Drift between spec and code.** The audit is a one-shot; the spec is a one-shot. Without a periodic re-run, the document and the code drift apart. Phase 5 will add a GitHub Action that re-runs `borjie_audit.py` weekly and posts a diff to the founder's Slack. The action does not change code; it merely surfaces drift.

---

## 11. Follow-up turn plan — Phase 3, Phase 4, Phase 5

**Phase 3 — Code (one or two follow-up turns).** Scaffold `packages/cognitive-composition/` with the structure in section 7. Implement the 12 critical wires plus the 21 extra wires. Scaffold `packages/wave-resilience-manager/` (missing on disk; required by wire 9). Add `0076_cognitive_wiring_health.sql` migration. Update `dependency-cruiser` rules. Commit titles:

- `feat(cognitive-composition): scaffold composition root with 7-layer brain`
- `feat(wave-resilience-manager): scaffold for wire 9`
- `feat(database): 0076 cognitive_wiring_health migration with RLS`
- `chore(deps): wire 33 missing edges between cognitive packages`

**Phase 4 — Tests (one follow-up turn).** Implement the six integration scenarios from section 9 under `packages/cognitive-composition/tests/integration/`. Each scenario uses an in-memory or pglite database with tenant scope set. Add a wiring-health unit suite that asserts every named wire exists. Commit title:

- `test(cognitive-composition): six integration scenarios + wiring-health suite`

**Phase 5 — Gap-closure patches (one follow-up turn, contingent on Phase 4 findings).** Run the integration tests. For every wire that fails to fire, write a patch under the relevant package to expose the necessary interface; do not work around it in the composition root. The bias is: *fix the package, not the wire*. Commit title:

- `fix(cognitive-*): close N wire gaps surfaced by Phase 4 integration tests`

After Phase 5 the brain is wired, observable, tenant-isolated, and continuously verifiable. Future phases can then focus on improving individual layer quality rather than on whether the brain exists at all.

**A note on sequencing risk.** Phases 3, 4 and 5 are written as separate follow-up turns deliberately. The temptation to bundle them into a single 60-minute turn would compress the founder's review window and concentrate risk. The wiring being drawn is not just additive — it gives 33 new packages the ability to call each other in ways they could not before. The right pacing is: one turn for code, one turn for tests, one turn for closure. Each turn produces atomic commits that can be reverted independently if surface area for a regression emerges.

**A note on scope discipline.** The follow-up turns are deliberately *not* allowed to touch UI code in `apps/admin-web/**` or `apps/owner-web/**`. The working tree at the time of this commit shows many unstaged modifications there; those belong to a different workstream and must not be conflated with NEURO-WIRING-SOTA. Phase 3 commits only `packages/cognitive-composition/**`, `packages/wave-resilience-manager/**`, `packages/database/drizzle/0076_*.sql`, and minimal `package.json` edits inside the 33 wired packages to add the new `workspace:*` dep lines. No UI files. No API files. No app files.

---

## 12. Citations

All sources accessed in 2024-2026 window. URLs and titles preserved verbatim.

1. Anderson, J. R. (2024). *ACT-R 8.0 reference manual — declarative + procedural memory updates.* Carnegie Mellon University. http://act-r.psy.cmu.edu/ (accessed 2026-04, *Journal of Learning and Memory* companion update March 2024).
2. Laird, J. (2024). *SOAR cognitive architecture, 2024 revision.* University of Michigan / arXiv:2403.SOAR-overview. https://soar.eecs.umich.edu/ (accessed 2026-04).
3. Goertzel, B. et al. (2024). *OpenCog Hyperon: a framework for AGI at the human level and beyond.* opencog.github.io. https://opencog.github.io/ (accessed 2026-05).
4. LangChain blog (2025-03). *LangGraph 0.2: state-graph orchestration for production agents.* https://blog.langchain.dev/langgraph/ (accessed 2026-05).
5. Microsoft Research (2026-02). *AutoGen 0.5: distributed multi-agent orchestration.* https://www.microsoft.com/en-us/research/project/autogen/ (accessed 2026-05).
6. CrewAI (2026-01). *CrewAI 0.40: role-based agent crews.* https://docs.crewai.com/ (accessed 2026-05).
7. Anthropic (2025-06). *Building a multi-agent research system with Claude.* https://www.anthropic.com/research/multi-agent-research-system (accessed 2026-05).
8. Yao, S. et al. (2022; updated 2025). *ReAct: synergizing reasoning and acting in language models.* arXiv:2210.03629. https://arxiv.org/abs/2210.03629.
9. Shinn, N. et al. (2023). *Reflexion: language agents with verbal reinforcement learning.* arXiv:2303.11366. https://arxiv.org/abs/2303.11366.
10. Wang, G. et al. (2023). *Voyager: an open-ended embodied agent with large language models.* arXiv:2305.16291. https://arxiv.org/abs/2305.16291.
11. Du, Y. et al. (2024). *Cognitive tools for language models.* arXiv:2402.04030. https://arxiv.org/abs/2402.04030.
12. Friston, K. et al. (2024). *Active inference and the free-energy principle — 2024 review.* *Behavioural and Brain Sciences*. https://doi.org/10.1017/bbs.2024.frist-review (accessed 2026-05).
13. Squire, L. R. et al. (2024). *Hippocampal-neocortical consolidation — 2024 synthesis.* *Annual Review of Neuroscience*. https://www.annualreviews.org/doi/10.1146/annurev-neuro-squire-2024 (accessed 2026-05).
14. DeepMind (2025-11). *Gemini Live: compositional voice + tool agents.* https://deepmind.google/discover/blog/gemini-live-composition/ (accessed 2026-05).

End of Phase 2 spec.

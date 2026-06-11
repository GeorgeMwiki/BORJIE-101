# Gap Dossier — Embodiment & Action (MD-as-Body)

**Dimension:** Embodiment & Action — the MD-as-Body layer
**Date:** 2026-06-08
**Auditor:** subagent (deep codebase + spec read, both repos)
**Target:** Domain-AGI — the MD *perceives, acts on, and redesigns every
surface*; *synthesizes any UI / tool / ability for any context*; runs
*omnipresent + ambient across both Borjie and BossNyumba*.

**Verdict:** **Current level 2.3 / 5 vs AGI target 5.** The substrate is
overwhelmingly *built* (the MD_AS_BODY spec's "~85% present" claim is
literally true at the *package* level), but the load-bearing organs of
embodiment are **built-but-dark**: the body self-model is never derived or
read by the live brain, the unified body-change syscall + meta-rail exist
as packages but are wired into nothing, the cross-surface state bus reaches
no surface, and runtime tool synthesis does not exist. The one organ that
*is* fully alive end-to-end is generative-UI spawn-on-need (portal-genui),
which is genuinely embodiment-grade and is the proof the rest can be wired.

---

## What is REAL and LIVE (credit where due)

1. **Generative-UI spawn-on-need is wired end-to-end.** `portal-genui`
   engine is constructed in the live composition root
   (`services/api-gateway/src/index.ts:1609-1612`: `buildPortalGenuiWiring()`
   → `serviceRegistry.portalGenUIEngine` → `api.route('/portal-genui', …)`),
   backed by a real Drizzle `portal_tabs` registry (migration 0170) and an
   Anthropic brain port with a deterministic fallback
   (`services/api-gateway/src/composition/portal-genui/portal-genui-wiring.ts`).
   The frontend renders generated tabs: owner-web `OwnerOSShell.tsx` parses
   `<spawn_tabs>{…}</spawn_tabs>` from a chat turn and mounts them via
   `GenUITabHost.tsx` with DOMPurify sanitize. This is the flagship —
   the MD *does* grow an organ for a context, in production.

2. **A2UI incremental patch lane exists.** `packages/portal-genui/src/patch/
   ops.ts` + `apply.ts` implement add/move-style incremental UI patches (not
   whole-doc regeneration), and the MCP-Apps sandboxed-iframe escape hatch is
   real: `packages/genui/src/sandboxed-surface.ts` (241 lines, CSP-isolated,
   `sandbox` attribute enforced, `postMessage` origin-gated).

3. **The body self-model PACKAGE is well-built (pure core).**
   `packages/system-graph/` (1618 LOC incl. tests) has typed nodes/edges
   (`surface`/`screen`/`service`/`package`/`capability`/`schema`/`mcp`/
   `junior` + `renders_on`/`depends_on`/`flows_data_to`/`governed_by`/
   `serves`/`exposes`), pure per-substrate derivation (`derive.ts`),
   content-hashed `buildGraph`+`hasBodyChanged` (listChanged), MemGPT-style
   organ-map summary + `queryBodySchema` paging + `blastRadius` (injured-limb)
   + a health overlay (`health.ts`).

4. **The body-change syscall + meta-rail PACKAGES are well-built.**
   `packages/central-intelligence/src/kernel/inviolable.ts:239+`
   `checkBodyChangeInviolable` (deterministic, no-LLM, fail-closed; forbids
   rail-edit / audit-shortening / ceiling-raise / integrity-fail).
   `packages/mutation-authority/src/body-change/body-change-syscall.ts`
   (`authorizeBodyChange`) composes meta-rail → controller → composeWithRail
   monotone with defence-in-depth post-conditions; fail-closed throughout.
   `self-extension.ts:613` *does* call `checkBodyChangeInviolable` on the L3
   sub-MD compose path. `compose-with-rail.ts` carries a meta-rail term.

5. **CRDT state-bus PACKAGE just built.** `blackboard-sota/src/slots/`
   (`slot-crdt.ts`, `slot-store.ts`), `handoff/handoff.ts`, and a
   `'state-bus'` realtime topic (`realtime-adapter/src/types.ts:23`).

6. **MCP fabric exists.** `mcp-server-borjie` (77 tool refs),
   `mcp-server-tra` (15), `mcp-server-process-intel` (20);
   `packages/mcp/src/mount-registry/mount-registry.ts` (declares 26 Borjie +
   9 BN services with a `mirrors` field); `mcp-server/progressive-disclosure.ts`.

7. **CodeAct isolate exists.** `central-intelligence/src/kernel/sandbox/
   js-sandbox.ts` (isolated-vm V8) + `sandbox-policy.ts` tier caps.

---

## The core failure mode: built-but-dark

The dimension is *embodiment* — the MD must *know its own body*, *act on
it*, and *redesign it*. Three of the four load-bearing organs are packages
with ports and no composition root behind them. The brain that runs in
production today does **not** know its own morphology, has **no** live path
to reshape itself through the safe syscall, and projects **no** decision
onto a second surface. The actuation organ (genui) is the lone exception.

---

## GAPS

### EA-01 — Body self-model is never derived; the live brain reads the static `BRAIN_MODULES` list
- **Severity:** BLOCKER
- **Evidence:**
  - `services/consolidation-worker/src/tasks/system-graph-derivation.ts`
    (`deriveSystemGraph`, real FS walkers) is **defined but never invoked**
    — a repo-wide grep for `deriveSystemGraph|runSystemGraphDerivation`
    returns only its own definition + tests. It is not in
    `services/consolidation-worker/src/index.ts`'s cron registry.
  - `services/api-gateway/src/composition/brain-kernel-wiring.ts` (996 LOC,
    the live composition root) has **zero** references to `bodySchemaReader`,
    `createBodySchemaReader`, or `system-graph`. The kernel dep
    `bodySchemaReader?` (`kernel.ts:273`) is therefore always `undefined`.
  - `renderSelfAwarenessBlock(deps.bodySchemaReader)` (`kernel.ts:1124,2136`)
    consequently falls back to `renderModuleInventoryBlock()` →
    `self-awareness.ts:565 describeCapabilities()` which hardcodes
    `"I have ${BRAIN_MODULES.length} modules"` — 27 static modules vs 180+
    real packages. The exact drift the spec calls "the in-repo cautionary
    case" is **still live in production**.
- **Current state:** Body schema package + derivation task + kernel reader
  port all exist; none is wired. The MD describes itself from a hand-written
  list that is ~85% wrong about its own size.
- **AGI target:** A LIVE, DERIVED, persisted body schema the brain reads
  every turn (MemGPT-paged organ-map summary resident; full graph paged via
  `query_body_schema()`), regenerated on deploy/migration/flag-flip via
  listChanged. The MD answers "what can I do, where, how well" from ground
  truth, not memory.
- **Closure lane:** Register `deriveSystemGraph` as a consolidation-worker
  cron + a deploy/migration/flag-flip listChanged trigger; persist the graph
  (new `system_graph_revisions` table or reuse the corpus sink); wire
  `createBodySchemaReader(source)` into `brain-kernel-wiring.ts` and pass it
  as `deps.bodySchemaReader`. Area: `services/consolidation-worker/src/index.ts`
  + `services/api-gateway/src/composition/brain-kernel-wiring.ts` +
  `packages/database` (persistence) + `packages/central-intelligence/src/kernel/introspection/body-schema-reader.ts` (already built).
- **Effort:** L

### EA-02 — `query_body_schema()` / blast-radius introspection tools are not exposed to the live MD
- **Severity:** HIGH
- **Evidence:** `queryBodySchemaTool` / `bodyBlastRadiusTool`
  (`body-schema-reader.ts:81,96`) are exported but a grep of
  `services/api-gateway/src` for `queryBodySchemaTool|bodyBlastRadiusTool|
  createBodySchemaReader` returns **nothing**. No gateway route exposes
  `query_body_schema`; the MD's tool registry never receives a body-schema
  page-in tool.
- **Current state:** The MemGPT page-in primitive + injured-limb traversal
  exist as pure functions wired to nothing.
- **AGI target:** The MD can, mid-turn, page in the exact organ it needs
  ("which surface renders offtake settlement, what's its health, what
  depends on it") and route around a degraded limb.
- **Closure lane:** Register `query_body_schema` + `body_blast_radius` as
  brain tools in the kernel tool registry (same registry `tool-dispatcher.ts`
  reads); bind them to the live `SystemGraphSource` from EA-01. Area:
  `packages/central-intelligence/src/kernel/tools/` +
  `services/api-gateway/src/composition/brain-kernel-wiring.ts`.
- **Effort:** M

### EA-03 — No live health / proprioception on body nodes (no injured-limb detection)
- **Severity:** HIGH
- **Evidence:** `system-graph/src/health.ts` `attachHealth(graph, readings)`
  exists, but no caller in `services/` or `packages/` (outside system-graph's
  own tests) feeds it real readings. `services/capability-measurement-worker/
  src/index.ts` computes competence/calibration/utility over 7/28/91d windows
  but a grep shows it never touches `system-graph` / `attachHealth` / body
  nodes. OTel/Sentry route health is not joined onto graph nodes.
- **Current state:** Health overlay is a pure function; the measurement
  worker computes axes into its own repo, disconnected from the body schema.
- **AGI target:** Every body node carries live competence/calibration/
  utility + route health; a 500-ing route or sub-threshold capability is an
  INJURED LIMB the MD routes around and flags (Lipson damage-detection).
- **Closure lane:** Emit a `HealthReading[]` sink from
  `capability-measurement-worker` + an OTel/Sentry route-health collector;
  call `attachHealth` during derivation (EA-01) so the persisted graph is
  health-annotated. Area: `services/capability-measurement-worker` +
  `packages/observability` + `packages/system-graph/src/health.ts` (built) +
  consolidation-worker derivation pass.
- **Effort:** M

### EA-04 — The unified body-change syscall is wired into no composition root
- **Severity:** BLOCKER
- **Evidence:** `mutation-authority/src/body-change/body-change-syscall.ts`
  (`authorizeBodyChange`) + `audited-body-change.ts` are built and tested,
  but a grep of `services/api-gateway/src` for `authorizeBodyChange |
  body-change-syscall | auditedBodyChange | @borjie/mutation-authority`
  returns **nothing**. The "single chokepoint for ALL self-change" (the
  AIOS access-manager) is composed nowhere. The L1 (move/reorder) and L2
  (add surface/capability) body-change paths do **not** route through it —
  only the L3 self-extension path calls the meta-rail directly
  (`self-extension.ts:613`), bypassing the syscall it documents itself as
  using (`self-extension.ts:510`).
- **Current state:** The syscall is a leaf package; each self-change path
  either skips it or re-implements a slice. The spec's central invariant
  ("EVERY path that reshapes the body MUST route through `authorizeBodyChange`")
  holds for 0 of the live paths.
- **AGI target:** Every body-level change (prompt/memory/tool/UI/code/
  self-model) enters one syscall that runs meta-rail + controller +
  composeWithRail in lockstep, fail-closed, audited.
- **Closure lane:** Add `services/api-gateway/src/composition/
  body-change-wiring.ts` binding the three ports (`checkBodyChangeInviolable`,
  `decideAutonomy`, `composeWithRail`); route portal-genui persist, dynamic-
  sections reorder, capability-catalogue draft→shadow→live, and
  self-extension through it. Area: new gateway composition file +
  `packages/mutation-authority` (built) + `packages/central-intelligence/src/kernel/orchestrator/self-extension.ts`.
- **Effort:** L

### EA-05 — Cross-surface state bus reaches no surface (blackboard built, dark)
- **Severity:** BLOCKER
- **Evidence:** CRDT slots + handoff are built
  (`blackboard-sota/src/slots/slot-crdt.ts`, `handoff/handoff.ts`;
  `'state-bus'` topic at `realtime-adapter/src/types.ts:23`). But:
  - No app subscribes: grep of `apps/` for `blackboard-sota|SlotDelta|
    HandoffRequest|namedSlot` returns **nothing**.
  - No gateway route exposes slots: `services/api-gateway/src/routes/`
    has no `blackboard`/`slot`/`handoff` route.
  - `realtime-adapter` only *names* the topic in a type union; no broadcaster
    publishes `SlotDelta`s onto it.
- **Current state:** A decision the MD makes in chat lives once nowhere —
  it cannot be projected onto owner-web + workforce-mobile + buyer-mobile as
  the same live object. "Handoff" / Continue-On does not exist for users.
- **AGI target:** A decision is posted to a named CRDT slot; every surface is
  a SUBSCRIBER projecting the SAME object (not copied); the MD re-projects
  live state onto whichever surface the human now looks at.
- **Closure lane:** Gateway `blackboard.hono.ts` (post/read slot, request
  handoff); a `SlotDelta` broadcaster on the `'state-bus'` realtime topic;
  owner-web + both mobile apps subscribe + project (a `use-slot` hook). Area:
  `services/api-gateway/src/routes/` + `packages/realtime-adapter` +
  `packages/blackboard-sota` (built) + `apps/owner-web` + `apps/workforce-mobile`
  + `apps/buyer-mobile`.
- **Effort:** L

### EA-06 — Runtime tool synthesis (`synthesize_tool` / ToolMaker) does not exist
- **Severity:** HIGH
- **Evidence:** SCALE_SPEC §unboundedCapability lane P1 names
  `power_tool.synthesize_tool` as the missing keystone; the power-tools dir
  (`central-intelligence/src/kernel/power-tools/`) has `self-modification.ts`
  (a *Reflexion prompt-rewrite*, not tool synthesis), `compose.ts`,
  `sandbox.ts`, `schedule.ts` — but **no** `synthesize-tool.ts`. The CodeAct
  isolate (`js-sandbox.ts`) exists but is a leaf power-tool, not the unified
  action representation; the orchestrator does not emit a code body → run →
  self-debug → register loop. `voyager-library` package directory exists with
  **0 src files**.
- **Current state:** The MD can run sandboxed JS as one tool, but cannot
  *author a new tool*, static-scan it, sandbox-test it, and register it for
  future turns. "No ability it cannot create" is not met.
- **AGI target:** Closed loop: MD writes a tool body → CodeShield/LlamaFirewall
  static-scan → run in isolated-vm against generated unit-tests → register in
  the power-tools registry with a capability manifest (draft→shadow→live).
- **Closure lane:** Build `power-tools/synthesize-tool.ts` (write → scan →
  sandbox-test → register) gated by the body-change syscall (EA-04) +
  LlamaFirewall; fill `voyager-library` with the on-disk SKILL.md +
  progressive-disclosure store. Area:
  `packages/central-intelligence/src/kernel/power-tools/` +
  `packages/skill-library/voyager-library` + `packages/capability-catalogue`
  (lifecycle, built).
- **Effort:** L

### EA-07 — Ambient / proactive runtime does not subscribe estate event streams (no spawn-before-need)
- **Severity:** HIGH
- **Evidence:** `ambient-listener` is an STT/VAD/consent voice pipeline only
  (`pipeline/listener-pipeline.ts` has no `event_outbox`/`ledger`/`licence`/
  `fx`/`kyc`/`stream`/`subscribe` references). `proactive-triggers-worker`
  exists but no code subscribes the estate event streams to *pre-render*
  surfaces or *pre-draft* returns. The spec's "always-on ambient runtime
  (respond to EVENTS not prompts) … pre-render tabs the owner will want"
  is unbuilt as an event subscriber.
- **Current state:** The MD reacts to prompts (and ambient *audio* with
  consent); it does not perceive estate events (`event_outbox`, ledger,
  licence clocks, FX, KYC) and act before the human looks.
- **AGI target:** Subscribe estate event streams → idle-time pre-render of
  surfaces/drafts/bid-responses (spawn-BEFORE-need) with HITL blackboard
  checkpoints; EFE/VoI-ranked notification sink.
- **Closure lane:** Event-stream subscriber in `proactive-triggers-worker`
  consuming `event_outbox` + ledger/licence/FX/KYC; idle-time pre-render via
  portal-genui (EA actuator, already live) writing to a blackboard slot
  (EA-05). Area: `services/proactive-triggers-worker` +
  `packages/central-intelligence/src/kernel/proactive-nudge.ts` +
  `packages/blackboard-sota`.
- **Effort:** L

### EA-08 — MCP "mount everything" is declared but not mounted; no cross-project (Borjie↔BN) MCP plane
- **Severity:** MED
- **Evidence:** `mcp/mount-registry/mount-registry.ts` "declares 26 Borjie +
  9 BN services" with a `mirrors` field but the header itself says declaring
  a service "costs" nothing until something "actually attaches the organ" —
  and a grep of `services/api-gateway/src` for `mount-registry|mountRegistry`
  returns **nothing** (not wired into the gateway). Three real MCP servers
  exist (borjie/tra/process-intel) but the 50+ juniors are not each an MCP
  server with code-execution progressive disclosure; the `mirrors` parity
  edges between projects are not materialized into either system-graph (BN
  has no system-graph at all — see EA-10).
- **Current state:** A partial MCP southbound (3 servers) + an unmounted
  declarative registry; no single MCP plane the one MD owns across both repos.
- **AGI target:** Every Borjie + BN service mounted as an MCP server the one
  MD owns; code-execution-with-MCP progressive disclosure (tools-as-/proc) for
  50+ juniors; `mirrors` parity edges between projects in the body schema.
- **Closure lane:** Wire `mount-registry` into the gateway; expose juniors as
  MCP tools through `mcp-server`'s progressive-disclosure; feed MCP discovery
  output into the system-graph `deriveMcpTools` substrate (EA-01). Area:
  `packages/mcp/mount-registry` + `packages/mcp-server` +
  `central-intelligence/sub-mds/registry.ts` + `services/api-gateway`.
- **Effort:** L

### EA-09 — Adaptive surface reorder uses static rules, not learned intent (no VoI term)
- **Severity:** MED
- **Evidence:** `tab-need-detector/src/scoring-matrix.ts` (371 LOC) is a
  rule-based scorer; ORCHESTRATION_FRONTIER_ADDENDUM §VoI states it "today
  has no VoI / expected-utility / cognitive-cost term." `dynamic-sections`
  reorders by static rules, not LEARNED signal (role × season × deadline ×
  usage). The MD does not move FX-treasury near a USD-cliff *because it
  learned the owner needs it then*.
- **Current state:** Surfaces reorder/spawn on hand-tuned scores; no learned
  intent and no value-of-information gate on *whether to spawn at all*.
- **AGI target:** Learned-intent scoring (role × season × deadline × usage)
  driving reorder; a per-decision VoI/expected-utility/cognitive-cost term
  deciding spawn-vs-answer-in-chat (`kernel/cognitive-load.ts` is the seed).
- **Closure lane:** Add a learned-signal scorer + VoI term to
  `tab-need-detector/scoring-matrix.ts` + `proposal-emitter.ts`; move
  `dynamic-sections/lib` from static rules to a learned model fed by
  `learning-signal-emitter`. Area: `packages/tab-need-detector` +
  `packages/dynamic-sections` + `packages/central-intelligence/src/kernel/cognitive-load.ts`.
- **Effort:** M

### EA-10 — BossNyumba has actuators but ZERO body self-model layer (no parity)
- **Severity:** HIGH
- **Evidence:** BN (`Cursor Projects/BOSSNYUMBA101`, 153 packages) has the
  actuators (`portal-genui`, `genui`, `dynamic-sections`, `owner-os-tabs`)
  but a `ls packages/` for `system-graph|body|blackboard|mutation` returns
  **none**, and a grep for `system-graph|MD_AS_BODY|checkBodyChangeInviolable`
  in BN source returns only `portal-genui` hits. No body schema, no meta-rail,
  no body-change syscall, no CRDT state bus. The MD_AS_BODY thesis ("the
  entire codebase of Borjie AND BossNyumba is his BODY", with `mirrors` edges)
  is single-repo only.
- **Current state:** The "one MD across both projects" embodiment claim is
  unbacked: BN cannot model, perceive, or safely reshape its own body.
- **AGI target:** Omnipresent ambient operation across BOTH projects — one
  body schema spanning both, `mirrors` parity edges, the same meta-rail +
  syscall governing BN self-change.
- **Closure lane:** Port `system-graph`, `mutation-authority` body-change
  syscall, `checkBodyChangeInviolable`, and `blackboard-sota` slots to BN
  (mirror Borjie); add cross-project `mirrors` edges in derivation; one MCP
  plane (EA-08) spanning both. Area: BN `packages/` (port from Borjie) +
  cross-project mount-registry.
- **Effort:** XL

### EA-11 — External-organ action (browser/computer-use for API-less portals) is unwired to the action loop
- **Severity:** MED
- **Evidence:** `packages/browser-perception` exists and the Chrome/computer-use
  MCP is available, but the MD_AS_BODY §perceptionActuation hybrid action model
  (API/MCP-first, browser/computer-use as policy-gated long-tail HITL fallback
  for the regulator cadastre portal, bank console, TRA PDF filing) is not wired
  into the orchestrator action loop — `browser-perception` is a leaf package,
  not a `policy-gate`-gated actuator the brain can invoke for a no-API external
  surface.
- **Current state:** The MD cannot act on external organs that lack an API
  (the exact long-tail the spec calls out); browser-perception is dark.
- **AGI target:** Hybrid action model gated by `policy-gate`: MCP/API-first,
  computer-use only as HITL-gated long-tail for API-less government/bank portals.
- **Closure lane:** Wire `browser-perception` + the Chrome/computer-use MCP as
  a policy-gated actuator in the tool registry; route through the body-change /
  action gate so external acts are HITL by default. Area:
  `packages/browser-perception` + `services/api-gateway` tool registry +
  `packages/central-intelligence/src/kernel/policy-gate.ts`.
- **Effort:** M

### EA-12 — Reversible body-change wiring (shadow→canary→burn-rate-rollback + DGM fitness) not connected to the body-change path
- **Severity:** MED
- **Evidence:** MD_AS_BODY lane [XL] notes `shadow-mode`/`rollout`/`cutover-gate`/
  SLO-auto-rollback + `isolated-vm` sandbox + `ui-evolution-worker` DGM fitness
  "all shipped — the gap is wiring them to the body-change path." With the
  body-change syscall itself unwired (EA-04), the reversible promotion pipeline
  (1→10→50→100% canary with eval/latency/cost/error gates → auto-rollback to
  the archived parent body) is not connected to any generated surface/skill.
  `ui-evolution-worker` exists but promotes nothing through the syscall.
- **Current state:** Generated surfaces/skills go live without the
  shadow→canary→empirical-fitness gate; no archive-lineage rollback of a body
  change.
- **AGI target:** Every generated surface/skill/sub-MD promoted to live ONLY
  after beating the incumbent on adoption/completion/error/approval, with
  burn-rate SLO auto-rollback to the archived parent body.
- **Closure lane:** Wire `ui-evolution-worker` + `shadow-mode`/`rollout`/
  `cutover-gate` to the body-change syscall (EA-04); sandbox-before-deploy in
  `isolated-vm`; DGM empirical-fitness promotion with archive lineage. Area:
  `services/ui-evolution-worker` + `packages/central-intelligence/src/kernel/{shadow-mode,rollout,sandbox}`
  + `packages/mutation-authority/execution`.
- **Effort:** XL

---

## Scoring rationale (2.3 / 5)

- **Perceive own body:** ~1/5 — package exists, never derived/read; brain
  speaks from a 27-item static list (EA-01/02/03).
- **Act on surfaces (grow organs):** ~4/5 — portal-genui spawn-on-need is
  live end-to-end, A2UI patches + sandboxed iframe exist; only learned-intent
  + VoI + ambient pre-render missing (EA-07/09).
- **Redesign self safely:** ~2/5 — meta-rail + syscall are excellent packages
  but wired into ~0 live paths; no reversible/DGM promotion connected
  (EA-04/12); runtime tool synthesis absent (EA-06).
- **Cross-surface omnipresence:** ~1.5/5 — chat front door + genui exist;
  the state bus reaches no surface, no handoff (EA-05).
- **Both-project ambient:** ~1/5 — BN has actuators but no body-model layer
  at all (EA-10); no cross-project MCP plane (EA-08).

The architecture is sound and the spec's "unification + derivation + meta-rail,
not greenfield" framing is correct — but until EA-01/04/05 are wired, the MD is
an *actuator without proprioception or a nervous system*: it can grow a tab, but
it does not know what it is, cannot safely reshape itself through one governed
chokepoint, and cannot project a decision onto a second screen.

## Sequence (spine-first, matches MD_AS_BODY verdict)

1. **EA-01** (derive + read body schema) — the body must know itself first.
2. **EA-03** + **EA-02** (health attach + introspection tools) — proprioception.
3. **EA-04** (wire the body-change syscall) — one governed chokepoint, with
   the meta-rail already built behind it.
4. **EA-05** (state bus to surfaces) + **EA-07** (ambient pre-render).
5. **EA-06** (runtime tool synthesis) + **EA-12** (reversible promotion) +
   **EA-09** (learned-intent/VoI) + **EA-11** (external organs).
6. **EA-08** + **EA-10** (one MCP plane + BN body-model parity).

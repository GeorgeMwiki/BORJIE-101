# THE VISUAL OS × THE BLACKBOARD — how the render discipline and the shared-state spine AMPLIFY the vision

**Document:** `VISUAL_OS_AMPLIFICATION.md`
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Status:** synthesis dossier — no code, no commit. The amplification register for **INV-H (amplified)**.
**Repos:** Borjie (mining estate OS) **and** BossNyumba (real-estate OS) — same spine, same render
discipline; only the domain layer differs.

**Invariants bound:** **INV-H** (chat-first but a rich SOTA workspace) + **INV-H (amplified)**
(`MASTER_GAP_REGISTER.md:522-542` — the Visual OS discipline + the blackboard as shared-state spine)
+ the **UI invariant** (reasoned-need · proposal-gated · reversible · chat-refinable, `:314-333`) +
**INV-B** (surfaces are semantic lenses over the org-graph) + **INV-K** (one design system to artifact
depth) + the **status-only re-scope** (`:565-579` — show STATUS + OUTPUTS + EVIDENCE, never internal
cognition; this is the hard constraint the Visual OS "visible work" claims must bend to).

**Synthesizes:**
- `amp-blackboard-audit.md` — the substrate inventory (the spine exists as a tested library, **0% wired**).
- `amp-visual-os-render-audit.md` — the render stack vs the 7-layer Visual OS spec (rich-by-default is
  real in ONE lane, prose-default at the code level, four un-unified routers).
- `THE_CHAT_SURFACE_ARCHITECTURE.md` — the Face (two views of one state, the 9-wave Face roadmap).
- `MD_COGNITIVE_KERNEL_ARCHITECTURE.md` — the Mind (the resident `EstateMind` + its Current Situational
  Model, organ #2).
- `MASTER_GAP_REGISTER.md` — INV-H amplified, the UI invariant, EA-05/EA-07/EA-10, COG-15, the Face/Mind gaps.
- **THE VISUAL OS spec** (`Visual_OS_Engineering_Spec.docx`) — the 7-layer render discipline + the
  Claude.ai primitives to adapt.

---

## 0. Thesis in one paragraph

We arrived at the same machine from two directions. The **Mind** dossier said the kernel's one
structural deficiency is that the cognitive cycle is *triggered, not resident* — it needs a standing
**Current Situational Model** held between ticks (organ #2). The **Face** dossier said the chat's one
frontier gap is *bidirectional shared state* — "two views of one state," a session-state document the
brain patches and surfaces patch back (Face Layer 3). The **blackboard audit** found a fully-built,
fully-tested **CRDT slot bus + region/post/control kit** sitting completely dark — the *exact* substrate
both gaps describe. And the **Visual OS spec** supplies the missing *render discipline* on top: default
to the richest output, route modality deterministically, engineer SVG/HTML with rigor, and close a
clickable→follow-up→re-render loop. **The amplification is the unification: promote the blackboard from
a dark LITFIN/credit-flavored library to the ONE shared-state spine that simultaneously is the Mind's
resident situational model, the Face's two-views-of-one-state, and the juniors' coordination board —
then make the Visual OS the Face's render discipline that reads and writes that same spine.** Every
Claude.ai primitive in the spec maps cleanly onto a self-hosted seam we already own; almost nothing is
greenfield. This dossier is that unification, the exact wiring, the adaptation map, the amplify-vs-build
split with file evidence, and how it folds into the master convergence as a promoted core wave.

---

## 1. THE BLACKBOARD AS SHARED-STATE SPINE — one substrate, three roles, one wiring

### 1.1 The convergence (why three research lanes name the same object)

Three independent dossiers each named a missing piece, and the pieces are **the same CRDT slot board**:

| Lane | What it asked for | The blackboard primitive that IS it |
|---|---|---|
| **Face** (`THE_CHAT_SURFACE_ARCHITECTURE.md §0,§3.3,§3.4`) | "one shared session-state document rendered as two coupled projections"; `STATE_SNAPSHOT`/`STATE_DELTA`; chat + surface = one object | `SlotStore` (CRDT LWW-register + version-vector merge, `slots/slot-crdt.ts:41-180`) broadcasting `SlotDelta` on the tenant-scoped `state-bus`; `HandoffService` re-projecting the LIVE slot onto a 2nd surface |
| **Mind** (`MD_COGNITIVE_KERNEL_ARCHITECTURE.md §2.2, organ #2; COG-15) | "persistent, decaying per-tenant SituationalModel"; "open-loop registry"; the Global-Workspace single broadcast | named slots as the persistent state cells; `blackboard_posts_v2` (threaded, append-only, embedding-bearing) as the per-tick working memory; `summary-generator` rolling condensation as the GWT broadcast |
| **Juniors** (`amp-blackboard-audit.md §3c`; INV-D ORGANIZE/delegate) | handoff/control/posts between ~50 agents; opportunistic scheduling | the **Hayes-Roth 1985 control shell** (`pickNext()` scores every eligible KS by priority×freshness×competence), the KS registry (juniors registerable as knowledge sources), append-only posts + cross-reference detection |

The blackboard is, by design, *capable* of all three — the audit's own verdict: "the **right
substrate, fully present as a library, zero percent integrated**" (`amp-blackboard-audit.md:203-204`).
The unification thesis is therefore not "build a spine" but **"wire the one spine we already have to
three consumers that already need it."**

### 1.2 The unification — one substrate, three projections

```
              ┌──────────────────────────────────────────────────────────────────┐
              │  THE BLACKBOARD SPINE  (per tenant, RLS-scoped, durable)           │
              │  @borjie/blackboard-sota  +  @borjie/blackboard-intel              │
              │                                                                    │
              │   SLOTS (CRDT LWW + version-vector)   ── the persistent state cells│
              │   POSTS (append-only, embedding, SSE) ── the per-tick working mem  │
              │   REGIONS (problem namespaces, hash-chained audit)                 │
              │   CONTROL SHELL (pickNext → ControlActivation)                     │
              │   HANDOFF (re-project a live slot onto another surface)            │
              │   SUMMARIES (rolling/digest GWT broadcast)                         │
              │   INTEL (groundedness/calibration/utility scoring + hybrid search) │
              └───────▲──────────────────▲──────────────────────▲─────────────────┘
       reads/writes  │                  │ reads/writes          │ posts/handoff/control
   ┌──────────────────┴──┐   ┌───────────┴───────────┐   ┌───────┴───────────────────┐
   │ (a) THE FACE        │   │ (b) THE MIND          │   │ (c) THE JUNIORS           │
   │ two views of 1 state│   │ resident Situational  │   │ multi-agent coordination  │
   │ chat + owner-web +  │   │ Model (organ #2)      │   │ ~50 juniors as KSes;      │
   │ both mobiles render │   │ EstateMind.tick()     │   │ control-shell schedules;  │
   │ the SAME slots;     │   │ WRITES the model each │   │ posts = shared scratchpad;│
   │ host-actions patch  │   │ tick, READS it on the │   │ handoff = agent→agent →   │
   │ back (STATE_DELTA)  │   │ Fast Loop chat turn   │   │ surface continuation      │
   └─────────────────────┘   └───────────────────────┘   └───────────────────────────┘
```

**One write, three readers.** When the kernel's Slow Loop (`EstateMind.tick()`) updates a situational
slot (`royalty-window-closing`, activation 0.82), that single CRDT write: (i) becomes the *resident
model* the Fast Loop reads on the next chat turn (Mind, organ #2 ← organ #1); (ii) broadcasts a
`SlotDelta` that the Face renders inline + on any open tab (two views of one state); (iii) is visible to
the royalty-junior as a region post it can answer. **No copy, no second source of truth — a slot lives
once and every consumer converges via the lattice join** (`slot-crdt.ts` proven commutative/associative/
idempotent + unit-tested).

### 1.3 The exact wiring (the EA-05 closure, made the spine)

This is the EA-05 BLOCKER closure (`MASTER_GAP_REGISTER.md:176`) re-scoped from "a cross-surface bus"
to "the org-brain's shared-state spine." Dependency-ordered:

1. **Persistence (the missing floor).** Add a `blackboardSlots` Drizzle pgTable + a forward-only
   migration + a SQL `SlotsRepository` (today only `in-memory-slots-repository.ts:20` exists; the
   core 5 tables have schema `blackboard-sota.schema.ts:87-244` + migration `0073`/`0297` but **slots
   have neither**). A slot must survive process restart to be the Mind's resident model (INV-J: never
   lose data) and the durable situational state.
2. **Declare the workspace dependency.** No `package.json` declares `@borjie/blackboard-sota` or
   `-intel` (audit §1, grep empty) — they are orphan workspace packages. Add them as deps of
   `services/api-gateway` and `packages/central-intelligence`.
3. **The gateway route.** Build `blackboard.hono.ts` (post/read a slot, handoff, region/post) — the
   route the gap register prescribes and that does not exist. RLS-scoped, idempotent.
4. **Bind the broadcaster.** Construct `SlotStore` at a composition root and bind its `SlotDelta`
   broadcast to the tenant-scoped `state-bus` realtime topic (today `realtime-adapter` only *reserves*
   the topic string, `realtime-adapter/src/types.ts:23`; nobody broadcasts/subscribes).
5. **The Face subscriber (role a).** A shared `use-slot(tenantId, slotId)` hook in `packages/chat-ui`
   that owner-web + workforce-mobile + buyer-mobile consume (replacing/augmenting the local teaching
   board the chat currently mounts, `OwnerOSChatPanel.tsx:180`). Inbound deltas feed the SAME merge;
   loop-suppressed by `originSurface`. **This is the Face's "two views of one state" landed.**
6. **The Mind read/write (role b).** `EstateMind.tick()` (Mind Wave 3) writes the SituationalModel as a
   set of slots each tick and the Fast Loop `think(req)` reads them — "reads the live SituationalModel
   instead of recomputing cold" (Mind W3.2). The control-shell `pickNext()` (which has **zero callers**
   today, `control-shell.ts:74-150`) becomes the metalevel-scheduler heartbeat the Slow Loop ticks.
7. **The juniors (role c).** Register the ~50 juniors as `KnowledgeSource`s (`ks-registry.ts`); add a
   `ControlActivation` listener in the agent-runtime that dispatches the KS the control-shell selects;
   juniors `publish()` posts to their region and read cross-references. blackboard-intel's competence
   scoring closes the self-improving loop (feeds the control-shell `CompetenceLookupPort`).

**The single most important re-framing:** the audit files this as EA-05 (a Face feature). The
amplification **promotes it to the spine wave** — because the same wiring simultaneously closes COG-15
(the Mind's missing situational model) and the juniors-coordination gap. One build, three invariants.

### 1.4 The status-only rail (INV-H sharpened) constrains the spine

`MASTER_GAP_REGISTER.md:565-579` is the hard constraint: the user sees **STATUS + OUTPUTS + EVIDENCE,
never internal cognition** (chain-of-thought, tool-calls, swarm mechanics are IP). So the spine has a
**visibility partition**:
- **Owner-facing slots** (`decision|document|task|draft|dataset`) project to the Face — these are
  outputs + their evidence.
- **Mind-internal slots/posts** (situational activation field, control-shell activations, junior
  scratchpad posts, debate transcripts) are the resident model + coordination board — they live on the
  spine but are **NEVER broadcast to owner surfaces**; they surface only as polished STATUS ("preparing
  your royalty filing…") and as the *final* output slot. Borjie-internal admin-web MAY read them
  (gated/audited). The `note` slot-kind and the posts/regions layer are the internal partition; the
  `state-bus` broadcast filter is the enforcement point.

This is a *strength*, not a tax: the blackboard already has per-region hash-chained audit + the
intel-layer scoring, so the internal partition is fully observable to ops without leaking to owners.

---

## 2. THE VISUAL OS as the Face render discipline (default-to-richest; prose is fallback)

The blackboard is the *spine* (what state lives where). The Visual OS is the *render discipline* (how a
turn becomes the richest correct artifact and how that artifact talks back). The render audit's verdict:
rich-by-default is **real but prompt-driven in ONE lane**, **prose-default at the code level**, with
**four un-unified routers** (`amp-visual-os-render-audit.md` TL;DR). The amplification makes richest the
*structural floor* and folds the four routers into one.

### 2.1 Default-to-richest as a CODE invariant (invert the three prose defaults)

The spec's CORE PRINCIPLE: "every response DEFAULTS to the richest output; prose is the fallback." Today
three code-level defaults all fall to **prose** — the inverse:
- `selectInlineBlock()` documented default `'none'` (`block-selector.ts:29,128`),
- the modality-arbiter **fails closed to `chat`** on ambiguity (`modality-arbiter.ts:61-66,299-306`),
- unknown-block → prose bubble.

**Amplification:** make the *fallback* the rich path. When shape is detectable (rows→table, series→chart,
scalar→metric — the `selectInlineBlock` heuristic already does this, `block-selector.ts:131-156`),
**render it**; prose is the explicit exception, not the silent default. The render audit is explicit
this is the #1 architecture fix: "the *fallback* must be the rich path and prose the exception —
currently inverted at the code level" (`amp-visual-os-render-audit.md` cross-cutting #2). This honours
INV-I (visualizations beautiful AND correct, right-chart-for-the-question) by construction.

### 2.2 Visual routing as a modality-arbiter SUB-LAYER (one router, not four)

The spec's L3 is a deterministic first-match tree (`MCP-tool > file > visual-type`). Borjie has the
*capability* in four un-unified subsystems (A inline-blocks, B blackboard-canvas, C AG-UI catalog, D
portal-tabs, E LitFin domain blocks — `amp-visual-os-render-audit.md` inventory) but **no shared
router**. INV-H (amplified) names the fix precisely: the visual-routing decision tree is **"a sub-layer
of the modality-arbiter"** (`MASTER_GAP_REGISTER.md:526-528`).

**Amplification:** the modality-arbiter (`modality-arbiter.ts`, the 7-way head chat|tab|document|media|
action|skill|workflow) becomes the single L1/L3 entry. Its closed set stays output-channel; we add a
**visual-type sub-decision** evaluated in first-match order *inside* the chosen channel:
- `MCP-tool / ui-resource` → `SandboxedSurface` (CSP iframe, `sandboxed-surface.ts` — already the safest
  posture, *better* than the spec's claude.ai primitive).
- `file` → document-studio / media-engine renderers (the `document`/`media` channels).
- `visual-type` → SVG flowchart (sequence) / SVG structural (containment) / **SVG-or-HTML
  illustrative-interactive ("how does X work" — the DEFAULT for mechanism, NOT a flowchart)** / HTML
  chart (data) / HTML mockup (UI) / HTML interactive (live-state) / React+juniors-API (AI app).

**The single biggest missing behavior** (render audit #3): mechanism / "how does X work" has **no
default interactive-explainer route** — the blackboard `diagram`/`sketch` primitives exist but are
*teaching-gated* ("DO NOT use the blackboard for trivial chitchat", `public-chat.hono.ts:1071,1102`).
Amplification: promote "illustrative-interactive mechanism" to a first-class router target so "how does
the royalty calc work" defaults to an interactive SVG/HTML explainer, not prose-plus-formula. The four
subsystems become *renderers behind one router*, which makes richest-default transfer across surfaces
(today the floating-widget lane has no richness directive at all — render audit #2/L6).

### 2.3 SVG / HTML engineering rigor adopted into GenUIWidgetRenderer + the SVG primitives

The spec's L4/L5 rigor maps onto components we already own. The render audit found we *do* render real
SVG (viewBox + `<defs>` arrow markers + marker-end + topological layout in `DataflowDiagram.tsx:43-217`
— "textbook spec-L4") but with three rigor gaps to close, **bound to INV-K** (one design system to
artifact depth):
- **Color classes auto light/dark, never hardcoded hex.** Today half the stack hardcodes hex
  (`svg-primitives.ts:8-21`, `DataflowDiagram.tsx:24-36`) and half uses CSS vars (`VennView` uses
  `hsl(var(--warning))`, the genui-tab renderers use `border-border`/`bg-surface`). Amplification:
  **all** SVG/HTML output flows through the design-system tokens (INV-K) — the codebase already proves
  it knows how; make it the only path.
- **CSS-vars never hardcode hex in HTML widgets** (spec L5) — same INV-K fix; the genui-tab renderers
  are already token-clean, the chat-ui generative-ui blocks are not (`AdaptiveRenderer.tsx:375-386`).
- **Anti-patterns** (no gradients / emoji / font-weight 600+ / position:fixed in generated widgets /
  display:none-while-streaming) — adopt as a lint/runtime guard on generated output (today unenforced).

**Security fold-in (a real flag, not a style nit):** the raw-SVG `dynamic_visual` path uses
`dangerouslySetInnerHTML` with **no DOMPurify** (`chat-ui/src/generative-ui/AdaptiveRenderer.tsx:384`),
violating the CLAUDE.md hard rule "No raw HTML interpolation. DOMPurify wraps required." Adopting the
Visual OS discipline means the SVG/HTML engineering pass **wraps every raw-markup path in DOMPurify** —
the render discipline carries the security rule with it.

### 2.4 The clickable → follow-up → re-render bidirectional loop (the genui host-action seam)

The spec's recursive feedback loop: a clickable diagram node → `sendPrompt` follow-up → re-render. The
render audit found this is wired for **blocks/buttons** (`InlineBlockRenderer.tsx:108-119`
`InlineBlockActionEvent`; `tab_promotion_chip`; `micro_action_card`) but **NOT for SVG nodes**
(`DataflowDiagram` nodes are static `<g>` with no onclick — render audit L4 #2).

**The seam already exists and is half the loop.** `packages/genui/src/genui-host-actions.ts` is the
**H12 host-action contract**: the genui primitives fire LLM-emitted payloads into seven
`genui:*` CustomEvents (`genui:tree-action`, `genui:prompt-suggestion`, `genui:slider-change`, …) which
the host portal dispatches through a **security-allowlisted** `createGenUiActionDispatcher` (the host is
the authoritative boundary; the helper bakes in the allowlist). This is *exactly* the spec's
clickable→sendPrompt loop, already built with a stronger security model than the claude.ai primitive.

**Amplification (close the loop both ends):**
- **Click side:** make SVG diagram nodes clickable `<g class="node" onclick=…>` that fire a
  `genui:node-action` CustomEvent through the same allowlisted dispatcher (extend `GENUI_ACTION_EVENTS`).
  A clicked node emits a follow-up turn via the chat-refine path.
- **Re-render side:** the follow-up turn patches the **slot** (§1) the artifact projects from →
  `SlotDelta` → the **same** artifact re-renders in place (stable `artifact_id`, the Face's "Interactable
  artifact", not a second chart below). This is where the Visual OS loop and the blackboard spine MEET:
  *the click writes a delta to the shared slot; every view of that slot — inline bubble, open tab, second
  device — re-renders.* The Face's `STATE_DELTA` channel (Face Wave 4) and the Visual OS recursive loop
  are the **same mechanism**, and `packages/portal-genui/patch/` (`apply.ts`/`ops.ts`) is the JSON-Patch
  evolution seam that already exists for it.

All gated by the UI invariant: a node-click that proposes a mutation surfaces as a proposal (Open/Undo),
never self-applies; reversible; chat-refinable.

---

## 3. THE ADAPTATION MAP — every Claude.ai primitive → our self-hosted equivalent

The spec is written in claude.ai-environment primitives. INV-H (amplified, `:538-541`) names the
mapping; this is the full table with the seam file each lands on (the spec MUST be adapted to
self-hosted Next.js owner-web + Expo mobile — these primitives do not exist for us verbatim):

| Visual OS spec primitive (claude.ai) | Our self-hosted equivalent | Seam / file (verified) |
|---|---|---|
| `/mnt/skills` (read the skill before generating) | the skills tree + document-studio / media-engine | `packages/ai-copilot/src/skills`, `packages/agent-runtime/src/skills`, `services/reports/skills`, `packages/document-studio`, `packages/media-engine`; arbiter loads `active && humanReviewed` skills (`modality-arbiter.ts:207-213`) |
| `visualize:read_me` (the widget registry the model renders into) | the portal-genui field/widget registries injected into the prompt | `packages/portal-genui/fields/registry.ts` (22 fields), `widgets/registry.ts` (14 widgets), `generator/prompt.ts:19-107` (catalog-in-prompt) + the `@borjie/genui` 32-entry `ARTIFACT_CATALOG` (`catalog.ts:595-892`) |
| `present_files` (deliver a generated file inline) | artifact delivery via document/media channels → inline preview | document-drafter renderers (`services/api-gateway/.../document-drafter/renderers/`), media-engine artifacts, `file_request_card` / `draft_preview` inline blocks |
| `window.storage` (persistent per-widget state) | owner-tabs-store (UI) + the blackboard slot (cross-surface) + DB (durable) | `apps/owner-web/src/lib/owner-tabs-store.ts`, the CRDT `SlotStore` (`slots/slot-store.ts`), `packages/genui/src/document.ts` (per-(tenant,persona,user) JSON doc), `portal_tabs` table |
| `sendPrompt` (clickable → follow-up turn) | genui host-actions + chat-refine | `packages/genui/src/genui-host-actions.ts` (`GENUI_ACTION_EVENTS`, allowlisted dispatcher), `InlineBlockActionEvent` (`InlineBlockRenderer.tsx:108-119`), the chat-refine path |
| `Anthropic-API-in-artifacts` (artifact spawns a sub-agent) | our juniors / live-artifacts (NOT Claude-in-Claude) | the ~50 juniors in `packages/ai-copilot/src/juniors`, the brain `/turn` as the artifact's "API", `SandboxedSurface` for isolated live artifacts |
| `conversation_search` (possessive recall: "my Geita site") | memory-v2 retrieval + GraphRAG | `packages/memory-v2` (6-layer Drizzle, the cognitive-memory hierarchy), org-graph retrieval; gap: possessive-triggered search not yet wired into the render turn (render audit L7 #1) |
| `userMemories` (auto-apply silently; remember/forget edits) | memory-v2 + advisor-memory directive | `services/api-gateway/.../advisor-memory/index.ts:174` (`## OWNER_MEMORY` injected every turn, wired `brain-teach.hono.ts:633-636`); gap: explicit "remember/forget" command surface (render audit L7 #2) |

**The adaptation principle:** we are *not* poorer than claude.ai here — for several primitives our
self-hosted seam is **stronger** (the host-action allowlist > raw `sendPrompt`; the CSP-isolated
`SandboxedSurface` > artifact iframe; RLS + audit-chain + evidence-required > consumer memory). The
adaptation is mostly *wiring an existing seam to the render path*, not building a new primitive.

---

## 4. AMPLIFY vs BUILD-NEW (with file evidence)

### 4.1 AMPLIFY — we have it; sharpen it (the dominant category)

| Capability | What exists (evidence) | The amplification |
|---|---|---|
| **The CRDT spine** | `blackboard-sota` slot bus + handoff + control + posts + regions, **tested**, `slot-crdt.ts:41-180`, `slot-store.ts:79-146`, `handoff.ts:74-128` | Wire it (§1.3). It is the right substrate at 0% integration — the highest-leverage amplification in the codebase. |
| **Rich inline render** | 16 inline blocks (`InlineBlockRenderer.tsx`), 35-primitive AG-UI catalog (`AdaptiveRenderer.tsx`), 22-field/14-widget tabs, real SVG (`DataflowDiagram.tsx`) | Invert the prose-default (§2.1); unify the four routers under the arbiter (§2.2); INV-K-clean every render (§2.3). |
| **The clickable loop** | host-action seam `genui-host-actions.ts` (`GENUI_ACTION_EVENTS` + allowlisted dispatch), `InlineBlockActionEvent`, `portal-genui/patch/` | Extend to SVG nodes; route the follow-up's delta back to the shared slot so the SAME artifact re-renders (§2.4). |
| **The modality arbiter** | 3-tier cascade rule→pgvector→LLM, 7-way head, skill/workflow load (`modality-arbiter.ts:55,140-419,207-213`) | Add the visual-type sub-decision (§2.2); flip the fail-closed default from `chat` to the detected rich type when shape is known. |
| **Memory auto-apply** | `## OWNER_MEMORY` directive every turn (`advisor-memory/index.ts:174`), 6-layer memory-v2 | Wire possessive `conversation_search` + a "remember/forget" surface into the render turn (§3, L7 gaps). |
| **The richest-default prompt** | the INLINE-FIRST RULE + size-of-answer ladder (`public-chat.hono.ts:695-749`) | Keep the prompt; back it with the *code* invariant so it holds even when the LLM doesn't emit a block. |
| **Persona/affect-calibrated disclosure** | `affective_profile` streamed; theory-of-mind directive (`brain-teach.hono.ts:628-631`) | Drive the visual-complexity scale (1 vs 3-5 vs 10 artifacts) off the same profile — calibrated richness. |

### 4.2 BUILD-NEW — genuinely missing (the minority)

| Gap | Why new | Closure |
|---|---|---|
| `blackboardSlots` table + migration + SQL `SlotsRepository` | only `in-memory-slots-repository.ts:20` exists; no slots table/migration | the persistence floor (§1.3.1). Small, blocks everything. |
| `blackboard.hono.ts` gateway route | does not exist (EA-05) | the spine's front door (§1.3.3). |
| `SlotDelta` broadcaster bound to `state-bus` | `state-bus` topic reserved, no publisher/subscriber | bind at composition root (§1.3.4). |
| `use-slot` subscriber in 3 apps | apps mount the unrelated local teaching board | shared `chat-ui` hook (§1.3.5). |
| `ControlActivation` dispatcher + junior KS registration | `pickNext()` has zero callers; juniors never post | the juniors-coordination wire (§1.3.7). |
| Visual-type sub-decision in the arbiter | the four routers are un-unified; no first-match tree in code | §2.2 — new code *inside* an existing module. |
| Mechanism "how does X work" → interactive-explainer route | only teaching-gated blackboard diagrams today | §2.2 — promote to a first-class router target. |
| SVG node `onclick` → `genui:node-action` | SVG nodes are static `<g>` | §2.4 — extend the existing event set. |
| DOMPurify on the raw-SVG path | `dangerouslySetInnerHTML` unwrapped (`AdaptiveRenderer.tsx:384`) | security fix carried by the render-rigor pass (§2.3). |

**The ratio is the headline:** ~7 amplify-rows vs ~9 build-rows, but every build-row is *small and
localized* (a table, a route, a hook, a dispatcher, a sub-decision) — there is **no greenfield
subsystem**. The expensive part (the CRDT, the renderers, the arbiter, the host-action contract) is
already built and tested. This matches both source dossiers: the Mind's "wiring + grounding, not
greenfield" and the Face's "the bones are unusually strong; the remaining work is wiring and depth."

---

## 5. HOW THIS FOLDS INTO THE MASTER CONVERGENCE — the blackboard is PROMOTED to a core spine

### 5.1 The promotion (the strategic move)

The blackboard audit found the spine is "nobody's" — it shows up only as a **deferred-work comment**
("complex parallel-agent coordination boards. Not on the core /turn path", `cognitive-wiring.ts:115`)
and is filed as EA-05, a Face-only feature in the embodiment wave. **The amplification's central
recommendation: promote the blackboard from a deferred/credit-flavored coordination feature to a CORE
SHARED-STATE SPINE** — because wiring it once closes three invariant gaps at once:
- **EA-05** (Face: cross-surface state bus) — the original filing.
- **COG-15** (Mind: no unified situational self-state model) — the Mind dossier's organ #2, today
  "aspirational, not implemented" (`amp-blackboard-audit.md §3b`; INV-J's "resident Current Situational
  Model" is the same object).
- **the juniors-coordination gap** (INV-D ORGANIZE/delegate) — handoff/control/posts between agents.

It is no longer "the cross-surface bus for the credit flow"; it is **the substrate the resident mind
thinks on, the surfaces render, and the juniors coordinate over** — the literal spine of the org-brain.

### 5.2 The convergence Face wave + Mind wave become ONE blackboard-spine wave

The two source roadmaps already point at the same keystone from opposite ends:
- **Face Wave 4** ("bidirectional shared state — the co-build loop — the frontier gap"): an AG-UI-shaped
  `STATE_SNAPSHOT`/`STATE_DELTA` channel; live host-bridge on every artifact via
  `packages/genui/src/genui-host-actions.ts`; server-push partial-update into a live open surface.
- **Mind Wave 1** (`SituationalModel` object, organ #2) → **Mind Wave 3** (the resident `EstateMind`
  loop reads/writes it).

**Amplification fold:** these are **two halves of one blackboard-spine wave**. Sequence:

> **Spine-0 (persistence + wiring):** `blackboardSlots` table + migration + SQL repo + declare deps +
> `blackboard.hono.ts` + `SlotDelta` broadcaster on `state-bus`. *Closes the floor for all three roles.*
>
> **Spine-1 (Mind read/write):** `EstateMind.tick()` writes situational slots; `think(req)` reads them;
> `pickNext()` becomes the metalevel heartbeat. *= Mind W1+W3 on the spine = COG-15.*
>
> **Spine-2 (Face two views):** `use-slot` in owner-web + both mobiles; inline + tab render the same
> slot; host-actions patch back; Interactable `artifact_id` re-renders in place. *= Face W4 = EA-05.*
>
> **Spine-3 (juniors):** register juniors as KSes; `ControlActivation` dispatcher; posts/handoff/xref.
> *= INV-D ORGANIZE/delegate on the spine.*

The **Visual OS render discipline** (§2) is the *Face-side* render layer that consumes Spine-2 — it is a
parallel track that lands on the same arbiter + genui renderers and does not block the spine wave. Order:
invert the prose-default + unify the router (§2.1-2.2) → SVG/HTML rigor + DOMPurify + INV-K (§2.3) → SVG
node-click loop (§2.4, depends on Spine-2's slot-delta for the re-render half).

### 5.3 Build-roadmap placement (flag-default-safe, status-only rail honored)

Folding into the existing dependency spines:

```
Mind:  W0 honesty+durable+rails ─► W1 SituationalModel ─┐
                                                        ├─► [BLACKBOARD-SPINE WAVE] ─► W4 Closure ─► …
Face:  W0 coherence ─► W1 visible-work(STATUS-only) ────┘        (Spine-0..3)
                                                        ╰─► Visual-OS render discipline (§2) ──────────►
```

- **Prereqs honored:** Spine-0's durable slot needs the durable substrate (Mind W0.3); the Mind
  read/write needs `EstateMind.tick()` (Mind W3); the Face subscriber needs thread hydration (Face W0).
- **Flag-default-safe:** the spine ships behind a default-OFF flag per tenant (canary internal first);
  no surface changes until the flag flips; every slot mutation that touches an owner surface is
  proposal-gated + reversible (UI invariant); money/licence/deletion stay HITL.
- **Status-only rail (§1.4):** the internal partition (situational activation, control activations,
  junior posts, debate) lives on the spine but is filtered out of the `state-bus` owner broadcast — the
  owner sees STATUS + the final output slot + evidence only. This is enforced at the broadcaster.
- **INV-K:** every artifact the Visual OS discipline emits flows through the design-system tokens, so the
  product feels like one platform from chat to the deepest SVG.

The **wow-demo critical path** (Face §9) becomes literally true once the spine + render discipline land:
"Site B royalty if gold drops 8%" → STATUS ("analyzing…") → a live forecast chart draws inline (richest-
default, §2.1) → owner drags the price slider (SVG node-click → `genui:node-action` → slot delta, §2.4)
→ the **same** chart re-renders (Interactable `artifact_id` reading the slot, §2.4 + Spine-2) → "pin to
my cockpit" → the inline artifact becomes a tab with zero refetch (same slot, two views, §1.2) →
next week the tab re-opens Live with a diff badge (the durable slot, §1.3.1). One state, two views,
fully audited, EN-or-SW absolute, every artifact Borjie-styled.

---

## 6. BOTH REPOS — the spine + discipline are domain-free; BN inherits

The blackboard spine and the Visual OS render discipline are **entirely domain-agnostic** — the same way
the Face and Mind dossiers conclude. The CRDT slot bus, the control shell, the KS registry, the arbiter,
the genui renderers, the host-action contract, the design-system tokens carry **zero** mining or
real-estate semantics; only the *slot contents* and the *junior set* differ.

- **Discipline:** build the spine + the render discipline in the **shared spine**
  (`packages/blackboard-sota`, `packages/blackboard-intel`, the modality-arbiter, `packages/genui`,
  `packages/chat-ui`, the design-system) so BossNyumba inherits both by registering its real-estate
  domain slots + junior KSes. The Face dossier's rule holds: any BN-side divergence re-introduces
  duplication debt.
- **The one BN delta the gap register flags (EA-10, `:183`):** BossNyumba has actuators but **zero
  body-model layer** — `blackboard-sota` is not ported to BN at all. So the amplification's BN action is
  literal: **port `blackboard-sota` (+ the system-graph + body-change syscall) to BN**, then BN's Face,
  Mind situational model, and juniors coordination all light up on the shared spine. The Mind dossier's
  BN deltas (behind on embodiment EA-10, far behind on domain depth DM-12) are the same two BN gaps; the
  spine wave serves both repos and BN parity is then "load the real-estate ontology pack + build the BN
  body-model + manufacture BN juniors."

**Wherever this dossier says "mining," read "or real-estate."** The spine is built once in Borjie,
inherited by BossNyumba.

---

## 7. The one-line takeaway

The blackboard is the **right substrate, fully built, fully tested, 0% wired** — and the *exact* object
three separate research lanes independently asked for (the Face's two-views-of-one-state, the Mind's
resident Current Situational Model, the juniors' coordination board). The amplification is to **promote
it from a dark, deferred, credit-flavored library to the ONE shared-state spine of the org-brain — wire
it once to close EA-05 + COG-15 + the juniors gap together — and adopt the Visual OS as the Face's render
discipline (default-to-richest as a code invariant, one modality-arbiter router with a visual-type
sub-layer, INV-K-clean SVG/HTML rigor with DOMPurify, and a clickable-node → slot-delta → re-render loop
that is the same mechanism as the Face's bidirectional shared state).** Every claude.ai primitive in the
spec maps onto a self-hosted seam we already own — several of ours are *stronger* — so the work is wiring
and depth, not a rewrite. It folds into the master convergence as a promoted **blackboard-spine wave**
that the Face wave and the Mind wave converge into, honoring the status-only rail (internal partition
never broadcast) and INV-K (one design system to artifact depth), identical for Borjie and BossNyumba.
```

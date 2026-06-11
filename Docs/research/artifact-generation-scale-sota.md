# Artifact Generation & Scale SOTA — ONE spec, ANY artifact, ANY surface, ANY scale, intelligently chosen

**Lane:** `artifact-generation-and-scale-sota`
**Date:** 2026-06-09
**Audience:** Mr. Mwikila brain layer (Borjie) + BossNyumba (shared engine, different domain layer)
**Scope:** the SOTA of INTELLIGENT, DYNAMIC artifact generation + rendering at ANY scale — from an inline metric to a 1,000-node graph to a live dashboard — rendered to ANY surface (in-chat inline / blackboard CRDT slots / tabs-cockpit / document / media) from a SINGLE declarative spec, the artifact CHOSEN by intent+data, streamed, branded, and safe.
**Register tie-ins:** INV-C (output) infinite-by-composition + self-extending primitives via the meta-rail + CONFORMANCE GATE; INV-H Visual OS render discipline; INV-K one Chrome-level design system to artifacts; INV-L render-decision (inline vs blackboard vs tab) + persistent thought-trend; INV-H/D no-IP-leak.
**Sibling dossier (do not duplicate):** `data-viz-sota.md` owns the *chart-internal* intelligence (Draco/Mackinlay selection grounding, faithfulness gate, perceptual aesthetics, Vega-Lite interactivity). THIS dossier owns the layer *above* the chart — the cross-surface spec, the artifact-vs-artifact arbiter, any-scale rendering, composition/self-extension, and live artifacts.

---

## 0. Thesis in one sentence

There must be ONE declarative artifact spec — a typed tree referencing only a trusted, per-surface catalog of vetted primitives — that the MD synthesizes for ANY intent, that an **intelligent arbiter** chooses the *form* of (metric vs table vs chart vs diagram vs dashboard vs document vs media vs interactive app), that renders **the same spec** to chat / blackboard / tab / document / media through surface-specific renderers, that **streams progressively** and **degrades by level-of-detail** so it works at any scale (1 datum → 1,000 nodes → live feed), that is **branded** to one Chrome-level design system, that can **re-query the brain** while it lives (Live Artifacts), and whose primitive alphabet is **unbounded by composition + safely self-extending** through the conformance gate — never a hardcoded catalog of allowed outputs.

The 2026 industry has now converged on exactly this architecture as four named protocol layers (A2A / MCP / AG-UI / A2UI) plus a "generative-UI spectrum" (controlled → declarative → open). Borjie already has the rarest and hardest pieces (the 32-entry zod catalog as a security boundary, the blackboard CRDT spine, portal-genui tab synth, the CSP-sandboxed surface). The gap is (a) ONE spec/arbiter unifying the five un-unified subsystems, (b) any-SCALE rendering discipline, and (c) Live Artifacts.

---

## 1. The 2026 protocol stack — declarative cross-surface artifact specs

The frontier has *standardized* the exact shape Borjie's INV-C/INV-L imply. Four layers, each a real shipping protocol:

| Layer | Protocol (2026) | What it carries | Borjie analogue |
|---|---|---|---|
| Agent ↔ agent | **A2A** | task delegation between agents | internal juniors (NEVER A2A-exposed — leaks topology; A2A only at the regulator/buyer trust boundary per the orchestration keystones) |
| Agent ↔ tools/data | **MCP** | tool calls, data, `ui://` resources | tool-dispatcher, juniors-as-tools |
| Agent ↔ user (runtime) | **AG-UI** | the streaming transport: `RUN_STARTED/FINISHED`, `STATE_DELTA`, `TOOL_CALL_*`, `USER_ACTION` over SSE/WS | our brain SSE stream (status frames only, per INV-H/D) |
| Agent → describes UI | **A2UI / json-render / MCP-Apps** | the *declarative spec* of what to render — surfaces, components, data model — **not executable code** | `@borjie/genui` 32-entry catalog + AG-UI parts |

The canonical decomposition (Vishal Mysore, *The Essential 2026 AI Agent Protocol Stack*): *"Agents talk to agents → A2A. Agents call tools & systems → MCP. Agents talk to users → AG-UI. Agents describe UI → A2UI / Open-JSON-UI."* AG-UI is an **event-driven transport, not a UI framework**; it carries A2UI specs incrementally via `STATE_DELTA` (deltas, never full snapshots). A2UI is a **declarative spec** of *what* to render, transport-agnostic.

**The load-bearing security property (the whole reason this stack exists):** the agent emits a **declarative component description, not executable code**. A trusted **client-side catalog** interprets the spec into the host's own vetted components. *"Unlike HTML/JavaScript approaches, A2UI transmits declarative component descriptions, not executable code. Clients render A2UI messages using their own trusted components, eliminating security risks."* This is **exactly INV-C's "zod-typed primitive = per-primitive security boundary; composition space unbounded."** The frontier independently arrived at Borjie's invariant.

The concrete shipping implementations to study:
- **Google A2UI** — JSON component messages render natively cross-platform: web (Lit/Angular/React), mobile (Flutter/SwiftUI/Jetpack Compose), desktop. In production behind Opal, Gemini Enterprise, Flutter GenUI SDK. **This is the cross-surface ideal: one spec → many native renderers.**
- **Vercel json-render** (Jan 2026, Apache-2.0, 13k★) — "developers define a catalog of permitted components using **Zod schemas**; an LLM generates a JSON spec **constrained to that catalog**" → a "flat JSON tree of typed elements referencing only catalog entries." Ships renderers for **React, Vue, Svelte, Solid, React Native + PDF + HTML-email + Remotion video + OG-image + React-Three-Fiber 3D** — i.e. *the same spec renders to chat, document, AND media*. This is the literal blueprint for "one spec → any surface."
- **MCP Apps** (official MCP extension, 26-Jan-2026; shipped in Claude/ChatGPT/Goose/VS Code) — tools declare `_meta.ui.resourceUri` → `ui://` HTML bundle; host renders in a **sandboxed iframe**; bidirectional via **JSON-RPC over postMessage** (`app.callServerTool()`, `app.updateModelContext()`, `app.ontoolresult`). This is the "open" end of the spectrum + the live-re-query mechanism.
- **AG-UI** (CopilotKit; AWS Bedrock AgentCore + MS Agent Framework added native support, Mar 2026) — the SSE transport with bidirectional `USER_ACTION` feedback that makes interaction a labeled signal stream.

### The Generative-UI SPECTRUM (CopilotKit, Apr 2026) — the single most useful frame for INV-C

The dial runs **control → flexibility** across three named buckets, and the insight is *you mix all three in one session*:

| Bucket | Mechanism | Trade-off | Use for |
|---|---|---|---|
| **Controlled** | dev ships fixed components; agent only *selects* which + supplies data (zod-typed) | pixel-perfect, bounded, lowest autonomy | brand-critical surfaces (a royalty confirmation, a payment card) |
| **Declarative** | dev ships "lego" primitives; agent *composes* them into a UI tree at runtime | broad, slightly less deterministic | long-tail / internal (most of the MD's analytical output) |
| **Open** | agent emits full HTML/SVG markup or an embedded MCP App (sandboxed) | max expressiveness, higher error/cost, experimental | one-off custom visualizations, novel mechanisms |

The named spectrum axis from their diagram: **Manually-Emitted → Tool-Rendering → Fixed-Catalog → Fixed-Schema → Enriched-Markdown → Enriched-HTML**. *"No single approach is appropriate in all circumstances… a chat session might render a Controlled dashboard, a Declarative report, and an Open MCP App sequentially."*

**This is the spec for INV-C's "infinite by composition + self-extending":** Declarative is the *default* (unbounded composition over the vetted catalog); Open (sandboxed-surface) is the escape hatch for the genuinely novel; Controlled is the rail for irreversible/brand-critical actions. Borjie has all three (`@borjie/genui` catalog = Declarative, `sandboxed-surface.ts` = Open, inline `confirmation_card` = Controlled) but **no single arbiter that picks the bucket** — that is gap G2 below.

### Token-efficiency frontier — OpenUI Lang

Verbose JSON trees burn output tokens. **OpenUI Lang** (May 2026, MIT) replaces JSON with a line-oriented DSL (`root = Stack([title, tbl])` / `tbl = Table(cols, rows)`) — each line parsed+validated independently → **progressive render without a complete document**, and **~53% fewer tokens vs Vercel json-render** (40–67% range; 148 tokens vs several-hundred for a sample table; GPT-5.2, tiktoken `gpt-5`). The runtime validates mid-stream and **discards invalid fragments rather than crashing**. Relevant because Borjie's catalog emit is currently verbose JSON; a compact line-grammar both cuts cost AND is natively streamable.

---

## 2. INTELLIGENT artifact SELECTION — the modality/topology arbiter (above the chart)

`data-viz-sota.md` covers *which chart* (Draco/Mackinlay). This dossier covers the layer above: *which ARTIFACT FORM* (metric vs table vs chart vs diagram vs dashboard vs document vs media vs interactive-app), *which SURFACE* (inline vs blackboard vs tab vs doc vs media), and *which spectrum bucket* (controlled vs declarative vs open).

### SOTA finding: the right artifact is a function of (intent × data-shape × consequence × surface)

There is no single shipping "artifact arbiter" product — this is genuinely frontier and a differentiator. The pieces that exist:
- **Chart-vs-table is a perceptual question** (Mackinlay APT effectiveness ordering; `data-viz-sota.md` §2): a single value → metric; ≤8 rows → table; a trend/series → line; >6 categories → ranked bar not pie. This is a *deterministic shape classifier*, not LLM vibes.
- **Chart-vs-diagram is an intent question.** Mermaid/diagram work (MermaidSeqBench, Nov 2025) shows LLMs reliably map intent → diagram *type*: a **sequence** of interactions → sequence diagram; **containment/structure** → tree/venn/matrix; **process/flow** → flowchart; **dependency** → DAG/dataflow. The selector reads "Purpose / Main-Components / Interactions" and picks topology. Borjie's blackboard has flow/tree/venn/matrix but selection is the LLM's free choice (audit finding L3).
- **Diagram-vs-document-vs-media is a modality question** — Borjie already has the `modality-arbiter` (7-way: chat|tab|document|media|action|skill|workflow, a rule→pgvector→LLM cascade) but it (a) routes *output channel* not *visual form*, and (b) **fails closed to `chat`/prose** on ambiguity — the inverse of INV-H "default to richest" (audit L1).
- **Render-surface is an INV-L question** — inline (ephemeral, conversational) vs blackboard (persistent, trend-worthy, teaching) vs tab (a durable cockpit lens). The frontier signal: CopilotKit routes "brand-critical → Controlled, long-tail → Declarative, novel → Open"; Claude routes "ephemeral answer → inline, persistent tool → Artifact/Canvas."

### The 2026 consensus pattern: LLM-proposes, constraint-solver-disposes, surface-router-places

1. **Intent + data profile** (cardinality, types, distribution, zero-presence, time-axis, graph-ness) → a feature vector.
2. **LLM proposes** 1–3 candidate artifact forms (cheap, on-device router first).
3. **A deterministic effectiveness + consequence ranker disposes** — prunes forms that can't faithfully encode the data (Draco-style expressiveness), demotes forms that mislead, and *promotes richest-that-fits* (INV-H floor).
4. **The surface router places** it: ephemeral → inline; trend/decision/teaching → blackboard slot (INV-L); durable interactive → tab; signable/exportable → document; visual asset → media. Consequence (irreversible/brand-critical) forces the **Controlled** bucket.

**Beyond-today leap — the unified ARTIFACT ARBITER with an O(|V|+|E|) topology read.** Promote Borjie's `modality-arbiter` from a 7-channel head to a **two-stage artifact arbiter**: stage A picks the *form* (the 32-catalog entry + diagram topology) by intent×data-shape; stage B picks the *surface×bucket* by consequence×persistence×INV-L. Crucially, **flip the fail-closed default from `chat`/prose to the richest-form-that-faithfully-encodes** — make richest a *structural floor*, prose the explicit exception (the single biggest audit gap). The arbiter emits a one-line, IP-safe rationale ("ranked bar inline: 9 categories; 6-row table fits inline; not a tab — ephemeral"). No shipping product chooses *and explains* the artifact form. This is also where the **topology arbiter** (orchestration keystone) lands: the same DAG read that picks swarm topology picks artifact topology (dataflow vs tree vs sankey) from the data graph's parallelism-width/critical-path-depth/coupling-density.

---

## 3. ANY-SCALE rendering — 1 datum → 1,000 nodes → live feed

The hardest, least-solved facet for a *generative* system. An LLM can emit a spec for 6 rows; it must not emit a 100k-row literal. Scale is solved at the *renderer + data-binding* layer, not the spec layer.

### 3a. Progressive / partial-prop STREAMING (small-to-medium)

- **Streamdown** (Vercel's streaming-markdown renderer) — the canonical discipline: *"each token rendered immediately, elements appear as they become unambiguous, DOM updates incrementally without layout instability."* Open a code-block container on the first fence; open a `<table>` and populate cells as they arrive.
- **Vercel AI SDK 5** — *"tool-call inputs now stream by default, providing partial updates as the model generates."* Partial-object streaming is the substrate for partial-prop UI.
- **Suspense-boundary discipline** (RSC streaming guide 2026): wrap each independent data dependency in its OWN Suspense boundary with a **dimension-matched skeleton** (same H×W as final content → zero cumulative-layout-shift). Avoid both extremes: one boundary = whole page blocks on the slowest source; one-per-element = "popcorn effect." TTFT 200–500ms with streaming vs 5–30s without.
- **The chart exception** (`data-viz-sota.md` R2, keep it): **never stream a chart spec piece-by-piece** — a half-spec renders a *wrong* chart. Stream the *narrative* token-by-token; render the *chart* **atomically** on the complete validated payload. So: stream prose + skeleton, land the artifact atomically.

### 3b. VIRTUALIZATION / windowing (large tables, long lists)

- **TanStack Virtual** — the 2026 standard: a 100k-row × 10-col table = 1M DOM nodes; virtualization renders only the visible ~20–40 rows + recycles on scroll. Headless, framework-agnostic, pairs with TanStack Table.
- **Server-driven pagination / infinite-load** — TanStack Virtual + React Query: the spec carries a *data source descriptor* (query + page size), not the rows. "Load-More"/infinite-scroll over server pages feels infinite without page numbers. **The artifact spec must reference a data SOURCE, never inline 1,000 rows.**

### 3c. CANVAS / WebGL + LEVEL-OF-DETAIL (1,000+ node graphs)

- **Sigma.js** — instance-based **WebGL** pipeline, offloads to GPU; renders far larger graphs than SVG/Canvas. **Cosmograph** runs the *force simulation itself on the GPU* → **1M nodes/edges in-browser**. (Borjie already ships `@borjie/graph-viz` with ECharts/Cytoscape/Sigma/ReactFlow.)
- **Viewport culling + progressive refinement** — skip off-screen marks; show a coarse representation first, refine on zoom.
- **Semantic zoom / LOD** (yWorks "smart zoom", semantic-zoom literature 2026) — *qualitatively* adapt the representation at each zoom level: at far zoom show clusters + essential labels only (larger font, fewer objects → less memory, better readability); reveal richer structure/attributes as the user zooms in. This is the **Google-Maps pattern applied to artifacts**: a 1,000-node estate graph renders as ~12 cluster super-nodes by default, expanding on demand.
- **Graphologue** (interactive diagrams from LLM responses) — the precedent for turning a long LLM answer into a navigable diagram rather than a wall of prose.

### Beyond-today leap — the spec carries a SCALE-POLICY, the renderer enforces LOD

Make **scale a first-class field of the artifact spec**, not an afterthought: every data-bound primitive declares `{ source, estimatedCardinality, scalePolicy }`. The renderer reads `scalePolicy` and **auto-selects the rendering strategy by cardinality bucket**: ≤8 → inline literal; ≤10k → virtualized DOM (TanStack); ≤200k → canvas; >200k → WebGL + GPU sim (Cosmograph) + semantic-zoom LOD + server-side aggregation. The LLM **never emits >N rows** — it emits a source descriptor + a render hint; the renderer fetches+windows+aggregates. One spec, any scale, because the spec describes *intent + source*, not *materialized data*. This is the missing discipline: today our charts render `actions={false}` static, and there is no cardinality-aware strategy switch. Pair with **streaming SVG** for diagrams (Claude→Excalidraw streams *stroke-by-stroke* over MCP, the 2026 proof that even hand-drawn artifacts can stream) so a 200-node dataflow paints progressively instead of blocking.

---

## 4. COMPOSITION + SELF-EXTENSION — the unbounded alphabet, safely grown (INV-C)

### SOTA finding: "constrained generation over a typed catalog" is now the universal safety pattern

Every serious 2026 system (json-render, Tambo, A2UI, MCP-Apps, LangChain GenUI, Thesys C1) uses the **same** mechanism: a developer-defined catalog of components with **zod/typed schemas + a natural-language `description` the LLM reads to know when to use each**, and **constrained generation** so the model can only emit catalog entries. *"The LLM produces a flat JSON tree of typed elements referencing only catalog entries."* This is **infinite-by-composition**: a bounded alphabet (the catalog) yields unbounded sentences (the composed trees). It is exactly Borjie's INV-C and the existing `@borjie/genui` 32-entry catalog with zod re-validate as the security boundary.

The security urgency is real and rising: **30 MCP CVEs in 60 days (early 2026); 38% of 500+ scanned MCP servers had NO auth.** Constrained-catalog generation is the defense — the agent cannot emit malicious React/JS because it cannot emit code at all, only declarative catalog references (json-render's stated advantage). Tambo and Thesys C1 (OpenAI-compatible endpoint returning *UI instead of text*, streamed progressively) are the managed-service incarnations; the open patterns (json-render, OpenUI Lang) are the self-host blueprints Borjie should mirror, since INV-H/D forbids sending our catalog/topology to a third-party UI service.

### SOTA finding: SELF-EXTENSION (mint a new primitive) is the open frontier — almost nobody does it safely

The "open" bucket (MCP-Apps, full-markup) lets an agent emit *novel* UI, but **un-vetted** — that's the error/cost/risk corner of the spectrum. Borjie's INV-C demands the *opposite*: when a primitive is genuinely missing, the MD **mints a new vetted primitive** via the body-change meta-rail + the **CONFORMANCE GATE** (K-6), which stamps every new primitive with the invariants (EN/SW purity, NO-IP-LEAK, a11y, dark-mode, reversibility, INV-K design tokens) **before it can render**. The alphabet grows; every new letter is vetted. No shipping product has this — they either freeze the catalog (Controlled/Declarative) or render un-vetted markup (Open). The conformance gate is the synthesis: **Open-bucket expressiveness with Declarative-bucket safety.**

### Beyond-today leap — the self-extension pipeline as a body-change with a CONFORMANCE GATE

The mint path: competence-gap detected → MD drafts a new primitive (a zod schema + a renderer fragment in OUR design tokens) → it runs through the **conformance gate** as a battery of machine-checkable assertions (renders in light+dark; passes axe-core a11y; contains zero IP-leaking strings; uses only design-system tokens — no hardcoded hex, the exact audit-flagged debt; is reversible/removable; EN and SW copy both present) → **sandboxed smoke-render in the isolated-vm** → human-gate via the body-change syscall → registered into the catalog → now composable forever. This makes the catalog a *living, growing* security boundary rather than a frozen list, and is the architectural realization of "infinite output ≠ unsafe." It also closes the audit's `dangerouslySetInnerHTML`-without-DOMPurify hole by construction: a minted SVG primitive is gate-checked, not free-rendered.

---

## 5. LIVE / INTERACTIVE artifacts — the artifact that re-queries the brain

### SOTA finding: the artifact is becoming an intelligent micro-app, not a picture

**Claude Live Artifacts** (Anthropic, Apr 2026) is the headline shift: artifacts that *"call Claude's API directly from within the artifact, turning the interface into an intelligent layer rather than a static front-end."* They have **persistent storage, MCP connections to external services (Calendar/Gmail/Slack), and refresh with current data every time reopened** — "persistent dashboards that pull fresh data every time you open them." Anthropic is framing these as *replacing dashboards*: a Live Artifact is a KPI monitor / pipeline tracker that stays connected to its source. Combined with persistent storage, *"these artifacts maintain conversation-like context, remember preferences, and accumulate results across sessions without replaying the whole chat."*

The bidirectional machinery is standardized:
- **MCP Apps** — the iframe calls back via `app.callServerTool()` + `app.updateModelContext()` (JSON-RPC/postMessage), with optional **user-consent on UI-initiated tool calls**, and all messages auditable.
- **AG-UI** `USER_ACTION` — a click/accept/reject/edit is a labeled event back on the same stream → a live human-in-the-loop feedback signal (CopilotKit: *"every time a user steers the agent, that's a labeled signal"*).
- **Vega-Lite selections** (`data-viz-sota.md` §5b) — a click on a mark filters a linked view; wired to a chat-event bus, a chart click *becomes a chat turn*.

### Beyond-today leap — Live Artifacts as chat-aware, brain-re-querying lenses on the blackboard, with NO IP leak

Borjie's INV-B "live lenses" + INV-L "blackboard thought-trend" + Claude's Live-Artifacts pattern unify into: an artifact pinned to a **blackboard CRDT slot** that (a) **re-queries the MD brain** on interaction (click a pit on the estate map → the MD answers "Geita Q3 dip" as a turn), (b) **refreshes from its bound source** when reopened (a royalty-forecast lens pulls fresh ledger state), (c) **persists its state in the slot** (the trend accumulates), and (d) routes **every** re-query through the **central IP-egress guard** so a live artifact can never leak chain-of-thought/architecture even when it calls back. The critical Borjie-specific constraint the frontier ignores: Live Artifacts call back to the *model API directly* — for us that callback MUST go through the gateway's policy-gate + egress-guard (status+outputs+evidence only, never internals), and money/licence/deletion interactions stay HITL (Controlled bucket). This is **Live Artifacts with the IP moat and the fiduciary rail intact** — a posture no consumer product has, because none has our no-IP-leak + double-control invariants.

---

## 6. The ONE answer — how a single spec renders to chat + board + tab + doc, chosen, at scale, streaming, branded, safe

Tying the lane's question to one architecture (all five mechanisms are already proven in 2026 products; the novelty is *unifying* them under Borjie's invariants):

1. **ONE declarative spec** = a typed tree over the trusted catalog (json-render/A2UI shape), each node `{ kind, props, source?, scalePolicy?, surfaceHint?, bucket? }`. Emitted compactly (OpenUI-Lang-style line grammar for token+streaming efficiency), zod-validated on ingress (the security boundary), describing **intent + source**, never materialized data.
2. **Chosen** by the unified **artifact arbiter** (§2): form by intent×data-shape (Mackinlay/Draco-grounded, `data-viz-sota.md`), surface×bucket by consequence×persistence×INV-L, **defaulting to richest-that-faithfully-encodes** (INV-H floor), emitting an IP-safe rationale.
3. **Rendered to ANY surface** by surface-specific renderers over the **same** spec — the A2UI/json-render "one spec → React/Vue/RN/PDF/email/video" proof. Borjie's five surfaces: inline (InlineBlockRenderer), blackboard slot (SVG canvas), tab (GenUITabHost), document (document-studio), media (media-engine) — **unified behind one AdaptiveRenderer dispatch keyed on `surfaceHint`.** (Today these are five un-unified subsystems — the central architectural gap.)
4. **At any scale** by the renderer's **cardinality-aware strategy switch** (§3): inline literal → virtualized DOM → canvas → WebGL+LOD+semantic-zoom; the spec carries `scalePolicy`, the renderer enforces it.
5. **Streaming** progressively (Streamdown/Suspense discipline + AG-UI `STATE_DELTA`), **except** charts which land atomically on the complete validated payload; diagrams stream stroke-by-stroke (Excalidraw-over-MCP proof).
6. **Branded** to ONE Chrome-level design system (INV-K) — every primitive renders in design-system tokens (light+dark), enforced by the **conformance gate** (no hardcoded hex — the exact audit debt to close), so chat → tab → doc → media all feel like one platform.
7. **Safe** by four stacked guarantees: (a) declarative-not-executable + zod catalog (per-primitive boundary); (b) the **conformance gate** vetting every minted primitive (infinite-by-composition stays safe); (c) the **CSP-sandboxed surface** for the Open bucket; (d) the **central IP-egress guard** as the final step on every frame (Live Artifacts can't leak). Money/licence/deletion stay Controlled/HITL.

---

## 7. Our gaps vs the SOTA (concrete, ranked by leverage)

| # | Gap | Today (evidence) | Target |
|---|---|---|---|
| **G1** | **Five un-unified render subsystems, no shared spec/router** | `amp-visual-os-render-audit.md`: subsystems A (inline blocks) / B (blackboard) / C (genui catalog) / D (portal-tabs) / E (chat-ui blocks) each have own vocabulary+renderer+trigger | ONE declarative spec + ONE AdaptiveRenderer dispatch keyed on `surfaceHint`; the catalog is the single vocabulary (§6.1, §6.3) |
| **G2** | **No artifact ARBITER; richest-default is a prompt aspiration, fails closed to prose** | `modality-arbiter.ts` routes channel not form, fails closed to `chat`; `block-selector.ts` defaults to `'none'`/prose; richness lives in the home-chat *prompt* only | unified two-stage arbiter (form × surface×bucket), **richest-that-fits as structural floor**, IP-safe rationale (§2) |
| **G3** | **No any-scale rendering discipline** | charts render static `actions={false}`; no cardinality-aware strategy switch; specs can inline rows; graph-viz exists but not LOD/semantic-zoom-driven by spec | `scalePolicy` field + renderer strategy switch (inline→virtualized→canvas→WebGL+LOD); spec references SOURCE not rows (§3) |
| **G4** | **No Live Artifacts (re-query / refresh-on-open / persistent state)** | charts are pictures; no selection→chat-event bus; no artifact-calls-brain path; blackboard slots persist but don't re-query | Live Artifacts on blackboard slots: re-query brain on interaction (through egress-guard + policy-gate), refresh from source, persist state (§5) |
| **G5** | **Self-extension/conformance-gate for minted primitives not built** | catalog is a frozen 32-entry allowlist; `dangerouslySetInnerHTML` without DOMPurify (`chat-ui AdaptiveRenderer.tsx:384`) is the un-vetted-Open hole | the mint pipeline: draft→**conformance gate** (EN/SW, no-IP-leak, a11y, dark-mode, reversibility, tokens)→sandbox smoke-render→human-gate→register (§4) |
| **G6** | **Brand/token discipline half-applied** | owner-web tab renderers token-clean; chat-ui blocks + SVG primitives hardcode hex (`svg-primitives.ts:8-50`, `InlineChartBlock` gold `#d4af37`), light-mode-only `#fff` | conformance gate rejects hardcoded hex; one design system to every artifact incl. SVG/media (INV-K, §6.6) |
| **G7** | **No progressive/partial-prop streaming for artifacts (only text streams)** | home-chat lands `<ui_block>` whole at bubble end; no skeleton-matched Suspense per artifact; no streaming SVG | Streamdown/Suspense discipline + dimension-matched skeletons; atomic-chart exception kept; stroke-streamed diagrams (§3a) |
| **G8** | **Token-heavy verbose-JSON catalog emit** | catalog emitted as full JSON parts | OpenUI-Lang-style compact line grammar (~53% fewer tokens, natively streamable + mid-stream validatable) (§1) |
| **G9** | **Open-bucket present but not arbiter-routed; no IP-egress guard on artifact callbacks** | `sandboxed-surface.ts` exists (good CSP) but the arbiter never routes to it; Live-Artifact callbacks would bypass egress-guard | arbiter routes novel→Open(sandboxed); central egress-guard wraps every artifact frame + re-query (§5, §6.7) |

**Foundation verdict:** Borjie holds the *rarest* pieces the frontier is still standardizing — the zod catalog as a security boundary (= json-render/A2UI, independently), the blackboard CRDT spine (= a cross-surface state plane most products lack), portal-genui tab synth, the CSP-sandboxed surface, and an OKLCH design system. The frontier's lead is in (1) ONE spec/arbiter unifying surfaces, (2) any-SCALE renderer discipline, and (3) Live Artifacts. None of these three require new science — they require *unification* under the invariants Borjie already declared. The beyond-today differentiator across all of it: **an artifact engine that chooses the form AND explains it, scales by spec-declared policy, grows its own vetted alphabet through a conformance gate, and serves Live Artifacts with the IP moat + fiduciary rail intact** — a combination no 2026 product has, because none carries our no-IP-leak + double-control + infinite-but-vetted invariants together.

---

## Sources

- Vishal Mysore — *A2A, MCP, AG-UI, A2UI: The Essential 2026 AI Agent Protocol Stack* — https://medium.com/@visrow/a2a-mcp-ag-ui-a2ui-the-essential-2026-ai-agent-protocol-stack-ee0e65a672ef
- A2A Protocol — *Building AI Agent UIs with A2UI and A2A Protocol in 2026* — https://a2aprotocol.ai/blog/2026-a2ui-developer-guide
- MCP Blog — *MCP Apps: Bringing UI Capabilities To MCP Clients* (26-Jan-2026) — https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- modelcontextprotocol/ext-apps — official MCP Apps spec + SDK — https://github.com/modelcontextprotocol/ext-apps/
- AG-UI Protocol — https://github.com/ag-ui-protocol/ag-ui · docs https://docs.ag-ui.com/introduction
- CopilotKit — *Generative UI Spectrum: How Agents Now Ship Their Own Interfaces* — https://www.copilotkit.ai/blog/generative-ui-explained-how-agents-now-ship-their-own-interfaces · spectrum: https://www.copilotkit.ai/generative-ui-spectrum
- Vercel json-render (InfoQ) — *Vercel Releases JSON-Render: a Generative UI Framework* — https://www.infoq.com/news/2026/03/vercel-json-render/
- Vercel — *AI SDK 5* (partial-object streaming) — https://vercel.com/blog/ai-sdk-5 · Streaming React Components (RSC) — https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components
- Streamdown (Vercel streaming-markdown renderer) — https://www.solosoft.dev/post/streamdown-vercel-2026/
- Next.js — *Streaming / Suspense boundaries* — https://nextjs.org/docs/app/guides/streaming · RSC streaming performance 2026 — https://www.sitepoint.com/react-server-components-streaming-performance-2026/
- OpenUI Lang — *MIT generative UI that cuts LLM output tokens vs JSON* — https://mer.vin/2026/05/openui-lang-mit-generative-ui-that-cuts-llm-output-tokens-versus-json/
- Thesys C1 — generative-UI API (UI instead of text) — https://www.thesys.dev/ · docs https://docs.thesys.dev/guides/what-is-thesys-c1
- Tambo — zod-registered components, MCP support — https://medium.com/@akshaychame2/the-complete-guide-to-generative-ui-frameworks-in-2026-fde71c4fa8cc
- TanStack Virtual — https://tanstack.com/virtual/latest · Table virtualization guide — https://tanstack.com/table/v8/docs/guide/virtualization
- Sigma.js (WebGL graph rendering) — https://www.sigmajs.org/ · *How to Visualize a Graph with a Million Nodes* (Cosmograph) — https://nightingaledvs.com/how-to-visualize-a-graph-with-a-million-nodes/
- yWorks — *Level of Detail for Large Diagrams* (smart/semantic zoom) — https://www.yworks.com/pages/level-of-detail-for-large-diagrams · Semantic Zoom topic — https://www.emergentmind.com/topics/semantic-zoom
- Graphologue — *Exploring LLM Responses with Interactive Diagrams* — https://arxiv.org/pdf/2305.11473
- MermaidSeqBench — *Evaluation Benchmark for LLM-to-Mermaid Sequence Diagram Generation* (Nov 2025) — https://arxiv.org/html/2511.14967v1
- Claude — *Live Artifacts persistent AI workspace* (Apr 2026) — https://www.eigent.ai/blog/claude-live-artifacts-guide · features 2026 — https://suprmind.ai/hub/claude/features/
- Anthropic — *Claude Cowork replacing dashboards with live artifacts* — https://yourstory.com/ai-story/claude-cowork-live-dashboards-ai-bi-disruption
- Claude — live diagrams streamed stroke-by-stroke to Excalidraw over MCP — https://smallai.in/gems-of-ai/claude-live-excalidraw-diagrams
- LangChain — *Generative UI* docs — https://docs.langchain.com/oss/python/langchain/frontend/generative-ui
- awesome-generative-ui (curated index) — https://github.com/narrowin/awesome-generative-ui
- DracoGPT / Draco2 (chart-selection grounding, cross-ref `data-viz-sota.md`) — https://arxiv.org/pdf/2408.06845 · https://github.com/cmudig/draco2
</content>
</invoke>

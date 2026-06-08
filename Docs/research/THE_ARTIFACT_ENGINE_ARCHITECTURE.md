# THE ARTIFACT ENGINE ARCHITECTURE — ONE spec, ANY artifact, ANY scale, ANY surface, intelligently chosen, infinitely + safely extending

**Status:** synthesis architecture spec (buildable, file-level; no code, no commit)
**Date:** 2026-06-09
**Author:** artifact-engine synthesis subagent (workflow orchestration)
**Repos:** Borjie (mining-estate OS) AND BossNyumba (real-estate OS) — the engine is shared spine; only the domain catalog binding differs.
**Bar:** FULL SOTA, best-in-the-world, PhD/MIT. The unified engine that no 2026 product has assembled.

**Invariants bound (the contract this engine MUST satisfy):**
- **INV-C (output)** — infinite-by-composition over a vetted primitive alphabet + self-extending via the body-change **meta-rail** + the **CONFORMANCE GATE (K-6)**; default to richest, prose the fallback; no hardcoded catalog as a capability cap.
- **INV-H / INV-H-amplified** — Visual OS render discipline: default-to-richest, the SVG/HTML engineering rigor, the 7-layer pipeline, the blackboard as the shared-state spine.
- **INV-K** — ONE Chrome-level design system flows to EVERY artifact (chat → tab → doc → media), light+dark, no hardcoded hex, no foreign render.
- **INV-L** — the SOTA render-decision (inline chat vs blackboard slot vs tab) + the persistent, output-level **thought-trend** (decisions/insights/work-products, never internal cognition).
- **INV-H/D (absolute)** — NO IP leak: the spec, the arbiter rationale, the topology, the swarm mechanics stay server-side; every artifact frame + every live re-query passes the central **IP-egress guard**.
- Supporting: INV-G (uncapped capability, only dynamic governance), INV-I (right-chart-for-the-question, perceptually sound), INV-F (money/licence/deletion stay HITL — the Controlled bucket), INV-J (lossless capture/recall).

**Source dossiers synthesized (do not duplicate — this is the unification above them):**
- `artifact-generation-scale-sota.md` (the cross-surface spec, the arbiter, any-scale, self-extension, Live Artifacts — the SOTA frame)
- `artifact-rendering-audit.md` (our render substrate: 5 disjoint vocabularies, ~135 kind-strings, what's PRESENT/ABSENT)
- `amp-visual-os-render-audit.md` (the routing/richness discipline audit; the 7-layer Visual OS mapping)
- `THE_CHAT_SURFACE_ARCHITECTURE.md` (the chat workspace that this engine renders INTO; the SSE event spine; bidirectional state)
- `frontier-unified-surfaces.md` (semantic-lens / KG-OLAP — the *data* side; a lens is one artifact this engine renders)
- `MASTER_GAP_REGISTER.md` INV-C/H/K/L + the G1–G9 artifact gaps

**Sibling that owns the chart-internal layer (do not duplicate):** `data-viz-sota.md` owns Draco/Mackinlay chart selection, faithfulness, Vega-Lite interactivity. THIS dossier owns the layer *above* the chart — the cross-surface spec, the artifact-vs-artifact arbiter, any-scale render, composition/self-extension, Live Artifacts, the conformance gate.

---

## 0. Thesis in one sentence

There is **ONE declarative, zod-typed, A2UI-shaped `ArtifactSpec`** — a tree referencing only a trusted, per-surface catalog of vetted primitives, describing **intent + data-source + scale-policy + surface-hint**, never materialized data — that the MD synthesizes for ANY need, that a **two-stage Selection Engine** chooses the *form and surface* of (defaulting to richest-that-faithfully-encodes), that **one `renderTo(spec, surface)` projector matrix** renders identically to chat-inline / blackboard-slot / tab / document / media on INV-K design tokens, that **scales by a renderer strategy-switch** (inline literal → virtualized DOM → canvas → WebGL+LOD) so it never chokes from one datum to a million nodes, that **streams progressively** (charts land atomically, diagrams paint stroke-by-stroke), that **composes unboundedly** and **mints new vetted primitives at runtime** through the body-change meta-rail + the CONFORMANCE GATE, and whose every frame + every Live re-query passes the central IP-egress guard — so infinite output is never unsafe, and the same engine serves Borjie and BossNyumba.

**The state of play (from the audits):** Borjie holds the *rarest* pieces the 2026 frontier is still standardizing — the 32-entry zod catalog as a security boundary (= json-render/A2UI, arrived-at independently), the blackboard CRDT spine, portal-genui tab synth, the CSP-sandboxed surface, the streaming reducer, an OKLCH design system, and the `mutation-authority` body-change package. **But it is FIVE disjoint render systems (~135 kind-strings, 6+ dispatchers), not one engine.** The three engine-defining properties — (1) ONE spec/arbiter unifying surfaces, (2) any-scale render discipline, (3) self-extension + Live Artifacts — are each ABSENT. **None require new science. They require UNIFICATION under invariants Borjie already declared.** This document is that unification, file-level.

---

## 1. The fragmentation we are unifying (the precise "from")

Per `artifact-rendering-audit.md`, five independent vocabularies, no shared type, no shared dispatcher. The same logical "bar chart" is expressed **four** different ways:

| # | System | Vocabulary | Dispatcher | Surface | "bar chart" as |
|---|--------|-----------|-----------|---------|----------------|
| 1 | `@borjie/genui` AG-UI | 35 `PartKind`s + 32-entry `ARTIFACT_CATALOG` `component_type`s | `packages/genui/src/AdaptiveRenderer.tsx` (35-arm switch) | admin-web Jarvis + widget + artifacts route | `bar_chart` (catalog) / `chart-vega` bar mark (part) |
| 2 | `@borjie/portal-genui` tabs | 22 field + 14 widget kinds | `apps/owner-web/.../genui-tab/GenUITabHost.tsx` | owner-web tabs-cockpit ONLY | `chart_bar` (widget) |
| 3 | owner-web inline blocks | 16 block kinds | `apps/owner-web/.../home-chat/inline-blocks/InlineBlockRenderer.tsx` | owner-web home-chat inline ONLY | `inline_chart` |
| 4 | blackboard | 9 relational primitives | `apps/owner-web/.../blackboard/elements/*` | owner-web blackboard slots ONLY | `chart` kind `bar` |
| 5 | document-studio + media-engine | doc-type registry (open) + 7 media kinds | `packages/document-studio/src/renderers/*` / `packages/media-engine/src/providers/*` | exported file / media URL | (n/a — rendered into a doc) |

**The unification target:** one `ArtifactSpec` union that supersets all five; one `renderTo(spec, surface)` matrix that adapts that one spec to each surface's existing renderer; one Selection Engine that *chooses* the spec; one scale-switch + streaming discipline inside the renderers; one conformance gate that lets the alphabet grow safely; one egress guard wrapping every frame. **Existing renderers are KEPT** — they become per-surface *adapters* fed by the projector, not five parallel authoring vocabularies.

---

## 2. PART 1 — The ONE declarative `ArtifactSpec` (the security boundary AND the cross-surface contract)

### 2.1 The shape — zod-typed, A2UI/json-render-shaped, describes intent + source, never materialized data

A single discriminated-union spec. Every node is `{ kind, props, source?, scalePolicy?, surfaceHint?, bucket?, themeTokenSetId, locale, evidenceIds }`. The `kind` references **only** a catalog primitive (the per-primitive security boundary, INV-C). The spec carries a **data-source descriptor**, never the rows (the any-scale precondition, §4).

```
ArtifactSpec (the ONE union — supersets the 5 vocabularies)
├─ kind: PrimitiveKind            // references the trusted catalog ONLY (the security boundary)
├─ props: <zod schema for kind>   // pixel/format params (the catalog's existing per-kind schema)
├─ source?: DataSource            // { query | inlineData(≤N) | lensRef | streamRef } — a DESCRIPTOR, never 50k rows
├─ scalePolicy?: ScalePolicy      // { estimatedCardinality, strategyHint, aggregation, lodLevels } — §4
├─ surfaceHint?: SurfaceHint      // 'inline' | 'blackboard' | 'tab' | 'document' | 'media' (a HINT; arbiter decides)
├─ bucket?: GenUiBucket           // 'controlled' | 'declarative' | 'open' — the generative-UI spectrum (§3)
├─ themeTokenSetId: string        // INV-K — binds to a design-token set (today declared-but-dead; we WIRE it)
├─ locale: 'en' | 'sw'            // EN/SW absolute (bilingual purity gate)
├─ evidenceIds: string[]          // INV evidence-required — non-empty or the Auditor rejects
├─ interactivity?: LiveBinding    // §6 Live Artifacts — { reQueryTool, refreshSource, persistSlot } (HITL-gated)
└─ children?: ArtifactSpec[]      // INFINITE BY COMPOSITION — recursive (dashboard/section/layout)
```

**Two emit forms, one parse:**
- **Verbose JSON** (today's catalog emit) — kept as the canonical wire shape on ingress; zod-validated as THE security boundary (`packages/genui/src/validate-artifact.ts` `validateAndRender`).
- **Compact line-grammar** (OpenUI-Lang-shaped DSL: `root = Stack([title, chart])`) — ~53% fewer output tokens, **natively streamable + mid-stream validatable** (each line parsed+validated independently, invalid fragments discarded not crashed). The brain emits this; a parser expands it to the JSON spec on ingress. This is a **token-efficiency + streaming** win, not a second vocabulary.

### 2.2 Why this is the security boundary

The agent emits a **declarative component description, not executable code** (the A2UI/json-render/MCP-Apps universal 2026 pattern, independently = Borjie's INV-C). A `kind` not in the catalog → rejected → `UnknownKindCard`. Per-primitive `safeParse` + the dispatcher's defense-in-depth re-validate (`AdaptiveRenderer.tsx:145-173`) are the type boundary. The LLM **cannot emit malicious React/JS** — only catalog references + zod-shaped props. This is why "infinite output" stays safe (§5).

### 2.3 The spec is the SUPERSET, not a sixth vocabulary

Each existing vocabulary maps INTO `ArtifactSpec.kind`:
- genui's 32 catalog `component_type`s → `PrimitiveKind` directly (the canonical alphabet of record).
- portal-genui's 14 widget kinds + 22 field kinds → `PrimitiveKind` (the `genui_part` bridge widget becomes a real mount, not a placeholder card — see §5/G-fix).
- inline-block's 16 kinds → `PrimitiveKind` (with a `surfaceHint:'inline'` default).
- blackboard's 9 relational primitives → `PrimitiveKind` (with `surfaceHint:'blackboard'`).
- document-studio doc-types + media-engine media-kinds → `PrimitiveKind` with `surfaceHint:'document'|'media'`.

**One alphabet (`PrimitiveKind`), authored once, in `packages/genui/src/catalog.ts` as the registry of record.** portal-genui stops string-mirroring (`portal-genui/src/types.ts:49-85`) and imports the canonical kinds.

---

## 3. PART 2 — The SELECTION ENGINE (right-artifact-for-intent+data, defaulting to richest)

Today selection is three weak mechanisms (a prose prompt directive + the `modality-arbiter` that **fails closed to chat/prose** + N hardcoded `switch (kind)` dispatchers). There is **no right-artifact engine** because there is no unified vocabulary to select over. §2 gives us the vocabulary; this is the selector over it.

### 3.1 The 2026 consensus: LLM-proposes, constraint-solver-disposes, surface-router-places

A two-stage arbiter, promoting the existing `modality-arbiter` (`packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts`) from a 7-channel head to an artifact arbiter:

**Stage A — pick the FORM** (which primitive + topology), by `intent × data-shape × consequence`:
1. **Data profile** → a feature vector: cardinality, types, distribution, zero-presence, time-axis presence, graph-ness (the O(|V|+|E|) topology read — parallelism-width / critical-path-depth / coupling-density, shared with the swarm-topology arbiter per the orchestration keystone).
2. **Deterministic shape classifier first** (not LLM vibes): single value → `kpi_tile`; ≤8 rows → `data_table`; trend/series → `line_chart`; >6 categories → ranked `bar_chart` not pie (Mackinlay APT effectiveness, `data-viz-sota.md`); a **sequence** of interactions → sequence diagram; **containment/structure** → tree/venn/matrix; **process/flow** → flowchart; **dependency** → `dataflow_diagram`/DAG (MermaidSeqBench intent→topology).
3. **LLM proposes 1–3 candidate forms** only when the deterministic classifier is ambiguous (cheap on-device router first; cascade to a small LLM).
4. **Effectiveness + consequence ranker disposes** — prunes forms that can't faithfully encode the data (Draco-style expressiveness), demotes misleading forms, **promotes richest-that-fits** (the INV-H floor).

**Stage B — pick the SURFACE × BUCKET**, by `consequence × persistence × INV-L`:
- **Surface** (INV-L): ephemeral/conversational → **inline** (chat bubble); trend-worthy / decision / insight / reference / teaching → **blackboard slot** (the persistent, de-duped, time-ordered thought-trend); durable interactive cockpit lens → **tab**; signable/exportable → **document**; visual asset → **media**.
- **Bucket** (the generative-UI spectrum — CopilotKit's control→flexibility dial):

| Bucket | Mechanism | Borjie seam | Routed when |
|--------|-----------|-------------|-------------|
| **Controlled** | agent selects a fixed component + supplies zod-typed data | inline `confirmation_card`, payment/royalty cards | irreversible / brand-critical / money/licence/deletion (forces HITL — INV-F) |
| **Declarative** | agent composes catalog "lego" into a tree at runtime | the `ArtifactSpec` over the 32-catalog (THE default) | most analytical output (the long tail) |
| **Open** | agent emits sandboxed bespoke markup | `packages/genui/src/sandboxed-surface.ts` (CSP iframe) | genuinely novel mechanisms the catalog can't express (→ then often a mint candidate, §5) |

### 3.2 The single biggest fix: FLIP the default from prose to richest

Today every code-level default falls to PROSE (`block-selector.ts`→`'none'`, `modality-arbiter`→`chat`, unknown→prose) — the **inverse** of INV-H. The Selection Engine makes **richest-that-faithfully-encodes a structural FLOOR**; prose becomes the explicit, justified exception (e.g. a genuinely conversational reply where no data-shape warrants a visual). The arbiter emits a **one-line, IP-safe rationale** ("ranked bar inline: 9 categories, 6-row table fits inline, ephemeral so not a tab") — server-side only, never streamed to the client (INV-H/D). **No shipping product chooses the artifact form AND explains it.**

### 3.3 Files

- **Promote**: `packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts` — add Stage-A form selection + Stage-B surface×bucket; keep the 7-modality head as the coarse channel, add the artifact sub-decision. Flip the fail-closed default to richest (prose = explicit exception).
- **New**: `packages/central-intelligence/src/kernel/orchestrator/artifact-arbiter.ts` — the deterministic shape classifier + effectiveness/consequence ranker + topology read (imports the data-viz selection grounding). Pure, port-injected, testable.
- **New**: `packages/genui/src/selection/data-profile.ts` — the feature-vector extractor (cardinality/types/distribution/graph-ness) from a `DataSource`.
- **Retire to a hint**: the prose INLINE-FIRST ladder in `services/api-gateway/src/routes/public-chat.hono.ts:695-749` stays as a *prompt nudge* but is no longer the binding authority — the arbiter is.

---

## 4. PART 3 — ANY-SCALE rendering (1 datum → 1,000 nodes → live feed, never chokes)

Today large artifacts **choke**: zero virtualization anywhere; `DataTable.tsx:102-103` silently truncates at 50 rows; charts push ≤50k rows straight to Vega; `DataflowDiagram` emits O(layers×rows) SVG with no cap. Scale is solved at the **renderer + data-binding** layer, driven by a **spec-declared `scalePolicy`**.

### 4.1 The spec carries scale-policy; the renderer enforces LOD

Every data-bound primitive declares `scalePolicy: { estimatedCardinality, strategyHint?, aggregation?, lodLevels? }` and a `source` (a **descriptor**, never inline rows). The renderer reads `estimatedCardinality` and **auto-selects the strategy by cardinality bucket**:

| Bucket | Strategy | Mechanism | Seam |
|--------|----------|-----------|------|
| ≤ 8 | inline literal | render directly | existing primitives |
| ≤ 10k | virtualized DOM | `@tanstack/virtual` windowing (render visible ~20–40 rows, recycle on scroll) + server-paged source | NEW in `packages/genui/src/components/DataTable.tsx` (replace the `.slice(0,50)`) + a `VirtualList` wrapper |
| ≤ 200k | canvas | offload marks to canvas; viewport culling; down-sample/bin before render | NEW `packages/genui/src/scale/canvas-renderer.ts` |
| > 200k | WebGL + GPU sim + semantic-zoom LOD | Sigma.js / Cosmograph (force sim on GPU, 1M nodes); cluster super-nodes by default, expand on zoom (Google-Maps pattern) | wire existing `@borjie/graph-viz` (ECharts/Cytoscape/Sigma/ReactFlow) behind the strategy switch |

**The LLM never emits >N rows.** It emits a `source` descriptor + a render hint; the renderer fetches + windows + aggregates. One spec, any scale, because the spec describes *intent + source*, not *materialized data*. A 1,000-node estate graph renders as ~12 cluster super-nodes by default (semantic zoom), expanding on demand.

### 4.2 Progressive streaming (the streaming reducer, finally WIRED)

`packages/genui/src/streaming/streaming-artifact.ts` is a correct immutable chunk reducer (`schema → partial* → final`, stale-chunk guards) that **no renderer consumes** today (`AdaptiveRenderer.tsx:8-11` renders only on the COMPLETE payload). We wire it:
- **Prose + skeleton stream**, then the artifact lands. Each independent data dependency wrapped in its OWN Suspense boundary with a **dimension-matched skeleton** (same H×W → zero cumulative-layout-shift, TTFT 200–500ms).
- **The chart exception (KEEP):** never stream a chart spec piece-by-piece — a half-spec renders a *wrong* chart. Stream the narrative token-by-token; **land the chart atomically** on the complete validated payload.
- **Diagrams stream stroke-by-stroke** (the Claude→Excalidraw-over-MCP proof) — a 200-node dataflow paints progressively instead of blocking.

### 4.3 The inline → board → tab PROMOTION path (one spec, three mounts, no refetch)

The "same descriptor, three mount points" of `THE_CHAT_SURFACE_ARCHITECTURE.md` §3.2: a spec rendered inline carries a stable `artifact_id`; `requestDisplayMode('tab')` (`packages/genui/src/genui-host-actions.ts` seam) re-mounts the **same** spec as a tab with **zero refetch** (same state object). Promotion is a surface re-target via `renderTo` (§5), not a re-authoring. Reverse demotion is symmetric. This is the structural realization of INV-L's render-decision being *fluid*, not fixed at authoring time.

### 4.4 Files

- `packages/genui/src/streaming/streaming-artifact.ts` — already built; **wire into a streaming-capable AdaptiveRenderer path** (new `AdaptiveRenderer.streaming.tsx` branch).
- `packages/genui/src/components/DataTable.tsx` — replace silent `.slice(0,50)` with `@tanstack/virtual` windowing + server-paged source.
- NEW `packages/genui/src/scale/strategy-switch.ts` — the cardinality→strategy selector.
- NEW `packages/genui/src/scale/canvas-renderer.ts` + wire `@borjie/graph-viz` for WebGL+LOD.
- `packages/genui/src/components/DataflowDiagram.tsx` — node cap + LOD + fix the BFS in-degree bug (`:65-74`).
- The catalog schemas (`catalog.ts`) — replace `rows: z.array(...).max(50_000)` literals with a `DataSource` descriptor + `scalePolicy` (the spec references a SOURCE).

---

## 5. PART 4 — CROSS-SURFACE rendering (one spec → chat / board / tab / doc / media, on INV-K tokens)

Today a spec is bound 1:1 to a surface at authoring time; nothing re-targets one spec to another. The A2UI/json-render proof is "one spec → React/Vue/RN/PDF/email/video" via per-surface renderers. We build the **`renderTo(spec, surface)` projector matrix**.

### 5.1 The projector matrix — generalize the existing catalog→AG-UI projector

`packages/genui/src/projector.ts` already projects catalog payloads → `AgUiUiPart` (the AdaptiveRenderer's shape). We generalize it into a **surface-targeted projection matrix**: one `ArtifactSpec` → the right per-surface renderer.

```
ArtifactSpec ──renderTo(spec, surface)──▶ one of FIVE trusted per-surface renderers
   │
   ├─ 'inline'      → InlineBlockRenderer (owner-web home-chat)        [system 3 becomes an adapter]
   ├─ 'blackboard'  → board-element-renderer (owner-web blackboard)   [system 4 becomes an adapter]
   ├─ 'tab'         → GenUITabHost / GenUIWidgetRenderer (owner-web)   [system 2 becomes an adapter]
   ├─ 'document'    → document-studio renderer-factory (PDF/DOCX/XLSX) [system 5a]
   └─ 'media'       → media-engine providers                          [system 5b]
   (and AdaptiveRenderer for admin-web Jarvis + widget)               [system 1]
```

Each existing renderer is **kept** and becomes a **trusted per-surface adapter** that consumes the ONE spec. The projector adapts the spec's `kind` + `props` + `source` into that surface's existing component contract. **A spec authored once now crosses chat ↔ board ↔ tab ↔ doc ↔ media.**

**Fix the one real bridge that's fake:** the portal-tab `genui_part` widget (`portal-genui/src/types.ts:215-278`) today renders only a *placeholder card naming the kind* (`GenUIWidgetRenderer.tsx:46-50`). Under the matrix it **actually mounts** the AG-UI primitive (`renderTo(spec, 'tab')`).

### 5.2 INV-K — one design system to every artifact, enforced not aspired

Today: owner-web HTML renderers are token-clean; **every SVG renderer hardcodes hex** (`DataflowDiagram.tsx:24-36`, `InlineChartBlock.tsx` gold `#d4af37`, `svg-primitives.ts:8-50`); `themeTokenSetId` is **declared-but-dead** (consumed by zero renderers). We:
- **Wire `themeTokenSetId`**: every renderer in the matrix reads it, binds the artifact to a design-token set (the field already exists on `UiArtifactRow`, `validate-artifact.ts:35`).
- **Kill the hex**: every SVG renderer reads CSS-var / design-token colors (the blackboard `VennView` already does `hsl(var(--warning))` — the proof the codebase knows how). Light+dark flip for free.
- **The conformance gate (§6) REJECTS hardcoded hex** in any minted primitive — INV-K by construction, not by review.

### 5.3 IP-egress guard on every frame (INV-H/D absolute)

Every artifact frame + every Live re-query (§6) passes the **central IP-egress guard** (output firewall) as the FINAL step before any client — it strips/blocks IP-leaking content (no chain-of-thought, no prompts, no architecture, no agent/model/provider names, no arbiter rationale), **fail-closed (redact when uncertain)**. One chokepoint so a new or unaudited artifact path cannot leak by omission. Seam: the egress guard sits in the api-gateway response path (`services/api-gateway/src/routes/brain-teach.hono.ts` SSE final-frame hook) and wraps the `renderTo` output before serialization.

### 5.4 Files

- `packages/genui/src/projector.ts` → generalize to `renderTo(spec, surface)`; NEW `packages/genui/src/render-to/` with one adapter file per surface (`to-inline.ts`, `to-blackboard.ts`, `to-tab.ts`, `to-document.ts`, `to-media.ts`).
- `apps/owner-web/.../GenUIWidgetRenderer.tsx:46-50` — make `genui_part` actually mount via `renderTo(spec,'tab')`.
- SVG renderers (`DataflowDiagram.tsx`, `InlineChartBlock.tsx`, `chat-ui/.../svg-primitives.ts`) — read tokens, kill hex.
- All matrix renderers — consume `themeTokenSetId`.
- NEW `services/api-gateway/src/composition/artifact-egress-wiring.ts` — bind the IP-egress guard over every artifact frame.

---

## 6. PART 5 — INFINITE + SELF-EXTENDING (compose unbounded; mint a new primitive safely at runtime)

### 6.1 Infinite by composition (PARTIAL today → COMPLETE)

The composition half is *partially* real: `inline_section`/`inline_dashboard` render children recursively (`InlineBlockRenderer.tsx:248-281`), `DashboardGrid` renders children. The `ArtifactSpec.children[]` recursion (§2.1) makes this **structural and uniform across all surfaces** — a bounded alphabet (the catalog) yields unbounded sentences (composed trees). This is INV-C's infinite-by-composition, done once for every surface.

### 6.2 Self-extending — the mint pipeline (ABSENT today; the headline build)

Today the catalog is a **compile-time HARD CAP** (`catalog.ts:886-892` enforces a floor; adding a primitive = edit ≥3 files + redeploy). The only runtime self-extension is the **`packages/document-studio/src/registry/doc-type.ts`** doc-type registry (genuinely infinite-by-runtime-registration, `authored:true`) — but only for documents, and it registers a `{schema, binder, engineHint}` recipe, not a vetted UI primitive. The `SandboxedSurface` is the *un-vetted* escape hatch (opaque iframe, no tokens, not composable, bypasses the catalog).

INV-C demands the synthesis: **Open-bucket expressiveness with Declarative-bucket safety** — when a primitive is genuinely missing, the MD **mints a new vetted primitive** through the body-change meta-rail + the **CONFORMANCE GATE (K-6)**:

```
competence-gap detected (Open-bucket artifact recurs, or arbiter finds no faithful catalog form)
   │
   ▼
MD DRAFTS a new primitive  = { zod schema + a renderer fragment in OUR design tokens }
   │
   ▼
CONFORMANCE GATE (K-6) — a battery of MACHINE-CHECKABLE assertions, ALL must pass:
   ├─ renders in light AND dark (INV-K)
   ├─ passes axe-core a11y
   ├─ contains ZERO IP-leaking strings (egress-guard scan)
   ├─ uses ONLY design-system tokens — no hardcoded hex (INV-K, the exact audit debt)
   ├─ is reversible / removable (INV-E archive-first)
   ├─ EN and SW copy BOTH present (bilingual purity — today AG-UI primitives are monolingual; this closes it)
   └─ no dangerouslySetInnerHTML without DOMPurify (closes the chat-ui AdaptiveRenderer.tsx:384 hole by construction)
   │
   ▼
SANDBOXED smoke-render in the isolated-vm (it actually renders, headless)
   │
   ▼
HUMAN-GATE via the body-change syscall (packages/mutation-authority/src/body-change) — four-eye on capability change
   │
   ▼
REGISTERED into the catalog → now composable FOREVER (the alphabet grew; every new letter vetted)
```

This makes the catalog a **living, growing security boundary** rather than a frozen list. It is the architectural realization of "infinite output ≠ unsafe." **No shipping product has this** — they either freeze the catalog (Controlled/Declarative) or render un-vetted markup (Open). The conformance gate IS the synthesis.

### 6.3 Files

- NEW `packages/genui/src/self-extension/conformance-gate.ts` — the K-6 assertion battery (light/dark, axe-core, no-hex, EN/SW, reversibility, no-IP-leak, DOMPurify). Pure, testable, the heart of the build.
- NEW `packages/genui/src/self-extension/mint-primitive.ts` — draft → gate → sandbox smoke-render → body-change syscall → register.
- `packages/genui/src/registry.ts` + `catalog.ts` — add a **runtime registration path** (mirror `document-studio`'s `registry.register()` precedent) guarded so only conformance-gate-passed primitives enter; keep the CI floor (`catalog.ts:886-892`) as the minimum.
- Wire through `packages/mutation-authority/src/body-change` (the meta-rail; already has `body-change`, `approvals`, `execution`, `recipes`) — minting is a body-change, routed through the ONE chokepoint (EA-04/AUT-01).
- Replace the un-vetted `chat-ui/.../AdaptiveRenderer.tsx:384` `dangerouslySetInnerHTML` path: a bespoke SVG must be either a gate-checked minted primitive OR go through `SandboxedSurface` (CSP-isolated). No free raw-SVG render.

### 6.4 LIVE / INTERACTIVE artifacts (the artifact that re-queries the brain — with the IP moat intact)

Claude Live Artifacts (Apr 2026) = artifacts that call the model API directly, with persistent storage + refresh-on-open. Borjie's version (INV-B live lenses + INV-L thought-trend + the IP moat) is a Live Artifact pinned to a **blackboard CRDT slot** (`packages/blackboard-sota/src/slots/`) that:
- **re-queries the MD brain** on interaction (click a pit on the estate map → the MD answers as a turn) — the `interactivity.reQueryTool` binding;
- **refreshes from its bound source** when reopened (a royalty-forecast lens pulls fresh ledger state) — `interactivity.refreshSource`;
- **persists its state in the slot** (the trend accumulates) — `interactivity.persistSlot`;
- routes **every** re-query through the **central IP-egress guard + policy-gate** (§5.3) — a Live Artifact can NEVER leak chain-of-thought/architecture even when it calls back. Money/licence/deletion interactions stay HITL (Controlled bucket, INV-F).

The bidirectional machinery rides the existing SSE spine (`THE_CHAT_SURFACE_ARCHITECTURE.md` Wave 4): an AG-UI-shaped `STATE_SNAPSHOT`/`STATE_DELTA` channel, one shared session-state document the brain patches and surfaces patch back, every mutating call proposal-gated. Seam: `packages/genui/src/genui-host-actions.ts` (`requestDisplayMode`, `callBrainTool`, `updateBrainContext`). **Live Artifacts with the IP moat + the fiduciary rail intact — a posture no consumer product has.**

---

## 7. PART 6 — PRESENT / PARTIAL / ABSENT + the EXACT files to unify/build

### 7.1 Status of the six engine properties

| Property | Verdict | Evidence (what's there) | The gap |
|----------|---------|-------------------------|---------|
| (1) ONE declarative spec | **ABSENT** | 5 vocabularies (~135 kinds), zod-typed each | no shared `ArtifactSpec` union; build §2 |
| (2) Selection Engine | **PARTIAL** | modality-arbiter (7-channel, fails closed to chat); deterministic `selectInlineBlock` (defaults `'none'`) | no form×surface arbiter; richest not the floor; build §3 |
| (3) Any-scale render | **ABSENT** | streaming reducer built-but-unwired; graph-viz exists | zero virtualization; truncation; no scale-policy; build §4 |
| (4) Cross-surface render | **ABSENT** | catalog→AG-UI projector; `genui_part` bridge is a placeholder | no `renderTo` matrix; build §5 |
| (5) Infinite + self-extending | **PARTIAL (compose) / ABSENT (extend)** | recursive children; document-studio runtime registry (docs only); SandboxedSurface (un-vetted) | no mint pipeline + conformance gate; build §6 |
| (6) INV-K design tokens | **PARTIAL** | HTML token-clean; `themeTokenSetId` field exists | SVG hardcodes hex; field dead; wire §5.2 + gate §6.2 |
| Conformance gate | **ABSENT** | zod safeParse = type boundary only | no EN/SW/a11y/dark/reversibility/no-IP-leak vetting; build §6.2 |
| Live Artifacts | **ABSENT** | blackboard slots persist; no re-query | no artifact-calls-brain path; build §6.4 |
| IP-egress on frames | **ABSENT (for artifacts)** | egress guard is a chat-text concern | not wired to artifact props; build §5.3 |

### 7.2 Files to BUILD (new) — `filesToBuild`

1. `packages/genui/src/artifact-spec.ts` — the ONE `ArtifactSpec` zod union (the security boundary + cross-surface contract). §2.
2. `packages/genui/src/artifact-spec-linegrammar.ts` — OpenUI-Lang-shaped compact parser → JSON spec (token + streaming efficiency). §2.1.
3. `packages/central-intelligence/src/kernel/orchestrator/artifact-arbiter.ts` — Stage-A form + Stage-B surface×bucket selection, richest-default, IP-safe rationale. §3.
4. `packages/genui/src/selection/data-profile.ts` — data-shape feature-vector extractor (cardinality/types/graph-ness/topology). §3.1.
5. `packages/genui/src/render-to/index.ts` + `to-inline.ts` + `to-blackboard.ts` + `to-tab.ts` + `to-document.ts` + `to-media.ts` — the `renderTo(spec, surface)` projector matrix. §5.1.
6. `packages/genui/src/scale/strategy-switch.ts` + `scale/canvas-renderer.ts` — cardinality→strategy switch + canvas/WebGL+LOD path. §4.
7. `packages/genui/src/self-extension/conformance-gate.ts` + `self-extension/mint-primitive.ts` — the K-6 gate + the mint pipeline. §6.2.
8. `packages/genui/src/AdaptiveRenderer.streaming.tsx` — the streaming-capable render branch that consumes `streaming/streaming-artifact.ts`. §4.2.
9. `services/api-gateway/src/composition/artifact-egress-wiring.ts` — bind the IP-egress guard over every artifact frame + Live re-query. §5.3.
10. `packages/genui/src/live/live-binding.ts` — the `interactivity` (reQuery/refresh/persist) wiring onto blackboard slots + host-actions, all egress+policy-gated. §6.4.

### 7.3 Files to UNIFY (modify existing — keep, adapt, don't rewrite)

- `packages/genui/src/catalog.ts` — canonical `PrimitiveKind` alphabet; replace `rows.max(50_000)` literals with `DataSource` + `scalePolicy`; add runtime-registration path (gated). §2.3/§4/§6.3.
- `packages/genui/src/projector.ts` — generalize into the `renderTo` matrix. §5.1.
- `packages/genui/src/validate-artifact.ts` — validate the ONE `ArtifactSpec`; consume `themeTokenSetId`. §2/§5.2.
- `packages/genui/src/registry.ts` — runtime registration of minted primitives (conformance-gated). §6.3.
- `packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts` — host the artifact sub-decision; flip default to richest. §3.
- `packages/portal-genui/src/types.ts` — stop string-mirroring; import canonical kinds; `genui_part` becomes a real mount. §2.3/§5.1.
- `apps/owner-web/.../genui-tab/GenUIWidgetRenderer.tsx` — mount AG-UI primitive via `renderTo(spec,'tab')` (kill the placeholder). §5.1.
- `apps/owner-web/.../home-chat/inline-blocks/InlineBlockRenderer.tsx` — become a `renderTo(spec,'inline')` adapter. §5.1.
- `apps/owner-web/.../blackboard/elements/*` — become `renderTo(spec,'blackboard')` adapters. §5.1.
- `packages/genui/src/components/DataTable.tsx` — `@tanstack/virtual` windowing; kill `.slice(0,50)`. §4.4.
- `packages/genui/src/components/DataflowDiagram.tsx` — node cap + LOD + fix BFS in-degree bug; read tokens. §4.4/§5.2.
- `apps/owner-web/.../home-chat/inline-blocks/InlineChartBlock.tsx` + `packages/chat-ui/src/generative-ui/svg-primitives.ts` — kill hex, read tokens. §5.2.
- `packages/chat-ui/src/generative-ui/AdaptiveRenderer.tsx:384` — remove un-vetted `dangerouslySetInnerHTML`; route through mint-gate or SandboxedSurface. §6.3.
- `packages/genui/src/genui-host-actions.ts` — add `requestDisplayMode`/`callBrainTool`/`updateBrainContext` for promotion + Live re-query. §4.3/§6.4.
- `services/api-gateway/src/routes/brain-teach.hono.ts` — emit the `ArtifactSpec` + arbiter verdict; stream prose+skeleton then land atomically; final-frame egress hook. §3/§4.2/§5.3.
- `packages/mutation-authority/src/body-change` — minting is a body-change routed through the ONE chokepoint. §6.3.

---

## 8. PART 7 — Same engine, both repos (Borjie + BossNyumba)

The entire engine is **domain-agnostic by construction** — `ArtifactSpec`, the `renderTo` matrix, the scale-switch, the streaming discipline, the conformance gate, the egress guard, Live Artifacts. **Only the catalog binding + the domain data sources differ.** BossNyumba registers its real-estate primitive set into the same `PrimitiveKind` catalog and the same five renderers; it inherits every property the moment it registers its domain artifacts:
- **Port for free:** the spec, the arbiter, any-scale render, cross-surface render, the conformance gate, Live Artifacts.
- **Differs only:** the domain primitives (a rent-roll heatmap vs a recovery-grade chart), the data-source bindings (lease ledger vs royalty ledger), the brand token set (BN's own brand within the SAME INV-K system).
- **Discipline:** build every piece in the shared spine (`packages/genui`, `packages/blackboard-sota`, the modality-arbiter, `packages/mutation-authority`) — any BN-side divergence (its own renderer, its own catalog) re-introduces the five-vocabulary debt this whole document exists to kill.

BN's gap (per the audit, EA-10): it has actuators but ZERO body-model/blackboard layer — porting `blackboard-sota` + the body-change syscall to BN is a prerequisite for BN Live Artifacts, and is already a register row.

---

## 9. Dependency-ordered build-wave list (ship default-ON per FULL-POWERS-ON; kill-switch only)

Per the FULL-POWERS-DEFAULT-ON directive: build → VERIFY end-to-end + safe → DEFAULT ON; the flag name survives only as a kill-switch. Money/licence/deletion stay HITL (Controlled bucket) — the fiduciary rail, never a disabled power.

**Wave 1 — the ONE spec + the projector matrix (the foundation; unblocks everything).**
- `artifact-spec.ts` (the union) + `validate-artifact.ts` consuming it.
- `render-to/` matrix; existing renderers become adapters; `genui_part` becomes a real mount.
- Wire `themeTokenSetId` everywhere; kill SVG hex. (INV-K lands here.)
- *Verify:* one spec renders identically inline + tab + blackboard; light/dark flip; no hex.

**Wave 2 — the Selection Engine (richest-default).**
- `artifact-arbiter.ts` + `data-profile.ts`; promote `modality-arbiter`; flip the default to richest; IP-safe rationale.
- *Verify:* given data+intent, the arbiter picks the faithful richest form + surface + bucket; prose only as justified exception; consequence forces Controlled/HITL.
- *Depends on:* Wave 1 (needs the unified vocabulary to select over).

**Wave 3 — any-scale render.**
- `scale/strategy-switch.ts` + virtualized `DataTable` + canvas/WebGL+LOD; `catalog.ts` rows→source descriptor.
- Wire `streaming-artifact.ts` into `AdaptiveRenderer.streaming.tsx`; prose+skeleton stream, charts land atomically, diagrams stroke-stream.
- *Verify:* 6 rows, 10k rows, 200k points, 1M-node graph all render without choking; zero CLS.
- *Depends on:* Wave 1 (spec carries `scalePolicy` + `source`).

**Wave 4 — IP-egress on frames + the inline→tab promotion path.**
- `artifact-egress-wiring.ts` over every frame, fail-closed; `requestDisplayMode` promotion (zero refetch).
- *Verify:* no artifact frame leaks IP; an inline artifact promotes to a tab with the same state object.
- *Depends on:* Waves 1+2.

**Wave 5 — self-extension (the conformance gate + mint pipeline).**
- `conformance-gate.ts` (the K-6 battery) + `mint-primitive.ts`; runtime registration into `catalog.ts`/`registry.ts` through the body-change syscall.
- Remove the un-vetted `dangerouslySetInnerHTML` path.
- *Verify:* a missing primitive is minted, gated (EN/SW/a11y/dark/reversibility/no-IP-leak/no-hex), sandbox-smoke-rendered, human-gated, then composable forever; the un-vetted raw-SVG hole is closed.
- *Depends on:* Waves 1+5-gate needs `mutation-authority` body-change wired (EA-04/AUT-01).

**Wave 6 — Live Artifacts (the artifact that re-queries the brain, IP moat intact).**
- `live/live-binding.ts` onto blackboard slots; re-query/refresh/persist, every callback through egress-guard + policy-gate; HITL on money/licence/deletion.
- Rides the AG-UI `STATE_SNAPSHOT`/`STATE_DELTA` channel (chat-surface Wave 4).
- *Verify:* click a pit → MD answers a turn; reopen a lens → fresh numbers + diff badge; no callback leaks IP; money interactions gated.
- *Depends on:* Waves 1+4 (spec + egress) and the shared-state channel.

**Wave 7 — BossNyumba parity + standing regression.**
- BN registers its domain primitive set into the shared catalog + renderers; inherits Waves 1–6.
- Eval harness: spec-conformance (one spec → 5 surfaces identical), scale (no-choke budgets), conformance-gate vetting, egress (no-leak fuzz), arbiter richest-default, INV-K token-purity lint (no-hex CI gate).

**Critical-path chain:** Wave 1 (spec + matrix) → Wave 2 (arbiter richest-default) → Wave 3 (any-scale) → Wave 4 (egress + promotion) → Wave 5 (conformance-gate self-extension) → Wave 6 (Live Artifacts). That chain is the literal goal: ONE spec, intelligently chosen, at any scale, on any surface, infinitely + safely extending, with the IP moat and fiduciary rail intact — the engine no 2026 product has assembled.

---

## 10. Net

Borjie holds the rarest pieces the frontier is still standardizing — the zod catalog as a security boundary (= json-render/A2UI, independently), the blackboard CRDT spine, portal-genui tab synth, the CSP-sandboxed surface, the streaming reducer, the OKLCH design system, and the `mutation-authority` body-change package. What it does NOT have is **unification**: it is five rich substrates, not one engine, and the three engine-defining properties (one spec/arbiter, any-scale render, self-extension + Live Artifacts) are each ABSENT. None require new science. This document is the file-level build that fuses them under invariants Borjie already declared: **ONE `ArtifactSpec`, a richest-defaulting Selection Engine, a cardinality-aware any-scale renderer, a `renderTo` cross-surface matrix on one design system, a conformance-gated self-extending alphabet, and Live Artifacts behind the IP-egress guard — the same engine for Borjie and BossNyumba.** The bones are unusually strong; the remaining work is unification and depth, not a rewrite.

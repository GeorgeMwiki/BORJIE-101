# Artifact Rendering Audit — our renderers vs the unified-infinite-any-scale-any-surface goal

**Lane:** `our-artifact-rendering-audit` (repo READ-ONLY)
**Date:** 2026-06-09
**Auditor:** Claude subagent (Opus 4.8, 1M context)
**Scope:** `packages/genui` (AdaptiveRenderer + zod artifact catalog + projector + DataflowDiagram/InlineChart + sandboxed-surface + streaming), `packages/portal-genui` (22-field/14-widget dynamic-tab synth), `packages/document-studio`, `packages/media-engine`, `apps/owner-web` blackboard (9 primitives + replay) + InlineBlockRenderer (16 blocks) + genui-tab host/renderers. Companion to `amp-visual-os-render-audit.md` (which audited the *routing/richness* discipline); this dossier audits the **render substrate** against the unified-engine goal.

---

## TL;DR

**The render substrate is broad, well-typed, and security-conscious — but it is NOT a single unified artifact engine. It is FIVE disjoint render systems, each with its own spec vocabulary, its own dispatcher, and its own surface binding.** Against the seven sub-questions:

| # | Capability | Verdict | One-line |
|---|-----------|---------|----------|
| (a) | SINGLE unified artifact spec | **ABSENT** | 5 separate vocabularies (≈122 distinct kind-strings), no shared spec type |
| (b) | CROSS-SURFACE render of ONE spec | **ABSENT** | Each vocabulary renders to exactly one surface; no spec crosses chat↔board↔tab↔doc |
| (c) | INTELLIGENT artifact selection | **PARTIAL** | Selection is prose-prompt + a fail-closed arbiter + N hardcoded `switch` dispatchers; no right-artifact engine |
| (d) | ANY-SCALE (stream/virtualize) | **ABSENT** | Zero virtualization anywhere; DataTable silently truncates at 50 rows; charts push ≤50k rows straight to Vega |
| (e) | INFINITE / self-extending | **ABSENT** | The zod catalog is a compile-time HARD CAP; no runtime primitive registration, no meta-rail, no conformance gate in any render package |
| (f) | Design-token unification (INV-K) | **PARTIAL** | Owner-web HTML renderers are token-clean; ALL SVG + half the chat blocks hardcode hex; `themeTokenSetId` is declared but consumed by zero renderers |
| (g) | Conformance gate on generated artifacts | **ABSENT** | The per-primitive zod `safeParse` is a *type* boundary, not the K-6 conformance gate (no EN/SW-purity / a11y / dark-mode / reversibility / no-IP-leak vetting of a new primitive) |

The streaming primitive (`createArtifactWriter` / `reduceArtifactChunk`) is the one piece of any-scale machinery present, but it is a generic chunk reducer **not wired into any renderer** — the AdaptiveRenderer explicitly renders only on the COMPLETE payload (`AdaptiveRenderer.tsx:8-11`), so streaming is dead-ended at the display layer.

---

## The fragmentation, quantified (sub-question a)

There are **5 independent artifact vocabularies** with **no shared spec type and no shared dispatcher**. A spec authored for one cannot be rendered by another.

| # | System | Spec vocabulary (kinds) | Dispatcher (the switch) | Surface | Discriminator field |
|---|--------|------------------------|-------------------------|---------|---------------------|
| 1 | **`@borjie/genui` AG-UI** | 35 `PartKind`s + a 32-entry `ARTIFACT_CATALOG` of `component_type`s projected onto those 35 | `AdaptiveRenderer.tsx:175-273` (35-arm switch) | admin-web Jarvis + floating widget + the artifacts route | `uiPart.kind` (35) **and** `component_type` (32) — two keys for one system |
| 2 | **portal-genui dynamic tabs** | 22 field kinds + 14 widget kinds | `GenUITabHost.tsx` → `GenUIFieldRenderer` / `GenUIWidgetRenderer` | owner-web tabs-cockpit ONLY | `field.kind` / `widget.kind` |
| 3 | **owner-web inline blocks** | 16 block kinds (`mini_metric`, `inline_table`, `inline_chart`, `inline_section`…) | `InlineBlockRenderer.tsx:137-307` (own switch) | owner-web home-chat inline ONLY | `block.type` (16) |
| 4 | **blackboard** | 9 relational primitives (`formula`, `diagram`, `chart`, `comparison`, `image`, `text`, `highlight`, `arrow`, `sketch`) | `board-element-renderer.tsx` → `elements/*` | owner-web blackboard slots ONLY | `element.type` (9) |
| 5 | **document-studio + media-engine** | doc-type registry (open) + 7 media kinds | `renderer-factory.ts` (PDF/DOCX/XLSX) / media providers | exported file / media URL | `docType` / `MediaRequestKind` |

**Count: ~35 + 32 + 22 + 14 + 16 + 9 + 7 = ~135 kind-strings across 5 vocabularies and 6+ dispatchers.** The same logical artifact ("a bar chart") is expressed **four different ways**: `bar_chart` (catalog, `catalog.ts:67`), `chart-vega` + a vega `bar` mark (AG-UI part, `projector.ts:99`), `chart_bar` (portal widget, `types.ts:222`), `inline_chart` (inline block), and `chart` kind `bar` (blackboard, `types.ts:80-111`). There is **no `Artifact` union type** anywhere that any renderer accepts; each switch is closed over its own union.

Evidence the systems are genuinely un-unified:
- owner-web home-chat does **not** import `@borjie/genui`'s AdaptiveRenderer at all (grep of `apps/owner-web/src/components/home-chat/` for `@borjie/genui`/`AdaptiveRenderer` returns nothing — it uses its own `InlineBlockRenderer`).
- admin-web's `AdaptiveRenderer.tsx` is a **re-export shim** of `@borjie/genui` (`apps/admin-web/src/lib/genui/AdaptiveRenderer.tsx:7`) — so admin-web + widget share system 1, but owner-web's three surfaces (inline, blackboard, tabs) each run a different one.
- portal-genui re-declares the 35 dashboard kind names as a **string-mirror** (`portal-genui/src/types.ts:49-85`) rather than importing them, kept in sync only by a test — a structural admission the vocabularies are copies, not one source.

---

## Cross-surface rendering of one spec (sub-question b) — ABSENT

A spec is bound 1:1 to a surface at authoring time; nothing re-targets one spec to a different surface.

- An AG-UI part (`uiPart.kind`) can render in admin-web Jarvis and the floating widget — but those are *the same renderer* (system 1), not a cross-surface re-target. It **cannot** appear on the blackboard, in an owner inline bubble, inside a generated tab, or in a document without being re-authored in that surface's vocabulary.
- The blackboard `chart` and an inline `inline_chart` and a catalog `bar_chart` are three separate specs; none is a projection of another. There is no `renderTo(spec, surface)` seam.
- The portal-tab `genui_part` widget is the **single** intentional cross-vocabulary bridge: a tab widget of `kind: 'genui_part'` carries a `genuiKind` pointing at one of the 35 AG-UI primitives (`portal-genui/src/types.ts:215-278`). But (i) `GenUIWidgetRenderer.tsx:46-50` only renders a *placeholder card naming the kind* — it does **not** actually mount the AG-UI primitive — and (ii) it only flows tab→AG-UI, never the reverse. So even the one bridge is a label, not a render.
- The blackboard *is* persistent cross-surface state (CRDT slots, `use-slot.ts`, state-bus) — but it broadcasts blackboard-vocabulary elements between sessions of the **same** surface, not one spec across different surfaces.

Net: the "render ANY spec to ANY surface from a SINGLE declarative spec" goal has **no machinery**. Each of the 5 systems is a vertical silo: author-in-vocabulary-X → render-on-surface-X.

---

## Intelligent selection (sub-question c) — PARTIAL

There is **no right-artifact engine**. Selection is the sum of three weak mechanisms, all confirmed in the companion audit and re-verified here:

1. **Prose prompt directive** — the owner home-chat INLINE-FIRST ladder tells the LLM which of the 16 inline kinds to emit. Non-deterministic; lives in the prompt, not in code.
2. **Modality arbiter** (`packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts`, 17.9 KB) — a 7-way head (chat | tab | document | media | action | skill | workflow). Real and 3-tier, but it picks an **output channel**, not an artifact type, and **fails closed to `chat`/prose** on ambiguity — the inverse of "default to richest". It does not choose chart-vs-flowchart-vs-table.
3. **Hardcoded dispatch switches** — once a kind is chosen, every system is a literal `switch (kind)` (`AdaptiveRenderer.tsx:175`, `InlineBlockRenderer.tsx:137`, `board-element-renderer.tsx`). These are *routing-by-discriminator*, not *intelligent selection*.

There is no component that, given data + intent, **selects** the optimal artifact form across the unified vocabulary (because there is no unified vocabulary). The closest structural selector is `selectInlineBlock()` (cited in the companion audit) whose documented default is `'none'` = prose.

---

## Any-scale: streaming + virtualization (sub-question d) — ABSENT

Large artifacts **choke** — confirmed:

- **Zero virtualization / windowing anywhere.** Grep for `virtuali|react-window|react-virtual|windowing|tanstack/virtual` across `packages/genui` + `apps/owner-web/src/components` returns nothing.
- **DataTable silently truncates.** `DataTable.tsx:102-103`: `const pageSize = props.pageSize ?? 50; const visible = sorted.slice(0, pageSize);` — it renders the first 50 rows and **drops the rest with no pager, no "N more", no windowing**. Yet the catalog permits `rows: z.array(...).max(50_000)` (`catalog.ts:78,94,392,464,504,519`). A 10,000-row table is accepted by the schema, then 9,950 rows vanish at render.
- **Charts push the full row array straight to Vega.** `projector.ts` passes `data: asArray<Props>(data.rows)` unbounded into the vega spec (`:111,127,147`); the catalog caps at 50,000. There is no down-sampling / aggregation / binning before Vega — a 50k-point scatter renders 50k DOM/canvas marks.
- **DataflowDiagram has no node cap and an O(layers×rows) SVG.** `DataflowDiagram.tsx:43-104` lays out every node; a 1,000-node graph emits 1,000 `<g>` groups with no virtualization or LOD. (It also has a BFS-layering bug — `queue.push(to)` without an in-degree gate, `:65-74` — that re-processes nodes, but that is correctness, not scale.)
- **The streaming primitive exists but is unwired.** `streaming/streaming-artifact.ts` is a clean immutable chunk reducer (`schema → partial* → final`) with stale-chunk guards (`:160-210`) — exactly the substrate for progressive large-artifact render. But **no renderer consumes it**: `AdaptiveRenderer.tsx:8-11` mandates "render only on COMPLETE `tool-output-available` payload — never streamed piece-by-piece." So the any-scale machinery terminates before the display layer.

Net: the substrate is built for **small, complete** artifacts. "Inline metric → 1000-node graph → live dashboard" at any scale is not supported; the big end of that range degrades to truncation or unbounded DOM.

---

## Infinite / self-extending (sub-question e) — ABSENT

**The zod catalog is a compile-time HARD CAP, not an infinite-by-composition + self-extending vocabulary.**

- The catalog is frozen at module load and CI-guarded against shrinking: `catalog.ts:886-892` `if (ARTIFACT_CATALOG.length < 30) throw` — it enforces a *floor*, and the only way to add an entry is the documented 3-step source edit + redeploy (`catalog.ts:20-24`, `registry.ts:9-14`, `AdaptiveRenderer.tsx:13-14`). Adding a primitive means **touching ≥3 files and shipping a build**.
- No runtime primitive registration in any render package. Grep for `register.*primitive|primitive.*registr|self-extend|conformance|meta-rail` across genui/portal-genui/chat-ui/owner-web returns only doc comments — the only *runtime* `register()` is `document-studio`'s doc-type registry (`registry/doc-type.ts:109-137`, `authored: true`), which is genuinely infinite-by-runtime-registration **but only for documents**, and it registers a `{schema, binder, engineHint}` recipe, not a vetted UI primitive.
- INV-C(output) (`MASTER_GAP_REGISTER.md:625-640`) demands "INFINITE BY COMPOSITION + SELF-EXTENDING via the body-change meta-rail + the CONFORMANCE GATE (K-6)". The composition half is *partially* real (a tab/dashboard/section composes child primitives recursively — `InlineBlockRenderer.tsx:248-281`, `DashboardGrid`), but the **self-extending half is entirely absent**: there is no path for the MD to mint primitive #36 at runtime. The alphabet cannot grow.
- The `SandboxedSurface` lane (`sandboxed-surface.ts`) is the *intended* escape hatch for "irreducibly bespoke surfaces the catalog cannot express" — a CSP-isolated `srcdoc` iframe. This is the nearest thing to runtime self-extension, but it is an **opaque iframe**, not a vetted primitive that joins the vocabulary: it does not gain design tokens, it is not composable with other primitives, it is stateless across turns, and it bypasses (rather than extends) the catalog. It is an unbounded-but-unvetted-and-un-unified hole, the opposite of the INV-C "every new letter is vetted by the conformance gate" design.

---

## Design-token unification — INV-K (sub-question f) — PARTIAL

INV-K (`MASTER_GAP_REGISTER.md:546-551`) demands "one unified design system to Chrome-level — same styling all the way to artifacts". Reality is split:

- **Token-clean (good):** owner-web HTML renderers use semantic Tailwind tokens throughout — `border-border`, `bg-surface`, `text-foreground`, `text-neutral-400` in `GenUIWidgetRenderer.tsx:52-71`, `GenUITabHost.tsx:74-126`, `InlineBlockRenderer.tsx:302`, `Blackboard.tsx:122-148`, `InlineChartBlock.tsx:123-160`.
- **Hardcoded hex (violation):** **every SVG renderer hardcodes hex.** `DataflowDiagram.tsx:24-36` literal `#94a3b8/#3b82f6/#10b981/#ef4444/#dbeafe/#f3f4f6`, edge strokes `#64748b` (`:144,160`), node text `#0f172a` (`:198`). `InlineChartBlock.tsx` hardcodes the gold `#d4af37` in `fill`/`stroke`/inline `style` (`:145,180,232,243,257`) — *inside* an otherwise token-clean component, so SVG fills bypass the token system even where the chrome honours it. These do **not** flip with light/dark and break INV-K.
- **`themeTokenSetId` is declared-but-dead.** The artifact row type carries `readonly themeTokenSetId?: string | null` (`validate-artifact.ts:35`) — the field that *should* bind an artifact to a design-token set — but grep shows it is consumed by **zero renderers**. It is persisted (maybe) and never read. INV-K has a schema slot and no implementation.
- The blackboard `ChartElementChart.tsx:8` comments "Color band maps Borjie's design tokens" — one renderer that intentionally maps to tokens, proving the codebase knows the pattern; it is the exception.

Net: HTML half token-clean, SVG half hex-hardcoded, the cross-renderer token-set binding (`themeTokenSetId`) unwired. INV-K is aspirational at the artifact layer.

---

## Conformance gate on generated artifacts (sub-question g) — ABSENT

The codebase has a **type/security boundary** but NOT the **K-6 conformance gate** INV-C requires.

- What exists: per-primitive `safeParse` (every component) + a defense-in-depth re-`safeParse` at the dispatcher (`AdaptiveRenderer.tsx:145-173`) + the catalog as "THE security boundary" (`catalog.ts:13-18`) + `validateAndRender()` rejecting unknown `component_type` (`validate-artifact.ts:59-92`) + the sandbox-escape invariant on `SandboxedSurface` (`allow-same-origin`+`allow-scripts` forbidden, `sandboxed-surface.ts:186-198`). This is a strong **shape/safety** gate: malformed → `UnknownKindCard`.
- What is missing (the actual conformance gate, `MASTER_GAP_REGISTER.md:633-635`): a gate that, **before a NEW primitive can render**, stamps it for **EN/SW purity, NO-IP-LEAK, a11y, dark-mode, reversibility, INV-K design tokens**. None of these are checked at the render boundary:
  - **EN/SW purity:** the AG-UI catalog primitives take *monolingual* strings (`label: z.string()` in `catalog.ts`); only the blackboard enforces bilingual (`bilingualSchema` requires both `en`+`sw`, `blackboard/types.ts:17-23`). So an AG-UI artifact can ship single-language text with no purity check — the toggle-absolute invariant is unenforced for systems 1–3.
  - **No-IP-leak:** there is no output-firewall pass over rendered artifact content (the central IP-egress guard of INV-H/D, `MASTER_GAP_REGISTER.md:615` is a chat-text concern, not wired to artifact props).
  - **a11y / dark-mode / reversibility:** not asserted anywhere in the render path.
- Because there is **no runtime self-extension** (sub-question e), there is also nowhere a conformance gate *could* run — the two gaps are the same missing seam: the body-change meta-rail + K-6 gate that INV-C says must vet primitive #36 before it renders simply does not exist in any render package.

---

## What we HAVE (so the gaps are precise, not dismissive)

- **35-primitive AG-UI catalog** with a clean dispatcher, defense-in-depth re-validation, graceful `UnknownKindCard` degrade, and a telemetry event on unknown kinds (`AdaptiveRenderer.tsx:121-139,254-272`). Genuinely SOTA *within its silo*.
- **32-entry zod artifact catalog** as a real emit security boundary + a `list_artifact_types` tool for the brain (`catalog.ts:921-930`) — the LLM-on-rails pattern done right.
- **Real hand-rolled SVG** with computed `viewBox`, `<defs>` arrow markers + `markerEnd`, topological layout, `role="img"`+`aria-label` (`DataflowDiagram.tsx:130-213`).
- **portal-genui** 22-field/14-widget tab synthesis with intent detection, LLM generation, incremental JSON-patch, persistence + audit ring-buffer, RLS-shaped header (`portal-genui/src/types.ts`).
- **blackboard** 9 bilingual relational primitives + CRDT-slot persistence + replay + print-to-PDF export (`Blackboard.tsx`, `types.ts`).
- **document-studio** — the one genuinely **infinite-by-runtime-registration** subsystem (`registry.register()` for authored doc types), with locale-purity + citation gates + WORM audit in its pipeline (`index.ts:1-24`).
- **media-engine** — typed media-kind catalogue with approval/evidence gating (`kinds.ts`).
- **streaming reducer** — correct immutable progressive-artifact reducer, ready to wire (`streaming/streaming-artifact.ts`).
- **SandboxedSurface** — best-in-class CSP-isolated escape hatch (`sandboxed-surface.ts`).

The substrate is rich. The gap is that it is **five rich substrates, not one engine** — and the three properties that make an engine "unified-infinite-any-scale" (one spec, runtime self-extension + conformance gate, virtualized any-scale render) are each ABSENT.

---

## Beyond-today recommendations (the missing seams)

1. **Define ONE `Artifact` discriminated-union spec** that supersets the 5 vocabularies (or a thin `ArtifactSpec` that each existing renderer adapts FROM), so a single spec type exists to route. This is the precondition for (a)+(b)+(c).
2. **A `renderTo(spec, surface)` projector matrix** — generalise the existing `projector.ts` (catalog→AG-UI) into surface-targeted projections (spec→inline | spec→blackboard | spec→tab-widget | spec→doc) so one spec crosses chat↔board↔tab↔doc. Make the `genui_part` widget actually mount the AG-UI primitive (today it is a placeholder card).
3. **A right-artifact selection engine** — promote selection out of the prompt into a code-level scorer over the unified vocabulary (data-shape × intent × scale → artifact kind), with the modality arbiter feeding it, defaulting to *richest* not *chat*.
4. **Wire the streaming reducer into a streaming-capable AdaptiveRenderer path** + add virtualization (`@tanstack/virtual`) to DataTable/large charts/DataflowDiagram, and replace `DataTable`'s silent `.slice(0,50)` with real pagination/windowing so ≤50k-row specs render honestly.
5. **Build the body-change meta-rail + K-6 conformance gate** (RSS-16 / EA-04 in the register) so a primitive can be minted at runtime and vetted (EN/SW purity, no-IP-leak, a11y, dark-mode, reversibility, INV-K tokens) BEFORE it renders — turning the catalog from a hard cap into a self-extending, vetted alphabet.
6. **Implement INV-K**: make every SVG renderer read CSS-var/token colours (kill the hex), and actually consume `themeTokenSetId` to bind an artifact to a token set across all renderers.

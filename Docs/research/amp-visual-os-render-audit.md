# Visual OS Render Audit — Borjie rich-output stack vs the 7-layer Visual OS spec

**Lane:** `visual-os-render-audit` (repo READ-ONLY)
**Date:** 2026-06-08
**Auditor:** amp subagent
**Scope:** `apps/owner-web/src/components/genui-tab`, `packages/genui`, `packages/portal-genui`, `packages/chat-ui` (render path + composer), owner-web chat + home-chat, the brain teaching prompt, the modality-arbiter.

---

## TL;DR — the headline verdict

**Borjie DOES default to richest output — but only in ONE of its two chat lanes, and the routing is a prompt-driven heuristic, not the spec's structured first-match decision tree.**

The owner-web "home-chat" lane (`brain-teach.hono.ts` → `public-chat.hono.ts` system prompt) has an explicit, well-built **INLINE-FIRST RULE** (`public-chat.hono.ts:695-749`) that tells the model "your default response is to render the EXACT slice they need, inline" and gives a size-of-answer routing ladder (single number → `mini_metric`, 3-8 rows → `inline_table`, trend → `inline_chart`, …). That is the spec's CORE PRINCIPLE ("every response DEFAULTS to the richest output; prose is the fallback") expressed as a prompt directive. The renderers behind it are real, hand-rolled SVG/HTML React components (16 inline blocks + a 35-primitive AG-UI catalog + a blackboard SVG canvas + a 22-field/14-widget tab synthesiser). **The capability surface is genuinely rich and broad.**

BUT the gap to the Visual OS spec is **architectural**, in three places:

1. **Routing is prose-heuristic, not a deterministic first-match decision tree.** The spec's L3 is a `MCP-tool > file > visual-type` ladder evaluated in code. Borjie's routing is split across (a) a natural-language INLINE-FIRST directive the LLM may or may not honour, (b) a pure structural `selectInlineBlock()` whose **documented default is `'none'` = prose** (`block-selector.ts:29,128`), and (c) the modality-arbiter which **fails closed to `chat`** (pure text) on any ambiguity. So the *system-level* default — when the heuristics don't fire — is **prose**, the inverse of the spec.

2. **No "illustrative/interactive mechanism" lane as the default for "how does X work".** The spec routes mechanism questions to an interactive SVG/HTML explainer by default. Borjie has the *primitives* (blackboard `diagram`/`sketch`/free SVG via `dynamic_visual`) but they are gated behind a teaching-only `<board_add>` directive ("when you TEACH a concept… DO NOT use the blackboard for trivial chitchat", `public-chat.hono.ts:1071,1102`), not a first-class router target.

3. **The second chat lane (the floating widget / `chat-ui/widget` + the `@borjie/genui` AdaptiveRenderer) has no richness directive at all** — it renders whatever AG-UI parts the brain happens to emit, and the modality-arbiter that would route to them defaults to chat. The richness lives in the prompt, not in a shared engine, so it does not transfer across surfaces.

**Net: PARTIAL on "default to richest".** Rich-by-default is real and impressive in the owner home-chat prose-prompt, ABSENT as a structural guarantee, and the per-layer rigor (L4 SVG, L5 HTML widget, L7 memory) ranges from PRESENT to PARTIAL.

---

## Inventory — what actually renders rich output

Borjie has **four distinct rich-output subsystems**, which is itself a finding (the spec assumes one unified router; Borjie has four un-unified ones):

| # | Subsystem | Vocabulary | Renderer | Driven by |
|---|-----------|-----------|----------|-----------|
| A | **Owner-OS inline blocks** (home-chat) | 16+ kinds: `mini_metric`, `inline_table`, `inline_chart`, `inline_wizard`, `inline_workflow`, `inline_comparison`, `inline_section`, `inline_dashboard`, `data_capture_card`, `confirmation_card`, `file_request_card`, `micro_action_card`, `tab_promotion_chip`, `draft_edit`, `draft_preview`, `citations_block` | `apps/owner-web/src/components/home-chat/inline-blocks/InlineBlockRenderer.tsx` (recursive) | `<ui_block>{…}</ui_block>` tags in LLM output, parsed in `brain-teach.hono.ts` |
| B | **Blackboard** (dynamic SVG teaching canvas) | `formula`, `diagram` (flow/tree/venn/matrix), `chart` (bar/line/donut), `comparison`, `image`, `text`, `highlight`, `arrow`, `sketch` (free SVG path) | `apps/owner-web/src/components/blackboard/*` (`DiagramElement.tsx`, `ChartElement.tsx`, …) | `<board_add>{…}</board_add>` tags |
| C | **`@borjie/genui` AG-UI catalog** (the 35-primitive "generative UI on rails") | 35 `PartKind`s + a 32-entry `ARTIFACT_CATALOG` (kpi_tile, bar/line/pie/scatter/box/radar/funnel/treemap/sankey/histogram charts, data_table, kanban, gantt, timeline, map, heatmap, org_chart, dataflow-diagram, …) | `packages/genui/src/AdaptiveRenderer.tsx` (switch over `uiPart.kind`, defense-in-depth zod re-validate) | brain emits `ui_artifacts.component_type`; catalog is the security boundary |
| D | **`@borjie/portal-genui` dynamic tabs** | 22 field kinds + 14 widget kinds → a persisted `PortalTab` | `apps/owner-web/src/components/genui-tab/GenUITabHost.tsx` + `GenUIFieldRenderer.tsx` + `GenUIWidgetRenderer.tsx` | intent detector → LLM tab generator → zod-validated `PortalTab` |
| (E) | **`chat-ui/generative-ui`** (LitFin-ported domain blocks) | `royalty_affordability_calculator`, `5ps_operator_risk_wheel`, `offtake_timeline_diagram`, `maintenance_case_flow_diagram`, `asset_comparison_table`, `dynamic_visual` (raw SVG) | `packages/chat-ui/src/generative-ui/AdaptiveRenderer.tsx` + `svg-primitives.ts` | zero-LLM `generateBlocks()` regex post-processor + free SVG |

Subsystems A, B, E live in/feed owner-web home-chat. Subsystem C feeds admin-web + the floating widget. Subsystem D is the "infinite tabs" feature. **They do not share a routing engine** — this is the central architectural gap.

---

## Layer-by-layer mapping

### L1 — Intent Classification (5 dims: needs-visual? / current-data? / file? / memory? / MCP-tool?) → **PARTIAL**

The spec's L1 is a 5-dimension classifier that runs FIRST and decides the output shape. Borjie's nearest analogue is the **modality-arbiter** (`packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts`), a 7-way head (chat | tab | document | media | action | skill | workflow). It is a sophisticated 3-tier cascade (rule → pgvector semantic → cheap-LLM tie-break, `modality-arbiter.ts:55,140-419`).

**Why PARTIAL, not PRESENT:**
- The arbiter's closed set is **output-channel** (tab vs document vs media), NOT the spec's **visual-modality** dimensions. It never asks "does this need a chart vs a flowchart vs an interactive explainer". Visual sub-routing happens later and informally.
- It **fails closed to `chat`** on any ambiguity (`modality-arbiter.ts:61-66,299-306,409-416`) — the safe default is *prose*, the inverse of the spec's "default to richest".
- The actual per-turn visual decision in home-chat is NOT made by the arbiter at all — it is made by the LLM following the prose INLINE-FIRST directive. So the "classifier" is the model's own judgement, un-instrumented and non-deterministic.
- The structural fallback classifier `selectInlineBlock()` (`block-selector.ts:116-129`) inspects result shape (rows→table, series→chart, value→metric) — this IS a real L1-style shape classifier — but its **explicit default is `'none'` = prose** (`block-selector.ts:29,128`).

**Gap:** no single, code-level, first-thing-that-runs classifier emitting the spec's 5 dims. The decision is smeared across a prompt directive + a fail-closed arbiter + a prose-defaulting shape heuristic.

---

### L2 — Skill / Module load (read the skill before generating) → **PARTIAL**

The spec wants the router to LOAD a skill/module and read it before generating. Borjie has:
- `packages/document-studio` and a `services/reports/skills`, `packages/ai-copilot/src/skills`, `packages/agent-runtime/src/skills` skill tree (skills exist as a concept).
- The arbiter's Tier-1 retrieves learned **skills** and **workflows** by pgvector and only selects `active && humanReviewed` ones (`modality-arbiter.ts:207-213`) — that is a real "load capability before acting" path.
- The tab generator loads the field/widget **registries** and renders them into the system prompt before generating (`portal-genui/src/generator/prompt.ts:19-31,103-107`) — i.e. it reads the vocabulary catalog before emitting. That is the spec's "read the module" pattern, applied to tab synthesis.

**Gap:** there is no per-turn "read the matching visual skill file, then render" step the way the spec describes for visual generation. The visual catalogs are injected wholesale into the prompt (good) but there is no selective skill-load keyed to the detected visual type.

---

### L3 — VISUAL ROUTING decision tree (first-match: MCP-tool > file > visual-type) → **PARTIAL / the weakest layer vs spec**

This is the spec's heart and Borjie's biggest divergence.

**What exists:**
- A **size-of-answer ladder** in the prompt (`public-chat.hono.ts:713-721`): single number→`mini_metric`, 3-8 rows→`inline_table`, trend→`inline_chart`, multi-step form→`inline_wizard`, checklist→`inline_workflow`, 2-3 options→`inline_comparison`, grouped→`inline_section`, overview→`inline_dashboard`. This is a genuine visual-type router — but expressed as PROSE the LLM must follow, not code.
- A **structural shape router** `selectInlineBlock()` (`block-selector.ts:131-156`): draft→`draft_preview`, point-array→`inline_chart`, ranked→`inline_comparison`, row-array→`inline_table`, scalar→`mini_metric`. First-match ordered. This IS the spec's decision-tree-in-code — but it is a *hint* layer, defaults to `'none'`, and is not the binding authority.
- **File lane exists** as a modality (`document`/`media` in the arbiter) and the document-drafter renderers (`services/api-gateway/src/services/document-drafter/renderers/`). So the spec's "file > visual" precedence has machinery.
- **MCP-tool lane exists** (`SandboxedSurface`, `packages/genui/src/sandboxed-surface.ts`) — the spec's "MCP-tool first / ui-resource" escape hatch, CSP-isolated iframe.

**Gaps vs spec:**
1. **No single first-match `MCP-tool > file > visual-type` ordering in code.** The three lanes (tool/file/visual) live in different subsystems and are not evaluated in one ordered pass. The arbiter routes tab/doc/media; the prompt routes inline-visual; nothing arbitrates "tool vs file vs visual" in spec order.
2. **The mechanism/"how does X work" → illustrative-interactive default is ABSENT.** The spec says mechanism questions default to an interactive SVG/HTML explainer (NOT a flowchart). Borjie's only mechanism-visual lane is the **blackboard**, gated to *teaching mode* ("when you teach a concept", and "DO NOT use the blackboard for trivial chitchat", `public-chat.hono.ts:1071,1102`). A normal owner asking "how does the royalty calc work" gets prose + maybe a formula, not a default interactive explainer.
3. **SVG-flowchart-for-sequence vs SVG-structural-for-containment distinction is not encoded.** The blackboard `diagram` kind has flow/tree/venn/matrix, but selection is the LLM's free choice, not a routed first-match.

---

### L4 — SVG ENGINEERING rigor (viewBox "0 0 680 H", two text sizes, color classes auto light/dark, `<defs>` arrow markers + marker-end, L-bend collision avoidance, clickable `<g onclick=sendPrompt(…)>`) → **PARTIAL**

**Borjie DOES render real SVG diagrams** (this beats most chat systems). Evidence:
- `packages/genui/src/components/DataflowDiagram.tsx` — pure-SVG node/edge graph with **topological layering** (BFS from sources, `:43-104`), `viewBox` set to computed `0 0 W H` (`:130`), a `<defs>` arrow `<marker>` with `markerEnd="url(#dataflow-arrow)"` (`:134-146,162`), `role="img"` + `aria-label`. This is textbook spec-L4 — arrow markers, marker-end, computed viewBox all present.
- `apps/owner-web/src/components/blackboard/elements/DiagramElement.tsx` — flow (arrows), tree (recursive), venn (`<svg viewBox="0 0 240 140">`, `:160`), matrix.
- `InlineChartBlock.tsx` — hand-rolled SVG bar/line/area/sparkline/donut with `viewBox` (`:128,163`), multi-series, annotations.
- `Gauge.tsx`, `GanttChart.tsx`, `MetricSparkline.tsx` — more SVG primitives.
- `svg-primitives.ts` — a documented SVG primitive prompt the LLM composes from (bar chart, balance scale, pentagon radar, timeline, flow), with a `wrapSvg()` helper and `SVG_COLORS` palette.

**Gaps vs spec L4:**
1. **Colors are hardcoded hex, NOT auto light/dark classes.** `DataflowDiagram.tsx:24-36` uses literal `#94a3b8`/`#3b82f6`/`#10b981`; `svg-primitives.ts:8-21` is a hardcoded hex palette. The spec mandates color *classes* that flip with theme. Borjie's blackboard `VennView` is the exception — it uses `hsl(var(--warning))` CSS-var colors (`DiagramElement.tsx:161-162`) — proving the codebase knows how, but most SVG is hex.
2. **No clickable `<g onclick=sendPrompt(…)>` nodes.** The spec's recursive feedback loop (click a diagram node → follow-up prompt) is ABSENT from the SVG primitives. `DataflowDiagram` nodes are static `<g>` with no onclick; the inline blocks have action buttons but the SVG diagrams themselves are not click-to-prompt.
3. **viewBox is computed/ad-hoc, not the spec's "0 0 680 H" convention** — minor, but no shared canvas-width discipline.
4. **Collision-prevention via L-bend** — `DataflowDiagram` uses quadratic curves (`:159`), not the spec's L-bend orthogonal routing; fine visually but not the spec technique.
5. **`dynamic_visual` raw-SVG path uses `dangerouslySetInnerHTML={{__html: block.svg}}` with NO DOMPurify** (`chat-ui/src/generative-ui/AdaptiveRenderer.tsx:384`) — comment says "SVG comes from the block generator, not user input", but this violates the CLAUDE.md hard rule "No raw HTML interpolation. DOMPurify wraps required." A security flag (see Key Findings).

---

### L5 — HTML WIDGET rigor (content fragments only, CSS-vars never hardcode hex, persistent window.storage, anti-patterns: no localStorage / position:fixed / display:none-while-streaming / gradients / emoji / font-weight 600+) → **PARTIAL**

**The HTML-widget escape hatch exists and is well-secured:** `packages/genui/src/sandboxed-surface.ts` is the spec's MCP-Apps/ui-resource lane — a CSP-isolated `srcdoc` iframe with a strict `sandbox` allowlist (`allow-same-origin`+`allow-scripts` forbidden by construction, `:36-52`), required `csp`, postMessage origin allowlist (never `'*'`). This is *better* security posture than the spec's claude.ai primitive. Rendered by `SandboxedSurfaceFrame.tsx`.

**The "normal" widgets** (inline blocks, AG-UI parts) are React content fragments (no `<html>/<body>`), which matches the spec's "fragments only".

**Gaps vs spec L5:**
1. **CSS-vars discipline is inconsistent.** Owner-web genui-tab renderers correctly use theme tokens (`border-border`, `bg-surface`, `text-foreground` in `GenUIFieldRenderer.tsx`/`GenUIWidgetRenderer.tsx`) — spec-compliant. But the chat-ui generative-ui blocks hardcode hex (`#fff`, `#e2e8f0`, `#0f172a` in `AdaptiveRenderer.tsx:375-386`; `#d4af37` gold throughout `InlineChartBlock.tsx`). So half the stack honours CSS-vars, half hardcodes.
2. **`position:fixed` IS used** (`FloatingChatWidget.tsx`, `FloatingAskBorjie.tsx`) — but these are chrome, not generated widgets, so arguably out of scope.
3. **`persistent window.storage`** — there is a `window.storage`-style persistence in the PortalLayout document model (`packages/genui/src/document.ts` — per-(tenant,persona,user) JSON document, editable via chat, JSON-Patch evolved) which is the spec's "persistent widget state" pattern done at the *layout* level. But individual generated HTML widgets do not get a spec-style `window.storage` handle; the sandboxed iframe is stateless across turns.
4. **Anti-patterns (no gradients / emoji / font-weight 600+)** are NOT enforced — gradients appear in chat chrome (`MessageBubble.tsx:37` `bg-gradient-to-br`), font-weight 600/700 is common, and there is no lint/runtime guard against them in generated output.

---

### L6 — COMPOSITION (interleave prose + visual never stack, visual ≠ explanation, promise == deliver, scale complexity 1/3-5/10 calls, multiple focused diagrams, the FEEDBACK LOOP) → **PARTIAL**

**Strong evidence Borjie composes prose + visual:**
- The home-chat streams **text chunks progressively, THEN lands the `<ui_block>` at the end of the bubble** (`brain-teach.hono.ts:921` comment "stream progressively before the ui_block lands at the end of the bubble"). Multiple inline blocks per turn allowed (cap 4, `public-chat.hono.ts:782`). The model is told to interleave a short paragraph + a block (`:700`).
- **The "promise == deliver" + recursive feedback loop partially exists**: inline blocks carry `onAction`/`sendPrompt`-style callbacks (`InlineBlockRenderer.tsx:108-119` `InlineBlockActionEvent`), `tab_promotion_chip` is the escape hatch on every rich block, and `micro_action_card` proposes the next single tap. So click→action→next-turn is wired (the spec's feedback loop) — for *blocks*, though not for *SVG nodes* (see L4).
- **Recursive composition** is real: `inline_section` and `inline_dashboard` render child blocks recursively (`InlineBlockRenderer.tsx:248-281`), and `DashboardGrid` in `@borjie/genui` renders children. This is the spec's "multiple focused diagrams" composability.

**Gaps vs spec L6:**
1. **"Default to richest, prose as fallback" holds in the home-chat PROMPT but the SYSTEM-level default is prose.** When the LLM does not emit a block, or when `selectInlineBlock` returns `'none'`, or when the arbiter fails closed, the user gets a prose bubble. The spec inverts this: richest is the floor. Borjie's richest-default is a *prompt aspiration*, not a *structural guarantee*.
2. **"Visual ≠ explanation" not enforced** — nothing prevents a block that merely restates the prose.
3. **Complexity-scaling (1 vs 3-5 vs 10 tool calls)** is not encoded; the cap is a flat "max 4 ui_blocks".
4. **Two un-unified composers**: home-chat composes inline blocks; the widget lane (`chat-ui/widget/ChatPanel.tsx`, `LitFinChatPanel.tsx`) composes AG-UI parts with NO richness directive. The same owner on two surfaces gets different richness.

---

### L7 — MEMORY (auto-apply user memory silently, conversation_search on possessives, memory edits on "remember/forget") → **PARTIAL→PRESENT**

This is Borjie's strongest spec-alignment after L4.

- **Auto-apply user memory silently:** `renderMemoryDirective(snapshot)` produces a natural-language `## OWNER_MEMORY` block injected verbatim into the system prompt every turn (`advisor-memory/index.ts:12-15,174`; wired in `brain-teach.hono.ts:633-636`). "Owner prefers concise replies. Routine: files royalty every 12th." — exactly the spec's silent auto-apply.
- **Write path:** `recordObservation()` runs at the END of every turn, non-blocking (`brain-teach.hono.ts:808-819`), normalising engagement/timing/question-kind into pattern upserts. Plus the durable 6-layer cognitive memory (`packages/central-intelligence` memory hierarchy, MEM-01/02/05 in the task log) with a real consolidator.
- **Theory-of-mind / affective profile** (`renderMindStateDirectiveWithProfile`, `brain-teach.hono.ts:628-631`) — a richer-than-spec per-turn mind-state injection.

**Gaps vs spec L7:**
1. **No `conversation_search`-on-possessives** ("my Geita site", "our last royalty filing" → retrieve prior context) as an explicit retrieval primitive in the render path. The cognitive memory exists but the possessive-triggered search is not wired into the chat turn the way the spec describes.
2. **No explicit "remember/forget" memory-edit command surface** in chat — memory is observed implicitly, not user-editable via natural language ("forget that I prefer X").

---

## Cross-cutting gaps (the architecture-level findings)

1. **Four rich-output subsystems, no shared router.** A/B/C/D/E each have their own vocabulary, renderer, and trigger. The spec assumes one L1→L3 pipeline. Consolidating onto the modality-arbiter as the single entry, with visual-type as a sub-decision, would make richest-default structural rather than prompt-dependent.
2. **Richest-default is a prompt aspiration, not a code invariant.** The three code-level defaults (`selectInlineBlock`→`none`, arbiter→`chat`, unknown-block→prose) all fall to PROSE. To honour the spec's CORE PRINCIPLE the *fallback* must be the rich path and prose the exception — currently inverted at the code level.
3. **Mechanism/"how does X work" has no default interactive-explainer route** — the blackboard is teaching-gated. This is the single biggest missing spec behavior.
4. **SVG nodes are not click-to-prompt** — the recursive feedback loop (spec L4 + L6) is wired for blocks/buttons but not for diagram nodes.
5. **Theme/CSS-var discipline is half-applied** — owner-web tab renderers are token-clean; chat-ui generative-ui blocks hardcode hex (incl. light-mode-only `#fff` backgrounds that will look wrong in dark mode).
6. **Security: raw SVG via `dangerouslySetInnerHTML` without DOMPurify** (`chat-ui/src/generative-ui/AdaptiveRenderer.tsx:384`) violates the CLAUDE.md "DOMPurify wraps required" hard rule. The provenance comment ("not user input") is brittle — the SVG string flows from LLM-adjacent generators.

---

## Key file:line references

- Richest-default prompt directive: `services/api-gateway/src/routes/public-chat.hono.ts:695-749` (INLINE-FIRST RULE + size-of-answer ladder + rich catalog)
- Blackboard SVG directive (teaching-gated): `public-chat.hono.ts:1071-1102`
- Structural shape router, **default `'none'`/prose**: `services/api-gateway/src/services/orchestration/block-selector.ts:29,116-156`
- Modality arbiter, **fail-closed to chat**: `packages/central-intelligence/src/kernel/orchestrator/modality-arbiter.ts:61-66,299-306,409-416`
- Inline block dispatcher (16 kinds, recursive): `apps/owner-web/src/components/home-chat/inline-blocks/InlineBlockRenderer.tsx`
- Inline SVG chart renderer: `apps/owner-web/src/components/home-chat/inline-blocks/InlineChartBlock.tsx:128,163`
- AG-UI 35-primitive dispatcher (zod re-validate, security boundary): `packages/genui/src/AdaptiveRenderer.tsx:141-274`
- 32-entry artifact catalog (the emit vocabulary): `packages/genui/src/catalog.ts:595-892`
- Real SVG flow diagram (viewBox + arrow markers + topo layout): `packages/genui/src/components/DataflowDiagram.tsx:43-217`
- Blackboard diagram (flow/tree/venn/matrix): `apps/owner-web/src/components/blackboard/elements/DiagramElement.tsx`
- SVG primitive prompt + palette (hardcoded hex): `packages/chat-ui/src/generative-ui/svg-primitives.ts:8-50`
- HTML-widget MCP-Apps escape hatch (CSP iframe): `packages/genui/src/sandboxed-surface.ts:1-60`
- Persistent per-user layout document: `packages/genui/src/document.ts`
- Tab synthesis vocabulary (22 fields / 14 widgets) + catalog-in-prompt: `packages/portal-genui/src/fields/registry.ts`, `packages/portal-genui/src/widgets/registry.ts`, `packages/portal-genui/src/generator/prompt.ts:19-107`
- Dynamic-tab host + field/widget renderers: `apps/owner-web/src/components/genui-tab/GenUITabHost.tsx`, `GenUIFieldRenderer.tsx`, `GenUIWidgetRenderer.tsx`
- Memory auto-apply (L7): `services/api-gateway/src/services/advisor-memory/index.ts:174`, wired `brain-teach.hono.ts:633-636`
- Raw-SVG `dangerouslySetInnerHTML` (no DOMPurify): `packages/chat-ui/src/generative-ui/AdaptiveRenderer.tsx:384`

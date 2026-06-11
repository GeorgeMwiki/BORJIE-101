# Data-Viz SOTA — Beautiful AND Correct Visualization, Inline-in-Chat

**Lane:** `data-viz-sota`
**Date:** 2026-06-08
**Audience:** Mr. Mwikila brain layer (Borjie) + BossNyumba (shared brain, different domain layer)
**Register tie-ins:** INV-H (viz inline in chat as live lenses), INV-B (lenses), INV-I (PhD-grade descriptive→diagnostic→predictive→prescriptive analytics, automated insight generation, beautiful AND correct viz, right-chart-for-the-question), INV-J (never lose a data point; total provenance).
**Existing substrate:** `@borjie/genui` (VegaChart + 32-type catalog), `@borjie/portal-genui` (generator/intent/patch), `@borjie/graph-viz` (ECharts/Cytoscape/Sigma/ReactFlow/Sankey/TimeSeriesWithForecast + OKLCH theme), `@borjie/forecast-engine`, conformal-calibration.

---

## 0. The thesis in one sentence

The MD must answer any analytical question with a chart that is **simultaneously beautiful, perceptually correct, the right chart for the question, accessible, and rendered live inline in the conversation as a manipulable lens** — and it must *explain why that chart is the right one* and *prove the chart faithfully represents the data*. Today's portal-genui gets us 60% there: we have a validated catalog and a render pipeline, but **chart-type SELECTION is LLM-vibes not grounded in graphical-perception theory, correctness is structural-only (ajv) not perceptual/faithfulness, and there is no insight→annotation→narrative layer.** This dossier is the spec to close that gap to MIT/PhD bar.

---

## 1. The five layers of "beautiful AND correct" (the frame)

A world-class viz layer is five stacked decisions, each with a SOTA answer:

| Layer | Question | SOTA answer (2026) | Borjie status |
|---|---|---|---|
| **L1 Selection** | What chart answers THIS question? | Graphical-perception ranking (Mackinlay APT / Draco) + LLM intent, not LLM alone | ❌ LLM-vibes only |
| **L2 Encoding** | Which channel carries which field? | Effectiveness ordering: position > length > angle > area > colour, by data type | ⚠️ implicit in catalog props |
| **L3 Correctness** | Does the chart *not lie*? | Faithfulness/attribution + anti-misleader rules (truncated axes, dual-axis, area-for-quantity) | ❌ only ajv structural |
| **L4 Aesthetic** | Is it beautiful? | Perceptual objective (white-space, colour harmony, saliency, legibility) — ChartOptimiser | ⚠️ OKLCH theme only |
| **L5 Delivery** | How does it reach the user? | Stream inline-in-chat, interactive (selections/drill-down), annotated narrative, accessible | ⚠️ static render, no drill-down/annotation |

---

## 2. L1 — Picking the RIGHT chart (selection)

### SOTA finding: selection must be GROUNDED, not vibed
The frontier consensus (June 2026) is that **LLMs are good at chart selection because they encode visualization conventions** — line for time-series, bar for categorical — but they "prioritize aesthetic plausibility" and **confabulate** (wrong aggregation, topology change). The fix is to *constrain* the LLM with a formal effectiveness model:

- **Mackinlay APT (1986, still canonical)** — the effectiveness ranking by data type. For QUANTITATIVE: `position > length > angle > area > density > saturation > hue`; for NOMINAL: `position > hue > texture > connection`. "Position encodings are the most accurate across all data types." This is the *ground truth* for L2 encoding and prunes L1's chart space. ([SIGGRAPH APT](https://education.siggraph.org/static/HyperVis/concepts/apt_lo.htm), [UW CSE442 Visual Encoding](https://courses.cs.washington.edu/courses/cse442/25au/lectures/CSE442-VisualEncoding.pdf))
- **Draco 2 (cmudig/draco2)** — formalizes design knowledge as **hard + soft constraints in Answer-Set Programming**; treats recommendation as constrained optimization, ranking feasible charts by weighted penalty. Hard: "line/area marks require both x and y channels". Soft: weighted preferences (penalty/reward). This is the *machine-checkable* version of Mackinlay. ([Draco2 repo](https://github.com/cmudig/draco2), [Draco InfoVis PDF](https://idl.cs.washington.edu/files/2019-Draco-InfoVis.pdf))
- **DracoGPT (2024→2026)** — extracts an LLM's *latent* viz design preferences and compares them to Draco's, showing where LLM defaults diverge from perceptual theory. The pattern: use the LLM for intent + candidate generation, then **re-rank/repair against Draco constraints**. ([DracoGPT arXiv 2408.06845](https://arxiv.org/pdf/2408.06845))
- **ChartifyText (2024)** — the canonical 3-step selection algorithm to copy: (1) analyze table characteristics, (2) select a chart type suitable for those characteristics, (3) review the table to bind specific rows/columns to axes. ([arXiv 2410.14331](https://arxiv.org/pdf/2410.14331))

**Beyond-today leap:** a **two-pass selector** — pass A: LLM proposes intent + 3 candidate charts from the question + data profile; pass B: each candidate is scored by a *Draco-style constraint solver wired to our data profiler* (cardinality, type, distribution, zero-presence), and the highest-effectiveness candidate that is also *expressive* (can faithfully encode every required field) wins. The selector emits not just the chart but a one-line **rationale** ("ranked bar over pie: 9 categories exceed the 6-slice angle-perception limit"). No shipping product explains its chart choice; this is a differentiator that maps directly to INV-I "right-chart-for-the-question."

---

## 3. L3 — CORRECTNESS: the chart must not lie

This is the layer Borjie is weakest on and where the SOTA moved hardest in 2026.

### SOTA finding: structural validity ≠ faithfulness
Our `VegaChart` ajv-validates the spec and strips `expr`/`signal`/`calculate` (good security, good *structural* correctness). But a structurally-valid spec can still **mislead**:

- **ChartAttack (Jan 2026)** — a framework showing multimodal LLMs can be *prompted to inject "misleaders"* (truncated y-axis, inverted axis, cherry-picked range, dual-axis correlation illusions, area-encoding-for-quantity) into structurally-valid charts that **measurably degrade human comprehension**. The defense is an explicit **anti-misleader rule set** at generation time. ([arXiv 2601.12983](https://arxiv.org/pdf/2601.12983))
- **Automated Visualization Makeovers with LLMs (Aug 2025)** — chart-critique systems use **chart-type detection to dynamically apply tailored rule sets**, flag design issues, generate NL explanations, and emit *corrected code*. This is the "linter for charts" pattern. ([arXiv 2508.05637](https://arxiv.org/pdf/2508.05637))
- **ChartInsighter (Jan 2025)** — self-consistency tests catch **Extremum Error** and **Proportion Perception Error** in chart summaries and emit corrected versions — directly relevant because the MD *narrates* its charts (INV-I) and must not narrate a falsehood. ([arXiv 2501.09349](https://arxiv.org/pdf/2501.09349))
- **Dual-Path Agentic Framework for Misleading Chart QA (Mar 2026)** — robustly answers questions *about* charts even when the chart is misleading, by reconciling the visual reading against the source table — i.e. **chart attribution: trace every chart element back to a source row.** Faithfulness = attributability. ([arXiv 2603.28583](https://arxiv.org/pdf/2603.28583))
- **Validation-Driven LLM Workflows (2026)** — decompose generation into screen → propose → synthesize → render → **validate rendered output** → describe → QA-gen, catching "readability and semantic mismatch" that spec-validation misses. **Validate the rendered pixels, not just the JSON.** ([arXiv 2605.00800](https://arxiv.org/html/2605.00800))

**Beyond-today leap:** a **Faithfulness Gate** that runs *after* spec generation and *before* render, asserting machine-checkable correctness invariants tied to INV-J provenance:
1. **Axis honesty** — bar/area charts MUST include zero in the quantitative domain unless an explicit `zoom_justification` is attached; truncation is flagged in the chart subtitle ("y-axis starts at 40, not 0").
2. **Encoding honesty** — quantity is never encoded by area when length is available; no dual-y-axis unless the two series are unit-comparable.
3. **Aggregation faithfulness** — every aggregated mark carries an `evidence_id` chain back to the source rows (reuses our audit hash-chain + LMBM evidence requirement); the Auditor Agent already rejects empty evidence chains — extend it to reject *charts* whose marks don't attribute. This makes "the chart cannot lie" a *hard invariant*, not a hope. No BI tool does this.

---

## 4. L4 — Beautiful: perceptual aesthetics as an OBJECTIVE FUNCTION

### SOTA finding: aesthetics is optimizable, not vibes
**ChartOptimiser (2025→2026)** is the headline: it uses **Bayesian optimization over a constrained chart-design space** against a perceptual objective with four measurable metrics — beating LLM-only generation on clarity and task-solving ease:
- **White-Space Ratio (WSR)** — visual density / anti-clutter.
- **Colour Preference (WAVE)** — weighted affective valence estimates for harmonious palettes.
- **Task Saliency** — mean visual saliency in the *task-related* areas of interest (direct attention to the answer).
- **Text Legibility** — OCR-verified label readability.

Crucially: "BO operates within constrained parameter spaces, **guaranteeing data integrity**… LLMs frequently commit confabulations." BO runs in 3–6s/chart. Participants rated it **first in clarity and task-solving ease**. ([arXiv 2504.10180v2](https://arxiv.org/html/2504.10180v2))

Our `oklch-brand-theme` already gives perceptually-uniform OKLCH colour (correct foundation), but we don't *optimize* layout/saliency/legibility — we apply a static theme.

**Beyond-today leap:** a lightweight **perceptual post-pass** — after Draco selects the chart and the Faithfulness Gate passes, a cheap scorer evaluates WSR + legibility + a saliency proxy and nudges layout params (label rotation, axis-label thinning, mark-size, padding) toward the objective *deterministically* (no second LLM round-trip; budget <50ms). Beauty becomes a property the system *guarantees and can explain* ("rotated x-labels because 14 categories overlapped at 0°"), not an accident of the theme.

---

## 5. L5 — Delivery: inline-in-chat, interactive, annotated, accessible

### 5a. Declarative grammar choice (the rendering substrate)
June-2026 landscape, all viable, different sweet spots:
- **Vega-Lite v6** — declarative JSON grammar, *machine-generable and machine-checkable*, native **selections** (single/multi/interval) for interaction, Altair/Python parity. **This is the right primary substrate for an LLM** (JSON in, ajv-validatable) — which is exactly what we chose. ([Vega-Lite](https://vega.github.io/vega-lite/), [Selections](https://vega.github.io/vega-lite-v2/docs/selection.html))
- **Observable Plot 0.6** — layered grammar, simplest API, the direct D3 evolution; great for hand-authored exploratory charts but less LLM-target-friendly than Vega-Lite. ([Plot vs Vega-Lite](https://observablehq.com/@observablehq/plot-vega-lite))
- **ECharts** — best performance + breadth (Sankey, maps, GL); we already use it in `graph-viz` for large graphs. ([D3 alternatives 2026](https://lightningchart.com/blog/best-d3-js-alternatives-in-2026/))

**Recommendation:** keep **Vega-Lite as the LLM-target grammar** (it's the only one that is both generable-as-JSON and constraint-checkable), keep **ECharts for graph/Sankey/GL-scale**, keep our bespoke SVG `TimeSeriesWithForecast` for conformal-band rendering. This is a correct multi-substrate posture — formalize it as a router.

### 5b. Interactive drill-down/roll-up — the KG-OLAP lens tie-in (INV-B)
Vega-Lite **selections** are the native mechanism for drill-down: a selection on chart A filters a copy of the data feeding chart B, constructing OLAP roll-up/drill-down/slice/dice/pivot workflows declaratively (the Palantir Quiver pattern). The five OLAP ops (roll-up, drill-down, slice, dice, pivot) map 1:1 onto selection-parameterized Vega-Lite views. ([Palantir Quiver Vega](https://www.palantir.com/docs/foundry/quiver/cards-vega-plot), [OLAP ops](https://theintactone.com/2026/03/03/olap-operations-roll-up-drill-down-slice-dice-pivot/))

Our charts are **static today** (`actions={false}`, no selection wiring). This is the single biggest INV-B/INV-H gap: a "live lens" implies the user can click a bar to drill into it *and the chat understands the click*.

**Beyond-today leap:** wire Vega-Lite `params`/selections to a **chat-aware event bus** — a click on a mark emits a structured event (`{lens_id, selection, predicate}`) back into the conversation, so the MD can *react to a chart interaction as a turn* ("you clicked Q3 — here's the diagnostic on the Q3 dip"). The chart becomes a bidirectional control surface, not a picture. This is the literal realization of INV-B "live lenses" + INV-H "inline-in-chat" and is beyond every BI tool (which silos interaction inside the dashboard).

### 5c. Viz-in-chat streaming (INV-H)
The 2026 generative-UI standard (Vercel AI SDK 6, Claude Generative UI, Fabrik): "charts, tables, dashboards… text and components stream in progressively." But our own `VegaChart` doc correctly warns: **never stream a chart spec piece-by-piece** — render only on the *complete* `tool-output-available` payload (a half-spec renders a wrong chart). The right pattern is **skeleton-while-thinking, atomic chart on completion**: stream the *narrative* token-by-token, render the *chart* atomically once validated. We already enforce this (R2 anti-pattern) — keep it. ([Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6), [Vercel Academy Gen UI](https://vercel.com/academy/ai-sdk/multi-step-and-generative-ui), [Claude Gen UI vs Artifacts](https://www.mindstudio.ai/blog/what-is-claude-generative-ui-vs-canvas-artifacts))

### 5d. Narrative + annotation (INV-I automated insight generation)
- **DataNarrative (2024)** + **A2P-Vis (Analyzer→Presenter agentic pipeline, 2025)** — the **two-agent pattern**: a **Data Analyzer** profiles metadata, generates+executes analysis directions, yields **quality-gated, evaluator-scored** charts; a **Presenter** turns scored insights into publication-ready narrated visuals. Intermediate **insight-scoring gates** filter trivial findings. ([A2P-Vis arXiv 2512.22101](https://arxiv.org/pdf/2512.22101), [DataNarrative arXiv 2408.05346](https://arxiv.org/abs/2408.05346))
- **InReAcTable (Aug 2025)** — builds structural + semantic links between insights for interactive visual data *stories* from tabular data. ([arXiv 2508.18174](https://arxiv.org/abs/2508.18174))
- **DataScout (2025)** — automatic **data-fact retrieval** to augment a statement with supporting evidence — exactly the evidence-required posture (INV-J) applied to viz annotation. ([arXiv 2504.17334](https://arxiv.org/pdf/2504.17334))
- **Annotation survey (2024)** — automated textual annotation (Contextifier/Almanac lineage) detects+describes patterns/trends and overlays them; annotations "improve comprehension, engagement, clarity." ([arXiv 2410.05579](https://arxiv.org/pdf/2410.05579))

**Beyond-today leap:** an **Analyzer→Presenter loop wired to our standing-drives** so the MD surfaces *annotated* charts **unprompted** — the Analyzer (already implied by INV-I automated insight gen) scores anomalies/trends, the Presenter renders the chart *with the insight annotated on the mark itself* ("↑ 34% — driven by the Geita pit re-opening") and the annotation carries an `evidence_id`. This unifies INV-I (automated insight) + INV-H (inline) + INV-J (provenance) into one artifact.

### 5e. Accessibility — correctness for ALL viewers (WCAG 2.2 AA)
SOTA (2026): **multi-channel encoding** (never colour alone — add shape/line-style/pattern/direct-label), the **Wong colourblind-safe palette** (#0072B2/#E69F00/#D55E00/#CC79A7/#009E73) and **Viridis/Cividis** for sequential, ≤6 categories, **4.5:1 contrast**, ARIA roles/labels, keyboard-navigable interactions, and **an accessible data table alongside every chart** (screen-reader ground truth + precise values). ([Accessible dataviz best practices](https://5of10.com/articles/accessibility-data-visualization/), [Colorblind chart colors 2026](https://rgblind.com/blog/color-blindness-friendly-chart-colors))

We already emit `role="img"`, `<title>`, `<desc>` in `TimeSeriesWithForecast` — good. Gaps: no guaranteed colourblind-safe categorical palette (OKLCH is uniform but not provably CVD-safe), no auto-attached data-table-fallback, Vega charts render `canvas` (opaque to screen readers — should offer SVG + `<desc>` for a11y).

---

## 6. Our gaps vs portal-genui (concrete)

| Gap | Today | Target |
|---|---|---|
| **G1 Grounded selection** | LLM picks chart type by vibes in catalog prompt | Draco/Mackinlay constraint re-rank + 1-line rationale (§2) |
| **G2 Faithfulness gate** | ajv structural validation only; strips `expr` for *security* | anti-misleader rules (zero-axis, no area-for-quantity, no rogue dual-axis) + mark→`evidence_id` attribution, enforced by Auditor (§3) |
| **G3 Perceptual aesthetics** | static OKLCH theme | WSR/legibility/saliency post-pass with explainable nudges (§4) |
| **G4 Interactivity** | `actions={false}`, no selections — charts are pictures | Vega-Lite selections → chat-aware event bus → drill-down as a chat turn (§5b) |
| **G5 Insight/annotation** | chart only; narration is separate prose | Analyzer→Presenter loop, insight scored + annotated *on the mark* with evidence, surfaced unprompted via standing-drives (§5d) |
| **G6 Accessibility depth** | a11y on bespoke SVG only; Vega = opaque canvas; no CVD-proven palette; no data-table fallback | Wong/Viridis palette guarantee, SVG+`<desc>`, auto data-table sibling, keyboard a11y (§5e) |
| **G7 Selection rationale surface** | none | every chart ships *why this chart* + *why this faithful* (uniquely differentiating) |
| **G8 Render-output validation** | validate spec JSON | validate *rendered* output (readability, semantic-mismatch) before showing (§3, [2605.00800]) |
| **G9 Catalog→selector decoupling** | 32-type catalog is a security allowlist but selection still ad-hoc per prompt | promote catalog into a typed **capability surface** the Draco selector ranks over |

Borjie's **foundation is genuinely strong**: validated catalog (security boundary), multi-substrate (Vega-Lite/ECharts/SVG), conformal-band forecast renderer, OKLCH theme, streaming discipline (atomic chart render). The gap is **the intelligence between data and spec** — selection grounding, faithfulness, perceptual optimization, interactivity, and insight-annotation — none of which the catalog alone provides.

---

## 7. Recommended build order (lowest-risk → highest-leverage)

1. **G2 Faithfulness Gate** first — it's a pure function over the Vega-Lite spec + data profile, reuses the Auditor/evidence chain, and directly serves "the chart cannot lie." Highest trust-per-effort.
2. **G1 Grounded selector** — embed Draco2 (or a hand-port of its core soft constraints) as a re-ranker behind the existing LLM proposal; emit rationale.
3. **G4 Interactivity bus** — unlocks INV-B live-lenses; the single most visible "wow."
4. **G5 Analyzer→Presenter + annotation** — wires viz into the standing-drives so insights surface unprompted (INV-I).
5. **G3 perceptual post-pass** + **G6 accessibility** — polish that makes it MIT-grade.

Every layer emits an *explanation* (why-this-chart, why-it's-faithful), which is itself the beyond-today differentiator: **a viz layer that guarantees perceptual correctness AND explains the chart.**

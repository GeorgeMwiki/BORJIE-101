# Vision Dossier — Generative-UI Surface Synthesis

**Lane:** `generative-ui-surface-synthesis`
**Author:** Research subagent (Opus 4.8, 1M context)
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Audience:** Borjie brain / owner-web / workforce-mobile / buyer-mobile architects; `portal-genui` + `dynamic-sections` + `mutation-authority` owners; BossNyumba parity team.

---

## 0. The leap this lane is about

The 2026 generative-UI frontier (Vercel v0 / AI SDK 5, Thesys C1, Google A2UI, CopilotKit AG-UI) has solved **component synthesis**: given a turn of intent, an LLM picks and parametrises pre-registered components and streams them back. Borjie already lives here — `packages/genui/src/catalog.ts` is explicitly a "generative-UI on rails" catalog, with the projector (`projector.ts`) bridging catalog payloads to the renderer and an `UnknownKindCard` fail-closed default.

This lane is about the **next stratum up**, which nobody on the market ships yet:

> Synthesising **whole operational surfaces** — an HR console, a payroll run, a roster board, a maintenance kanban, a treasury dashboard — *and the navigable graph that links them*, from `(data model + role + intent + org-graph)`, then keeping that graph **coherent as the underlying schema evolves** — all proposal-gated, chat-refinable, and reversible.

The owner's vision is a **self-constructing organisational brain**: the MD does not navigate a fixed app, it *grows the app's surface graph* as the organisation reveals its shape. Picking a chart is table-stakes. Composing the chart into an HR surface, wiring that surface into a navigation graph beside payroll and roster, and migrating the whole graph when a column is added to `workforce_members` — that is the unsolved problem this dossier maps.

Three distinct questions, kept separate throughout:
1. **Surface synthesis** — `(data, intent, role) → a coherent operational surface` (not one widget).
2. **Surface-graph composition** — `(surfaces, org-graph, task-routing) → a navigable inter-surface graph` with stable invariants.
3. **Graph coherence under evolution** — when the data model changes, how does the whole graph stay correct, with no broken links, no orphan surfaces, no stale fields — proposal-gated and reversible.

---

## 1. State of the art — the 2026 generative-UI frontier (surveyed)

### 1.1 Streaming component synthesis (the solved layer)

- **Vercel AI SDK 5 / v0 — "generative UI on rails."** AI SDK 5 ships fully typed chat for React/Svelte/Vue/Angular plus first-class agent-loop primitives; v0's generative-UI tech was open-sourced with AI SDK 3.0 and the RSC-genui pattern streams React Server Components straight from tool calls. Critically, **AI SDK RSC is now paused** — Vercel's own guidance migrates teams off `streamUI`/RSC toward `useChat` + typed tool-driven UI. The lesson for Borjie: **do not bet the surface engine on RSC streaming**; bet on a *typed component contract the model selects against* (which is exactly what `genui/catalog.ts` already does). Source: Vercel AI SDK 3.0 generative-UI blog; ai-sdk.dev.
- **Thesys C1 — generative-UI as an API.** C1 is a hosted middleware layer between LLM and frontend: the model's output is interpreted and rendered as charts/forms/cards in real time, streamed progressively, theme-able through the open-source **Crayon** component library, integrating "in 2 lines" against the OpenAI SDK and working across GPT-5 / Claude Sonnet 4 / Gemini 3. It is the clearest commercial proof that *generative UI is a backend concern* — the UI is a function of model output, not hand-built screens. But C1 still operates **one response at a time**; it has no concept of a persistent surface graph. Source: docs.thesys.dev; thesys.dev/blogs.
- **Google A2UI (v0.8) + CopilotKit AG-UI.** A2UI is a **declarative JSON UI protocol** (not executable code): the agent sends a *flat list of components with ID references*, the client renders from a **trusted, pre-approved catalog** (`Card`, `Button`, `TextField`, …), and **UI structure is separated from the data model**. The flat-list-with-IDs shape is deliberately chosen because it is "easy for LLMs to generate incrementally" → progressive streaming + cheap incremental patches. The same messages render on web (Lit/Angular/React), Flutter, SwiftUI, Jetpack Compose. AG-UI is the **event protocol** underneath (messages, tool calls, **state patches**, lifecycle signals over one JSON-event stream on HTTP/WebSocket), adopted by Google, LangChain, AWS, Microsoft, Mastra, PydanticAI; AG-UI natively carries A2UI and lets you define custom gen-UI specs. Sources: developers.googleblog.com/introducing-a2ui; docs.ag-ui.com; copilotkit.ai/ag-ui.

**The convergent 2026 pattern** (all four agree): the LLM never emits raw JSX/HTML; it emits **tool-call args that select + parametrise components from a server-owned catalog**, streamed as a **flat ID-referenced list** with **state separated from structure**, on an **event protocol** carrying incremental patches. Borjie's `catalog.ts` comment calls this out by name — it is already on the right side of history.

### 1.2 Schema-driven UI (the bridge to surfaces)

- **JSON-Schema → UI** (`ui-schema`, JSON Forms, SurveyJS, the Apache APISIX 2026 GSoC "JSON-Schema-driven form" initiative). The domain model *is* the UI spec: a string-with-enum becomes a dropdown, a number-with-min/max gets range validation, a boolean a toggle; `visibleIf` + role gates conditionally show fields ("Department only for Admin"). Peter Hrynkow's "Schema-Driven Platforms" makes the leap explicit: *once the whole domain model is schemas, an LLM that understands your **meta-schema** can produce valid capability/UI definitions from natural language.* This is the missing rung between "pick a component" and "synthesise a surface": **a surface is a projection of a slice of the data model under a role lens.** Sources: ui-schema.bemit.codes; jsonforms.io; peterhrynkow.com/schema-driven-platforms.

### 1.3 Malleable / end-user-programmable software (the coherence research)

- **Ink & Switch, "Malleable Software" (June 2025).** The deepest source for *coherence as software evolves*. Four mechanisms matter directly to a surface graph:
  - **Cambria — schema lenses.** Decouple **write schema** from **read schema**: each tool writes in its preferred schema; other tools read it *interpreted on demand* through a **graph of bidirectional transformations called lenses**. This is the single most important idea in this dossier for **graph coherence under evolution** (§3).
  - **Entanglers** (Tchernavskij): "a dedicated layer of the UI system that **dynamically detects and connects related UI elements**" — connections are represented as data so they support *later* extension, not hardcoded wiring. This is the conceptual root of a **surface graph** (edges as first-class, discoverable data).
  - **Cross-surface awareness** (Embark): hovering a place on the map highlights it in the outline and vice-versa — surfaces that *share context* without explicit point-to-point wiring (a blackboard pattern).
  - **AI within a malleable substrate** (Patchwork/Potluck): AI drafts the detectors/tools, but the **generated logic stays visible and editable** in a live-programming environment — never an opaque cloud app. This is exactly the **proposal-gated + chat-refinable** invariant the owner wants.
  Sources: inkandswitch.com/essay/malleable-software; simonwillison.net/2025/Jun/11.

### 1.4 Production internal-tool builders (the operational-surface proof)

- **Retool AI / Appsmith / ToolJet / Budibase (2026).** Natural-language → working app *scaffold* in seconds (Retool generates the component layout already wired); database-first model; **governance + RBAC + Retool Vectors (built-in vector DB for RAG)**. The 2026 enterprise-dashboard shift (per Retool, Improvado, think.design): AI-generated insights replace manual chart config; conversational interaction replaces menus; **context-aware layouts adapt to the user's role without manual setup**. This is the closest market analogue to "synthesise an HR/payroll/roster surface" — but it is *author-time* (a human builds, AI assists), not *runtime self-construction*, and there is **no surface graph** (each tool is an island).

### 1.5 Adaptive / self-arranging layout (the intent layer)

- **RL-driven adaptive UIs.** MARLUI (multi-agent RL for adaptive UIs, arXiv 2209.12660), "Adapting User Interfaces with Model-based RL" (CHI 2021, 10.1145/3411764.3445497), "Adaptive UI Generation through RL" (arXiv 2412.16837), and "Learning from Interaction: UI Adaptation using RL" (arXiv 2312.07216). LSTM behaviour-predictor + RL content-prioritiser → bidirectional layout/content personalisation. **UI-JEPA** (arXiv 2409.04081): masked-prediction over on-screen activity to learn intent embeddings → "active perception of user intent." Borjie's `tab-need-detector/scoring-matrix.ts` is the rule-based ancestor of this; the frontier is a *learned* value-of-information scorer.
- **"The End of Information Architecture" / Latent Navigation (Medium, Jan 2026).** IA moves "from a static map to **intent modelling, confidence-aware routing, orientation patterns, and recovery design**." When you model navigation as an **intent graph** you "stop forcing everything into a folder structure and start designing the work — IA starts to look like systems design." The coherence rule is the keystone for §3: *make navigation adaptive without losing predictability — the surface can be dynamic but the **promises must be stable***; a user must always answer **"where am I, why am I here, how do I get out."*

---

## 2. SOTA findings — what's true at the frontier today (each maps onto Borjie)

1. **Generative UI is a backend concern, expressed as tool-calls against a server-owned catalog — never raw JSX.** C1, A2UI, AG-UI, and Vercel AI SDK 5 all converged here; `packages/genui/src/catalog.ts` is already this catalog and explicitly *is the security boundary* (unknown `component_type` → `UnknownKindCard`).
2. **The canonical wire format is a flat, ID-referenced component list with state separated from structure, streamed on an event protocol carrying incremental patches** (A2UI flat-list + AG-UI state-patch events). Borjie's `portal-genui/patch` and `genui/streaming` are the seeds of this; the gap is a *graph* envelope above the single-surface list.
3. **A surface is a role-lensed projection of a slice of the data model** (schema-driven UI + Retool's role-adaptive layouts). Borjie has the data model (Drizzle schemas) and the role lens (RLS + Supabase JWT roles) but **no surface-projector** that turns `(schema slice + role) → surface spec`.
4. **Coherence under schema change is solved by schema lenses, not by regeneration** (Cambria). Write-schema ≠ read-schema; a *graph of bidirectional lenses* lets old surfaces keep reading new data. Borjie regenerates surfaces today (portal-genui re-synthesises); it has **no lens layer**, so a column rename silently breaks any persisted artifact.
5. **Navigation is becoming an intent graph with stable invariants, not a static sitemap** (Latent Navigation). The invariant — *adaptive surface, stable promises; always answer where/why/how-out* — is the design contract that keeps a self-mutating surface graph usable.
6. **Production self-construction is still author-time, not runtime** (Retool/Appsmith generate scaffolds for humans). **No shipping product synthesises a coherent multi-surface graph at runtime from data+role+intent.** This is open white-space — and Borjie's `portal-genui` + `dynamic-sections` + `mutation-authority` triad is unusually close to claiming it.
7. **Generative UI's reliability problem is grounding + a runtime judge** (2026 hallucination literature: grounded models hit 0.7–1.5% on grounded tasks vs 15–52% ungrounded; fix = RAG + tool-use + citations + a runtime judge scoring the draft before it ships). A synthesised *surface* needs the same: it must be grounded in the real schema + real evidence, and judged before it is offered. Borjie's evidence-required + Auditor-gate invariants extend directly to surfaces.
8. **Malleable-software substrates keep AI-generated logic visible, editable, and reversible** (Patchwork/Potluck). This is the owner's "proposal-gated, chat-refinable, reversible" invariant restated by the leading research lab — strong external validation.

---

## 3. The hard problem — composing & maintaining a *surface graph*

Single-surface synthesis is C1/A2UI-solved. The owner's vision needs the layer above. Here is the architecture this lane proposes, beyond anything shipping today.

### 3.1 The surface graph as a first-class artifact

Model the org's operational UI as a **typed, persisted graph**:

- **Nodes = surfaces.** Each surface is `{ id, kind (hr_console | payroll_run | roster_board | maintenance_board | treasury_dashboard | …), data_binding (a named slice of the schema), role_lens, layout_spec (flat A2UI-style component list), provenance (which intent/evidence synthesised it) }`.
- **Edges = inter-surface relations**, themselves first-class data (the **entangler** idea): `drill_down` (roster cell → employee surface), `hand_off` (maintenance work-order → payroll overtime), `derives_from` (payroll_run derives_from roster_board), `shares_context` (treasury ↔ FX exposure via blackboard slot). Edges are **discovered, not hardcoded** — derived from foreign keys in the schema + task-routing in the org-graph.
- **The graph is generated, not authored.** Input: `(data model, org-graph, role set, observed/declared intent)`. A *graph synthesiser* proposes nodes (which surfaces a role needs) and edges (how the work flows between them), grounded in the real schema and the real `core_entity` family.

This is the structural leap past A2UI: A2UI gives you one surface's flat component list; Borjie needs **a graph of those lists** with typed edges, and that graph *is the navigation model* (Latent Navigation realised).

### 3.2 Keeping the graph coherent as the schema evolves — schema lenses, not regeneration

The naive approach (regenerate every surface on schema change) is non-deterministic, expensive, and destroys user-pinned layouts. Borrow **Cambria lenses**:

- Persisted `layout_spec`s bind to a **read schema** (the shape the surface expects). The live DB is the **write schema**. A migration registers a **lens** (`rename`, `add-with-default`, `wrap`, `hoist`) describing the delta.
- Every persisted surface keeps rendering by reading the live data **through the lens chain** — a `column rename` or `add` never silently breaks a surface; the lens migrates the binding on demand.
- A migration that *cannot* be lensed (a true destructive change — column dropped, table split) is precisely the trigger for a **proposal**: the graph synthesiser proposes the minimal surface-graph edit (re-bind / split / retire node) for owner approval, with a visual diff. **Coherence becomes proposal-gated by construction.**

This makes "the surface graph self-heals as the schema evolves" *deterministic and reviewable* instead of "the LLM regenerates and hopes."

### 3.3 The synthesise → judge → propose → refine → commit → reverse loop

Wrap surface/graph mutation in the same disciplined loop the brain uses for any consequential act:

1. **Synthesise** — graph synthesiser drafts the surface (or edge) from `(schema slice, role, intent)`, grounded against real schema + evidence (RAG).
2. **Judge** — a runtime UI-judge scores the draft: schema-valid (every field exists), role-safe (RLS-consistent), evidence-cited, layout-coherent, and *invariant-preserving* (does it keep where-am-I/why/how-out?). Empty-evidence or schema-invalid drafts are rejected — the generative-UI analogue of the hallucination-grounding fix and Borjie's Auditor-gate.
3. **Propose** — a `bodyChange` proposal (never a silent mutation) with a visual before/after diff. **UI changes are reasoned-need-only.** (`mutation-authority/proposals` already exists.)
4. **Refine** — the owner edits in chat ("make payroll the home tab; move overtime under roster") → the proposal mutates. Chat-refinable per the malleable-substrate invariant.
5. **Commit** — through the **one body-change chokepoint** (`mutation-authority/body-change` + the meta-rail), audited, shadow→canary.
6. **Reverse** — every commit is a reversible diff; burn-rate / NOI / confusion-signal rollback retires the surface and restores the prior graph.

### 3.4 The invariant that keeps a self-mutating UI usable

From Latent Navigation, the non-negotiable contract on every synthesised graph:

> **The surface may be dynamic; the promises must be stable.** At every node the user can answer *where am I, why am I here, how do I get out.*

Concretely: stable URLs/anchors per surface kind; a persistent orientation rail; every adaptive reorder is *explainable* ("payroll moved up because pay-run is due in 2 days") and *reversible*. This is what separates a self-constructing brain from a UI that randomly rearranges itself.

---

## 4. Beyond-today leaps (not yet articulated by the owner)

1. **The surface graph as a queryable body organ.** Expose `query_surface_graph()` / `surface_blast_radius(node)` as brain tools (mirroring the existing `query_body_schema`). The MD can *reason about its own UI graph* — "which surfaces read `royalty_rate`? if I retire the legacy royalty surface, what breaks?" — before it proposes. The UI graph becomes part of proprioception, not a blind output.
2. **Schema-lens chains as a permanent coherence substrate (Cambria-for-surfaces).** Ship a lens layer so the surface graph *never* needs full regeneration on a non-destructive migration — a category of bug ("LLM re-synthesised the dashboard and it drifted") that every current gen-UI product will hit and none has solved. This is a defensible moat.
3. **Counterfactual surface simulation before offer.** Before proposing a new surface, run it through the world-model / shadow band on *real recent data* and *replayed role sessions*; reject surfaces that would have shown wrong numbers or dead-ended a known workflow. "Simulate-before-act" applied to UI — A/B before the user ever sees option B.
4. **Role-lens as a security primitive, enforced at synthesis time.** A surface's `role_lens` is compiled directly from RLS policies, so a synthesised surface *cannot* project a column a role can't read — generative UI that is **incapable of leaking cross-tenant/cross-role data by construction**, not by after-the-fact filtering. This closes the "LLM builds a dashboard that queries the wrong tenant" risk class before it exists.
5. **Cross-app surface-graph mirroring (the Borjie ⇄ BossNyumba parity dividend).** Because the graph is `(schema + org-graph + role + intent)`-derived and domain-agnostic, the *same synthesiser* grows a mining surface graph for Borjie and a real-estate one for BossNyumba — only the data model + ontology differ. The surface engine is a shared organ; the domain is a swappable lens. Build once, mirror via `mirrors` edges.
6. **Intent-graph navigation with a value-of-information scorer.** Replace `tab-need-detector`'s rule-based scoring with a learned VoI/expected-utility term (UI-JEPA-style intent embeddings + MARLUI-style RL), so the *home node of the graph* is chosen by predicted value to *this* role *right now*, not a static default — while §3.4's stable-promise invariant prevents disorientation.
7. **Surfaces that carry their own provenance + citation chain.** Every synthesised surface ships an evidence panel ("this maintenance board was generated because work-orders crossed threshold X; figures cite assay_id …, ledger_entry …"). Generative UI with an audit trail per surface — extends the AI-audit-chain invariant from text answers to *the interface itself*.

---

## 5. Implication for Borjie & BossNyumba (build-plan grounding)

Borjie is unusually close to claiming the open white-space because the triad already exists in skeleton form:

- **`packages/genui`** — `catalog.ts` (component allowlist = A2UI trusted catalog, the security boundary), `projector.ts` (explicit, no-eval projection to renderer), `AdaptiveRenderer.tsx`, `validate-artifact.ts`, `streaming/`, `sandboxed-surface.ts`. This is the **single-surface** layer — already at frontier parity with C1/A2UI.
- **`packages/portal-genui`** — `engine.ts`, `intent/`, `generator/`, `patch/`, `persistence/`, `widgets/`, `fields/`. This is the **synthesis pipeline** (intent → generate → patch → persist). It synthesises *surfaces* but has **no surface-graph node/edge model** above it.
- **`packages/dynamic-sections`** — `contracts/section.ts`, `registry/{evaluate,filter,section-registry}.ts`. The **adaptive-layout** layer (sections rearrange) — the ancestor of §3.4's intent-graph, today rule-based.
- **`packages/tab-need-detector`** — `scoring-matrix.ts`, `personalization-engine.ts`, `proposal-emitter.ts`. The **intent scorer** — rule-based today; the §4.6 learned-VoI target.
- **`packages/mutation-authority`** — `proposals/{proposal-builder,proposal-repository}`, `recipes/registry`, `body-change/`, `approvals/`, `audit/`, `execution/`. The **proposal-gated, audited, reversible** chokepoint — exactly the §3.3 loop's commit stage. (Per MASTER_GAP_REGISTER `EA-04 / AUT-01`, this is built but **wired into no composition root** — the single highest-leverage wiring to unlock this whole lane.)

**The missing piece** is the **surface-graph layer**: a persisted node/edge model, a graph synthesiser that derives it from `(Drizzle schema + org-graph + role + intent)`, a **Cambria-style lens layer** for coherence under migration, and `query_surface_graph` brain tools. Plug it between `portal-genui` (synthesises nodes) and `mutation-authority` (commits graph edits), with `dynamic-sections` + a learned `tab-need-detector` choosing the active node. The UI invariant from `MASTER_GAP_REGISTER.md` (reasoned-need-only, proposal-gated, chat-refinable, reversible) is the governing contract — and it is, line-for-line, the malleable-software + Latent-Navigation research consensus.

**BossNyumba parity:** the surface-graph synthesiser is domain-agnostic by construction (it reads *whatever* schema + org-graph it's pointed at). Build it in Borjie against the mining schema; BossNyumba inherits the identical organ against the real-estate schema. Same brain, same surface engine, same wiring — only the data model + ontology differ. This lane is therefore a *shared-substrate* investment, not a Borjie-only feature.

---

## 6. Sources (real, June-2026)

- Vercel — "Introducing AI SDK 3.0 with Generative UI support" — https://vercel.com/blog/ai-sdk-3-generative-ui
- Vercel AI SDK docs (v5, RSC-paused migration) — https://ai-sdk.dev/docs/introduction
- Vercel RSC-genui template — https://vercel.com/templates/next.js/rsc-genui
- Thesys — "What is C1" (docs) — https://docs.thesys.dev/guides/what-is-thesys-c1
- Thesys — "How to Build Generative UI Applications" — https://www.thesys.dev/blogs/how-to-build-generative-ui-applications
- Google Developers — "Introducing A2UI: an open project for agent-driven interfaces" — https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- "The Complete Guide to A2UI Protocol … 2026" — https://dev.to/czmilo/the-complete-guide-to-a2ui-protocol-building-agent-driven-uis-with-googles-a2ui-in-2026-146p
- AG-UI protocol — https://docs.ag-ui.com/introduction · https://www.copilotkit.ai/ag-ui · https://www.copilotkit.ai/ag-ui-and-a2ui
- Ink & Switch — "Malleable software: Restoring user agency in a world of locked-down apps" (June 2025) — https://www.inkandswitch.com/essay/malleable-software/
- Simon Willison on malleable software — https://simonwillison.net/2025/Jun/11/malleable-software/
- Geoffrey Litt — "Malleable software in the age of LLMs" — https://www.geoffreylitt.com/2023/03/25/llm-end-user-programming.html
- Peter Hrynkow — "Schema-Driven Platforms: Why JSON Schema Is the Most Underrated Tool in Your Stack" — https://peterhrynkow.com/ai/architecture/2025/02/01/schema-driven-platforms.html
- ui-schema (JSON-Schema → React UI) — https://ui-schema.bemit.codes/ · https://github.com/ui-schema/ui-schema
- JSON Forms — https://jsonforms.io/examples/gen-uischema
- Apache APISIX Dashboard — "GSoC 2026: JSON Schema Driven Form Component" — https://github.com/apache/apisix-dashboard/issues/3315
- Retool — "AI App Builders: Picking the right tool for the job in 2026" — https://retool.com/blog/ai-app-builder-tool-comparison
- The New Stack — "Retool's New AI-Powered App Builder…" — https://thenewstack.io/retools-new-ai-powered-app-builder-lets-non-developers-build-enterprise-apps/
- "The End of Information Architecture (As We Knew It)" / Latent Navigation (Jan 2026) — https://medium.com/@ikoneco/the-end-of-information-architecture-as-we-knew-it-b9141551f330
- NN/g — "Information Architecture vs. Sitemaps" — https://www.nngroup.com/articles/information-architecture-sitemaps/
- MARLUI — "Multi-Agent RL for Adaptive UIs" — https://arxiv.org/pdf/2209.12660
- "Adapting User Interfaces with Model-based RL" (CHI 2021) — https://dl.acm.org/doi/fullHtml/10.1145/3411764.3445497
- "Adaptive UI Generation through Reinforcement Learning" — https://arxiv.org/pdf/2412.16837
- "Learning from Interaction: UI Adaptation using RL" — https://arxiv.org/html/2312.07216v1
- UI-JEPA — "Towards Active Perception of User Intent" — https://arxiv.org/pdf/2409.04081
- LLM hallucination detection & mitigation, SOTA 2026 — https://zylos.ai/research/2026-01-27-llm-hallucination-detection-mitigation
- Braintrust — "Best hallucination detection tools (2026)" — https://www.braintrust.dev/articles/best-hallucination-detection-tools-2026
- Sibling dossier (complementary, MD reshaping its own body) — `Docs/research/md-generative-self-redesign-sota.md`

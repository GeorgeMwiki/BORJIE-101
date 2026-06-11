# Generative UI in Chat — SOTA Dossier (June 2026)

**Lane:** `generative-ui-in-chat`
**Invariant served:** INV-H (chat-first but NOT a simple text box — the main
chat is a rich SOTA conversational *workspace*) + INV-B (surfaces are lenses)
+ the UI invariant (reasoned-need, proposal-gated, reversible, chat-refinable).
**Author:** research subagent · **Date:** 2026-06-08
**Scope:** how a chat RENDERS rich interactive UI *inline* and SPAWNS surfaces
— not links, not markdown. Forecast → live chart; document → editable canvas;
lens → interactive roll-up/drill-down table; proposal → actionable card.
Streamed, role-aware, proposal-gated, reversible, chat-refinable.

---

## 0. The thesis in one line

In June 2026 the frontier is no longer "the model writes prose." It is **the
model emits a typed UI intent over a streaming event protocol, a trusted client
catalog renders it as a live interactive component, and user interactions on
that component flow back to the model as events on the SAME stream — so the
conversation and the surface are two projections of one shared state.** Every
serious player (Vercel, OpenAI, Anthropic, Google, CopilotKit/AG-UI, Thesys,
Tambo, MCP-Apps) has converged on this shape. The differences are in *where the
trust boundary sits* (RSC server-component vs sandboxed iframe vs declarative
JSON + trusted catalog) and *how rich the bidirectional state sync is*.

Borjie already has the skeleton of the winning architecture — a typed catalog
(`packages/genui` 32 component_types, `packages/portal-genui` 22 fields + 14
widgets), an SSE artifact channel, an inline-block dispatcher (16 kinds), and a
proposal-then-persist tab spawn path. The gap is **depth of interactivity,
bidirectional state, and the "two views of one state" co-build loop** — not the
foundation.

---

## 1. The seven reference architectures (June 2026), each decoded

### 1.1 Vercel AI SDK — `streamUI` / RSC + the v5 data-stream pattern

**What it is.** AI SDK 3.0 open-sourced v0's generative-UI tech. `streamUI`
streams **React Server Components** alongside the model generation: the LLM does
multi-step tool calls, and each tool's `generate` can `yield` a loading
component then `return` a finished one — the component itself streams to the
client with zero client-side JS for the markup. In AI SDK 4/5 the RSC path
(`ai/rsc`) is **paused/maintenance**; the recommended production path is the
**UI-message data-stream** (`useChat` + typed `data-*` stream parts + a
client-side component map keyed by tool name / part type). Next.js 15 Partial
Prerendering is the substrate they're moving toward.

**The load-bearing mechanic.** Tool result → typed stream part → client switch →
React component. Props *stream* (partial objects render progressively). This is
exactly our `<ui_block>{...}</ui_block>` + `InlineBlockRenderer` switch, but
Vercel's version streams *partial* props (the table fills row-by-row) and treats
the component map as the single source of truth.

**Beyond-today leap for Borjie.** Adopt *partial-prop streaming* for our inline
blocks: a forecast chart should draw axes the instant the brain commits the
chart kind, then animate series in as the numbers arrive — not pop fully-formed
after the JSON closes. Our `ChatArtifactStream` already has a `streaming: true`
shimmer phase; the leap is to make the shimmer phase **render the real component
with skeletal data** that hydrates in place, so first-token-to-first-pixel is
sub-300ms even for a heavy roll-up.

### 1.2 OpenAI Apps SDK — iframe + `window.openai` bridge + MCP Apps

**What it is.** A tool on your MCP server returns `structuredContent` plus
`_meta["openai/outputTemplate"]`; ChatGPT renders your component **in a
sandboxed iframe inline with the conversation**. The component talks to the host
over **JSON-RPC via `postMessage`** (the MCP Apps bridge). Key bridge APIs:
- `window.openai.requestDisplayMode({ mode })` — negotiate **inline / PiP /
  fullscreen** (mobile coerces to fullscreen).
- `tools/call` JSON-RPC from inside the widget — the widget can invoke server
  tools directly (e.g. "refine this forecast").
- `ui/notifications/tool-result` — host pushes fresh data; component re-renders
  reactively, treating data as untrusted.
- `ui/message` / `ui/update-model-context` — widget injects a follow-up turn or
  updates what the model "sees."
- `uploadFile` / `selectFiles` / `getFileDownloadUrl` — multimodal in/out.
- State syncs via `openai:set_globals`; React `useSyncExternalStore` subscribes.
The strong design guidance: **separate data tools from render tools** — let the
model reason over fetched data *before* it chooses to render a widget.

**The load-bearing mechanic.** The widget is a *first-class actor*: it can call
tools and inject model context, so a card is not a dead-end — clicking "drill
into Site B" on a KPI tile is a `tools/call` that streams a new lens back. This
is the single biggest delta vs our current cards, which mostly emit a local
`onAction` that the host wires manually.

**Beyond-today leap for Borjie.** Give our genui components a **typed host-bridge
contract** analogous to `window.openai` — `requestDisplayMode` (inline →
spawn-as-tab → fullscreen-cockpit), `callBrainTool` (refine/drill/forecast-again
as a streamed turn), and `updateBrainContext` (so the brain *knows* the owner
expanded Site B's variance). Our `genui-host-actions.ts` is the seam; today it's
approve/submit only. The leap turns every inline artifact into a live tool-caller
that honours the UI invariant (every callBrainTool that mutates is
proposal-gated).

### 1.3 Anthropic Claude — Artifacts / Live Artifacts / Claude Design + Generative UI

**What it is.** When Claude produces substantial standalone content (React, HTML,
SVG, Mermaid, Markdown, a dashboard), a **side panel opens with a live preview**
— the artifact runs on Anthropic's infra, authenticated as you. **Live Artifacts
(2026)** add: persistent storage across sessions, *direct Claude API calls from
inside the artifact* (an AI micro-app), and MCP connections to external data —
so the artifact surfaces *fresh* data on each open rather than replaying a
snapshot. **Claude Design (Labs)** is prompt-to-prototype. The newer **Generative
UI** feature is distinct from both Canvas and Artifacts — it's the model drawing
a bespoke interactive interface for the answer itself.

**The load-bearing mechanic.** The **artifact-as-living-microapp**: state +
external data + its own model calls. The conversation authors it; the artifact
then has a life of its own and can be re-opened, remixed, shared by link.

**Beyond-today leap for Borjie.** Our `ui_artifacts` table + SSR pipeline
(Playwright → PNG/PDF/SVG/HTML for WhatsApp/email) is a *static snapshot*
renderer. The leap: make a Borjie artifact a **Live Artifact** — a persisted
`portal_tab` / forecast that, when re-opened (in-app, or as a WhatsApp deep-link),
**re-queries the brain for fresh numbers** with the same evidence chain, rather
than rendering the frozen JSON. A "royalty-affordability" artifact a manager
opened last week should show *this week's* royalty position, with a diff badge
("TZS figure moved +4% since you last saw this"). That is artifact-as-lens, not
artifact-as-photo.

### 1.4 ChatGPT Canvas — the editable document/code side panel

**What it is.** A split-pane: chat left, a **live editable document/code file**
right. Auto-opens for content >10 lines. Two edit modes: **direct** (type like a
word processor) and **highlight-to-instruct** (select text → contextual popup →
"rephrase / expand / simplify / change reading level"). Built-in **version
control** (every change saved, arrows to step back), length/reading-level
sliders, code shortcuts (review/add-logs/fix-bugs/port-language), and export to
PDF/MD/DOCX (code exports to the right extension).

**The load-bearing mechanic.** **Targeted edits, not full regeneration.** Highlight
→ instruct → only that span changes. Plus version history as a first-class
reversibility primitive.

**Beyond-today leap for Borjie.** Our `DraftEditBlock` / `DraftPreviewBlock` are
inline draft authoring, but they regenerate or swap whole drafts. The leap:
**span-level highlight-to-instruct on any Borjie document** (a licence renewal
letter, an offtake contract, an ESG disclosure) with **append-only version
history** that plugs straight into our hash-chained AI audit trail — every
targeted edit is an audit-chain entry, so "who changed clause 7 of the offtake
and on whose instruction" is answerable. Reading-level / EN↔SW toggle as a
Canvas-style control honours our absolute bilingual invariant *per document*.

### 1.5 AG-UI Protocol (+ CopilotKit / CoAgents) — the streaming event spine

**What it is.** AG-UI is the **bidirectional Agent↔User event protocol** — a
single JSON event stream over HTTP (optional binary channel). Event types:
`TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_SNAPSHOT`, `STATE_DELTA` (JSON-Patch),
lifecycle signals. The agent is the **state machine**; the UI is the **renderer**;
state flows **both ways on the same stream**. CopilotKit is the React frontend
stack on top; **CoAgents** add **shared state** (`useCoAgentStateRender` renders
the agent's live working state in chat — "the MD visibly works"),
**agentic generative UI**, and **human-in-the-loop breakpoints** (the agent
pauses at a node and waits for approve/edit/reject). 2026 playbook: **MCP** for
tools, **A2A** for agent-to-agent, **AG-UI** for agent-to-user. ~9k stars,
120k weekly installs, $27M raised — this is the de-facto standard layer.

**The load-bearing mechanic.** `STATE_SNAPSHOT` + `STATE_DELTA` = **shared
state**. The chat and the surface read/write the *same* state object; a delta
from the agent updates both, a user edit on the surface emits a delta the agent
sees. This IS "two views of one state." Plus interrupt-driven HITL = our
proposal-gating, but as a protocol primitive.

**Beyond-today leap for Borjie.** Our SSE today is mostly *one-way* (brain →
client artifacts/blocks) plus discrete `onAction` callbacks and a separate
`/portal-genui/generate` REST commit. The leap: **adopt an AG-UI-shaped
`STATE_DELTA` channel** so the owner-os cockpit state (open tabs, the forecast
the MD is building, the draft being edited) is **one shared document** the brain
patches and the surfaces patch back — `useCoAgentStateRender`-style "MD is
working" reasoning/progress rendered inline, and HITL breakpoints expressed as
native interrupt events instead of bespoke chip wiring. This collapses our three
parallel mechanisms (artifact SSE, inline-block tags, REST tab-commit) into one
coherent spine.

### 1.6 Thesys C1 — generative UI as an API layer over the LLM

**What it is.** C1 is "the first **Generative UI API**" — an OpenAI-compatible
endpoint that converts LLM output into **live, streamed, adaptive interfaces**
(charts/forms/tables/cards/layouts) in ~2 lines. Built on **Crayon** (open
component lib), themeable to your brand, multi-LLM (GPT-5 / Claude Sonnet 4 /
Gemini 3). UI streams progressively as generated.

**The load-bearing mechanic.** **The model emits the UI spec, not the app
developer.** The component vocabulary is large and generic; the model composes a
*layout* from it on the fly, themed to brand tokens.

**Beyond-today leap for Borjie.** Our catalog is *fixed and curated* (32 + 22 +
14 kinds) — which is correct for a regulated mining-estate OS (auditable,
deterministic, RLS-safe). The leap is **bounded composition**: let the brain
*compose* richer layouts from our existing primitives (a "site cockpit" that is
KPI-grid + variance-chart + drill-table + approval-card laid out responsively)
**within a zod-validated layout grammar**, themed per-tenant via our
`tenant_brand_themes` (0206). We get C1's expressiveness without C1's
unbounded-trust risk.

### 1.7 Tambo — register-components-with-Zod + stream props + Interactable components

**What it is.** React toolkit: you **register components with Zod schemas**; the
agent picks one and **streams the props**. Crucial distinction — **Generative
components** (one-time renders: chart, summary) vs **Interactable components**
(persistent, updatable, multi-turn: task board, cart) that hold state across the
conversation. Full MCP support (tools/prompts/elicitations/sampling).

**The load-bearing mechanic.** The **Generative vs Interactable** split. A chart
is fire-and-forget; a Kanban or a forecast-you-keep-tuning is a *living* component
that the next turn can mutate by id.

**Beyond-today leap for Borjie.** Today most of our inline blocks are
fire-and-forget renders inside a single bubble. The leap: a registry of
**Interactable artifacts** keyed by a stable `artifact_id` — so "make the
forecast more pessimistic" mutates the *existing* chart in place (and its tab, if
spawned) rather than emitting a second chart below the first. This is the
substrate for the co-build loop in §3.

### 1.8 Google A2UI + MCP Apps — the declarative, code-free, framework-agnostic standard

**What it is.** **A2UI (Google, v0.9, 2026)**: the agent sends a **declarative
JSON UI spec** (components + layout + data bindings); the **client renders with
its own native trusted catalog** (Angular/Flutter/Lit). **No executable code
crosses the trust boundary** — the agent can only reference catalog component
*types*; user actions return as events. **MCP Apps (official MCP extension,
Jan 26 2026)**: standardizes the OpenAI-Apps-SDK + MCP-UI pattern — tools return
a text result (for the model) + a UI resource pointer (HTML) the host renders in
a **sandboxed iframe**; supported by ChatGPT, Claude, Goose, VS Code.

**The load-bearing mechanic.** **Declarative-JSON-over-trusted-catalog vs
sandboxed-iframe-HTML** are the two safe ways to render agent UI across a trust
boundary. A2UI = no code crosses (safest, our model). MCP Apps = code crosses but
sandboxed.

**Beyond-today leap for Borjie.** Our portal-genui *is already an A2UI-shaped
system* (declarative `PortalTab` JSON → trusted field/widget registry, zod-gated,
no code crosses). The leap: **make the wire format A2UI-conformant** so a Borjie
brain could drive *any* A2UI client (a future Flutter workforce app, an embedded
regulator portal) from the same emit, and so external trusted agents (a
regulator's, a buyer's) could render *into* Borjie surfaces without us shipping
them code. This is the multi-surface, cross-trust-boundary future our INV-B
("surfaces are lenses") points at.

---

## 2. The convergent SOTA shape (synthesis across all seven)

Every 2026 leader implements four layers. Borjie's status against each:

| Layer | SOTA pattern | Borjie today | Gap |
|---|---|---|---|
| **1. Typed UI vocabulary** | Zod/JSON-schema component catalog; model emits a *type + props*, never raw HTML | ✅ 32 genui kinds + 22 fields + 14 widgets + 16 inline-block kinds; all zod-validated; `UnknownKindCard` fallback | Catalog is render-only in places; no *layout grammar* for composing multi-primitive cockpits |
| **2. Streaming transport** | One event stream; partial props render progressively; `streaming:true→false` | ✅ SSE `ui_artifact` channel + `<ui_block>` tags + `ChatArtifactStream` shimmer | One-way only; props don't stream *partially*; three parallel mechanisms not one spine |
| **3. Bidirectional state** | `STATE_SNAPSHOT`/`STATE_DELTA`; widget can `callTool`/`updateContext`; shared state = chat+surface one object | ⚠️ discrete `onAction` + separate REST commit; no shared-state deltas | **Biggest gap.** No "two views of one state"; surfaces and chat are loosely coupled |
| **4. Trust boundary** | declarative-JSON-over-trusted-catalog (A2UI) **or** sandboxed iframe (MCP Apps); HITL interrupts; reversible | ✅ declarative + zod + DOMPurify `toSafeText` + RLS + proposal-then-persist | Strong. Missing: version-history/undo as a first-class reversibility primitive; live-tool-call gating |

**Verdict:** Borjie has Layers 1, 2 (partial), and 4 at or near SOTA, with a
regulated-domain trust posture *stronger* than most (RLS + audit-chain +
evidence-required). **Layer 3 — bidirectional shared state — is the frontier gap.**

---

## 3. Beyond-today: the chat that co-builds the cockpit with you

**The vision (INV-H + INV-B at the limit):** the conversation and the surface
are **two renderers over one shared state document**. Not "chat spawns a tab,"
but "chat and tab are the same object seen two ways."

Concretely, the leap stack for Borjie:

1. **One shared session-state document** per owner-os session — `{ openTabs,
   draftArtifacts, activeForecast, pendingProposals, evidence }`. The brain
   patches it with `STATE_DELTA` (JSON-Patch); surfaces patch it back. (AG-UI
   shape; CoAgents `useCoAgentStateRender` for the "MD visibly works" inline.)
2. **Interactable artifacts with stable ids** (Tambo) — "make it pessimistic"
   mutates `activeForecast` in place; the inline chart AND its spawned tab both
   re-render from the patch. No duplicate components.
3. **Live host-bridge on every artifact** (OpenAI Apps SDK shape) — inline cards
   can `callBrainTool` (drill/refine/forecast-again as a streamed turn) and
   `requestDisplayMode` (inline → tab → fullscreen cockpit), each mutating turn
   proposal-gated per the UI invariant.
4. **Span-level highlight-to-instruct + append-only version history** (Canvas
   shape) on every document, wired into the hash-chained audit trail =
   reversibility as a protocol primitive, not bolt-on undo.
5. **A2UI-conformant wire format** so the *same* brain emit drives owner-web,
   a future Flutter workforce app, a buyer surface, and a sandboxed regulator
   portal — surfaces truly as lenses.
6. **Partial-prop streaming** (Vercel) so first-pixel < 300ms even for heavy
   roll-ups; **bounded layout composition** (Thesys/C1) so the brain assembles
   cockpits from our primitives within a zod layout grammar, themed per-tenant.

The end state: an owner says "show me Site B's royalty exposure if the gold price
drops 8%," the MD *visibly reasons* (inline progress + evidence), a **live
forecast chart draws progressively** in the bubble, the owner drags the price
slider on the chart → that emits a delta → the MD recomputes and the **same**
chart updates → the owner says "keep this on my cockpit" → the inline artifact
`requestDisplayMode('tab')` and **becomes** a tab with zero re-fetch (same state
object) → next week the tab re-opens **Live** with fresh numbers + a diff badge.
One state. Two views. Fully audited. EN-or-SW absolute. That is the bar.

---

## 4. Our gaps vs portal-genui / GenUITabHost (specific, actionable)

1. **`GenUITabHost` renders fields/widgets but they're largely passive.**
   `GenUIFieldRenderer` / `GenUIWidgetRenderer` render typed inputs; there is no
   shared-state binding back to the brain. A field edit in a spawned tab does not
   stream a `STATE_DELTA` the MD sees. **Gap:** Layer-3 bidirectionality.
2. **Proposal → persist is a discrete REST round-trip, not a state patch.**
   `genui-tab-proposal.ts` previews a `PortalTab`, the FE chip then POSTs
   `/portal-genui/generate {persist:true}`. Correct and safe — but it is a
   *separate* mechanism from the SSE artifact stream and the `<ui_block>` inline
   tags. **Gap:** three parallel UI mechanisms; no single AG-UI-style spine.
3. **Inline blocks are fire-and-forget; no Interactable identity.** A second
   "refine" turn emits a *new* `inline_chart` below, not a mutation of the prior
   one. **Gap:** no stable `artifact_id` mutation model (Tambo Interactable).
4. **No live host-bridge.** `genui-host-actions.ts` handles approve/submit
   locally; components cannot `callBrainTool` / `requestDisplayMode` /
   `updateBrainContext`. **Gap:** cards are dead-ends, not live tool-callers.
5. **Artifacts are snapshots, not Live.** `ui_artifacts` + Playwright SSR render
   the frozen JSON. Re-opening shows stale numbers. **Gap:** no re-query-on-open
   Live Artifact path (and no diff-since-last-seen).
6. **Drafts swap wholesale; no span-level edit + version history.**
   `DraftEditBlock`/`DraftPreviewBlock` regenerate; no highlight-to-instruct, no
   append-only version arrows tied to the audit chain. **Gap:** Canvas-grade
   targeted-edit + reversibility.
7. **No partial-prop streaming.** `ChatArtifactStream` shimmers then pops the
   finished artifact; heavy roll-ups feel slow. **Gap:** progressive hydrate.
8. **No bounded layout composition.** The brain emits one primitive at a time
   (or a fixed `inline_dashboard`); it can't compose an arbitrary responsive
   cockpit from primitives within a validated layout grammar. **Gap:** Thesys/C1
   expressiveness within our trusted catalog.
9. **Wire format is bespoke, not A2UI-conformant.** Locks UI to owner-web React;
   blocks the multi-surface / cross-trust-boundary lens future of INV-B.

**Net:** the foundation (typed catalog, zod gating, DOMPurify, RLS, audit-chain,
proposal-then-persist, SSE streaming, tab-spawn) is genuinely strong — stronger
on *trust/regulatory* posture than the public SOTA. The frontier work is
**Layer-3 bidirectional shared state**, **Interactable artifact identity**, a
**live host-bridge**, **Live (re-querying) artifacts**, **Canvas-grade targeted
edits + version history**, and an **A2UI-conformant wire** — all of which our
existing seams (`genui-host-actions.ts`, `ChatArtifactStream`, `genui-tab-proposal.ts`,
`ui_artifacts`, `tenant_brand_themes`) are positioned to host without a rewrite.

---

## 5. Sources (real, June-2026)

- Vercel — *Introducing AI SDK 3.0 with Generative UI* — https://vercel.com/blog/ai-sdk-3-generative-ui
- Vercel AI SDK docs (v4/v5, RSC `streamUI` status) — https://ai-sdk.dev/docs/introduction
- Vercel Labs — RSC GenUI template — https://github.com/vercel-labs/ai-sdk-preview-rsc-genui
- OpenAI Apps SDK — *Build your ChatGPT UI* (window.openai bridge, display modes) — https://developers.openai.com/apps-sdk/build/chatgpt-ui
- OpenAI Apps SDK — *Design components* / *UI guidelines* — https://developers.openai.com/apps-sdk/plan/components
- OpenAI — *Introducing apps in ChatGPT and the Apps SDK* — https://openai.com/index/introducing-apps-in-chatgpt/
- OpenAI — *Introducing canvas* — https://openai.com/index/introducing-canvas/
- OpenAI Help — *What is the canvas feature* — https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it
- Anthropic — *Introducing Claude Design (Labs)* — https://www.anthropic.com/news/claude-design-anthropic-labs
- Eigent — *Claude Live Artifacts: Persistent AI Workspace Guide (2026)* — https://www.eigent.ai/blog/claude-live-artifacts-guide
- MindStudio — *What Is Claude's Generative UI vs Canvas and Artifacts* — https://www.mindstudio.ai/blog/what-is-claude-generative-ui-vs-canvas-artifacts
- CopilotKit — *Introducing AG-UI: The Protocol Where Agents Meet Users* — https://www.copilotkit.ai/blog/introducing-ag-ui-the-protocol-where-agents-meet-users
- CopilotKit — *The Developer's Guide to Generative UI in 2026* — https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026
- CopilotKit — *Generative UI Spectrum: How Agents Now Ship Their Own Interfaces* — https://www.copilotkit.ai/blog/generative-ui-explained-how-agents-now-ship-their-own-interfaces
- CopilotKit / CoAgents — shared state + HITL — https://webflow.copilotkit.ai/coagents
- AG-UI Protocol — GitHub — https://github.com/ag-ui-protocol/ag-ui
- Microsoft Learn — *State Management with AG-UI* (STATE_SNAPSHOT/STATE_DELTA) — https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/state-management
- MarkTechPost — *Agentic UI, Generative UI, State Sync, Interrupt-Driven Approval Flows* (2026-04-30) — https://www.marktechpost.com/2026/04/30/a-coding-deep-dive-into-agentic-ui-generative-ui-state-synchronization-and-interrupt-driven-approval-flows/
- Google Developers Blog — *Introducing A2UI* — https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- Google Developers Blog — *A2UI v0.9: Portable, Framework-Agnostic Generative UI* — https://developers.googleblog.com/a2ui-v0-9-generative-ui/
- MCP Blog — *MCP Apps: Bringing UI Capabilities To MCP Clients* (2026-01-26) — https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- modelcontextprotocol/ext-apps (official MCP Apps spec + SDK) — https://github.com/modelcontextprotocol/ext-apps/
- MCP-UI — https://mcpui.dev/ · WorkOS deep dive — https://workos.com/blog/mcp-ui-a-technical-deep-dive-into-interactive-agent-interfaces
- Thesys — *Building the First Generative UI API: Architecture Behind C1* — https://www.thesys.dev/blogs/generative-ui-architecture
- Thesys C1 — https://www.thesys.dev/
- Tambo — GitHub (register components + stream props; Generative vs Interactable) — https://github.com/tambo-ai/tambo
- Tambo — Generative UI concepts — https://docs.tambo.co/
- Medium (A. Chame) — *The Complete Guide to Generative UI Frameworks in 2026* — https://medium.com/@akshaychame2/the-complete-guide-to-generative-ui-frameworks-in-2026-fde71c4fa8cc

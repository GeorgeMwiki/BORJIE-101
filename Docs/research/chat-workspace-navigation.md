# SOTA Dossier — Chat-First Workspace Navigation

**Lane:** `chat-first-workspace-navigation` — the chat AS the OS front door.
**Date:** 2026-06-08 · **Audience:** Borjie owner-web cockpit (Mr. Mwikila) + mobile surfaces.
**Invariants in scope:** INV-H (chat-first but a RICH conversational workspace, not a text box), INV-B (surfaces are lenses), the UI invariant (reasoned-need · proposal-gated · reversible · chat-refinable).

> The thesis the whole industry converged on in 2026: **the chat box is not a UI paradigm — it's just what shipped first.** Best-in-world systems now treat the conversation as the *spine* and grow persistent surfaces (canvas, tabs, lenses, mini-apps) as *warm limbs* off it. Our `OwnerOSShell` + `owner-tabs-store` + the background-spawn + proposal-tray path is already on the correct side of this line. This dossier maps where the frontier is, and where we are still one leap behind.

---

## 0. The landscape in one picture

Five things every SOTA chat-first OS now does, and our status:

| Capability | Frontier (June 2026) | Borjie today | Gap |
|---|---|---|---|
| Inline generative UI | Claude on-demand GenUI renders interactive apps *in the conversation*; ChatGPT Apps SDK / MCP Apps / Google A2UI all render widgets in-thread | `GenUITabHost` renders MD-authored `PortalTab`s, but in a **separate tab**, not inline in the chat stream | **Inline render** missing |
| Surfaces spawn from chat | ChatGPT Projects, Canvas, Cursor Canvases, Dia tab-groups — work persists where it was created | `openBackground()` spawns genui tab + "opened from your chat" notice | Near-parity; deep-link-back weak |
| Ambient / "come back to find work done" | LangChain Agent Inbox, Cursor background agents, Microsoft/Agent-Framework background responses | Proposal tray + `+N` pulse, but no async *long-running* job inbox | **Async job inbox** missing |
| Multi-conversation / project memory | ChatGPT Projects (shared instructions+files+Project Memory), Mem0/Zep/Letta multi-scope memory | Single home chat; durable cognitive memory exists in brain but no *thread/project* navigation layer | **Threads/projects** missing |
| Canvas-alongside-chat split | Arc Split View, Dia chat-with-tabs, Cursor Canvas dashboard replaces chat-wall | Tab strip switches *between* chat and surface (not side-by-side) | **Split layout** missing |

---

## 1. The core paradigm shift — "the chat box isn't a UI paradigm"

The defining 2026 essay (Adi Leviim, *UX Collective*) argues the chat box "is what shipped," not what's right: a linear transcript is a terrible *workspace* because the work scrolls away, can't be directly manipulated, and has no persistence. The industry answer, repeated across Anthropic (Artifacts → on-demand Generative UI), OpenAI (Canvas + Projects), and The Browser Company (Dia), is the **hybrid**: conversation for intent + reasoning, a *persistent direct-manipulation surface* for the artifact.

- Anthropic's **Generative UI** is explicitly "interactive applications inline during conversation — not in a separate canvas" (MindStudio, 2026). This is the sharpest contrast with us: ours always lands in a *tab*, never in the message stream.
- OpenAI **Canvas** is the editing/refinement model: a split-screen artifact you and the model co-edit, preserved "as an editable artifact rather than a conversational reply" — and it "keeps your work in the chat thread it was created in," so the artifact deep-links home.
- **Note the churn signal:** GPT-5.5 Instant/Thinking are *retiring* Canvas in favor of inline generative answers — the frontier is collapsing the chat/canvas split *back into the stream* where it makes sense, and reserving the separate surface for genuinely persistent, multi-session work. This validates our two-mode instinct (inline forecast chart vs. spawned tab) but tells us *which* goes where.

**For Borjie:** The MD already emits `<spawn_tabs>` and genui proposals. The missing half is the *inline* half — a forecast should render as a live chart in the bubble (lightweight, ephemeral, INV-B "lens"), and only **graduate** to a persistent tab when the owner pins it or the MD judges it durable. We currently force everything through the tab path.

**Beyond-today leap:** A *render-budget arbiter* in the chat turn — the MD decides per artifact whether it is (a) inline-ephemeral (chart, single number, a 3-row roll-up), (b) inline-promotable (renders inline with a "pin to tab" affordance), or (c) born-persistent (a whole domain workspace → background tab). The decision is itself evidence-cited and reversible. No competitor routes by *durability intent*; they route by *artifact type*.

---

## 2. Inline generative UI — the in-thread render layer (our biggest single gap)

Three competing standards, all shipping (TELUS Digital, 2026):

- **OpenAI Apps SDK** — proprietary, browser-backed React/web-component widgets sandboxed in ChatGPT; components hold their own state and talk to a backend.
- **MCP Apps** (open, extends Model Context Protocol; official in ChatGPT since Jan 2026) — servers "return interactive UI components instead of just text," rendered in *any* MCP client (Claude, Goose, VS Code). Three mechanisms: **inline HTML**, **web components**, **iframe'd external URLs**. The protocol lets the server **push updated UI resources at any time**.
- **Google A2UI** — declarative JSON (not executable code), cross-platform native-first (iOS/web/desktop), with **partial updates** (selective UI mutation without full re-render).

The convergent pattern: a **typed, declarative, updatable** UI description that the *server/agent* emits and the *client* renders with native components — exactly the shape of our `PortalTab` (typed sections + 22 field kinds + 14 widget kinds, zod-validated, DOMPurify-sanitized). We are *architecturally* aligned with A2UI's philosophy and ahead on safety, but we render only into a tab host, never inline, and we have no *partial-update / server-push* channel into an already-rendered surface.

**Our edges already present:** `GenUITabHost` re-validates `safeParsePortalTab` on fetch; `toSafeText` strips all tags (CLAUDE.md "no raw HTML interpolation"). MCP-Apps' iframe mechanism is the *unsafe* path we already designed around.

**Beyond-today leap:** Make `PortalTab` a **first-class A2UI-compatible declarative envelope** that renders identically (a) inline in a chat bubble, (b) in a spawned tab, and (c) in a side canvas — *same descriptor, three mount points* — and add a **server-push partial-update channel** (reuse the existing tab SSE `onUpdate` frame) so the MD can mutate a live forecast chart mid-conversation ("now add the BoT gold-window scenario") without a remount. One artifact schema, three surfaces, live-updatable: nobody ships this with our RLS/evidence guarantees underneath.

---

## 3. Surfaces spawn from chat — the "ambient tab" pattern (we are near-parity)

This is our strongest area. The frontier:

- **ChatGPT Projects** group conversations under shared instructions + files + **Project Memory** that "persists across all chats … behaving like a persistent workspace."
- **Cursor Canvases** "replace the chat-wall output with a live dashboard you interact with"; a Canvas "persists across the session" and you "interact with the artifact directly instead of re-prompting."
- **Dia** auto-creates tab groups (e.g. a *Meeting* group) and "when you come back to your work, everything is exactly where you left it."

Our `openBackground()` reducer is genuinely SOTA-shaped: it spawns the MD-authored tab **without stealing focus from the conversation**, lands it with a `+N` pulse, persists it to `portal_tabs` + localStorage + server sync, and drops a transparent **"Opened *X* from your chat" notice with Open/Undo/Dismiss**. `spawnOrAugment` with `deterministicTabId` does dedup-and-augment-in-place (conflicting scalars promote to arrays) so re-exploring a topic *enriches* the existing surface instead of cloning it. That augment-in-place behavior is *more* sophisticated than Dia's static tab-groups.

**Gaps vs. the frontier:**
- **No deep-link back from surface → conversation.** Canvas/Projects keep "the chat thread it was created in"; our genui tab knows its `portalTabId` but not the *message* that birthed it. There is no "jump to where the MD proposed this" affordance.
- **No project/space grouping.** Tabs are a flat strip; Arc Spaces / ChatGPT Projects cluster by client/site/licence. Our `deterministicTabId` already encodes `siteId`/`licenceId`/`counterpartyId` — the grouping key exists, the *grouping UI* doesn't.

**Beyond-today leap:** **Bidirectional provenance threading.** Every spawned surface stores `{ originMessageId, originThreadId, evidenceIds }`; the tab header shows a "from this conversation →" chip that scrolls the chat back to the exact turn (and vice-versa: each chat turn that spawned a surface shows a warm "→ Sites/Geita" limb). Combined with the existing `siteId` scoping, tabs auto-cluster into **estate Spaces** (per-site / per-subsidiary) that the MD can name. The conversation and the workspace become one navigable graph, not two stores.

---

## 4. Ambient / "come back to find work done" — the async job inbox (real gap)

The clearest frontier articulation (LangChain, *UX for Agents: Ambient*): shift from *human-in-the-loop* (you wait on each step) to *human-on-the-loop* — the agent works in the background and surfaces requests through an **Agent Inbox**, "comparable to a customer support dashboard … all the areas where the assistant needs human help, the priority of requests, and any additional metadata." Users become "more tolerant of longer completion times" because they delegated and walked away. Microsoft's Agent Framework formalizes this as **background responses with continuation tokens** for minutes-long reasoning jobs; Cursor's background agents "run long tasks while you do something else" and open a PR when done.

The four-component approval contract (LangGraph / SAP / AWS HITL, 2026): **interrupt → notify → review (action + reasoning) → resume (approve / edit / reject / respond)**, routed by four risk dimensions — **irreversibility · blast radius · compliance exposure · confidence**.

**Where Borjie stands:** Our proposal tray + `+N` pulse is the *synchronous* version of this — the MD proposes a tab *now*, the owner accepts/dismisses *now*. We do **not** have:
- A **long-running async job** model the owner can fire-and-forget ("Mr. Mwikila, reconcile last quarter's royalty across all three sites") and return to find done.
- An **inbox** that aggregates everything the MD needs from the owner, *prioritized*, with the action + reasoning + evidence visible before approval.
- **Risk-routed gating** tied to our existing policy tiers (sovereign / kill_switch / four_eye) — i.e. the LangGraph risk dimensions mapped onto our HIGH-risk policy prefixes.

This is the single highest-leverage build for an *owner who isn't watching the screen* — exactly the Tanzanian mining-owner persona who checks in twice a day.

**Beyond-today leap:** A **persistent "MD Desk" inbox** that is itself a lens off the chat: long-running MD jobs (reconciliations, EIA filings, offtake settlements) run in the background as durable tasks; each lands in the Desk with state (`prepare → ask → execute-or-handoff`), a one-glance **risk badge** (irreversibility × blast-radius × compliance × confidence, computed from policy-gate), the evidence chain, and approve/edit/reject/take-the-wheel. The owner lives in chat; the Desk fills up while they're away; the morning greeting says *"While you slept I prepared 3 things — 2 need your eyes."* No mining-OS competitor has an evidence-gated, policy-risk-routed ambient inbox.

---

## 5. Multi-conversation / threads / project memory (gap)

Frontier: memory is now "a dedicated architectural component separate from the model's context window" (Mem0 *State of AI Agent Memory 2026*; market $6.27B→$28.45B). The dominant pattern is **multi-scope memory** — every write tagged `user_id` / `agent_id` / `session_id` / `org_id`. ChatGPT Projects expose this as a *navigable* layer: cluster related chats, shared files, persistent Project Memory. The biggest *unsolved* problem they all name is **context fragmentation** across tools.

**Borjie:** We have durable cognitive memory in the brain (MEM-01..05, multi-layer, consolidator) — strong *backend*. What we lack is the **navigation layer**: the owner sees one home chat, not threads-per-topic or projects-per-site. Yet our scoping keys (`siteId`/`licenceId`/`employeeId`/`counterpartyId`) are already the natural project axis, and our memory is *single-tenant by construction* (RLS) so we sidestep the cross-tool fragmentation problem the consumer tools fight — Borjie is the *one* tool that holds the whole estate.

**Beyond-today leap:** **Estate-scoped conversation threads as lenses, not folders.** Instead of manual "Projects," the MD auto-threads the conversation by the entity in focus (a chat about Geita's NEMC EIA is *already* scoped to `siteId:geita`). Switching the active Space re-pivots both the chat memory recall *and* the tab strip to that entity — the conversation, the tabs, and the memory are one coherent, RLS-bounded, entity-scoped workspace. The "project" is the mining asset, not a manual bucket.

---

## 6. Canvas-alongside-chat split layout (gap) + mobile chat-first

**Split layout.** Arc **Split View** (multiple tabs side-by-side, itself a tab), Dia "chat with your tabs," Cursor's Canvas dashboard alongside the agent — the frontier lets chat and surface live *simultaneously*, not toggled. Our `OwnerOSTabHost` mounts only the *active* tab (a `TabSleeper` perf win) and switches *between* chat and surface. For an owner watching the MD build a forecast while still talking, a **chat-rail + canvas-stage** split is the missing layout.

**Mobile.** 2026 mobile is "multimodal — users switch between chat, voice, screens, and automated workflows seamlessly," and "voice is almost never voice-only … the screen's job is to provide information density speech cannot deliver linearly" (Fuselab VUI 2026). `gpt-realtime` is GA. We already wired OpenAI-Realtime voice — so the missing mobile piece is the **voice-while-surface** pairing: the MD speaks the reasoning while the spawned lens shows the numbers, and the proposal inbox becomes a swipeable card stack (approve/refine/handoff) sized for a manager underground with one hand free.

**Beyond-today leap:** **One adaptive shell, three densities.** Same descriptor + same chat spine renders as (1) desktop chat-rail + canvas-stage split, (2) tablet toggle, (3) phone voice-led with a swipeable lens + inbox card-stack. Our `useViewportBreakpoint` + `useAdaptiveTabOrder` already exist — the leap is making the *split vs. toggle vs. voice-led* decision adaptive and continuous, so the same MD turn is the same workspace at every density. AG-UI's protocol point ("agent logic reused across web, CLI, Slack, mobile, VS Code") is the architectural blessing for one event stream, many shells.

---

## 7. How they coexist as ONE workspace (the synthesis)

The question the lane poses — *how do chat + spawned tabs + lenses + the proposal inbox coexist as one coherent workspace?* — has a 2026 answer the leaders are circling but none has fully landed:

1. **The conversation is the spine and the index.** Every artifact, tab, and inbox item carries `originMessageId` — the chat *is* the navigation history. Scrolling the chat is scrolling the work.
2. **Surfaces are warm limbs, not separate apps.** They grow from a turn (`openBackground`), stay live and updatable (server-push partial updates), and deep-link home. Closing one doesn't lose it (recent-closed + persisted).
3. **The inbox is the asynchronous voice of the spine.** What the MD did while you were gone, prioritized and risk-badged, accept/edit/reject/take-the-wheel — the *human-on-the-loop* contract.
4. **Memory + scope make it one place, not many.** Entity scoping (`siteId`…) unifies chat recall + tab cluster + memory under one RLS boundary. Borjie's single-tenant integrity is the *advantage* the fragmented consumer tools lack.

**The beyond-today vision for the lane:** a workspace where **the conversation IS the navigation, the command line, AND the report.** You don't "open the Sites screen" — you *say* it, and a Sites lens grows inline; you don't "check notifications" — the MD's overnight work is the next thing it says; you don't "file a report" — the conversation, with its inline charts and evidence chains, *is* the auditable record. Surfaces are limbs that grow from the talk and retract when done, but the trunk — the hash-chained, evidence-cited conversation — is permanent and is itself the OS.

---

## 8. Concrete gaps vs. our `owner-tabs-store` / `OwnerOSShell` / proposal inbox

1. **Inline render path** — genui artifacts can *only* mount in a tab (`OwnerOSShell.renderActivePanel` → `GenUITabHost`); there is no in-bubble mount. → §2.
2. **No surface → conversation deep-link** — `OwnerTab.context.portalTabId` exists but no `originMessageId`/`originThreadId`; the "Opened from your chat" notice can't *scroll back* to the turn. → §3.
3. **No async long-running job inbox** — `proposals`/`spawnedNotices`/`tabErrors` trays are all *synchronous*. No fire-and-forget durable MD task with a "come back to find done" surface. → §4.
4. **No risk-routed approval** — the proposal tray treats every proposal equally; no mapping to policy-gate HIGH-risk prefixes (sovereign/kill_switch/four_eye) or the irreversibility×blast-radius×compliance×confidence matrix. → §4.
5. **No project/Space grouping** — `deterministicTabId` already encodes `siteId`/`licenceId`/`counterpartyId`, but the strip is flat; no entity-clustered Spaces. → §3, §5.
6. **No thread navigation** — one home chat; durable memory has no *navigable* threads-per-entity layer despite MEM backend. → §5.
7. **No side-by-side split** — `OwnerOSTabHost` mounts only the active tab; no chat-rail + canvas-stage layout for "watch the MD build while talking." → §6.
8. **No server-push partial update into a live surface** — tab SSE has `onUpdate`, but it patches *config/title*, not a live in-place data mutation of an open chart/lens mid-conversation. → §2.

---

## Sources

- Adi Leviim, "The chat box isn't a UI paradigm. It's what shipped." — *UX Collective* (Apr 2026): https://uxdesign.cc/the-chat-box-isnt-a-ui-paradigm-it-s-what-shipped-96e931d92769
- "What Is Claude's On-Demand Generative UI? How It Differs from Canvas and Artifacts" — *MindStudio* (2026): https://www.mindstudio.ai/blog/claude-on-demand-generative-ui-vs-canvas-artifacts
- "The Accelerating GenUI Ecosystem: MCP Apps, OpenAI Apps SDK and Google A2UI" — *TELUS Digital* (2026): https://www.telusdigital.com/insights/data-and-ai/article/accelerating-genui-ecosystem-mcp-apps-openai-apps-sdk-and-google-a2ui
- "UX for Agents, Part 2: Ambient" — *LangChain* (2026): https://www.langchain.com/blog/ux-for-agents-part-2-ambient
- "Handling Long-Running Operations with Background Responses" — *Microsoft Agent Framework* (2026): https://devblogs.microsoft.com/agent-framework/handling-long-running-operations-with-background-responses/
- "Human-in-the-Loop Patterns for AI Agents (2026)" — *MyEngineeringPath*: https://myengineeringpath.dev/genai-engineer/human-in-the-loop/
- "Human-in-the-loop" — *LangChain Docs* (2026): https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- "State of AI Agent Memory 2026: Benchmarks, Architectures & Production Gaps" — *Mem0*: https://mem0.ai/blog/state-of-ai-agent-memory-2026
- "The 6 Best AI Agent Memory Frameworks You Should Try in 2026" — *MachineLearningMastery*: https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/
- "Using Projects in ChatGPT" — *OpenAI Help Center* (2026): https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt
- "Introducing canvas" — *OpenAI*: https://openai.com/index/introducing-canvas/
- "GPT-5.5 Instant Response-Style Update … Canvas-Free Answers" — *reconnAI Blog* (2026): https://reconn-ai.com/news/gpt-5-5-instant-response-style-ai-visibility/
- "Cursor 3.2: /multitask and Canvases Turn the IDE Into an Agent Execution Platform" — *Pondero* (2026): https://pondero.ai/coding/guides/cursor-32-multitask-canvases/
- "The strategy behind Dia's design" — *The Browser Company* (Substack): https://browsercompany.substack.com/p/the-strategy-behind-dias-design
- "Split View: View Multiple Tabs at Once" — *Arc Help Center*: https://resources.arc.net/hc/en-us/articles/19335393146775-Split-View-View-Multiple-Tabs-at-Once
- "Don't ship another chat UI. Build real AI with AG-UI" — *LogRocket Blog* (2026): https://blog.logrocket.com/build-real-ai-with-ag-ui/
- "Voice User Interface Design Guide 2026" — *Fuselab Creative*: https://fuselabcreative.com/voice-user-interface-design-guide-2026/
- "ChatGPT Superapp Redesign … June 2026" — *Windows News*: https://windowsnews.ai/article/chatgpt-superapp-redesign-agents-coding-images-and-automation-coming-in-june-2026.423520
- "7 UX Patterns for Better Ambient AI Agents" — *Benjamin Prigent*: https://www.bprigent.com/article/7-ux-patterns-for-human-oversight-in-ambient-ai-agents

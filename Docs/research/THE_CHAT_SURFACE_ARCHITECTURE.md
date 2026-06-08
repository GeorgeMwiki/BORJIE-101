# THE CHAT-SURFACE ARCHITECTURE — Borjie / BossNyumba conversational workspace

**Status:** synthesis dossier (architecture spec, no code, no commit)
**Date:** 2026-06-08
**Author:** research-synthesis subagent (workflow orchestration)
**Invariants bound:** **INV-H** (chat-first but NOT a text box — the main chat is a
rich SOTA conversational *workspace*), **INV-B** (surfaces are semantic lenses over
the org-graph), the **UI invariant** (reasoned-need · proposal-gated · reversible ·
chat-refinable), plus the supporting org-brain rails (INV-D kernel, INV-F prepare→ask→
execute-or-handoff, INV-I inline analytics, INV-J lossless capture).
**Bar:** SOTA, best-in-the-world, PhD/MIT — ChatGPT-Canvas + Claude-Artifacts +
Cursor/Devin agent-progress + generative-UI workspace + voice persona, fused into the
cockpit. Same surface for **Borjie** (mining estate) and **BossNyumba** (real estate) —
they share the spine; only the domain layer differs.

**Source dossiers synthesized:** `chat-generative-ui.md`,
`chat-agentic-transparency.md`, `chat-multimodal-persona.md`,
`chat-workspace-navigation.md`, `chat-code-audit.md`, and the invariants in
`MASTER_GAP_REGISTER.md` (§ UI invariant, INV-B, INV-H, INV-F, INV-I, INV-J).

---

## 0. Thesis in one line

The main chat is **one shared session-state document rendered as two coupled
projections** — a conversation and a set of warm surfaces — where the MD (Mr. Mwikila)
*visibly works*, *emits typed UI intents* that render as live interactive lenses inline
and spawn as tabs on reasoned need, and every mutating affordance is proposal-gated,
reversible, and chat-refinable. We already have the skeleton of the winning
architecture (typed genui catalog, SSE artifact stream, inline-block dispatcher,
proposal→persist tab-spawn, realtime voice). The frontier work is **one event spine, a
live visible-work layer, bidirectional shared state, and continuity of persona+memory** —
all hostable on existing seams without a rewrite.

---

## 1. The conversational-workspace architecture — chat + inline genUI + spawned lenses + ambient inbox as ONE surface

### 1.1 The mental model the industry converged on (June 2026)

The chat box "is what shipped, not a UI paradigm" (UX Collective). The frontier answer
is the **hybrid spine + warm limbs**: conversation for intent and reasoning, persistent
direct-manipulation surfaces for the artifacts, and an asynchronous inbox for the
work done while you were away. Anthropic (Artifacts → on-demand Generative UI inline),
OpenAI (Canvas + Projects), Google (A2UI declarative), CopilotKit (AG-UI shared state),
The Browser Company (Dia tab-groups) all circle the same shape. **None has fully landed
the unification.** Borjie's `OwnerOSShell` + `owner-tabs-store` + background-spawn +
proposal-tray path is already on the correct side of the line.

### 1.2 The four parts of the one surface

```
                    ┌──────────────────────────────────────────────┐
                    │  ONE SHARED SESSION-STATE DOCUMENT (per owner) │
                    │  { openTabs, draftArtifacts, activeForecast,   │
                    │    pendingProposals, evidence, threadScope }   │
                    └──────────────────────────────────────────────┘
                         ▲  patches (STATE_DELTA) ▼  both directions
   ┌─────────────────────┴──────────────────────────────────────────────┐
   │ A. THE SPINE — the conversation (HomeChatTeach)                      │
   │    intent · reasoning · the index/navigation history · the record   │
   │    every artifact/tab/inbox item carries originMessageId            │
   ├────────────────────────────────────────────────────────────────────┤
   │ B. INLINE LENSES — generative UI rendered IN the bubble             │
   │    forecast→live chart · document→editable canvas · lens→roll-up    │
   │    ephemeral OR promotable-to-tab (render-budget arbiter)           │
   ├────────────────────────────────────────────────────────────────────┤
   │ C. WARM SURFACES — tabs/lenses spawned from chat (GenUITabHost)     │
   │    same descriptor as inline; born-persistent or graduated; INV-B   │
   │    deep-link back to the turn that birthed them; auto-cluster (Spaces)│
   ├────────────────────────────────────────────────────────────────────┤
   │ D. AMBIENT INBOX — the asynchronous voice of the spine ("MD Desk")  │
   │    proposals (now) + long-running jobs (come back to find done)     │
   │    risk-badged · evidence-shown · approve/edit/reject/take-the-wheel │
   └────────────────────────────────────────────────────────────────────┘
```

**The unifying rule (the synthesis the leaders are circling but none has landed):**

1. **The conversation is the spine, the index, and the record.** Every artifact, tab
   and inbox item carries `originMessageId`; scrolling the chat is scrolling the work;
   the hash-chained, evidence-cited transcript *is* the auditable OS record (INV-J).
2. **Surfaces are warm limbs, not separate apps** (INV-B). They grow from a turn
   (`openBackground`), stay live and updatable (server-push partial updates), deep-link
   home, and don't lose state when closed (recent-closed + persisted).
3. **The inbox is the asynchronous voice of the spine** — what the MD did while you were
   gone, prioritized and risk-badged (human-on-the-loop).
4. **Memory + entity-scope make it one place, not many.** Scoping keys
   (`siteId`/`licenceId`/`counterpartyId`/`employeeId`) unify chat recall + tab cluster +
   memory under one RLS boundary. Borjie's single-tenant integrity is the *advantage* the
   fragmented consumer tools fight.

---

## 2. The visible-work / transparency layer (plan · reasoning · tool-use · progress · evidence — steerable, calibrated)

> Trust is not built by *telling* the owner the MD is smart; it is built by letting the
> owner *watch the MD work* — at exactly the resolution that owner, on that task, at that
> risk level, needs. The layer is a **calibrated window into the MD mind**, never a log to
> parse.

### 2.1 The five SOTA primitives + Borjie's beyond-today leap

| Primitive | SOTA (frontier) | Borjie leap (INV-H + INV-F + rails) |
|---|---|---|
| **Visible plan / todo** | Claude Code plan-mode/Tasks; Devin plan-approval; Manus step view | A **prepare→ask→execute-or-handoff plan card** rendered as genui *inside the turn*; each step typed by **risk** (auto/confirm/dual-control-HITL) and **money-path** (anything touching `LedgerService.post()` visibly flagged); steps auto-tick as evidence lands; the money/licence step is visibly gated + reversible (INV-F sharpened) |
| **Tool-call timeline** | AG-UI `TOOL_CALL_*`; LangChain `tools` channel; Hermes right-pane preview | An **MD-junior activity rail** — each tool-call is a *named junior at work* ("Royalty Engine · running · 1.2s · 3 evidence"), live `pending→running→done/failed`, result **promotable to a spawned surface** (INV-B) |
| **Collapsible reasoning** | Claude 4.6 summarised thinking; OpenAI `reasoning.summary` | A **three-depth fold calibrated to the owner**: L0 always-on one-liner → L1 plain-language debate/LATS rationale → L2 raw evidence chain; default depth **driven by the `affective_profile` we already stream** |
| **Inline evidence** | LangChain citations projection; agent-assist inline KB | **Evidence-native by invariant** — per-claim chip on the exact sentence ("…royalty is 4% [Mining Act 2010 §87 ▸]"); critically, an **amber "unverified" state** for any sentence lacking an `evidence_id` (no consumer product makes *missing* proof first-class) |
| **Interrupt / steer** | Magentic-UI co-planning/plan-editing/action-guards; Operator takeover | **Barge-in over voice + text simultaneously** ("wait — use last month's spot price"), MD re-plans remaining steps in place showing the plan diff; **action-guards bound to `policy-gate`** so HIGH-risk prefixes (sovereign/kill_switch/four_eye/policy_rollout) force a takeover handoff |
| **Trust calibration (meta)** | TCMM; expertise-inverted disclosure; adaptive-beats-static | A **self-calibrating transparency controller** — the MD watches whether the owner expands reasoning / edits plans / rubber-stamps and adjusts default disclosure depth per owner over time, bilingually (EN/SW absolute), persona-consistent |

### 2.2 The architectural mechanic

Stream **one typed event sequence of work-events**; UI components **mount only the
projections they render** (LangChain: "ask for the thing it wants to render, not iterate
raw protocol events"). The event classes: `plan/step` · `tool_call` (lifecycle) ·
`reasoning` (folded) · `evidence` (per-claim) · `progress` · `guard` (HITL interrupt).
**Today's gap (verified):** `brain-teach.hono.ts` emits `step_progress`,
`debate_metadata`, `brain_state`, `affective_profile`, `auto_authorized`, `inline_block`,
`ui_block`, `board_element`, `spawn_tabs`, `tab_proposal`, `suggested_actions` — but **no
`tool_call`/`tool_started`/`tool_finished`/`reasoning` event** (event sites confirmed at
`services/api-gateway/src/routes/brain-teach.hono.ts:348,546,567,897,972,982,993,1142,
1213,1264`). The keystone build is adding `plan`/`tool_call`/`reasoning` events on this
existing SSE channel, then a `WorkChoreography` renderer in `HomeChatTeach`.

---

## 3. The inline generative-UI render pipeline (forecast→chart · document→canvas · lens→table · proposal→card)

### 3.1 The convergent four-layer SOTA shape and Borjie's status

| Layer | SOTA pattern | Borjie today | Gap |
|---|---|---|---|
| **1. Typed UI vocabulary** | Zod/JSON-schema catalog; model emits *type + props*, never raw HTML | ✅ 32 genui kinds + 22 portal-genui fields + 14 widgets + ~20 inline-block kinds; all zod-validated; `UnknownKindCard`/placeholder fallback; DOMPurify `toSafeText` | No *layout grammar* for composing multi-primitive cockpits |
| **2. Streaming transport** | One event stream; **partial** props render progressively | ✅ SSE `inline_block`/`ui_block` + `ChatArtifactStream` shimmer | One-way; props don't stream *partially*; three parallel mechanisms not one spine |
| **3. Bidirectional state** | `STATE_SNAPSHOT`/`STATE_DELTA`; widget can `callTool`/`updateContext`; chat+surface = one object | ⚠️ discrete `onAction` + separate REST commit | **Biggest gap** — no "two views of one state" |
| **4. Trust boundary** | declarative-JSON-over-trusted-catalog (A2UI) or sandboxed iframe (MCP Apps); HITL; reversible | ✅ declarative + zod + DOMPurify + RLS + proposal-then-persist | Missing version-history/undo as a first-class primitive; live-tool-call gating |

**Verdict:** Layers 1, 2 (partial), 4 at or near SOTA with a *regulated-domain trust
posture stronger than the public frontier* (RLS + audit-chain + evidence-required).
**Layer 3 — bidirectional shared state — is the frontier gap.**

### 3.2 The pipeline, end to end

```
brain turn ──emits──▶ typed UI intent (genui kind + props, zod-validated)
                         │
              ┌──────────┴───────────┐ render-budget arbiter (per artifact,
              ▼                      ▼  evidence-cited + reversible decision):
   (a) inline-ephemeral      (b) inline-promotable        (c) born-persistent
   chart / single number     renders inline +              whole domain workspace
   / 3-row roll-up           "pin to tab" affordance        → background tab spawn
              │                      │                          │
              ▼                      ▼                          ▼
   InlineBlockRenderer       graduate → same descriptor   genui-tab-proposal →
   (in the bubble)           mounts as a tab (no refetch)  openBackground + ambient
                                                            notice + GenUITabHost
```

**Same descriptor, three mount points** (inline bubble / spawned tab / side canvas).
The four canonical mappings, honouring the UI invariant + INV-B:

- **forecast → live chart** (`inline_chart`): draws axes the instant the chart kind
  commits, animates series as numbers arrive (partial-prop streaming, sub-300ms first
  pixel); INV-I — right-chart-for-the-question, perceptually sound, interactive.
- **document → editable canvas** (`draft_edit`/`draft_preview`): Canvas-grade **span-level
  highlight-to-instruct** + **append-only version history** wired into the hash-chained
  audit trail ("who changed clause 7, on whose instruction"); reading-level + EN↔SW toggle
  per document (bilingual invariant per artifact).
- **lens → interactive roll-up/drill-down table** (`inline_dashboard`/`inline_section`/
  `inline_table`): INV-B — roll-up = full visibility; drill-down = one part in its own
  scope; categories auto-expand/contract as the org grows.
- **proposal → actionable card** (`micro_action_card`/`confirmation_card`/
  `tab_promotion_chip`): the prepare→ask→execute gate (INV-F); never self-applies;
  surfaces as proposal (ambient notice + Open/Undo); mutates only on approval.

### 3.3 The UI-invariant gates (must hold on every render)

1. **Infinite UI, not a catalog** — portal-genui *synthesizes* the surface; forecast/
   media/document are ARTIFACTS that flow into a dynamically-composed lens (no fixed tab
   kinds).
2. **Change only on reasoned need** — a plain chat turn proposes no UI change (the
   render-budget arbiter evaluates tau + evidence + goal).
3. **User approval gates the mutation** — proposed change never self-applies; default =
   propose-and-approve; auto-spawn only for a flow the user explicitly set to auto, always
   reversible.
4. **Chat-customizable** — the proposal is a starting point; the user chats to refine and
   genui re-synthesizes from the amended spec (`packages/portal-genui/patch/` already
   exists as the seam).

### 3.4 The Layer-3 leap (the co-build loop)

The end state: owner says "show Site B's royalty exposure if gold drops 8%" → MD *visibly
reasons* (§2) → a **live forecast chart draws progressively** in the bubble → owner drags
the price slider on the chart → emits a `STATE_DELTA` the MD sees → MD recomputes → the
**same** chart updates (Interactable artifact with stable `artifact_id`, not a second
chart below) → "keep this on my cockpit" → the inline artifact `requestDisplayMode('tab')`
and **becomes** a tab with zero refetch (same state object) → next week the tab re-opens
**Live** with fresh numbers + a diff badge ("TZS figure moved +4% since you last saw
this"). One state. Two views. Fully audited. EN-or-SW absolute.

---

## 4. Multimodal voice + vision + text & the persona+memory layer

### 4.1 Voice (realtime duplex)

**Have:** `gpt-realtime-2` provider wired (`services/voice-agent/src/providers/
gpt-realtime-2.ts`), multi-provider STT/TTS failover (Cartesia/ElevenLabs v3/Lelapa/
Spitch), client path `use-realtime-voice.ts` (PCM16 up, gapless playback, VAD barge-in),
`VoiceMicButton` with Web-Speech fallback, `VoicePlayButton` TTS on replies.
**Leap:** **semantic VAD / end-pointing** (not silence-based), **backchannel emission**
("mm-hm" in the active locale while the owner talks — the single strongest "real person"
signal), **predictive duplex briefings** (open mid-thought), **barge-in that re-plans
remaining steps in place** (§2.1). Gate interruptibility on a per-owner preference learned
in memory. **Honest-affect prosody** — tone computed from the situation being reported
(grave on a safety incident, warm on a good assay) and from evidence confidence, never
theatrics, staying below the ~47% anthropomorphism-cliff.

### 4.2 Vision / upload (ingestion → grounded action)

**Have:** document intake (`OwnerOSChatPanel` drop-zone → `/api/v1/owner/docs/intake`;
`file_request_card` does real upload+extraction). **Gap:** no image/vision-in-the-
conversation (no inline image attach in composer, no camera/photo turn).
**Leap (grounded mining-vision as a first-class chat verb):** a field worker snaps a doré
bar / stockpile / cracked weld / fuel gauge / paper licence; the image passes **straight
into the brain tool call** (no OCR detour — GPT-5.4/5.5-class single-pass); the MD grounds
it against the estate's own catalog ("that's the GR-241 pour, last assay 86.4% Au; at
today's LBMA fix and the TZS rate ~X — draft the royalty filing + stage the offtake?") and
returns an **inline editable artifact + proposal-gated action** (INV-F). BossNyumba's
analogue: snap a damaged unit / a meter / a signed lease.

### 4.3 Persona + memory (continuity of identity)

**The CRITICAL break (verified):** **voice and text are two different characters.**
`services/voice-agent/dist/personas/mr-mwikila.js` is a *property steward* (rent
reminders, lease lookups, `book_viewing`); the mining MD lives in a *different package*
(`packages/ai-copilot/src/personas/mining-ceo-persona.ts`, text-only); the voice-persona
DNA set (`tenant/owner/vendor/regulator/applicant`) is real-estate. `memory-v2`'s
`MemorySurface` enum (`packages/memory-v2/src/types.ts`) is also property-domain.

**The architecture:**
- **One canonical Mwikila character sheet** (backstory, values, verbal tics, EN+SW
  register, taboos) as structured DNA, injected into **both** the realtime session config
  **and** the text brain prompt **from the same source of truth**, enforced at runtime by
  the existing `scorePersonaFit` + `drift-detector`. *Same person whether you type or
  call.* Tune below the anthropomorphism cliff (trusted colleague, never "friend").
- **Persona ≠ memory.** Persona anchors permanent identity; memory stores contextual
  facts/events. Add a **first-class semantic owner-model layer** (how this owner likes to
  be addressed: terse vs narrative, EN vs SW, numbers-first vs story-first; risk appetite;
  settled decisions they won't revisit; what they ignored last time) paged into both
  voice + text as Letta-style "core memory." The **bi-temporal** model is the moat: "last
  March you told me to hold the Mara licence; that reasoning no longer holds because
  royalty rates moved — revisit?"
- **EN/SW absolute** — code-switch only inside the active locale's allowed inserts; never
  "Habari! Hello there." Per CLAUDE.md hard rule.
- **In-chat memory surfacing + thread hydration.** `HomeChatTeach` holds only
  client-local message state and **loses history on reload** (no thread hydration; the
  legacy `HomeChat` has `initialThreadId` + restore). Surface "what I remember about you"
  inline and hydrate threads.

### 4.4 Proactive / ambient (calibrated interrupt budget)

**Have:** plumbing (portal-genui tab-proposal → ambient notice → GenUITabHost; proactive
notification sink). **Leap:** a per-owner **interrupt budget** — only spend it when
expected value clears a threshold (a safety incident or royalty deadline → voice barge-in;
minor FX drift → next briefing), learn from dismissals (ProActor timing-aware), and
**always say why now** ("the permit lapses in 72h"). Converts a notification firehose into
the judgement of a veteran who knows when to knock.

---

## 5. Chat-first navigation & the conversation↔surface relationship

**The paradigm:** the conversation IS the navigation, the command line, AND the report.
You don't "open the Sites screen" — you *say* it and a Sites lens grows inline; you don't
"check notifications" — the MD's overnight work is the next thing it says; you don't "file
a report" — the conversation, with its inline charts + evidence chains, *is* the auditable
record (INV-J).

**Have (strong):** `OwnerOSShell` with a pinned chat-first tab; `openBackground()` spawns
the MD-authored tab without stealing focus, lands a `+N` pulse, persists to `portal_tabs` +
localStorage + server sync, drops "Opened *X* from your chat" with Open/Undo/Dismiss;
`spawnOrAugment` with `deterministicTabId` dedups + augments-in-place (more sophisticated
than Dia's static tab-groups); keyboard-driven strip (Cmd+T/W/1-9/Shift+T); adaptive
recency ordering; `useViewportBreakpoint` + `useAdaptiveTabOrder`.

**Gaps + leaps:**
- **Bidirectional provenance threading** — every surface stores
  `{ originMessageId, originThreadId, evidenceIds }`; the tab header shows a "from this
  conversation →" chip that scrolls the chat to the exact turn (and each spawning turn
  shows a warm "→ Sites/Geita" limb). The conversation and workspace become one navigable
  graph.
- **Estate Spaces** — `deterministicTabId` already encodes `siteId`/`licenceId`/
  `counterpartyId`; the grouping *key* exists, the grouping *UI* doesn't. Auto-cluster
  tabs into per-site / per-subsidiary Spaces; switching the active Space re-pivots chat
  recall + tab strip together. The "project" is the mining asset, not a manual bucket.
- **Async MD-Desk inbox** — long-running fire-and-forget jobs ("reconcile last quarter's
  royalty across all three sites") run in the background as durable tasks, land in the Desk
  with state (`prepare→ask→execute-or-handoff`), a one-glance risk badge (irreversibility ×
  blast-radius × compliance × confidence, computed from `policy-gate`), the evidence chain,
  and approve/edit/reject/take-the-wheel. Morning greeting: "While you slept I prepared 3
  things — 2 need your eyes." (human-on-the-loop; INV-F/INV-G durable execution).
- **Split layout, three densities** — desktop chat-rail + canvas-stage split; tablet
  toggle; phone voice-led with a swipeable lens + inbox card-stack. The split-vs-toggle-
  vs-voice-led decision is adaptive and continuous; same MD turn = same workspace at every
  density. (`OwnerOSTabHost` currently mounts only the active tab — a `TabSleeper` perf
  win — and switches *between* chat and surface; the leap is simultaneous.)
- **Hero-CTA seam** — the dashboard "Ask Borjie" hero routes to the *leaner* `/ask`
  (`AskBorjieSurface`, `/api/v1/brain/turn`), not the rich `HomeChatTeach`. Point the
  prominent CTA at the rich surface.

---

## 6. Marketing-simple-chat vs main-rich-chat split (load-bearing)

Two distinct surfaces; must not be conflated:

- **Marketing / ambient widget — simple chat (CORRECT).** `FloatingAskBorjie` from
  `@borjie/chat-ui`, mounted via `apps/owner-web/src/components/BorjieWidgetMount.tsx:36`
  (also `apps/marketing/`, `apps/admin-web/`). A floating bubble streaming plain text via
  `/api/v1/mining/chat`. "Simple chat = marketing only" — this is *correctly* simple.
- **Main workspace — the INV-H bar.** `OwnerOSShell` → chat tab → `OwnerOSChatPanel` →
  `HomeChatTeach` (1421 lines), rendered on the dashboard at
  `apps/owner-web/src/app/dashboard/page.tsx:125`. The real SOTA surface; genuinely rich;
  all of §1–§5 grade against it.

The rule: **the marketing chat MUST stay a text box; the main chat MUST be the rich
workspace.** The only coherence defect today is the hero CTA pointing at the leaner `/ask`
instead of the rich surface (§5).

---

## 7. PRESENT / PARTIAL / ABSENT — with file evidence + exact wiring

Graded against the **main workspace** (`HomeChatTeach` + OwnerOS). PRESENT = at/near SOTA;
PARTIAL = real but below bar; ABSENT = not built.

| INV-H pillar | Verdict | Evidence (file) | Exact wiring to reach the bar |
|---|---|---|---|
| **1. Visible-work transparency** | **PARTIAL** | trust badges + citations + auto-authorized + `step_progress` present (`HomeChatTeach.tsx:1142-1177,1308-1365`); SSE has no `tool_call`/`reasoning` (`brain-teach.hono.ts:348,546,567,897,…`); real tool log `ToolCallSidebar.tsx` wired only into legacy `HomeChat.tsx:248-253` | Add `plan`/`tool_call`(lifecycle)/`reasoning` SSE events on `brain-teach.hono.ts`; build a `WorkChoreography` plan-card + junior-rail renderer in `HomeChatTeach`; wire 3-depth reasoning fold to the streamed `affective_profile` |
| **2. Inline generative UI** | **PRESENT** | `InlineBlockRenderer.tsx:137-307` dispatches ~20 kinds in-bubble (`inline_chart`/`inline_table`/`inline_dashboard`/`draft_edit`/`draft_preview`/`citations_block`/…); `UnknownKindCard` fallback | Add partial-prop streaming (`ChatArtifactStream` shimmer → real component w/ skeletal data); Interactable `artifact_id` mutation; span-level edit + version history; bounded layout grammar |
| **3. Surface-spawn-from-chat** | **PRESENT** | `OwnerOSShell.tsx:245-341,707-813` (`handleBrainTabFrame`→`onGenuiProposal`→`openBackground`+ambient notice); `genui-tab-proposal.ts`; `GenUITabHost.tsx` re-validates `safeParsePortalTab` | Add `originMessageId` provenance; Spaces clustering on existing `deterministicTabId`; server-push partial-update into a live open surface (reuse tab SSE `onUpdate`) |
| **4a. Multimodal — voice** | **PARTIAL** | client path real (`use-realtime-voice.ts:134-142` VAD barge-in; `VoiceMicButton.tsx:107-122` Web-Speech fallback; `AskComposer.tsx:148`); endpoint not live in this env → fallback | Semantic VAD + backchannel + honest-affect prosody on `gpt-realtime-2.ts`; barge-in re-plan; unify persona (§4.3) |
| **4b. Multimodal — vision** | **ABSENT** | only doc intake (`OwnerOSChatPanel.tsx:123-167`, `file_request_card`); no inline image/camera turn | Inline image attach in composer → image as native brain tool param → grounded inline artifact + proposal-gated action |
| **5. Agentic approve/refine/take-the-wheel** | **PARTIAL** | inline approve/refine execute through action-bridge (`HomeChatTeach.tsx:861-878` + `runInlineAction`); `confirmation_card` = prepare→ask gate; but delegation/approval inbox on **separate pages** (`/mwikila/inbox`, `/mwikila/delegation`); `HandoffCard.tsx` exists | Bring prepare→ask→execute-or-handoff + the approval queue + "take the wheel / raise autonomy for this task" INLINE; bind action-guards to `policy-gate` HIGH-risk prefixes |
| **6. Persona + memory** | **PARTIAL** | persona present (`PersonaGreeting`, `lib/persona.ts`, affective frames → `ProactiveHint`/`MasteryGate`); memory client-local + **lost on reload** (`HomeChatTeach.tsx:418-420`, no thread hydration) — brain memory real but under-surfaced | One canonical Mwikila DNA → voice+text from one source; semantic owner-model paged as core memory; thread hydration in `HomeChatTeach`; surface "what I remember" inline |
| **7. Chat-first navigation** | **PRESENT (one seam)** | OwnerOS chat-first pinned tab; `/`→`/dashboard` (`app/page.tsx:11`); keyboard strip (`OwnerOSShell.tsx:432-476`); but dashboard is a scrollable page (chat is a section) + hero CTA → leaner `/ask` | Make chat full-bleed home; point hero CTA at `HomeChatTeach`; add split layout + Spaces + async Desk |

**Cross-cutting debt:** owner-web rolled its **own** banner + proposal tray instead of the
shared `packages/chat-ui` primitives `NeedSpawnBanner` + `ChatArtifactStream` (which exist,
are tested, but have **zero app consumers**). Consolidate on the shared primitives so both
estates inherit fixes.

---

## 8. Same surface for Borjie + BossNyumba

BN shares the **same brain, same SSE event taxonomy, same surface components**
(`OwnerOSShell`, `HomeChatTeach`, `InlineBlockRenderer`, `GenUITabHost`,
`packages/chat-ui`, the voice stack) — **only the domain layer differs** (real-estate
juniors/tabs/corpus vs mining).

- **Port for free** the moment BN registers its domain tab descriptors + inline-block
  payloads: pillar 2 (inline genUI), 3 (surface-spawn), 4-voice, 7 (chat-first) — all
  domain-agnostic by construction.
- **Shared gaps** (fixing in Borjie's spine fixes BN simultaneously): pillar 1 (visible
  reasoning/tool-trace), 4-vision, 5 (inline take-the-wheel/approval), 6 (surfaced memory
  + thread hydration).
- **Discipline:** build every fix in the **shared spine** (`packages/chat-ui`, the SSE
  taxonomy, the genui catalog, the persona DNA source-of-truth) so both estates inherit it;
  any BN-side divergence (e.g. its own banner) re-introduces the duplication debt.

---

## 9. Dependency-ordered FULL-CODE roadmap (flag-default-safe)

Each wave is shippable behind a default-OFF flag; **flag-default-safe** = no behaviour
change until the flag flips, every mutating affordance proposal-gated + reversible, money/
licence/deletion stay HITL. **[BLOCKER]** = required for the wow demo.

### Wave 0 — coherence + spine consolidation (no new capability, removes traps)
- **[BLOCKER]** Point the dashboard hero CTA at `HomeChatTeach` (the rich surface), not
  `/ask` (`dashboard/page.tsx`). One-line discoverability fix.
- Consolidate owner-web's bespoke banner + proposal tray onto shared
  `packages/chat-ui` `NeedSpawnBanner` + `ChatArtifactStream` (kills duplication debt;
  BN inherits).
- Thread hydration in `HomeChatTeach` (`initialThreadId` + restore, mirror legacy
  `HomeChat`) so history survives reload (INV-J at the surface). *Blocks Wave 5.*

### Wave 1 — the visible-work layer (the keystone, single highest-leverage)
- **[BLOCKER]** Add `plan` / `tool_call`(pending→running→done/failed) / `reasoning` SSE
  events on `brain-teach.hono.ts` (extend the existing channel + event taxonomy).
- **[BLOCKER]** `WorkChoreography` renderer in `HomeChatTeach`: the prepare→ask→execute-
  or-handoff **plan card** (steps typed by risk + money-path, auto-tick on evidence) + the
  **MD-junior activity rail** (live lifecycle, result promotable to surface).
- Three-depth reasoning fold (L0/L1/L2) wired to the streamed `affective_profile`
  (self-calibrating disclosure). *Depends on `reasoning` event.*
- Per-claim inline evidence chips + the **amber "unverified"** state.

### Wave 2 — inline genUI depth (Layer-2 polish + Interactable identity)
- Partial-prop streaming: `ChatArtifactStream` shimmer renders the real component with
  skeletal data that hydrates in place (sub-300ms first pixel).
- **[BLOCKER]** Interactable artifacts with stable `artifact_id` — "make it pessimistic"
  mutates the existing chart, not a new one below. *Substrate for Wave 4.*
- Canvas-grade `draft_edit`: span-level highlight-to-instruct + append-only version
  history wired to the hash-chained audit trail; per-document EN↔SW + reading-level.
- Bounded layout grammar (compose KPI-grid + variance-chart + drill-table within a
  zod-validated layout, themed per-tenant via `tenant_brand_themes`).

### Wave 3 — multimodal completion
- **[BLOCKER]** Vision-in-chat: inline image attach in the composer → image as a native
  brain tool param → grounded inline artifact + proposal-gated action (INV-F).
- Voice realism: semantic VAD + backchannel + honest-affect prosody on `gpt-realtime-2.ts`;
  barge-in that re-plans remaining steps in place (depends on Wave 1 plan events).

### Wave 4 — bidirectional shared state (the co-build loop — the frontier gap)
- **[BLOCKER]** An AG-UI-shaped `STATE_SNAPSHOT`/`STATE_DELTA` channel: one shared
  session-state document the brain patches and surfaces patch back (collapse artifact SSE
  + inline-block tags + REST tab-commit into one spine). *Depends on Wave 2 `artifact_id`.*
- Live host-bridge on every artifact (`requestDisplayMode` inline→tab→fullscreen;
  `callBrainTool` drill/refine as a streamed turn; `updateBrainContext`) — every mutating
  call proposal-gated. Seam: `packages/genui/src/genui-host-actions.ts`.
- Server-push partial-update into a live open surface (reuse tab SSE `onUpdate` +
  `packages/portal-genui/patch/`).
- Live (re-querying) Artifacts: a re-opened tab re-queries the brain for fresh numbers +
  a diff-since-last-seen badge.

### Wave 5 — chat-first navigation completion (the ambient OS)
- Bidirectional provenance threading: `originMessageId`/`originThreadId`/`evidenceIds` on
  every spawned surface + "jump to the turn" chip. *Depends on Wave 0 thread hydration.*
- Estate Spaces: auto-cluster tabs on the existing `deterministicTabId`
  (`siteId`/`licenceId`/`counterpartyId`); active-Space re-pivots chat recall + tab strip.
- **[BLOCKER]** Async **MD-Desk inbox**: durable long-running jobs (durable execution per
  INV-G), risk-badged (irreversibility × blast-radius × compliance × confidence from
  `policy-gate`), evidence-shown, approve/edit/reject/take-the-wheel; morning-greeting
  digest.
- Inline take-the-wheel / per-task autonomy + the approval queue brought INLINE (off the
  separate `/mwikila/*` pages); action-guards bound to `policy-gate` HIGH-risk prefixes.

### Wave 6 — persona+memory continuity + adaptive shell
- **[BLOCKER]** One canonical Mwikila character sheet (mining-true DNA) injected into BOTH
  realtime session config AND text brain prompt from one source of truth; enforce with
  `scorePersonaFit` + `drift-detector` on the live voice path. (Fixes the CRITICAL
  voice≠text break.)
- Semantic owner-model layer in memory-v2 (re-domain `MemorySurface`; page core memory
  into voice+text); bi-temporal "this no longer holds" prompts.
- Calibrated interrupt budget for proactive surfacing (expected-value threshold,
  "why now", dismissal-learning).
- Adaptive shell, three densities (split / toggle / voice-led) on the same descriptor +
  same spine.

### Wave 7 — BossNyumba parity + standing regression
- BN registers its real-estate domain tab descriptors + inline-block payloads (pillars
  2/3/4-voice/7 port for free); BN inherits Waves 1/3/4/5/6 from the shared spine.
- Persona-fidelity eval (voice==text), first-audio-latency / turn-detection P99 budget,
  anthropomorphism guardrail; UI-invariant wiring tests (no UI change without approval;
  low-need turn proposes nothing; chat refinement re-synthesizes; auto-flow reversible;
  routed money/licence action hits `policy-gate`).

**Wow-demo critical path (the [BLOCKER] chain):** Wave 0 hero-CTA → Wave 1 plan-card +
junior-rail → Wave 2 Interactable `artifact_id` → Wave 3 vision-in-chat → Wave 4
shared-state co-build loop → Wave 5 MD-Desk → Wave 6 unified Mwikila persona. That chain
is the literal owner script in §3.4 ("Site B royalty if gold drops 8%" → visible reasoning
→ live chart → drag slider → same chart updates → pin to tab → Live re-open) plus the field
worker snapping a doré bar and the MD pricing it inline.

---

## 10. Net

The Borjie main chat (`HomeChatTeach` + OwnerOS) is **well past "a text box"** — genuinely
strong on inline generative UI, surface-spawn-from-chat, and the voice client, with a
regulated-domain trust posture (RLS + audit-chain + evidence-required + DOMPurify +
proposal-then-persist) *stronger than the public frontier*. The gap to best-in-the-world
INV-H is concentrated and buildable on existing seams: **(a) a live visible-work layer**
(plan + junior-rail + reasoning + amber-unverified), **(b) bidirectional shared state**
(the co-build loop), **(c) inline vision + inline take-the-wheel/approval**, **(d) the
async MD-Desk inbox**, **(e) one unified Mwikila persona across voice+text**, and **(f)
surfaced/hydrated memory** — every one of them in the **shared spine** so BossNyumba
inherits it. The bones are unusually strong; the remaining work is wiring and depth, not a
rewrite.

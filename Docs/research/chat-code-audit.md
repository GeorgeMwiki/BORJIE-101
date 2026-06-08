# Chat-Surface Code Audit — INV-H "rich SOTA conversational workspace"

**Lane:** chat-surface-code-audit (repo READ-ONLY)
**Date:** 2026-06-08
**Auditor scope:** owner-web chat surfaces, workforce-mobile + buyer-mobile chat,
the `packages/chat-ui` primitives, the genui tab-proposal → ambient-notice →
`GenUITabHost` path, realtime voice, persona/memory.

INV-H bar (from MASTER_GAP_REGISTER): the MAIN chat is **not a text box** — it is a
**rich conversational workspace** where (1) the MD visibly works
(reasoning+evidence+progress surfaced), (2) generative UI renders **inline**
(forecast=live chart, document=editable preview, lens=interactive roll-up),
(3) surfaces **spawn from chat** (ambient "you left chat, here are the tabs"),
(4) **multimodal** (realtime voice, vision/upload, text), (5) agentic affordances
inline (approve/refine/take-the-wheel; prepare→ask→execute-or-handoff),
(6) **persona+memory**, (7) **chat-first navigation**. "Simple chat = marketing only."

---

## Marketing-vs-Main distinction (load-bearing)

There are **two distinct chat surfaces** in owner-web, and they must not be conflated:

- **Marketing / ambient widget** — `FloatingAskBorjie` from `@borjie/chat-ui`,
  mounted via `apps/owner-web/src/components/BorjieWidgetMount.tsx:36` (also in
  `apps/marketing/` and `apps/admin-web/`). This is the simple floating bubble that
  streams plain text via `/api/v1/mining/chat`. It is **correctly** the "simple chat."
- **Main workspace** — `OwnerOSShell` → chat tab → `OwnerOSChatPanel` → `HomeChatTeach`,
  rendered on the dashboard at `apps/owner-web/src/app/dashboard/page.tsx:125`. This is
  the surface that must meet the INV-H bar. **`HomeChatTeach.tsx` (1421 lines) is the
  real SOTA surface and is genuinely rich** — this audit grades against it.

One trap: the dashboard's hero CTA "Ask Borjie" (`dashboard/page.tsx:62`) routes to
`/ask`, which mounts the **older/leaner** `AskBorjieSurface` (`/api/v1/brain/turn`,
`app/(routes)/ask/page.tsx`), **not** the rich teach surface. So the most prominent
button points at the weaker surface; the rich one lives lower on the same page in the
OwnerOS shell. This is a discoverability/coherence gap, not a missing capability.

---

## Pillar-by-pillar verdict (main workspace = HomeChatTeach unless noted)

### 1. Visible-work transparency — **PARTIAL**
The teach surface surfaces *some* of the MD's work but **not a live reasoning/tool trace**:
- PRESENT: "Thinking…" typing pill (`home-chat/MessageBubble.tsx:135`); per-turn
  **trust badges** — debate "Verified ✓ N-model" + degraded-brain pill
  (`HomeChatTeach.tsx:1142-1177`, fed by `debate_metadata`/`brain_state` SSE frames at
  `brain-teach.hono.ts:897,546`); **evidence/citation chips** under each bubble
  (`HomeChatTeach.tsx:1308-1322`); **auto-authorized rationale** card
  (`HomeChatTeach.tsx:1343-1365`); `step_progress` 5-dot pill via `UiBlockRenderer`.
- ABSENT: there is **no streaming reasoning/thinking trace and no live tool-execution
  log** in the teach surface. `brain-teach.hono.ts` emits **no `tool_call` /
  `tool_started` / `tool_finished` / `reasoning` event** (event list at
  `brain-teach.hono.ts:31-37` + grep of all `event:` sites). The owner sees *that* a
  debate happened and *which* evidence was cited, but never watches the juniors run.
- The one real tool-call execution log — `ToolCallSidebar.tsx` ("What the brain ran",
  per-junior latency/status/evidence-count) — is wired **only into the legacy
  `HomeChat.tsx`** (`/turn` surface, `HomeChat.tsx:248-253`), **not** into
  `HomeChatTeach`/OwnerOS. SOTA (AG-UI `TOOL_CALL` event class) expects inline
  tool-step visualization in the primary surface.
- The `Blackboard` (`components/blackboard/Blackboard.tsx`) is a strong adjacent
  "visible work" canvas (Mr. Mwikila places chart/diagram/formula/comparison elements
  live, with replay + export), driven by `board_element` SSE frames — but it is a
  side-by-side teaching canvas, not a reasoning/tool trace.

### 2. Inline generative UI — **PRESENT** (this is the standout strength)
`InlineBlockRenderer.tsx` is a single-source dispatcher over **~20 inline block kinds**
emitted inside `<ui_block>` / `inline_block` SSE frames and rendered **inside the bubble**:
- `inline_chart` (live chart), `inline_table`, `inline_dashboard` (recursive),
  `inline_section` (recursive), `inline_comparison`, `inline_wizard`, `inline_workflow`,
  `mini_metric`, `data_capture_card`, `confirmation_card`, `file_request_card`,
  `micro_action_card`, `tab_promotion_chip`, `draft_edit` (**editable** doc revision),
  `draft_preview` (read-only preview + format chips), `citations_block`, `doc_quest`,
  `level_select` (`InlineBlockRenderer.tsx:137-307`).
- This matches the INV-H examples precisely: forecast→`inline_chart`,
  document→`draft_edit`/`draft_preview`, lens→`inline_dashboard`/`inline_section`.
- Plus `UiBlockRenderer` (concept_card/metric_strip/decision_card/step_progress) and
  the 6 `SuperpowerChips` families (navigate/prefill/highlight/share/bulk/bookmark,
  `HomeChatTeach.tsx:592-657`). Unknown kinds degrade to a visible placeholder, never
  a crash. **This pillar is at or near SOTA on owner-web.**

### 3. Surface-spawn-from-chat — **PRESENT** (genuinely "truly chat-first")
The full path is wired end-to-end and recently hardened (HEAD commit "truly chat-first"):
- Brain emits a tab SSE frame → `HomeChatTeach` forwards every recognised frame up via
  `onTabSseFrame` (`HomeChatTeach.tsx:698-702`) → `OwnerOSShell.handleBrainTabFrame`
  parses it (`OwnerOSShell.tsx:245-341`) and dispatches `onSpawn`/`onUpdate`/`onRemove`/
  `onProposal`/`onGenuiProposal`/`onError`.
- `onGenuiProposal` is the flagship "ambient" path: it **persists** the MD-authored tab
  (`POST /api/v1/portal-genui/tabs`), spawns it in the **background** without stealing
  focus (`openBackground`, `OwnerOSShell.tsx:287-322`), and drops an "Opened … from your
  chat — it's in your tab strip, keep chatting" notice with **Open / Undo / Dismiss**
  (`OwnerOSShell.tsx:765-813`). That is exactly the INV-H "you left chat, here are the
  tabs" behaviour.
- The persisted tab renders through `GenUITabHost` (`genui-tab/GenUITabHost.tsx`), which
  fetches + re-validates the `PortalTab` and renders registry-mapped fields+widgets,
  DOMPurify-sanitised. Lower-confidence cases render an accept/dismiss **proposal tray**
  (`OwnerOSShell.tsx:707-764`); deterministic keyword matches surface the ambient
  `SuggestedTabBanner` (`HomeChatTeach.tsx:1037-1058`).
- NOTE — duplication/debt: owner-web rolled its **own** banner + proposal tray instead of
  the shared `packages/chat-ui` primitives `NeedSpawnBanner` and `ChatArtifactStream`,
  which exist, are tested, but have **zero app consumers** (grep: only `packages/genui`
  re-exports). Parity work should consolidate on one of these.

### 4. Multimodal (voice + vision) — **PARTIAL**
- Voice: PRESENT on owner-web. `AskComposer` mounts `VoiceMicButton`
  (`AskComposer.tsx:148`), which prefers a **realtime duplex call** to the gateway voice
  WS (`use-realtime-voice.ts` — PCM16 up, gapless playback, VAD barge-in at
  `use-realtime-voice.ts:134-142`) and **gracefully degrades** to browser Web-Speech STT
  when the WS is unavailable (`VoiceMicButton.tsx:107-122`). Assistant replies get a
  `VoicePlayButton` TTS control (`HomeChatTeach.tsx:1334`). The realtime endpoint is not
  live in this environment, so it runs in fallback today — but the client path is real.
- Vision/upload: PARTIAL. `OwnerOSChatPanel` has a top-edge **file drop-zone**
  (`OwnerOSChatPanel.tsx:123-167`, POST `/api/v1/owner/docs/intake`) and the
  `file_request_card` inline block performs real upload+extraction. That is document
  intake, **not image/vision-in-the-conversation** (no inline image attach in the
  composer, no camera/photo turn). True multimodal vision (send a photo of a licence /
  a pit, MD reasons over the pixels inline) is ABSENT.

### 5. Agentic approve / refine / take-the-wheel — **PARTIAL**
- Inline approve/refine PRESENT: action-bearing inline blocks (`micro_action_card`,
  `confirmation_card`, `data_capture submit`) **execute through the gateway
  action-bridge** (`HomeChatTeach.tsx:861-878` + `runInlineAction`), reflecting executed /
  needs-confirmation / declined back into the transcript. `confirmation_card` is the
  prepare→ask→execute gate. Refine is implicit via deep-dive / go-wider / related chips
  and suggested-action chips that re-prompt the MD.
- Take-the-wheel / prepare→ask→**handoff** is split OUT of chat: the cross-role
  `<chat_handoff />` renderer (`components/chat/HandoffCard.tsx`) exists but the
  **delegation + approve/deny/reverse workflow lives on separate pages**
  (`/mwikila/inbox`, `/mwikila/delegation` — `mwikila-inbox-panel.tsx`, T0–T3 tiers). So
  the *standing* autonomy/delegation controls and the approval inbox are **not inline in
  the conversation**; the owner leaves chat to run them. A true inline "take the wheel /
  raise autonomy for this task" affordance and an inline approval queue are ABSENT from
  the main surface.

### 6. Persona + memory — **PARTIAL (in the chat surface specifically)**
- Persona PRESENT: `PersonaGreeting` opens the surface; the owner persona is bound via
  `persona-runtime` (`lib/persona.ts`, cookie-persisted `persona-store.ts`); affective /
  Theory-of-Mind reads stream in (`affective_profile` frame → `BorjieDynamicHints` →
  `ProactiveHint`/`MasteryGate`/`LearnedShortcutsPanel`, `HomeChatTeach.tsx:1076-1082`).
- Memory PARTIAL **at the surface**: `HomeChatTeach` holds only **client-local** message
  state; history sent to the server is reconstructed from the in-component array
  (`HomeChatTeach.tsx:418-420`) and is **lost on reload** (no thread hydration — contrast
  the legacy `HomeChat`, which has `initialThreadId` + `isHydrating` thread restore at
  `HomeChat.tsx:84,220`). The durable cognitive memory exists at the brain layer
  (MEM-01/02 wired per project memory), but the teach surface does not visibly hydrate or
  *show* "what I remember about you" inline. So memory is real in the brain but
  under-surfaced in the main chat.

### 7. Chat-first navigation — **PRESENT (with one seam)**
The dashboard composes the OwnerOS shell whose pinned first tab is the chat, surfaces
spawn from it as tabs, and the tab strip is keyboard-driven (Cmd+T/W/1-9/Shift+T,
`OwnerOSShell.tsx:432-476`) with adaptive recency ordering. The root `/` redirects to
`/dashboard` (`app/page.tsx:11`). The seam: the dashboard is still a scrollable page
(greeting hero → daily brief → metric tiles → OwnerOS shell → live surface), so chat is
*a section within* the dashboard rather than *the* full-bleed home; and the hero CTA
points at the leaner `/ask`. Navigation is chat-anchored but not yet chat-*dominant*.

---

## BossNyumba parity (reasoned from the shared spine)

BossNyumba shares the same brain, the same SSE event taxonomy, and the same surface
components (`OwnerOSShell`, `HomeChatTeach`, `InlineBlockRenderer`, `GenUITabHost`,
`packages/chat-ui`, the voice stack) — only the **domain layer** differs (real-estate
juniors/tabs/corpus vs mining). Therefore:
- Pillars 2 (inline genUI), 3 (surface-spawn), 4-voice, 7 (chat-first) port **for free**
  the moment BN registers its domain tab descriptors + inline-block payloads — these are
  domain-agnostic by construction.
- Pillars 1 (visible reasoning/tool-trace), 4-vision, 5 (inline take-the-wheel/approval),
  6 (surfaced memory + thread hydration in the teach surface) are **shared gaps** — fixing
  them in Borjie's spine fixes them for BN simultaneously. Conversely, any BN-side
  divergence (e.g. BN building its own banner) would re-introduce the same
  `NeedSpawnBanner`/`ChatArtifactStream` duplication debt seen here. Recommend fixing in
  the shared `packages/chat-ui` so both estates inherit it.

---

## Net

The Borjie **main** chat (HomeChatTeach + OwnerOS) is **well past "a text box"** and
genuinely strong on inline generative UI, surface-spawn-from-chat, and the voice client —
clearly distinct from the marketing `FloatingAskBorjie` bubble. The gap to the
best-in-the-world INV-H bar is concentrated in: **(a) a live reasoning/tool-execution
trace in the primary surface** (today only badges+citations, the real tool log is on the
legacy surface); **(b) inline vision/multimodal**; **(c) inline take-the-wheel/autonomy +
an inline approval queue** (today on separate pages); **(d) surfaced/hydrated memory in
the teach surface**; and **(e) consolidating on the shared chat-ui spawn primitives** plus
pointing the hero CTA at the rich surface. The mobile apps are deliberately a tier
simpler (see below) and are the largest parity delta.

---

### Sources (key file evidence)
- `apps/owner-web/src/app/dashboard/page.tsx:125` · `apps/owner-web/src/app/page.tsx:11`
- `apps/owner-web/src/components/owner-os/OwnerOSShell.tsx:245-341,707-813`
- `apps/owner-web/src/components/owner-os/OwnerOSChatPanel.tsx:123-167`
- `apps/owner-web/src/components/home-chat/HomeChatTeach.tsx` (whole; esp. 698-702, 861-878, 1142-1177, 1308-1365)
- `apps/owner-web/src/components/home-chat/inline-blocks/InlineBlockRenderer.tsx:137-307`
- `apps/owner-web/src/components/home-chat/ToolCallSidebar.tsx` (only wired in `HomeChat.tsx`)
- `apps/owner-web/src/components/genui-tab/GenUITabHost.tsx`
- `apps/owner-web/src/components/voice/use-realtime-voice.ts:134-142` · `VoiceMicButton.tsx:107-122` · `AskComposer.tsx:148`
- `apps/owner-web/src/components/blackboard/Blackboard.tsx`
- `apps/owner-web/src/components/chat/HandoffCard.tsx` · `app/(routes)/mwikila/inbox/mwikila-inbox-panel.tsx`
- `apps/owner-web/src/components/BorjieWidgetMount.tsx:36` (marketing widget)
- `services/api-gateway/src/routes/brain-teach.hono.ts:31-37` (SSE event taxonomy — no tool_call/reasoning event)
- `packages/chat-ui/src/components/{ChatArtifactStream,NeedSpawnBanner,ProactiveHint,MasteryGate,LearnedShortcutsPanel}.tsx` (NeedSpawnBanner/ChatArtifactStream unused by apps)
- `apps/buyer-mobile/src/chat/HomeChat.tsx` · `apps/workforce-mobile/src/chat/{HomeChat,ToolCallRenderer}.tsx` · `apps/workforce-mobile/app/(tabs)/ask.tsx`
</content>
</invoke>

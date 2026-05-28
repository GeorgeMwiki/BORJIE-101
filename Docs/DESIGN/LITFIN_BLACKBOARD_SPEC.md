# LitFin Blackboard — measured spec + behavioural contract

Audience: Borjie engineers cloning pixel + logic parity for the mining
cockpit. Source surveyed: `src/core/smartboard/` (69 files, ~600 KB)
under the user-owned LitFin workspace. No LitFin source ships in
Borjie; this document is the only artefact retained.

## 1. Surface and layout

Visual canvas (the "Smartboard" / blackboard) sits beside the chat
stream as a split-pane composition. LitFin's chosen ratio is 55%
chat / 45% board on the borrower portal. The board is full-height of
the chat container, internal-scrolls when content exceeds the
viewport, and collapses to a stacked layout below the chat on
≤640px viewports.

Container chrome:
- rounded-2xl, border-border/60, bg-card, shadow-sm
- internal padding `p-5`, `max-h-[min(60vh,520px)]`, `overflow-y-auto`
- Each act of a scene gets its own gradient header bar
  (`from-...-500/20 to-...-500/5`) with an act icon + label

## 2. Element primitives (the visual verbs)

Every primitive is a typed object with an `id`, an optional `atMs`
reveal timestamp, an optional sentiment (`positive | negative |
neutral`), and a payload tailored to the primitive. Each is rendered
by a dedicated React view component under
`storytelling-primitives.tsx`.

| Primitive | Purpose | Payload (essential) |
|-----------|---------|---------------------|
| `growth_bar` | quantity rising / falling | label, fromValue, toValue, unit, sentiment, durationMs |
| `causal_arrow` | "X drives Y" | fromAnchorId, toAnchorId, label, sentiment |
| `hierarchy` | parent → child tree | rootId, nodes[{id,parentId,label,meta}] |
| `timeline` | ordered events on an axis | axisLabel, events[{id,atLabel,title,description,sentiment}] |
| `equation` | display + per-variable gloss | title, expression (LaTeX-lite), variables[{symbol,meaning}] |
| `callout` | tone-coded anchor sentence | text, textSw, tone, attribution |
| `comparison` | side-by-side cards | headline, cardA, cardB |
| `image` | labelled figure | src, caption, attribution |
| `text` | headline / emphasis / normal body | body, bodySw, weight |
| `highlight` | overlay pulse on prior element | targetId, tone |
| `sketch` | hand-drawn SVG path | svgPath, label |

LitFin further layers a "Whisper Layer" (overlays the AI places
silently on existing elements without sending chat text): pulse
highlights, guide arrows, tooltips, annotations, breadcrumbs,
progress rings, nudge glows. These are conceptually the same as
`highlight` + `text` but bound to a `WhisperOverlay` envelope
(`{id, visualId, type, position{x%,y%,w%,h%}, content, priority,
ttl, animation, interactive}`) and capped by a `WhisperStrategy`
(`wait | hint | guide | celebrate | nudge`).

## 3. Animation system

Library: framer-motion. Cadence:

| Element | Enter | Notes |
|---------|-------|-------|
| growth_bar | width 0→target over 1.2s, easing `[0.16, 1, 0.3, 1]`, 90ms stagger per index | cinematic build |
| causal_arrow | stroke-dashoffset draw 0.7s, arrowhead `opacity 0→1 @0.6s`, label `delay 0.4s` | drawn-on feel |
| hierarchy | per-node `opacity + x:-8→0`, 0.3s, `delay = depth × 0.08s` | left-to-right reveal |
| timeline | per-event `opacity + x:-10→0`, 0.35s, `delay = i × 0.1s` | walks down axis |
| equation | type-on at ~28 ms/char, variables `delay = totalMs + 0.15s` | chalk-on-board |
| callout | `opacity + y:6→0`, 0.35s, eased | lands gently |
| takeaway | `opacity + y:8→0`, 0.4s, fires when scene `state.finished` | mastery moment |

Reduced-motion is honoured via a single `useReducedMotion` hook;
duration collapses to 0 and stagger to 0 when prefers-reduced-motion
is set.

## 4. State machine

`smartboardReducer` is a pure switch over an `SmartboardAction` union.
Every case returns a new immutable state. Action vocabulary:

```
SHOW_VISUAL | UPDATE_VISUAL | REMOVE_VISUAL | SET_ACTIVE_VISUAL
ADD_WHISPER | REMOVE_WHISPER | CLEAR_WHISPERS
SCROLL_TO | HIGHLIGHT_ZONE | ANNOTATE | SET_BREADCRUMB
SET_INTERACTION_SESSION | UPDATE_EXPLORATION_PROGRESS
TOGGLE_EXPANDED | SET_SCROLL_POSITION
```

State envelope:
```
SmartboardState = {
  activeVisualId | null
  visuals: SmartboardVisual[]
  whisperLayer: WhisperOverlay[]
  interactionSession: InteractionSession | null
  scrollPosition: number
  isExpanded: boolean
}
```

`SmartboardVisual` carries `id, messageId, type, data, title,
subtitle, isActive, explorationProgress, conceptId, parentVisualId,
depth, createdAt`. Nesting (parent visual id) lets follow-up
elements thread below their parent so the board becomes a
comprehension tree.

## 5. Chat ↔ board protocol

The brain emits inline tags inside the SSE chat stream. LitFin's
chosen wire shape:

```
<artifact id="art-42" type="comparison_table" title="Loan options">
  ... arbitrary inner content the model streams ...
</artifact>
```

A streaming state-machine parser (`chat-artifact-stream-parser.ts`)
watches the chat stream chunk-by-chunk and emits three lifecycle
events per artifact: `open`, `delta`, `close`. The parser:
- holds back ambiguous suffixes that could be the START of `<artifact`
  / `</artifact>` across chunks (so a tag split across chunks is not
  missed)
- enforces strict id / type / title charsets (DOMPurify is layered on
  top before render)
- carries an optional `seq` per session so missed events after a
  reconnect can be detected
- runs both server-side (inside the SSE proxy) and client-side (inside
  `useChatBlackboardStream`)

The close event carries a typed `EntryEnvelope` so downstream
composers route to the right renderer (math → KaTeX, comparison →
ComparisonCard, dynamic_visual → AI2D generator, etc.).

## 6. Drawing canvas overlay

A transparent absolute-positioned `BoardCanvas` overlays the active
visual when drawing mode is on. Tools: pen / highlight / eraser /
text / arrow / circle / rectangle. Colors: 9-swatch palette
(slate, red, amber, green, blue, violet, pink, teal, white, ink).
Undo/redo stacks are immutable arrays of `Stroke[]`. Strokes export
as PNG via canvas `toDataURL`. Touch + mouse.

## 7. Interaction surface

- Click any visual → emits `visual_click` panel event, scrolls into
  view, sets it active
- Hover → `visual_hover` event for analytics
- Scroll wheel → `visual_scroll`
- Whisper overlays are click-through unless `interactive: true`
- Annotations are interactive (you can re-click to remove)
- "Ask about this" → injects `<board_focus>{visualId}</board_focus>`
  into the next user message so the brain has scoped context

## 8. Replay + export

Every visual is reconstructable from the ordered list of `<artifact>`
emissions plus interaction events. The owner can scroll back and
hit "Replay" to watch the board rebuild itself in time (the renderer
walks `state.shapes` from `revealed = {}` forward, applying `atMs`).
"Export PDF" rasterises the current scene + all visible elements +
the takeaway banner into a single page (handout-grade).

## 9. Brain prompt — how the LLM is told to push elements

The teaching system prompt carries a SMARTBOARD section that:
1. Describes the surface ("You have a visual canvas next to the chat.
   Show, do not just tell.")
2. Lists the element vocabulary (one line per primitive with a
   one-line schema)
3. Describes the teaching flow ("Explain briefly in chat. Render an
   element on the board. Observe. Ask Socratic. Quiz on the board.
   Celebrate / scaffold. Advance.")
4. Calls out when to STAY SILENT (Whisper Layer active → no chat
   message)
5. Anchors the language (bilingual sw/en, level-aware depth)

The same system prompt is rendered in sw and en variants; brain
picks the variant from the request `language`.

## 10. Surfaces of provenance

Every artifact carries `kind`, `confidence ∈ [0,1]`, `tierScope`,
`dependsOn[]`, `agentId`, `modelId`. The Auditor Agent rejects
artifacts whose evidence chain is empty. The Blackboard Repository
persists every artifact to Supabase (`blackboard_entries` row) so
sleep-pass agents can read back the lesson and reason about it
later (`heartbeat/sleep-passes/blackboard-writeback.ts`).

## 11. Test surfaces

`__tests__/blackboard-state.test.ts`, `tier-filter.test.ts`,
`blackboard-consumption.test.ts`. The reducer is the single hardest
seam to keep right; LitFin pins the immutability invariant with a
freeze-and-mutate detector in CI.

## 12. Borjie deltas (what we change vs. parity)

- Element vocabulary becomes mining-estate-tailored (royalty
  formulas, PML cross-sections, chain-of-custody flow, succession
  tree, LBMA-fix sparkline, NEMC EIA cycle).
- Tag is renamed `<board_add>` (one element per tag, JSON payload)
  for tighter alignment with the existing Borjie `<spawn_tabs>`
  protocol family. LitFin's open/delta/close lifecycle is not needed
  because we send a closed-form JSON payload, not free-form inner
  content.
- Whisper Layer is deferred to wave 2 — wave 1 is the visible
  element pipeline + replay.
- The drawing canvas overlay is deferred to wave 2.
- KaTeX is opt-in (peer dep). Wave 1 ships a sanitized
  text-with-monospace formula fallback so the board renders on every
  build without a new dep.

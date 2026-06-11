# LITFIN Harvest — the SOTA engineering of the learning/stepper chat + smartboard/teaching-canvas lineage

**Lane:** `litfin-harvest` (REPO READ-ONLY — no code edits, no commit)
**Date:** 2026-06-09
**Author:** harvest subagent
**Scope:** Extract ALL the reusable SOTA engineering from the LitFin-ported
learning/stepper chat + smartboard/teaching-canvas lineage that lives in
THIS repo so it can be amplified. Four deep-logic axes:
(1) how it teaches, (2) how it acts human, (3) how it decides board vs
inline, (4) the smartboard reducer model.

The lineage is a port of LitFin's borrower-portal `learning-smartboard` +
`smartboard` (~69 files / 600 KB surveyed structurally; no LitFin source
shipped). The measured specs are at
`Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md` and
`Docs/DESIGN/LITFIN_BLACKBOARD_SPEC.md`. The runtime port lives in
`packages/chat-ui/src/chat-modes/*`, `packages/chat-ui/src/blackboard/*`,
`apps/owner-web/src/components/blackboard/*`,
`apps/owner-web/src/components/home-chat/*`, and the server brain at
`services/api-gateway/src/routes/brain-teach.hono.ts` +
`public-chat.hono.ts`.

---

## 0. The lineage map (where every piece lives)

| Layer | File | Role |
|---|---|---|
| **Pedagogy + persona DNA (the prompt)** | `services/api-gateway/src/routes/public-chat.hono.ts:601-1187` (`BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN`; SW twin at `:1189`) | The actual teaching brain: level-assessment, 5-step ladder, invisible-thinking mode router, check-in cadence, inline-first routing, blackboard flow, IP-protection clause |
| **Render-routing engine (server)** | `services/api-gateway/src/routes/brain-teach.hono.ts:854-1204` | Strips `<board_add>` / `<ui_block>` / `<inline_metric>` / `<spawn_tabs>` / superpower tags from one model reply and fans them out to distinct SSE event families (board vs inline vs tab) |
| **Board element parser (server)** | `services/api-gateway/src/routes/board-element-parser.ts` | Zod-validated `<board_add>` extractor; caps 12/turn, first-id-wins dedupe, always strips tag |
| **Board element parser (FE, shared shape)** | `apps/owner-web/src/components/blackboard/parse-board-elements.ts` | Identical contract, runs FE-side too (defense-in-depth) |
| **Smartboard reducer (the state machine)** | `apps/owner-web/src/components/blackboard/use-blackboard-store.ts` | Pure reducer + module-level pub/sub store; the `smartboardReducer` port |
| **Board element schema (the visual vocabulary)** | `apps/owner-web/src/components/blackboard/types.ts` | 9-primitive discriminated union, all bilingual, zod-strict |
| **Board host (the canvas)** | `apps/owner-web/src/components/blackboard/Blackboard.tsx` | Scrollable column, replay walker, export-PDF, focus + auto-scroll |
| **Element renderers** | `apps/owner-web/src/components/blackboard/elements/*` + `board-element-renderer.tsx` | One component per primitive, exhaustive `never` switch |
| **Chat ↔ board wiring** | `apps/owner-web/src/components/home-chat/HomeChatTeach.tsx:554-562` | The SSE `board_element` frame → `appendBoardElement()` bridge |
| **Split-pane host** | `apps/owner-web/src/components/owner-os/OwnerOSChatPanel.tsx:169-184` | 55/45 chat-board grid (`minmax(0,55fr) minmax(0,45fr)`) |
| **Pedagogical chat-mode reducer** | `packages/chat-ui/src/chat-modes/mode-detector.ts` + `apps/owner-web/src/components/home-chat/use-chat-mode.ts` | Zero-LLM content-driven mode switcher (teaching/quiz/review/discussion/classroom) |
| **Mode layouts** | `packages/chat-ui/src/chat-modes/{TeachingModeLayout,QuizLockdownOverlay,ReviewModeSummary,DiscussionModeLayout,ClassroomChatAdapter}.tsx` | The chrome each mode swaps in |
| **Stepper rail** | `apps/owner-web/src/components/home-chat/StepperBar.tsx` (+ `MasteryDial.tsx`) | 5-step mining-literacy ladder with mastery rings |
| **Generic teaching-canvas shell (package-level)** | `packages/chat-ui/src/blackboard/Blackboard.tsx` | Portable board shell (used by other surfaces); simpler than owner-web's |

The package `packages/chat-ui/src/chat-modes` was previously an **orphan**;
`use-chat-mode.ts` is the file that mounts it onto the live teaching
surface. The whole lineage is wired end-to-end ONLY on the owner-web home
chat today.

---

## 1. HOW IT TEACHES — pedagogy / stepper / progressive disclosure / scaffolding / mastery-gating

### 1.1 Level-first scaffolding (assess before you teach) — SOTA

`public-chat.hono.ts:640-654`. The single most important pedagogical move:
**read the learner before teaching them.** Early in the first session the
professor asks (casually, in its own words) whether the owner is *new /
knows-the-basics / veteran*, then emits a `level_select` `ui_block` so the
owner can tap their level. The picked level lands in `<owner_context>` on
every subsequent turn and silently sets:

- **NEW** → ~150-word replies, one concept/turn, plain analogies ("a PML
  is like a shop licence for a piece of land"), no un-glossed acronyms.
- **INTERMEDIATE** → ~250 words, one new term/turn with a one-line gloss.
- **ADVANCED** → ~400 words, professional vocab, surfaces counter-args +
  edge cases.

This is Vygotskian **zone-of-proximal-development** scaffolding done as a
prompt contract, not a model guess. **How good:** excellent — it converts
"adapt to the user" (a vibe) into a measurable per-turn word-budget +
depth knob keyed off a durable context field. The `level_select` block is
in the server allowlist (`brain-teach.hono.ts:344-356`).

### 1.2 The 5-step literacy ladder (progressive disclosure with a map) — SOTA

`public-chat.hono.ts:656-666` + `StepperBar.tsx:54-100`. A fixed
ORIENT → LICENCE → ROYALTY → WORKFORCE → MARKETPLACE ladder gives the
learner a **visible map of the whole journey** (left rail, always on
screen) while only one step is taught at a time. Each `concept_card`
declares its `stepIndex (1-5)`; each `step_progress` block re-confirms
`current/total`. The FE tracks `lessonStep` and the server frames the 3
trailing action chips as **next / deeper / wider** (`:883-886`):
- **next** = advance one rung on the ladder
- **deeper** = same concept, more depth
- **wider** = a connected concept

**How good:** this is the crux of progressive disclosure — the learner
always sees where they are, where they can go deeper, and what's next,
without being dumped the whole curriculum. The `next/deeper/wider`
triad is a cleaner pedagogical framing than LitFin's deeper/wider pair
(an explicit Borjie surpass, documented `brain-teach.hono.ts:11-13`).

### 1.3 Mastery-gating (the dial + the gate) — strong, partly aspirational

`StepperBar.tsx:160-213` renders a `MasteryDial` SVG ring per step
(`stroke-emerald-500` complete, `stroke-warning` ≥0.5, `stroke-warning/60`
>0, neutral 0) and supports `isLocked` steps with a `Lock` icon +
`opacity-40 cursor-not-allowed` (prerequisite gating). The progression
data feeds from `useMyMastery()` / `useMyShortcuts()` queries
(`HomeChatTeach.tsx:335-336`) into `<BorjieDynamicHints>` →
`MasteryGate`/`LearnedShortcutsPanel`. **How good:** the UI machinery for
mastery-gating is fully built (rings, locks, percent labels); the live
mastery *scores* are wired through the me-progression queries. The
`DEFAULT_STEPS` ship `mastery: 0` so until the query populates, every step
reads as un-mastered — the gate is real but the scoring source is the
thing to amplify.

### 1.4 Bloom's-taxonomy depth tagging — strong

`chat-modes/types.ts:25-31` (`BloomLevel`) + `TeachingModeLayout.tsx:11-27`
(`BLOOM_COLOR` + `BLOOM_LEVEL_INDEX` 1-6 with per-level colors) +
`mode-detector.ts:222-228` (regex-extracts the Bloom level from the reply).
`concept_card` carries `bloomLevel` (`public-chat.hono.ts:810`). Each
teaching turn surfaces a colored "Understand · L2" badge so the learner
(and the system) knows the cognitive level being targeted. **How good:**
real and consistently threaded from prompt → extractor → badge. The
6-segment Bloom bar in the LitFin ConceptCard spec
(`LITFIN_STEPPER_LEARNING_SPEC.md:130-135`) is the richer render to amplify.

### 1.5 The check-in cadence (Socratic, never dump) — SOTA pedagogy

`public-chat.hono.ts:685-693`. Hard rule: **ONE concept per message, then
a gentle confirm**, with the confirm phrasing *varied every turn* so it
never reads as a script:
- "Does that click, or want me to go a layer deeper?"
- "Following so far, or should I slow down on the royalty rate piece?"
- "How's that landing? Should we keep going, or pause here?"

"Never dump the full lesson at once." This is the **comprehension-check
loop** that distinguishes a teacher from a lecturer. Mirrored in the
blackboard flow step 3 (`:1090`). **How good:** this is gold — it is the
single behavior that makes the thing feel like a patient professor rather
than a doc-dump. Amplify by making the check-in *responsive to the
affective read* (see §2.4).

### 1.6 The "show, don't tell" visual-teaching loop — SOTA

`public-chat.hono.ts:1087-1102` (BLACKBOARD TEACHING FLOW):
1. Brief prose in the bubble (1-2 sentences MAX).
2. Render the visual on the board (1-3 elements).
3. Check in ("Does that land...").
4. On follow-up, **ADD** elements to extend — do NOT start over.
5. End with a `comparison` or a takeaway `text` element so the learner
   walks away with something concrete.

Plus a **curriculum of canonical moves** (`:1094-1101`) — pre-composed
element recipes per topic (ROYALTY = formula + monthly chart; LICENCE =
flow ladder + bar chart; CUSTODY = pit→assayer→smelter→exporter→buyer flow
+ hash-chain arrows; TREASURY = LBMA-vs-BoT line + parcel-price formula;
ESTATE = succession tree + net-worth formula). **How good:** this is the
deepest teaching IP in the repo — it encodes a *pedagogy of multi-modal
explanation* (verbal + visual + persistent artifact) and a reusable
recipe book. `BORJIE_BLACKBOARD_CURRICULUM.md` is the fuller corpus.

### 1.7 The mode-detector (zero-LLM pedagogical state machine) — strong

`mode-detector.ts`. Pure regex pattern-analysis classifies each completed
assistant turn into `teaching / quiz / review / discussion / classroom /
conversation` with a confidence score, using:
- A **warm-up window**: never changes mode in the first 2 messages
  (`:115-121`) — pedagogically, don't label the relationship before it
  exists.
- **Tool-call priority** over prose (`:123-149`): an emitted `teach-concept`
  block ⇒ teaching@0.95, beating any prose heuristic.
- **Indicator banks** (`QUIZ_/TEACHING_/REVIEW_/DISCUSSION_INDICATORS`)
  scored by match count with thresholds (teaching ≥2, quiz needs ≥2 + A-D
  options, review ≥2, discussion ≥3 solo / ≥2 in group).
- **Sticky default**: "No strong mode signal" → stay in current mode
  (`:203-207`), so the surface never flickers.

`use-chat-mode.ts:190-238` reduces a turn into a new immutable
`ChatModeState`, **clearing every non-active data slice** so a stale quiz
card can never linger (`:210-219`), and degrades quiz→teaching when the
reply has no parsable A-D options (`:224-230`). **How good:** a genuinely
elegant zero-cost classifier — no extra LLM call, fully deterministic,
testable, immutable. The thresholds + warm-up + sticky-default trio is the
reusable pattern.

### 1.8 Quiz lockdown + spaced-review summary — strong

`QuizLockdownOverlay.tsx` is a timed assessment overlay (countdown with
color ramp green→amber→red `:13-18`, locks the composer until answered,
auto-reverts to teaching after 1.5s `:69`). `shouldExtendQuizTime`
(`mode-detector.ts:310-317`) extends the timer when a group is < 60%
answered and < 30% time remains. `ReviewModeSummary.tsx` is the
end-of-block mastery card: overall score, mastery delta (colored
±), concepts covered, quiz accuracy, Bloom reached, misconceptions
addressed, **recommended next concepts**, and a **recommended review
date** (`:82-86`) — i.e. a spaced-repetition hook. **How good:** the
review summary with a next-review date is the spaced-repetition seam; it
is rendered but the scheduling logic is the thing to amplify.

---

## 2. HOW IT ACTS HUMAN — pacing, tone, turn-taking, the "person" feel

### 2.1 The MD persona — "takes the wheel," partner not student — SOTA

`public-chat.hono.ts:615-617`. The framing is the whole personality:
"You are a senior mining COO at the owner's elbow who **takes the wheel**:
when the owner tells you something, you move the estate forward, then
explain what you did and why so they grow over time." And: "The owner is
your **partner, not your student**. Match their pace. Adapt to their
level. **Earn the right to teach by reading them first.**" The
PROCESS-OWNER MANDATE (`:619-638`) makes action the priority and teaching
the slipstream — for every fact the owner shares, *first* ask "as MD,
what must now happen?" then DRIVE it (with a worked example for "I hired 3
blasters" at `:631-638`). **How good:** this is the tonal core. It refuses
the "AI tutor lecturing a student" failure mode and replaces it with a
competent-peer-who-also-teaches register — exactly the "person feel" the
owner wants amplified.

### 2.2 Anti-robotic output discipline — SOTA tone control

`public-chat.hono.ts:677-683`. Concrete, enforceable tone rules:
- **NEVER em dashes** — use commas/colons/periods/semicolons.
- **Plain text only** in the body: no markdown headings, no bullet lists,
  no bold/italic, no code blocks. Short paragraphs (1-2 sentences), blank
  line between.
- A **banned-buzzword list**: never "AI-powered", "revolutionize",
  "synergize", "next-generation", "leverage", "seamlessly",
  "best-in-class" — and a positive concrete-vocabulary list (licence,
  royalty, parcel, shift, drill-hole, FX window, LBMA, BRELA, TRA...).
- **Temperature 0.85** so the *opener varies turn-to-turn* — owners
  "should never see the same 'Good morning' boilerplate twice"
  (`brain-teach.hono.ts:773-776`).

**How good:** this is the difference between "sounds like ChatGPT" and
"sounds like a person." The banned-list + no-em-dash + no-markdown + high
opener-temperature combination is directly reusable across every persona.

### 2.3 Conversational memory / turn-taking discipline — SOTA

`public-chat.hono.ts:668-676` (INVISIBLE THINKING) + `:762-764` (data
capture threading). Every turn the model silently asks: what MODE
(ASSESS/TEACH/EXECUTE/SUMMARISE), what LEVEL, what STEP, what real data is
in `<owner_context>`, and **what's in history[]** — with the hard rule:
"Don't re-introduce, don't re-ask what they shared, build on what you
already taught. If the owner says 'the others' / 'number two', reuse the
SAME labels you offered moments ago. **Inventing fresh categories mid-thread
is a hard failure.**" Data-capture cards thread across turns: captured
values come back as a hidden `__data_capture_response` and MUST be treated
as next-turn input, never re-asked. **How good:** label-stability +
no-re-ask is what makes a multi-turn conversation feel like one continuous
mind rather than independent completions. This is a top amplify target.

### 2.4 Live Theory-of-Mind affective read (pacing knob) — SOTA, wired

`brain-teach.hono.ts:520-575`. Before any text streams, the server runs
`inferMindState(message)` → an `affectiveAccumulator.observe(tenant,user)`
that maintains a stateful per-(tenant,user) profile with five unit-interval
axes (frustration / comprehension / anxiety / trust / urgency), TTL'd at
24h, and emits an `affective_profile` SSE frame *before* the message chunks
so `<ProactiveHint>` can offer a handoff / simpler-explanation / safety
reassurance / idle-teach as soon as the bubble paints
(`HomeChatTeach.tsx:693-697`, `:328-334`). The profile also feeds an
`OWNER_STATE` directive injected into the system prompt
(`brain-teach.hono.ts:591-632`) so the model *itself* adapts pacing.
**How good:** this is the human-pacing engine — the system reads the
owner's emotional state and modulates both UI hints and prompt directive.
It is live-wired. Amplify by tying the §1.5 check-in phrasing to the
frustration/comprehension axes.

### 2.5 Persistent advisor memory across sessions — strong, wired

`brain-teach.hono.ts:531-540` + `:1274-1302`. `getMemory(db, tenant)` reads
persisted preferences + observed patterns; `recordObservation` writes back
the turn's engagement signal, question kind, local-hour (timezone-aware
`:293-308`), and any detected routine action (`detectRoutineAction`) or
rejected recommendation (`detectRejectedRecommendation`). The memory
renders into an `OWNER_MEMORY` prompt directive so "the brain remembers WHO
the owner is across sessions." A **degraded-brain badge** also surfaces
when the provider ladder fails 2 turns running (`:542-554`). **How good:**
this is the "remembers me" layer that makes a tool feel like a relationship.

### 2.6 Streaming "person" micro-feel — strong

The LitFin spec pins the micro-animations that sell live-presence:
typing-dots placeholder, streaming cursor (`w-1.5 h-4 bg-primary
animate-pulse`), per-bubble spring entry, quick-reply chips with stagger +
hover micro-lift (`LITFIN_STEPPER_LEARNING_SPEC.md:193-235`). The adaptive
stream controller (`brain-teach.hono.ts:931-964`) micro-streams when the
client keeps up and batches for slow clients, with a recommended inter-chunk
delay — i.e. **paced** delivery, not a dump. **How good:** the pacing of
token delivery is itself a humanness signal; the adaptive controller is the
seam to amplify (e.g. slow down deliberately on a hard concept).

---

## 3. HOW IT DECIDES BOARD vs INLINE — the render-routing logic

This is the INV-L "what goes on the blackboard vs inline (ephemeral)"
decision, implemented in two places: the **prompt** tells the model which
tag to emit, and the **server router** fans those tags into distinct SSE
event families.

### 3.1 The INLINE-FIRST default rule (the routing brain) — SOTA

`public-chat.hono.ts:695-723`. The governing principle: "The owner is
talking to you in the chat. Your default is to render the EXACT slice they
need, **inline, inside this turn**." A 6-way inline decision tree (`:699-707`):
1. Precise answer → `mini_metric` or short paragraph + `tab_promotion_chip`.
2. Needs 1-3 fields → `data_capture_card` (exactly those fields).
3. Proposes a state change → `confirmation_card`.
4. Needs a doc → `file_request_card`.
5. Just completed something → `micro_action_card` (next step).
6. Richer view exists → end with a `tab_promotion_chip`.

And the SLICE-CAN-SCALE-UP rule (`:709-723`): pick the inline block by
**size of answer** — single number → `mini_metric`; 3-8 rows →
`inline_table`; trend → `inline_chart`; multi-step → `inline_wizard`;
checklist → `inline_workflow`; 2-3 options → `inline_comparison`; grouped →
`inline_section`; overview → `inline_dashboard`. **"Many owners will never
click into a tab — your chat replies are the entire UI for them."**

**How good:** this is the canonical render-routing spec — a precise
decision procedure from *question shape* to *render primitive*, with a
strong default (inline, ephemeral) and explicit escape hatches (tab
promotion for persistence). This is the INV-L logic to amplify.

### 3.2 Three render destinations, three persistence tiers

The lineage routes content to **three** distinct destinations, each with
its own persistence semantics — the heart of INV-L:

| Destination | Tag | SSE event | Persistence | When |
|---|---|---|---|---|
| **Inline (chat, ephemeral)** | `<ui_block>` (inline-first kinds), `<inline_metric>` | `inline_block`, `inline_metric`, `ui_block` | Lives in the bubble; scrolls away with the thread | Default — the slice the owner needs *now* |
| **Blackboard (persistent, reference, teaching)** | `<board_add>` | `board_element` | Accumulates across turns; replayable; PDF-exportable | A CONCEPT / FORMULA / DIAGRAM / TREND / COMPARISON that "deserves to live on the canvas for the rest of the lesson" (`:1102`) |
| **Tab (durable cockpit surface)** | `<spawn_tabs>` / `<tab_spawn>` | `spawn_tabs`, `tab_*` | Persisted cockpit section, DB-backed | Explicit "open X" / "everything" intent only (`:707`) |

The board-vs-inline rule is explicit at `:1102`: **"DO NOT use the
blackboard for trivial chitchat. Use it when there is a CONCEPT, a FORMULA,
a DIAGRAM, a TREND, or a COMPARISON that deserves to live on the canvas."**
That single sentence is the INV-L render-routing decision in one line:
*ephemeral answers stay inline; durable thought-artifacts go to the board.*

### 3.3 The server fan-out (one reply → many event families) — SOTA

`brain-teach.hono.ts:854-1236`. The model emits ONE text reply with
embedded tags; the server strips them in a **deliberately ordered**
pipeline (order matters because some payloads contain braces that would
confuse later regexes) — `:856-877`:
`spawn_tabs → tab_tags → auto_authorized → board_add → inline_blocks →
ui_block → inline_metrics → superpowers → citations`. Then it streams the
*cleaned* prose first (`:939-964`), and only after the text fans each
stripped artifact out as its own SSE event in document order —
`board_element` per board element (`:969-975`), `inline_metric` per metric,
`inline_block` per inline block, `ui_block` for the one primary teaching
block, then superpower chips, spawn-tab chips, tab CRUD, genui proposal.
**How good:** this is the architectural keystone — a clean separation
where the *model* decides intent (which tag) and the *server* deterministically
routes to the right surface, with validation + capping + dedupe at every
boundary. The ordered-strip pipeline is a subtle, reusable trick.

### 3.4 What becomes a board element (the 9-primitive vocabulary) — SOTA

`apps/owner-web/src/components/blackboard/types.ts` (zod discriminated
union) + `public-chat.hono.ts:1075-1085`. The closed vocabulary of "things
worth drawing on the board," all bilingual `{en,sw}`:

| Primitive | What it teaches | Key payload |
|---|---|---|
| `formula` | chalk-on-board maths | `latex` + per-`variables` gloss |
| `diagram` | flow / tree / venn / matrix | `nodes` + `edges` |
| `chart` | bar / line / donut trend | `series` of points, tonal colors |
| `comparison` | two side-by-side cards | `cardA`/`cardB` + bullets + metric |
| `image` | labelled figure | `src` + `caption` |
| `text` | normal / emphasis / headline | `body` + `weight` |
| `highlight` | pulse overlay on a prior element | `targetId` + `tone` |
| `arrow` | causal arrow between two elements | `fromId`/`toId` + `sentiment` |
| `sketch` | hand-drawn SVG path | `svgPath` |

`highlight` and `arrow` are *relational* — they reference earlier element
ids (`targetId` / `fromId`/`toId`), which is how the board becomes a
**comprehension graph** rather than a flat list. The renderer is an
exhaustive `never`-checked switch (`board-element-renderer.tsx:53-58`) so a
new primitive can't be added without a render path. **How good:** a tight,
validated, relational visual grammar — the reusable "what is worth
persisting as a thought-artifact" answer.

---

## 4. THE SMARTBOARD REDUCER MODEL — elements, history, board state machine

### 4.1 The reducer (`use-blackboard-store.ts`) — SOTA, the port of `smartboardReducer`

`apps/owner-web/src/components/blackboard/use-blackboard-store.ts`. A pure
`reduce(state, action)` switch returning a **new immutable state** every
case, plus a **module-level pub/sub** store so the store *survives unmounts
across the chat ↔ board boundary* (the chat and the board are sibling
components; a React-context provider would re-mount; the module singleton
does not). Parity note in the header: "parity with LitFin's
`smartboardReducer`, but local rather than provider-based."

**State envelope** (`:18-32`):
```
BoardState = {
  elements: ReadonlyArray<BoardElementEnvelope>  // ordered, emission order
  activeId: string | null                        // focused element
  lastAddedAt: number                            // wallclock, drives replay
  replaying: boolean                             // replay walk in progress
}
```

**Action union** (`:34-40`):
`append | focus | remove | clear | replay-start | replay-end`.

**The append case (`:44-68`) is the crux:** it **dedupes by element id** —
if an element with the same id already exists it re-emits the envelope *in
place* (preserving order, updating content) rather than appending a
duplicate. The header explains why: "so the brain can safely re-emit an
element across reconnects." This is what makes the SSE stream
**idempotent** — a dropped-then-redelivered `board_element` frame, or a
deliberate same-id re-emit (e.g. updating a formula after a correction,
`:1073`), lands as an in-place update, not a dupe. `focus` no-ops if the id
is unknown (`:69-72`); `remove` re-points `activeId` to the last surviving
element (`:73-81`); `clear` resets to `INITIAL` (`:82-83`).

**How good:** this is textbook — pure reducer + immutable state + idempotent
append + module-singleton-pub/sub-for-cross-tree-survival. The id-dedupe-on-
append is the single cleverest line in the lineage; it is what makes the
board safe under at-least-once SSE delivery.

### 4.2 The envelope (`BoardElementEnvelope`) — the history record

`types.ts:223-232`. Each stored element is wrapped: `{ id, addedAt
(monotonic, for stagger), element (the validated payload), messageId (which
assistant turn it came from) }`. The `messageId` link is what ties a board
artifact back to the chat turn that produced it — the seam for "ask about
this element" scoped context (LitFin's `<board_focus>`,
`LITFIN_BLACKBOARD_SPEC.md:148`). **How good:** the envelope is the
minimum-viable provenance record; amplify by surfacing the messageId link
in the UI (jump-to-turn).

### 4.3 History / replay (the board rebuilds itself in time) — SOTA

`Blackboard.tsx:35,80-109` (owner-web). The board keeps elements in
**emission order** and exposes a **Replay** that walks the list from index
0 forward with a `REPLAY_STAGGER_MS = 600` stagger (`startReplay()` sets
`replaying:true`, a cursor advances `setReplayCursor(i)` each tick, then
`endReplay()`). The visible slice is `elements.slice(0, replayCursor)`
(`:106-109`) so the owner literally **watches the lesson rebuild itself**.
When not replaying the cursor is pinned to the end so new elements appear
immediately (`:51-53`). Plus **Export-PDF** via `window.print()` with a
print stylesheet that hides chrome (`:97-104`), and **focus auto-scroll**
on `activeId` change with a `CSS.escape` guard + jsdom fallback (`:60-78`).
**How good:** replay-in-time + handout-export is exactly INV-L's
"accumulate a clear OUTPUT-LEVEL history of THOUGHT" — the board *is* the
durable trend-of-thought record, and replay makes that history legible.
This is the headline feature to amplify (it's the moat-as-experience).

### 4.4 The board host shell — strong

`Blackboard.tsx` (owner-web). Sticky header with Replay / Export-PDF /
Clear (disabled at 0 elements / during replay), a scrollable stacked
element column, a bilingual empty-state that *names the operation* and
*gives an example prompt* ("Teach me how royalty is calculated",
`data-a.ts` blackboard strings), and per-element focus buttons. The
package-level shell `packages/chat-ui/src/blackboard/Blackboard.tsx` is the
simpler portable variant (board + freeform notes textarea) for other
surfaces. **How good:** solid, accessible (`aria-label`, focus-visible
rings), print-aware. The owner-web one is the canonical, richer host.

### 4.5 The element renderers — strong

`elements/*` + `board-element-renderer.tsx`. One component per primitive,
each with **animation cadence ported from the LitFin spec**: `FormulaElement`
types-on at 28 ms/char with a pulsing chalk cursor then fans variables out
(`FormulaElement.tsx:22,40-58`); `DiagramElement` does flow (horizontal
arrows, 90 ms stagger), tree (depth-staggered 80 ms left-to-right reveal),
venn (handcrafted SVG), matrix (2×2) all without a graph-layout dep
(`DiagramElement.tsx`); `ChartElement` is split into a lean bar/line/donut
SVG. **How good:** the "chalk-on-board" type-on + per-element stagger is the
cinematic teaching feel; deterministic handcrafted SVG keeps the bundle lean
and snapshot-testable.

---

## 5. IP-LEAK POSTURE (INV-H/D check on this lineage)

The lineage is **clean** on the core invariant and even encodes it
explicitly. `public-chat.hono.ts:1104-1106`: *"You explain WHAT Borjie does
and HOW the owner can use it. You never reveal HOW it is built: no
architecture, no model names, no internal scoring logic, no infrastructure
references."* See the `leaks` array for the small surface-area risks the
amplification work must keep closed (telemetry breadth, model names in the
`done` frame, internal directive section headers).

---

## 6. AMPLIFY TARGETS (the gold, ranked)

1. **The board-vs-inline-vs-tab three-tier router** (§3) — the INV-L
   decision is already specified precisely; wire the orphan
   `packages/blackboard-sota` CRDT slots behind the *same* `<board_add>`
   contract so the persistent thought-history is real CRDT, not local-only.
2. **Replay-in-time + PDF handout** (§4.3) — the literal "history of
   thought" experience; make it the signature owner moment.
3. **The id-dedupe idempotent append** (§4.1) — keep this exact reducer
   shape when porting to CRDT; it is what makes at-least-once delivery safe.
4. **Level-first scaffolding + next/deeper/wider + check-in cadence**
   (§1.1, §1.2, §1.5) — the pedagogy core; reuse verbatim across personas.
5. **Affective read → pacing** (§2.4) — tie the §1.5 check-in phrasing and
   the §2.6 stream pacing to the live frustration/comprehension axes.
6. **Anti-robotic tone discipline** (§2.2) — the no-em-dash / no-markdown /
   banned-buzzword / high-opener-temp combo is the reusable "person voice."
7. **The 9-primitive relational visual grammar** (§3.4) — the reusable
   answer to "what is worth persisting as a thought-artifact."

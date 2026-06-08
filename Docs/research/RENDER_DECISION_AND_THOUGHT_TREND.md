# The Render-Decision Engine + the Blackboard Thought-Trend — synthesis

**Status:** synthesis dossier (architecture spec; no code, no commit)
**Date:** 2026-06-09
**Author:** render-decision synthesis subagent (workflow orchestration)
**Repos:** Borjie (mining estate OS · Mr. Mwikila) **and** BossNyumba (real-estate OS,
shared spine, domain layer differs). LITFIN is the credit-vertical donor of the
learning/stepper teaching-canvas + smartboard lineage.

**Invariants bound** (`Docs/research/MASTER_GAP_REGISTER.md`):
- **INV-L** (`:593-602`) — SOTA decision of what renders INLINE (chat, ephemeral) vs on
  the BLACKBOARD (persistent, reference, teaching), accumulating a clear, reviewable,
  **OUTPUT-LEVEL** thought-trend — DECISIONS / INSIGHTS / work-products / teaching steps,
  **never** internal cognition.
- **INV-H/D (hardened)** (`:583-591`) + **INV-H/D (ABSOLUTE)** (`:606-621`) — NEVER an IP
  leak; the system never explains its own mechanics; enforced **by construction** via a
  single central IP-egress guard (output firewall), fail-closed.
- **INV-H (amplified)** (`:522-542`) — the Visual-OS render discipline + the blackboard as
  the one **shared-state spine** (Face / Mind / juniors-coordination).

**Source dossiers synthesized:** `litfin-harvest.md`, `ip-leak-audit.md`,
`amp-blackboard-audit.md`, `THE_CHAT_SURFACE_ARCHITECTURE.md`, `MASTER_GAP_REGISTER.md`.

---

## 0. Thesis in one line

The MD already knows *which render primitive* fits an answer (LitFin's inline-first
decision tree) and *which visual* deserves to persist (the 9-primitive board vocabulary);
the missing piece is a **single typed Render-Decision arbiter** that (a) routes every
output to one of three persistence tiers on five output-level signals, (b) writes the
durable tier to **real CRDT slots** (today it writes an in-browser ephemeral reducer), and
(c) sits behind **one central IP-egress guard** so the thought-trend is, *by construction*,
an output-level work-history and never the cognition behind it.

---

## 1. The SOTA RENDER-DECISION ENGINE

### 1.1 What exists today (the two-place implementation)

Per `litfin-harvest.md §3`, the INV-L decision is **already implemented in two places**,
just not unified or named:

1. **The prompt** (`public-chat.hono.ts:695-723`) tells the model *which tag to emit* —
   an inline-first 6-way decision tree (precise answer → `mini_metric`; 1-3 fields →
   `data_capture_card`; state change → `confirmation_card`; doc needed →
   `file_request_card`; just-completed → `micro_action_card`; richer view →
   `tab_promotion_chip`) plus a **slice-scales-up** ladder (number → `mini_metric`; 3-8
   rows → `inline_table`; trend → `inline_chart`; multi-step → `inline_wizard`; …).
2. **The server fan-out** (`brain-teach.hono.ts:854-1236`) strips the emitted tags in a
   deliberately ordered pipeline and fans them into distinct SSE event families
   (`board_element` vs `inline_block` vs `ui_block` vs `spawn_tabs`), with zod validation +
   capping + first-id dedupe at each boundary (`board-element-parser.ts`).

The governing rule already in the prompt (`public-chat.hono.ts:1102`) is the one-line
INV-L spec: **"DO NOT use the blackboard for trivial chitchat. Use it when there is a
CONCEPT, a FORMULA, a DIAGRAM, a TREND, or a COMPARISON that deserves to live on the
canvas."** *Ephemeral answers stay inline; durable thought-artifacts go to the board.*

**The gap:** the decision is a *prompt heuristic + a tag-stripping switch*, not a typed,
testable **arbiter** with explicit signals; and its durable output lands on the
**in-browser ephemeral reducer** (`use-blackboard-store.ts`), not the CRDT slot bus that
`amp-blackboard-audit.md` shows is fully built but 0% wired.

### 1.2 The three persistence tiers (the heart of INV-L)

From `litfin-harvest.md §3.2`, the lineage already routes to **three** destinations with
three persistence semantics. The arbiter formalizes them:

| Tier | Tag (model emits) | SSE event | Persistence | When |
|---|---|---|---|---|
| **INLINE** (chat, ephemeral) | `<ui_block>` inline kinds, `<inline_metric>` | `inline_block`, `inline_metric`, `ui_block` | Lives in the bubble; scrolls away with the thread | Default — the exact slice the owner needs *now* |
| **BLACKBOARD** (persistent, reference, teaching) | `<board_add>` | `board_element` | Accumulates across turns; replayable; PDF-exportable; **(target) CRDT-persisted** | A decision / insight / formula / diagram / trend / comparison / teaching-step that "deserves to live on the canvas" |
| **TAB** (durable cockpit surface) | `<spawn_tabs>` / `<tab_spawn>` | `spawn_tabs`, `tab_*` | DB-backed cockpit section | Explicit "open X" / "everything" intent only |

### 1.3 The five decision signals (output-level only)

The arbiter scores each candidate output block on five signals — **all output-level, none
cognitive** (this is what keeps INV-L and INV-H/D simultaneously satisfied):

1. **Ephemerality** — is the answer only useful *this turn* (a single number, a yes/no, a
   field capture)? High ephemerality → INLINE. (Maps to the `public-chat.hono.ts:709-723`
   slice-size ladder: number/3-8 rows = inline by size.)
2. **Reference-value** — will the owner want to look *back* at this (a formula they'll
   reuse, a comparison they'll cite, a decision-record)? High → BLACKBOARD.
3. **Trend-worthiness** — does it extend an accumulating thread (a metric over time, the
   next teaching step on the 5-step ladder, a follow-up that *adds to* a prior board
   element rather than restating)? High → BLACKBOARD (append/extend, **not** restart —
   `public-chat.hono.ts:1087-1102` "ADD elements to extend, do NOT start over").
4. **Teaching-intent** — is this a CONCEPT/DIAGRAM/FORMULA in a teaching turn (the mode
   detector classified `teaching`, a `concept_card` with `stepIndex`/`bloomLevel`)? High →
   BLACKBOARD (the "show, don't tell" loop, `litfin-harvest.md §1.6`).
5. **Consequence** — is this a state change / proposal / durable workspace the owner will
   operate (a confirmation, a whole domain cockpit)? High consequence + durable-operate →
   TAB; high-consequence + just-confirm → INLINE `confirmation_card`.

**Decision rule (deterministic, testable):**
- ephemerality dominant → **INLINE** (default tier; "many owners never click a tab — your
  chat replies are the entire UI", `public-chat.hono.ts:709-723`).
- reference-value ∨ trend-worthiness ∨ teaching-intent → **BLACKBOARD** (curated,
  de-duped, time-ordered).
- consequence-durable-operate (explicit "open"/"everything") → **TAB**.
- Ties resolve toward the *less* persistent tier (cheapest to the owner, reversible).

### 1.4 Where it hooks — the modality-arbiter + the blackboard slot bus

Two hook points, both already named in the codebase:

- **The modality-arbiter** is the Visual-OS "VISUAL ROUTING decision tree" sub-layer
  (`MASTER_GAP_REGISTER.md:526-530`): intent-classify → skill/module load → **VISUAL
  ROUTING** → engineering rigor → composition. The Render-Decision arbiter is the *tier*
  decision that sits *beside* the visual-routing *form* decision: visual-routing picks
  **what shape** (SVG / HTML chart / React app / file); the render-decision picks **which
  surface tier** (inline / blackboard / tab). They run together in the same pre-render
  layer; the model emits the tag, the **server arbiter** (extending the
  `brain-teach.hono.ts:854-877` ordered-strip pipeline) is the deterministic enforcement
  point — validation + capping + dedupe + **tier assignment** at one chokepoint.
- **The blackboard slot bus** (`packages/blackboard-sota/src/slots/slot-store.ts:79-146`)
  is where the BLACKBOARD tier *should* write. Today the `board_element` SSE frame feeds
  the **local** `appendBoardElement()` reducer
  (`HomeChatTeach.tsx:554-562` → `use-blackboard-store.ts`). The arbiter's durable path
  must instead (also) call `SlotStore.set()` so the trend is a real CRDT slot that survives
  reload and projects cross-surface (Face role). The reducer's **id-dedupe-on-append**
  (`use-blackboard-store.ts:44-68`) must be preserved verbatim — it is exactly the
  idempotent-merge property the CRDT slot already guarantees
  (`slot-crdt.ts:41-180`), so the contract lines up.

---

## 2. The THOUGHT-TREND model on the blackboard (IP-SAFE by construction)

### 2.1 What the trend is — and is NOT

Per INV-L (`:596-599`) and the `ip-leak-audit.md` blackboard verdict (SAFE-by-design *iff*
two guardrails hold): the trend is **the curated thread of DECISIONS, INSIGHTS,
work-products, and teaching steps over time — never the internal chain-of-thought**. The
board element is the **conclusion** ("Royalty filing set for the 7th — gold 6%, TZS X"),
never the **derivation** ("Geology junior queried, FX junior disagreed, judge picked…").

### 2.2 The engineering keystone — a typed artifact union (compile-time IP safety)

`ip-leak-audit.md` (Blackboard section) gives the load-bearing pattern: make the board's
**write-contract a typed artifact union** with **no field for reasoning / tool / agent /
model**. If a value cannot be expressed as one of these output types, it does not belong on
the board — making "output-level only" a **compile-time property**, not a reviewer's
judgement call (the same "zero-mixing-by-construction" discipline used for EN/SW
localization).

The union is the existing 9-primitive board vocabulary (`litfin-harvest.md §3.4`,
`apps/owner-web/src/components/blackboard/types.ts`) — `formula | diagram | chart |
comparison | image | text | highlight | arrow | sketch` — **extended with explicit
work-thread record types**:

```
ThoughtTrendArtifact =
  | DecisionCard   { title, decision, rationale (DOMAIN-language only), evidenceIds[] }
  | Insight        { headline, body, evidenceIds[] }
  | Metric         { label, value, unit, trendPoints?[] }
  | TeachingStep   { stepIndex(1-5), conceptId, bloomLevel, body }
  | DocRef         { docId, title }
  | <the 9 visual primitives, all bilingual {en,sw}>
```

Hard constraint: **no `reasoning`, `toolCalls`, `handoffs`, `provider`, `model`,
`judgeProvider`, `winnerReason`, `thoughtText`, `finalPersonaId` field exists anywhere in
this union** — so the L1/L2/L4/L6 leak payloads (§4) are *structurally* unrepresentable as
a board write. This is guardrail #2 from `ip-leak-audit.md` enforced at the type level.

### 2.3 Curated, de-duped, time-ordered, persisted, reviewable

The trend inherits the reducer/CRDT properties the harvest proved are SOTA:

- **De-duped** — id-keyed idempotent append (`use-blackboard-store.ts:44-68`) ≡ CRDT LWW
  merge (`slot-crdt.ts`): a redelivered or deliberately-updated artifact (e.g. a corrected
  formula) lands **in place**, never duplicated. Safe under at-least-once SSE delivery.
- **Time-ordered** — elements kept in emission order; the `BoardElementEnvelope`
  (`types.ts:223-232`) carries `addedAt` (monotonic) + `messageId` (provenance back to the
  turn that produced it).
- **Reviewable history** — **Replay-in-time** (`Blackboard.tsx:80-109`, 600ms stagger walks
  the trend forward so the owner *watches the work-thread rebuild itself*) + **Export-PDF**
  handout. This is the literal INV-L "clear OUTPUT-LEVEL history+trend of THOUGHT" — and
  the signature owner moment (the moat *as experience*).
- **Persisted (target)** — today the trend dies on reload (local reducer); the wave wires
  it to the CRDT slot bus + a `blackboardSlots` Drizzle table (the missing persistence
  `amp-blackboard-audit.md §1` flags) so the work-history is durable and cross-surface.

### 2.4 The two guardrails that must hold (from the audit)

1. **Route on OUTPUT semantics, never cognition** — a decision/insight/artifact/teaching
   step goes to the board; a reasoning step / tool-call / handoff / CoT fragment **never**
   does. (§1.3 signals are all output-level by design.)
2. **No leaky frame may land on a slot** — the typed union (§2.2) makes this a compile
   error, and the central egress guard (§4.0) is the runtime backstop.

---

## 3. The LITFIN AMPLIFICATIONS (port into the Borjie/BN Face — named, file-level)

These are the gold from `litfin-harvest.md §6`, ported into the shared spine
(`packages/chat-ui`, the SSE taxonomy, the persona DNA) so **both repos inherit**. Each is
named with its donor file and its Face target.

### 3.1 Teaching / stepper pedagogy → the teaching surface

- **A1 · Level-first scaffolding** (`public-chat.hono.ts:640-654`, `level_select`
  `ui_block`) — assess NEW/INTERMEDIATE/ADVANCED before teaching; per-level word-budget +
  depth knob keyed off durable `<owner_context>`. *Port verbatim into every persona prompt
  (Borjie + BN), reuse the `level_select` allowlist entry (`brain-teach.hono.ts:344-356`).*
- **A2 · 5-step literacy ladder + next/deeper/wider** (`public-chat.hono.ts:656-666`,
  `StepperBar.tsx:54-100`) — a visible journey map (left rail) with one step taught at a
  time; the `next/deeper/wider` action triad is a documented surpass of LitFin's
  deeper/wider. *BN swaps the 5 domain rungs (ORIENT→LISTING→TENANCY→MAINTENANCE→PORTFOLIO
  or similar); the rail component is domain-agnostic.*
- **A3 · Check-in cadence (Socratic, never dump)** (`public-chat.hono.ts:685-693`) — ONE
  concept per message + a *varied* confirm phrasing; "inventing fresh categories mid-thread
  is a hard failure." *Amplify by tying the confirm phrasing to the live
  frustration/comprehension axes (A8).*
- **A4 · Show-don't-tell visual loop + curriculum recipes**
  (`public-chat.hono.ts:1087-1102`, `BORJIE_BLACKBOARD_CURRICULUM.md`) — brief prose →
  render 1-3 board elements → check in → ADD to extend → end with a takeaway. The
  per-topic recipe book (ROYALTY = formula+chart; CUSTODY = pit→…→buyer flow + hash-chain
  arrows; …). *BN authors its own recipe corpus; the loop + the recipe-book mechanism port
  unchanged.*
- **A5 · Bloom depth tagging + mode-detector** (`chat-modes/types.ts:25-31`,
  `mode-detector.ts`) — the zero-LLM pedagogical state machine (warm-up window /
  tool-call-priority / indicator-bank thresholds / sticky-default) + colored Bloom badge.
  *Already package-level (`packages/chat-ui/src/chat-modes`); mount on BN's teaching
  surface via `use-chat-mode.ts`.*
- **A6 · Quiz lockdown + spaced-review summary** (`QuizLockdownOverlay.tsx`,
  `ReviewModeSummary.tsx`) — timed assessment + end-of-block mastery card with a
  **recommended review date** (the spaced-repetition seam). *Amplify the scheduling logic
  (it renders the date but does not yet schedule).*
- **A7 · Mastery dial + gate** (`StepperBar.tsx:160-213`, `useMyMastery()`) — SVG rings +
  prerequisite locks. *Wire the live mastery scores (the UI is built; the scoring source is
  the amplify target).*

### 3.2 Acting-human → the persona/pacing layer

- **A8 · Live Theory-of-Mind affective read → pacing** (`brain-teach.hono.ts:520-575`,
  `affective_profile` SSE) — per-(tenant,user) five-axis profile
  (frustration/comprehension/anxiety/trust/urgency) streamed *before* text, feeding both
  `<ProactiveHint>` and an `OWNER_STATE` prompt directive. *Tie the A3 check-in phrasing +
  the stream-pacing (A10) to these axes.*
- **A9 · MD persona "takes the wheel," partner-not-student + anti-robotic discipline**
  (`public-chat.hono.ts:615-638`, `:677-683`) — process-owner mandate (act first, teach in
  the slipstream); no em-dashes / no markdown body / banned-buzzword list / temp 0.85 so
  the opener never repeats. *This is the reusable "person voice"; bind it to the single
  canonical Mwikila DNA (the voice≠text break in `THE_CHAT_SURFACE_ARCHITECTURE.md §4.3`).
  BN binds its own canonical character to the same discipline.*
- **A10 · Streaming person micro-feel** (`brain-teach.hono.ts:931-964`,
  `LITFIN_STEPPER_LEARNING_SPEC.md:193-235`) — adaptive paced token delivery + typing-dots
  / streaming cursor / spring bubble entry / staggered quick-replies. *Amplify by
  deliberately slowing on hard concepts (driven by A8 comprehension axis).*
- **A11 · Conversational memory / no-re-ask** (`public-chat.hono.ts:668-676`, `:762-764`) —
  label-stability across turns; data-capture cards thread as hidden next-turn input.
  *Reinforced by surfacing persistent advisor memory (`brain-teach.hono.ts:531-540`).*

### 3.3 Blackboard-display → the Face board

- **A12 · The smartboard reducer + id-dedupe idempotent append**
  (`use-blackboard-store.ts:18-83`) — pure reducer + module-singleton pub/sub
  (survives the chat↔board unmount boundary) + in-place id-dedupe. *Preserve the exact
  reducer shape when porting onto the CRDT slot bus; it is the at-least-once-safe contract.*
- **A13 · 9-primitive relational visual grammar** (`types.ts`, `board-element-renderer.tsx`
  exhaustive-`never` switch) — `highlight`/`arrow` reference prior element ids so the board
  is a **comprehension graph**, not a flat list; "chalk-on-board" type-on + per-element
  stagger animations (`FormulaElement.tsx`, `DiagramElement.tsx`). *This IS the §2.2
  artifact-union visual half; BN inherits the renderers wholesale (domain-agnostic).*
- **A14 · Replay-in-time + PDF handout** (`Blackboard.tsx:80-109,97-104`) — the headline
  "history of thought" experience (§2.3).
- **A15 · Provenance envelope** (`types.ts:223-232`, `messageId` link) — amplify by
  surfacing the jump-to-turn link in the board UI (the `THE_CHAT_SURFACE_ARCHITECTURE.md §5`
  bidirectional-provenance leap).

---

## 4. The IP-LEAK FIX LIST (every leak + fix, prioritized)

### 4.0 The structural fix first — the central IP-egress guard (INV-H/D ABSOLUTE)

`MASTER_GAP_REGISTER.md:615-621` mandates **one** chokepoint: a central output firewall
every chat response passes through as the FINAL step before any client, fail-closed (redact
when uncertain) — like the agent-security-guard but for egress. This is the by-construction
backstop; the per-leak fixes below are defense-in-depth on top. **Build the guard first**,
then close each leak so no unaudited path can leak by omission.

### 4.1 Prioritized leak → fix table (from `ip-leak-audit.md`)

| # | Leak (file:line) | Sev | Fix (suppress / redact / deflect) |
|---|---|---|---|
| **L1** | `debate_metadata` SSE leaks model names + scores + judge reasoning (`brain-teach.hono.ts:895-918`); rendered as a model-brand tooltip (`HomeChatTeach.tsx:1151-1155`, `teach-sse-normalisers.ts:88-100`) | **CRITICAL** | **Suppress + reshape.** Replace with a **trust-only** frame `{ verified: boolean, contenders: number }`. Drop `winner`/`trace`/`scores`/per-response entirely. Remove `winnerProvider`/`winnerModel` from `DebateBadge`; delete the tooltip `title`. Prefer "independently verified" over "N-model". |
| **L2** | `tool_call`/`handoff` SSE + `toolCalls`/`handoffs`/`advisorConsulted` JSON leak junior+tool names + the handoff graph (`brain.hono.ts:317-325,1436-1438,1553-1568`); rendered in `ToolCallSidebar.tsx:91-93` ("What the brain ran") + `AskBubble.tsx:42-53` | **HIGH** | **Suppress at boundary + delete renderers.** Collapse `tool_call`/`handoff` into one generic `status` frame `{ phase: 'working' }`. Strip `toolCalls`/`handoffs`/`advisorConsulted` from JSON. Neutralise `ToolCallSidebar`/`AskBubble` to a status-only model. If a "what did the brain do" view is wanted, gate to **admin-web only**. (Latent: orchestrator returns empty arrays today but the contract still ships the fields.) |
| **L3** | `done`/`error` frames leak winning provider + the attempts ladder to the **public** visitor (`public-chat.hono.ts:2098-2109,1998-2007`; `brain-teach.hono.ts:839-852`) | **HIGH** | **Redact.** Strip `provider`/`model`/`depth`/`attempts[]` from every client `done`/`error` frame. Keep `{ at, latencyMs, retryable }` only. Provider/attempt detail → pino log only (already logged). |
| **L4** | Kernel CoT `thoughtText` readable by `TENANT_ADMIN` (`cot-query.router.ts:96-100,236-344`) — an owner-side role reaching scrubbed CoT + `stakes`/`promptHash`/`responseHash` | **HIGH** | **Restrict audience.** Drop `TENANT_ADMIN` from the CoT-read roles; restrict to Borjie-internal `SUPER_ADMIN`/`ADMIN`. A tenant DSAR gets a redacted **existence + category** view (counts/categories/timestamps), never the `thoughtText` body. Keep the audit emission. |
| **L5** | Error/503 messages name provider + env-vars + internal function names (`brain-vision.hono.ts:388-390,411,496-503`; `brain.hono.ts:489`) | **MEDIUM** | **Deflect via generic copy.** Vendor-neutral client message ("Photo analysis is temporarily unavailable…") + stable `code` (`VISION_UNAVAILABLE`). Route through the existing `utils/safe-error.ts` (`scrubMessage`/`safeInternalError`) instead of hand-rolled 503s; provider/env/function detail → pino log only. |
| **L6** | `finalPersonaId` + `advisorConsulted` leak persona-routing (`brain.hono.ts:1434,1438,1467,1470,344-353,1593-1603`) | **MEDIUM** | **Redact.** Drop both from client envelopes. Send one fixed public identity (`"Mr. Mwikila"` / BN's face) decoupled from the internal persona id; never the routing result. |
| **L7** | "Degraded mode" pill + `consecutiveFailures` hints a fallible LLM ladder (`brain-teach.hono.ts:544-551`, `HomeChatTeach.tsx:1167-1175`) | **LOW** | **Soften copy, drop count.** Outcome-shaped pill ("Some answers may be delayed — working on it."); remove `consecutiveFailures` from the client payload (keep in logs). |
| **L8** | `proposed_action.description` may carry internal verb/object; `executionHeld`/`reviewRequired` (`brain.hono.ts:326-339,1578-1591`) | **LOW** | **Validate, don't remove.** Ensure the description is domain language ("file royalty draft"), not an opcode (`ledger.post`). `executionHeld`/`reviewRequired` are output-level governance status — keep. |

**Two structural roots** (`ip-leak-audit.md` roll-up): (a) the gateway treats internal
mechanics as first-class client telemetry (L1/L2/L3/L6) — fixed once by the **status-only
frame contract** (three families: `status` / `output` / `evidence`, typed union so an
internal field cannot be added by accident); (b) operator diagnostics leak onto client
error envelopes (L5) — fixed once by routing through `safe-error.ts`. The persona prompts
are **not** the problem (CSA-2 `public-chat.hono.ts:288-323` is excellent); the envelope
around them is.

**Verified NON-LEAKS** (do not "fix" by mistake): vision `reasoning` (output-level about
the ore, not cognition); the `auditor` SSE frame (evidence/trust metadata); citations /
`evidence_ids`; the `decision-log.hono.ts` trace (SUPER_ADMIN/ADMIN-only = admin-web,
permitted). **One stale-domain bug** to fix while here: `prompt-shield.ts:331` still says
"here to help with **property management**" (a BossNyumba leftover in the Borjie repo) —
not an IP leak but a cross-domain identity bug.

### 4.2 BossNyumba note

BN shares the same brain + SSE taxonomy
(`THE_CHAT_SURFACE_ARCHITECTURE.md §8`), so **every L1-L8 leak exists identically on the BN
surface**, and the single central egress guard + status-only frame contract closes them on
both repos at once. Fix in the shared spine; any BN-side divergence re-introduces the leak.

---

## 5. How this folds into the Face / blackboard-spine build wave

This dossier slots into the `THE_CHAT_SURFACE_ARCHITECTURE.md §9` roadmap as the
**render-decision + IP-egress + thought-trend** thread, dependency-ordered:

- **Wave 0 (coherence)** — install the **central IP-egress guard** + the **status-only
  frame contract** (the typed `status`/`output`/`evidence` union). Close L1-L8 + the
  `prompt-shield.ts:331` stale string. *This is the gate; nothing else ships until the
  envelope is clean.* Consolidate owner-web's bespoke board onto the shared
  `packages/chat-ui` primitives so BN inherits.
- **Wave 1 (visible-work, re-scoped to STATUS-only)** — per INV-H/D (`:565-579`) the "tool
  rail / reasoning fold" leaps in `THE_CHAT_SURFACE_ARCHITECTURE.md §2` are **re-scoped to
  polished STATUS + outputs + evidence** (no `tool_call`/`reasoning` client frames). Build
  the named **Render-Decision arbiter** here as the server chokepoint extending the
  `brain-teach.hono.ts:854-877` ordered-strip pipeline (tier assignment + cap + dedupe).
- **Wave (blackboard-spine, = `amp-blackboard-audit.md` EA-05 fix)** — wire the BLACKBOARD
  tier to the **CRDT slot bus**: add a `blackboardSlots` Drizzle table + migration + SQL
  `SlotsRepository`; a `blackboard.hono.ts` route; a `SlotStore` broadcaster on the
  `state-bus` topic; a `use-slot` subscriber replacing/augmenting the local reducer in
  owner-web + both mobiles. Enforce the **typed artifact-union write-contract** (§2.2) so
  the trend is compile-time output-level. Preserve the id-dedupe append (A12).
- **Pedagogy + persona waves** — land the LITFIN amplifications A1-A15 (§3) into the shared
  spine + the single canonical Mwikila/BN DNA source-of-truth.
- **Replay + provenance** — surface Replay-in-time + PDF handout + jump-to-turn as the
  signature owner moment.

**Discipline:** every fix lands in the **shared spine** (`packages/chat-ui`, the SSE
taxonomy, the genui catalog, the egress guard, the persona DNA) so **both Borjie and
BossNyumba inherit** the render-decision engine, the IP-egress guard, and the
output-level thought-trend simultaneously.

---

## 6. Net

The render-decision logic and the persistable visual grammar **already exist** at SOTA
quality (LitFin-harvested, two-place-implemented). The frontier work is three named moves,
all on existing seams: **(1)** a typed **Render-Decision arbiter** (five output-level
signals → three persistence tiers) at the server chokepoint; **(2)** a **typed
artifact-union write-contract** on the **CRDT slot bus** so the thought-trend is a durable,
de-duped, time-ordered, reviewable, **compile-time-output-level** work-history (not the
cognition behind it, and not an ephemeral local reducer); **(3)** a **central IP-egress
guard + status-only frame contract** that closes every L1-L8 leak by construction. Land all
three in the shared spine and both estates inherit a Face that teaches like LitFin, persists
a clear trend of thought, and never leaks the moat.

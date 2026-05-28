# CHAT-FIRST UNIVERSAL PARITY — SOTA RESEARCH (2026-05-28)

**Audience:** Borjie product, engineering, design.
**Scope:** every surface of Borjie should be chat-first. Tabs and pages
are visual escape hatches. The same Mr. Mwikila DNA carries across
marketing, owner-web, admin-web, workforce-mobile, buyer-mobile, with
surface-specific role variants.

**Method:** consolidated reading + cross-checking of public docs, app
inspection, and 2024-2026 product reviews of every major chat-first AI
product. Each entry lists 3-5 patterns we should adopt and 1-2 we should
explicitly avoid. The document closes with a 12-principle Borjie
Chat-First Manifesto mapped to mining-estate domain.

---

## 1. Linear AI Assistant

Linear's AI assistant lives inside the issue tracker. It is invoked
from a global keyboard chord, can read the entire workspace, and emits
structured edits (create issue, link issue, transition status, attach
comment) inline. The composer accepts text + file attachment + voice on
desktop. Slash commands let power users skip free-form prompting.

### Adopt

1. Single global invocation chord (Cmd+K on web, long-press on mobile)
   that opens the chat overlay over any tab without losing context.
2. Inline structured edits — the assistant proposes, the user confirms
   with one click; the change writes audit + threads itself into the
   relevant entity timeline.
3. Slash command catalog drawn from the brain tool list, surfaced as
   typeahead the moment the user types `/`.
4. Context-carry: when invoked from inside a parcel page, the chat
   preloads "you're currently looking at parcel #PARCEL-241".
5. Persistent thread per surface — closing the overlay does not lose
   the conversation.

### Avoid

1. Pretending the assistant is omniscient: Linear sometimes hallucinates
   issue IDs. Borjie must always cite an evidence id; the Auditor Agent
   rejects responses with empty evidence chains (CLAUDE.md hard rule).

---

## 2. Lovable / Bolt.new / v0

These code-first products treat chat as the primary IDE interaction.
The user types a feature request; the assistant generates the file
tree, mounts it in a preview, and offers diff-style edits. Voice input
exists. File-drag-into-chat-bubble is the primary attachment vector.

### Adopt

1. Outputs are reified as artefacts (in Lovable / Bolt, a live preview).
   Borjie equivalent: every chat reply that proposes a draft document
   immediately renders a preview pane (the existing inline_wizard,
   inline_workflow, inline_table catalog already supports this).
2. Drag-and-drop file ingestion (PDF, photo, voice memo) into the chat
   composer with automatic OCR / transcription / chunking + corpus
   citation. Mining owners regularly receive scanned letters and faxed
   permits — Borjie should ingest these inline.
3. Versioned conversation threads: any thread can fork from any turn,
   so the user can explore alternatives without losing the canonical
   line. Borjie reuses this for "what-if" royalty scenarios.
4. Visible undo for every state-change action. Lovable shows a small
   "Revert" chip on every generated file. Borjie's confirmation_card
   primary/secondary action already mirrors this.

### Avoid

1. Replacing every page with chat. Bolt forces the user into prompt-
   driven UX even for trivial reads. Borjie keeps tabs as visual escape
   hatches for slow, deep scanning of lists, calendars, dashboards.

---

## 3. Cursor / Windsurf

Cursor's chat is agentic: it can call tools, read files, propose
multi-file diffs, and iterate. `@`-references let the user pin
specific files, folders, symbols, docs, or web pages into the prompt
context. The composer keeps multi-cursor selections in context. Voice
input is supported in 2025+.

### Adopt

1. `@`-reference autocomplete in the composer. Typing `@` opens a menu
   of entities relevant to the current surface — for Borjie this is
   recent scopes, licences, parcels, sites, counterparties, documents.
   On select, the brain receives the entity ID + display name as
   inline context.
2. Multi-tool reasoning loop. Cursor's chat plans, calls tools,
   summarises, and may call more tools. Borjie's brain orchestrator
   already exposes this loop via streamTurn; the FE just needs to
   render each tool call as a discrete card so the user trusts the
   trace.
3. Diff-style edits for any document the assistant proposes. Borjie's
   document_studio already renders Word-style diffs; the chat should
   surface a "Show changes" chip on every draft turn.
4. Multi-cursor / multi-tab context carry. Borjie's brain already
   tracks active tabs in the owner cockpit; that list should be in
   every system prompt so the assistant can reason "you have
   compliance Geita open, you also asked about Mererani — that's the
   site you mean?"
5. Inline error / refusal explanation. Cursor explains why a tool call
   failed in plain language. Borjie's persona-tool-gate already emits
   denial strings; surface them in the chat bubble, not in a hidden
   console.

### Avoid

1. The agentic loop running unbounded. Cursor's "Compose" mode can
   burn dozens of tool calls. Borjie's max_action_tier ceiling + the
   four-eye / sovereign / kill_switch policy gates already block this.

---

## 4. Replit Agent

Replit Agent takes a project goal, scaffolds a full-stack app,
deploys it. Chat is the primary interaction. The agent narrates its
progress in checklist form, with live status pills (planning, coding,
testing, deploying).

### Adopt

1. Live progress checklist for any multi-step junior. The owner asks
   "draft a TRA royalty filing for April" and the chat renders an
   inline_workflow with `pull data` → `compute` → `format` → `sign` →
   `submit` steps; each step's status pill flips live as the brain
   executes. Borjie already has inline_workflow; wire it to the
   junior progress stream.
2. Single "what's running" surface. Replit's agent panel shows every
   active background job. Borjie equivalent: the existing admin
   control-tower surfaces every running junior — replicate the same
   feel for owners on their cockpit ("3 things running in the
   background, click to peek").
3. Long-horizon goal tracking. Replit remembers "build me a Stripe
   integration" across sessions. Borjie's owner can say "build me a
   month-end close routine" and the brain tracks the goal across
   logins.

### Avoid

1. Showing every internal step. Replit can be noisy; reveal only the
   user-meaningful checkpoints, hide internal LLM scratchpads. Borjie
   already does this via the explained vs internal trace separation.

---

## 5. Notion AI

Notion AI lives inside every document. The user can `/ai` anywhere to
spawn an in-place rewrite, summary, brainstorm, table generation,
translation. The composer is the page itself — there is no separate
chat overlay.

### Adopt

1. `/ai` (or in Borjie's case, `/`) as an in-place invocation from any
   text input across all surfaces. The user does not need to find the
   chat overlay — they type `/draft TRA letter` directly in the docs
   tab's notes field and the assistant takes over.
2. AI-generated blocks. Notion's table/chart blocks are first-class
   editable artefacts. Borjie's inline_table / inline_chart / inline_
   workflow are already this; promote them to the docs tab as
   embeddable cards.
3. Translation as a default. Every owner sees their language;
   Borjie's bilingual sw/en is already mandatory. Notion's pattern of
   surfacing translation alongside the original (toggle) maps to
   Borjie's "tap to flip to Swahili" affordance.

### Avoid

1. The empty-state-as-prompt-engineering UX. Notion's blank-page is
   intimidating. Borjie's chat-first surfaces always greet first, ask
   one clarifying question second, then offer suggestion chips.

---

## 6. Arc Search / Perplexity

Arc Search and Perplexity reframe the browser as chat: the user types
a query; the system summarises web results inline with citations. The
search bar is the chat. Voice is first-class on mobile.

### Adopt

1. Citation chips inline with the answer. Every claim is footnoted
   with a clickable source. Borjie already enforces evidence_id
   citations; the FE should render each as a chip the user can
   peek-on-hover or tap-to-open.
2. Multi-modal answers. Perplexity returns text + image + table + map
   when relevant. Borjie's inline catalog already covers this; the
   brain should pick the best block by question shape, not default
   to prose.
3. "Ask follow-up" persistent chips. Every answer ends with three
   suggested next questions — the existing Borjie `<actions>` chip
   array already implements this.
4. Voice-first on mobile. Arc Search's mobile UX starts with a hold-
   to-record button. Borjie's mobile chat should do the same: the
   composer's mic button should be at least as prominent as the send
   button on small screens.

### Avoid

1. Source-stuffing. Perplexity sometimes cites 12 sources for a one-
   sentence answer. Borjie should cite the smallest set of evidence
   ids needed.

---

## 7. ChatGPT Advanced Voice

OpenAI's Advanced Voice mode delivers near-natural turn-taking,
interruption handling, persona, and prosody (laughter, sighs, accents).
The model can sing, whisper, and emote.

### Adopt

1. Persona prosody. Mr. Mwikila should sound like a senior Tanzanian
   mining COO — warm, measured, occasionally dry. The existing
   persona DNA prompt covers tone; the voice synth backend (`packages/
   persona-voice`) should be tuned to match.
2. Natural turn-taking. Voice replies should be interruptible mid-
   sentence; the moment the user starts speaking, the assistant
   pauses and listens. The existing `voice-agent` service should
   support VAD-based barge-in.
3. Language switching mid-utterance. The owner may say "explain in
   English but use mrabaha for royalty"; the assistant should oblige
   without re-prompting.

### Avoid

1. Over-emoting. Borjie is a professional surface; avoid laughter
   tracks or theatrical asides. The persona DNA already forbids this
   on compliance / fatality / regulator topics.

---

## 8. Anthropic Computer Use / OpenAI Operator

These agentic products let the assistant act on the user's behalf:
click, type, scroll, fill forms. The user delegates a goal; the agent
executes step-by-step with visible cursor moves.

### Adopt

1. Visible action trace. Every step the agent takes (click, type,
   submit) is rendered as a card in the chat with a screenshot
   thumbnail. Borjie's confirmation_card pattern already implements
   the "I am about to do X, confirm?" feel; extend it to a running
   "I did A then B then C" trace.
2. Owner-in-control. The user can pause / resume / revoke at any
   moment. Borjie's max_action_tier + kill-switch + four-eye rules
   already model this; the chat surface should expose a single
   "Pause" affordance on every long-running junior.
3. Fail-loud. When a step fails, the assistant explains what it
   tried and what blocked it, in the user's language.

### Avoid

1. Silent failure. Computer Use sometimes gives up without telling
   the user. Borjie's Auditor Agent should never let a turn close
   without surfacing the failure to the user.
2. Action without consent for HIGH-risk steps. The CLAUDE.md hard
   rules forbid auto-execution of money moves, regulator filings,
   contract signatures — never relax this for the sake of speed.

---

## 9. Slack / Teams AI

Slack's AI surfaces conversation summaries, threads recap, and
"catch me up". Microsoft Teams Copilot drafts messages, summarises
calls, builds agendas. Both are chat-inside-chat — the AI is a
participant in the existing channel.

### Adopt

1. Chat-in-workflow. Borjie equivalent: any junior that drafts a
   document offers a "share to my workforce" chip that drops the
   draft into the workforce-mobile conversation tab. The owner does
   not switch surfaces.
2. Daily recap. Slack's "catch me up" is the equivalent of Borjie's
   daily brief; the brain should default to a brief on every owner's
   first chat turn of the day.
3. Smart suggestions. Teams suggests reply chips based on recent
   conversation. Borjie's chat already does this; add a suggestion
   to "spawn a tab for this" when the conversation crosses into
   actionable territory.

### Avoid

1. Surveillance feel. Slack AI summarises private channels by
   default in some plans, creating distrust. Borjie's RLS guarantees
   admin chat cannot see owner private content without authorised
   four-eye approval.

---

## 10. GitHub Copilot Chat

Copilot Chat is context-aware inline assistance: it knows the current
file, cursor, selection, repo, and surfaces suggestions in the gutter,
the side panel, or inline as ghost text.

### Adopt

1. Ghost text suggestions in the composer. As the owner types, the
   composer should suggest the most likely next phrase from history
   ("draft the April royalty for…" auto-completes to "…the Geita
   PML"). This reduces typing friction on mobile.
2. Selection-driven actions. Highlight a paragraph in the docs tab
   and a small chip appears: "Ask Borjie to summarise / translate /
   compare to LBMA".
3. Multi-file diff awareness. Copilot can reason across many files
   at once. Borjie's brain already does this via tool calls; the
   chat should surface "I read A, B, C" as visible citations when
   the answer required multi-source reasoning.

### Avoid

1. Suggestions for the sake of suggestions. Copilot's ghost text is
   noisy in unfamiliar code; the assistant should be silent when it
   has no confident continuation.

---

## 11. Cross-cutting patterns we adopt across all 10 products

- **Streaming first.** Every response streams (SSE). No blank-screen
  waits.
- **Inline cards over redirects.** When the answer is a table, render
  the table; do not link out.
- **One persona, many roles.** A single character (Mr. Mwikila) with
  surface-specific roles (Sales MD, Teaching MD, Operations Director,
  Platform Director, Marketplace Director). This is the core insight
  of Notion AI and Anthropic's Claude personas combined.
- **Voice in, voice out.** Mobile-first interaction is voice-driven.
  Web supports voice but defaults to text.
- **Citation chips on every claim.** Trust comes from showing the
  source.
- **Always offer a tab as escape hatch.** Even the most chat-pure
  users sometimes want the full visual layout.

## 12. Patterns we explicitly reject

- **Unbounded agentic loops.** Borjie's policy gate blocks these.
- **Empty-state-as-prompt-engineering.** Greet, ask, offer suggestions.
- **Hidden source citations.** Every claim shows its evidence.
- **Forcing chat where a tab serves better.** Tabs remain available.
- **Tone mismatch.** Mr. Mwikila is warm, measured; never theatrical.
- **Auto-execution of HIGH-risk actions.** Owner-in-control always.

---

# BORJIE CHAT-FIRST MANIFESTO — 12 PRINCIPLES

The synthesis of the research above, mapped to Borjie's mining-estate
domain.

### Principle 1 — Chat is the primary surface

Every surface (marketing, owner-web, admin-web, workforce-mobile,
buyer-mobile) treats chat as the primary interaction. Tabs and pages
are the visual escape hatch the user reaches when they want to scan,
scroll, or compare side-by-side. A first-time visitor lands on the
marketing chat. A signed-in owner lands on the home chat. A workforce
supervisor opens the app and is talking to Mr. Mwikila within one
tap. A buyer opens the app and Mr. Mwikila greets them with the
day's hot parcels.

### Principle 2 — Same Mr. Mwikila DNA, role variant per surface

The persona DNA prompt (warmth, pacing, humor, refusal templates) is
identical across every surface; only the role variant changes:

- Marketing chat: **AI Mining Managing Director** (visitor-facing
  sales advisor — diagnose first, sell second).
- Owner cockpit: **AI Mining Managing Director** (family-office chief
  of staff — teach, execute, summarise).
- Admin console: **AI Platform Director** (Borjie HQ fleet of tenants
  — cross-tenant rollups, audit queries, system health, kill-switch
  proposals, four-eye initiation).
- Workforce mobile: **AI Operations Director** (role-aware: supervisor
  / pit operator / geologist / treasury / safety officer / compliance
  clerk).
- Buyer mobile: **AI Marketplace Director** (buyer-facing parcel
  discovery, bid management, deal pipeline, custody verification).

### Principle 3 — Multi-modal input

Every chat composer accepts text + voice + file + image, with sensible
defaults per surface:

- Web: text first, voice on click of mic chip.
- Mobile: voice first (large mic button), text always available.
- File/image attachment drag-and-drop on web; tap-to-capture on
  mobile. Photos are routed to the photo advisor (already shipped for
  workforce-mobile).

### Principle 4 — Multi-modal output

The brain picks the smallest block that fits the answer. Single
number → mini_metric. Trend → inline_chart. Multi-step → inline_
wizard. Comparison → inline_comparison. Status overview → inline_
dashboard. Document → render the draft + Show changes chip. Audio
reply when the surface is voice-driven. Image + audio simultaneous on
voice mode (Mr. Mwikila narrates while a chart renders).

### Principle 5 — Context-carry

The chat always knows what tab the user has focused, what scope is
active (pit / site / region / parcel), what documents are recent,
what the daily brief said. The owner does not need to repeat "for the
Geita PML" if Geita is the focused tab. The buyer does not need to
re-state the parcel they were just looking at.

### Principle 6 — Proactive

The brain surfaces relevant signals unasked. On the owner's first
turn of the day: "Three things changed overnight, want the brief?"
On a buyer's first turn: "Two new dore-bar parcels from Geita
matched your watchlist." On a supervisor's first turn: "Your A-shift
crew is one short — fuel log says vehicle TZ-4571 needs service."
The user retains "no" as a one-tap response; the brain learns and
adjusts cadence per principle 12.

### Principle 7 — Cross-surface continuity

A conversation started on owner-web can be picked up on workforce-
mobile (when the role permits). Conversation IDs are tenant-scoped
and persisted across surfaces. The owner walks from the office to
the pit and continues their chat in their pocket.

### Principle 8 — Slash commands for power users

Typing `/` opens a typeahead menu of brain catalog tools the current
persona can call. Examples:

- `/find parcel 7.2kg Geita`
- `/draft TRA royalty letter April`
- `/spawn compliance Geita`
- `/show my crew today`
- `/bid 18m TZS on parcel-241`
- `/kill-switch propose data-incident`

The slash menu is filtered by persona slug. Workforce supervisors see
worker-tools; buyers see marketplace tools; admins see fleet tools.

### Principle 9 — `@`-references for entities

Typing `@` opens a typeahead menu of recent entities relevant to the
current surface: scopes, licences, parcels, sites, counterparties,
documents. On select, the brain receives the entity ID + display
name as inline context — the next turn is grounded.

- `@geita` → focused on Geita site.
- `@pml-0241` → focused on a specific licence.
- `@catering-co` → focused on the camp catering counterparty.
- `@april-royalty-draft` → references the document already drafted.

### Principle 10 — History scrubbing

Long conversations are threadable, searchable, exportable. Every
thread has a title (auto-generated by the brain), a date, a
participant set. The user can search "find my royalty conversations
from April" and the brain returns the matching threads with timeline
preview. Export is a one-tap PDF or markdown handout.

### Principle 11 — Inline-first responses, tab is escape hatch

The brain's default is to render the answer inline, in the bubble.
A full tab is spawned only on explicit user intent ("open the full
compliance tab") or when the data exceeds a sensible inline bound
(>20 rows in a table, >10 metrics in a dashboard). Every rich inline
block carries a tab_promotion_chip the user can tap to scale up.

### Principle 12 — Owner always in control

The brain never executes HIGH-risk actions without explicit
confirmation. Money moves, regulator filings, contract signatures,
employment changes, kill-switch flips, sovereign tier actions all
require a confirmation_card with autoAuthorized:false. The four-eye
policy applies where the policy literal requires it. The owner can
pause/revoke any running junior. The Auditor Agent enforces this on
every turn; persona drift triggers an automatic refusal.

---

## Closing — what this means for the next 30 days

The audit document (`Docs/AUDIT/CHAT_FIRST_PARITY_AUDIT.md`) catalogs
each surface's gap against this manifesto. The wiring in this branch
closes the biggest gaps:

- Admin chat already shipped (HomeChat + 6 admin tools).
- Buyer marketplace tools expanded with `marketplace.chain_of_custody`,
  `marketplace.accept_offer`, `marketplace.market_intel` so the buyer
  chat can answer the full lifecycle inline.
- Workforce role-aware tools added (`workforce.my_crew`,
  `workforce.log_drill_hole`, `workforce.log_fuel`,
  `workforce.shift_attendance`).
- Slash command + `@`-reference catalog wired in chat-ui composer
  primitives so all surfaces share the implementation.

The remaining gaps (buyer-mobile AI chat surface, workforce LLM
hookup, full cross-surface continuity threading) are tracked in the
audit doc.

---

*Document length: this file is intentionally long. The 12 product
deep-dives above + the 12 manifesto principles + cross-cutting
patterns deliver a complete map. The audit doc is the actionable
sibling.*

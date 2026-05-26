# Tacit Knowledge Harvest — Wave HARVEST Specification

> Mining-domain harvest engine. Five interview modes, each tuned to a
> moment, a role, and a cognitive cost budget. Companion to
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md)
> (the lifecycle-event harvest regime — onboarding/departure/curious/
> spotlight). This spec defines the **session-shaped** harvest — five
> live, context-rich interview modes (walk-the-floor, post-incident,
> ride-along, deal-replay, cross-role) that put Mr. Mwikila in the
> same room, truck, or replay as the person whose know-how he needs.
>
> Persona: **Mr. Mwikila** (Borjie's autonomous Managing Director,
> here cast as a *conversational anthropologist*). Brand: Borjie.
> Wave: HARVEST. Migration: `0044_tacit_knowledge.sql`. Package:
> `@borjie/tacit-knowledge`.

---

## 1. Why Tacit Knowledge Matters in Mining

The mine never runs on the manuals. It runs on what the foreman knows
about how the new compressor sounds when its bearings are going. It
runs on the geologist's intuition about whether *this* vein continues
past the fault, learned from forty cores. It runs on the driver's map
of which border officer at Tunduma waves them through if approached
before 11am, and which one will pull every truck on principle. It
runs on the trader's read of a buyer's body language during a
negotiation. None of it is written down. Most of it cannot be — the
people who hold it could not articulate it on demand even if asked.

Squirro's 2026 enterprise-AI survey, cited widely in the literature
([squirro.com — Corporate Amnesia](https://squirro.com/squirro-blog/ai-tacit-knowledge-capture),
2026-03-04), puts the figure plainly: **roughly 80% of business
value sits in tacit knowledge** — the intuition, context, unwritten
rules, customer relationships, failure stories, and trade craft that
make work actually work. In Tanzanian artisanal-to-mid-tier mining,
that fraction is higher, because the regulatory environment, the
informal-trading channels, and the road network all reward local
knowledge that does not survive a Google search.

Four examples that motivate this package:

1. **Route timing** — the Geita-to-Mwanza gold run is a four-hour
   trip on paper. In practice, leaving at 04:40 puts you through the
   Geita weighbridge before the day shift comes on; leaving at 05:15
   puts you behind the timber convoy and turns a four-hour trip into
   nine. The night driver knows this; the dispatch software does not.

2. **Regulator officer personalities** — the Tumemadini cadastre
   liaison who covers Shinyanga believes, deeply, that paperwork
   filed on a Tuesday morning is more credible than paperwork filed
   any other day. The liaison who covers Mara couldn't care less
   about which day, but will quietly accept additional photos of the
   pit if attached as a separate WhatsApp message rather than as a
   document attachment. The compliance officer at the mine head
   office knows these things. The compliance officer who replaces
   her in eighteen months will not, unless someone harvested it.

3. **Weather x road heuristics** — once the November rains start at
   Bulyanhulu, the eastern access road becomes unusable for a
   six-tonne flatbed but stays passable for a four-wheel-drive
   pickup for another two weeks. Knowing this means you can still
   move samples; not knowing it means a stuck truck and a $4,000
   tow.

4. **Buyer negotiation patterns** — a specific Dubai-based gold
   buyer always opens at 0.8% below the LBMA fix, will move to fix
   minus 0.4% if you mention a competing offer from Mumbai, and
   walks if you ask for fix-plus. The trader who learned this over
   fifteen calls cannot tell you why; he can only tell you that "it
   always goes that way with them". Mr. Mwikila needs to learn it
   too, because the trader is leaving in March.

These four examples motivate the four "non-departure" modes below.
Mode E (cross-role) addresses the fifth pattern: knowledge that
isn't articulable to Mr. Mwikila in the first person but emerges
when one person teaches another while the system listens.

---

## 2. The Five Modes

Each mode is a **session shape** — a question template, a pacing
budget, a place-and-time anchor, and a target know-how density.
Mode selection is not done by the subject; it is done by
Mr. Mwikila based on the situation. The subject is never told
"this is a post-incident interview" — they are told "let's walk
through what happened, no blame, no script".

### 2.1 Mode A — Walk-the-Floor

**Anchor:** the subject is *on shift, doing the work*. The session
runs voice-first through their handset, on speaker if hands-free is
unsafe, on earpiece otherwise. Sessions are 8–20 minutes, opportunistic.

**Cognitive cost:** **minimum**. Mr. Mwikila never asks more than
two questions in a row. He waits for the subject to finish what
they're doing. The pacing budget is ~30 seconds of subject
speech for every 5 seconds of Mr. Mwikila speech.

**Question template (excerpt):**

- *"What are you looking at right now?"* — surfaces what cues the
  subject is parsing in real time.
- *"What would tell you it's going wrong?"* — surfaces the failure
  signal before the failure.
- *"If I asked someone new to do this in your place, what would
  they get wrong on the first day?"* — surfaces the unwritten rule.
- *"Last time this happened, what did you do that you didn't have
  to be told to do?"* — surfaces the discretionary judgement.

**Mining example:** Mr. Mwikila joins the night shift compressor
walk-through. He doesn't ask "describe the compressor" — he asks
"what are you listening for right now?". The foreman replies "the
high whine when number three loads up — if it's there longer than
two seconds when the pressure crosses 6 bar, that's a bearing".
That sentence is a `rule` cell. It would never have appeared in a
compressor manual.

**Target density:** 6–12 know-how artifacts per session.

### 2.2 Mode B — Post-Incident

**Anchor:** within 24–72 hours of an incident (near-miss, breakdown,
regulator visit, deal lost, deal won). The subject has had time to
sleep on it; the memory is still rich. Sessions are 45–75 minutes,
sit-down, no calendar pressure.

**Cognitive cost:** moderate. Question pacing is slower than walk-
the-floor; Mr. Mwikila waits, leaves silence, never interrupts. The
explicit norm announced at session start: **blame-free**. No
person-blaming attributions are extracted from this mode; the
extractor filters for *system* and *judgement* cells, not
*responsibility* cells.

**Question template (excerpt):**

- *"Walk me through the last 30 minutes before it happened, in any
  order you remember."* — non-linear recall.
- *"What were you expecting to happen, and where did the reality
  diverge?"* — surfaces the operating model.
- *"What did you almost do but didn't?"* — surfaces decision points
  and counterfactuals.
- *"What would you tell yourself, three hours earlier?"* — surfaces
  the early-warning signal in hindsight.
- *"If this happens again, what's the one thing you'd want
  available that wasn't?"* — actionable mitigation, not blame.

**Mining example:** A compressor fails mid-shift. The day-shift
foreman is interviewed 36 hours later. He recalls: "I had felt
something off with number three on Tuesday but I didn't write it
up because the night shift had already gone through it and signed
off". That's two cells: (i) `pattern` — the night-shift sign-off
displaces the day-shift's instinct, and (ii) `failure` — discretionary
escalation has a missing channel.

**Target density:** 15–40 artifacts per session.

### 2.3 Mode C — Ride-Along

**Anchor:** in-vehicle, in motion. GPS is recording. The session is
the journey. The subject is the person whose route knowledge
Mr. Mwikila wants to harvest — typically a transport driver, a
mineral runner, a field surveyor with regulator stops, or the owner
on a buyer-visit circuit.

**Cognitive cost:** low to moderate. Mr. Mwikila joins via voice,
the subject narrates the route. Every Mr. Mwikila utterance is
GPS-tagged on capture; every artifact extracted is geo-stamped.

**Question template (excerpt):**

- *"Why did you choose this road over the [alternative]?"*
- *"What's the cue that tells you to leave now versus 30 minutes
  later?"* — surfaces timing heuristics.
- *"If you saw a [convoy / police vehicle / weighbridge queue]
  ahead, what would you change?"* — surfaces conditional routing.
- *"Who knows you on this stretch? What do they want from you?"* —
  surfaces relational + regulatory knowledge along the route.
- *"What time of year is this route different?"* — surfaces
  seasonal patterns.

**Mining example:** Mr. Mwikila joins the night driver from Geita
to Mwanza. The driver narrates: he is leaving at 04:40 because the
weighbridge clerks rotate at 06:00 and Stephen, who covers 04:00–06:00,
"doesn't read the manifest line by line". This is sensitive — the
extractor flags it for **owner-only scope** with the optional
`scope_id` = owner's user-id, not the broader tenant. The artifact
is captured but its scope is restricted; consent is implicit only
for capture, not for sharing.

**Target density:** 10–25 artifacts per session, geo-tagged.

### 2.4 Mode D — Deal-Replay

**Anchor:** within hours or days of a commercial conversation
(a buyer negotiation, a regulator phone call, a vendor pricing
discussion, a partner alignment meeting). The transcript or the
subject's memory of the transcript is the substrate; Mr. Mwikila
walks back through the conversation turn by turn.

**Cognitive cost:** moderate to high — this is the most cognitively
demanding mode because it asks for explicit reflection on
counterfactual choices.

**Question template (excerpt):**

- *"At minute 4, when [counterparty] said [X], what did you read
  in the way they said it?"* — surfaces paralinguistic cues.
- *"What would have happened if you'd named your price first?"* —
  surfaces negotiation heuristics.
- *"What was the moment you decided where the deal was going?"* —
  surfaces decisive cues.
- *"What did you not say that you could have? Why didn't you?"* —
  surfaces restraint judgement.
- *"If you were teaching me to take this call cold next week, what
  would you tell me to listen for?"* — surfaces transferable rules.

**Mining example:** The senior trader replays the call with the
Dubai buyer. At minute 14 the buyer paused for three seconds after
the trader said "Mumbai is asking about the same parcel". The
trader recalls: "that pause meant he was checking whether I had a
real Mumbai offer or was bluffing. If you don't have the bluff
ready, don't mention Mumbai — he'll call it." That's a `rule` cell
with a paralinguistic precondition.

**Target density:** 12–30 artifacts per session.

### 2.5 Mode E — Cross-Role Probe

**Anchor:** two subjects, one teaching the other. Mr. Mwikila is
the silent observer. The subjects know they are being observed; the
explicit task is "Person A, teach Person B how you would do this".

**Cognitive cost:** low for the teacher (they are doing what they
already do); moderate for Mr. Mwikila (he is the listener, not the
asker, and he must classify each utterance into the right tacit cell
kind without prompting).

**Question template (excerpt):** Mr. Mwikila does not ask questions
during the session — he only asks a small set at the end to clarify
artifacts.

- *"You said [X] to Person B — was that the most important point,
  or the most concrete one?"*
- *"What did Person B miss in their first attempt?"*
- *"What would Person B have to do for a week before they could do
  this without you?"*

**Mining example:** The retiring chief geologist walks the junior
geologist through reading a core sample from the eastern adit. The
chief says things he would never say to Mr. Mwikila directly — "see
how the quartz veining narrows here? In this district, that
*always* means the vein continues for another six metres before it
pinches." That's a `pattern` cell, district-specific. It only
surfaces because the chief is teaching, not being interrogated.

**Target density:** 8–20 artifacts per session, with high
confidence because two-person dialogue gives the extractor
implicit ground-truth checks.

---

## 3. The Consolidation Pipeline

Each interview produces a transcript. The pipeline transforms it
into memory cells in four stages:

```
transcript chunk
      │
      ▼
 entity extraction        (LLM port: chunk → Extraction[])
      │
      ▼
 redundancy check         (vector + lexical similarity vs existing cells)
      │
      ├──── redundant ──► reinforce existing cell (provenance appended)
      │
      ▼
 cell write               (cognitive-memory port: observe / reinforce)
      │
      ▼
 provenance attachment    (person + mode + at + place)
```

**Entity extraction** uses an LLM port (the package ships a
reference implementation; production wires the brain-llm-router).
The extractor returns `Extraction[]` with `entity_kind` mapped to
one of the eight `MemoryKind`s the cognitive-memory store accepts:
`pattern | fact | rule | preference | template | citation |
failure | terminology`. Each extraction carries a `confidence`
in [0,1] and a `novel` flag set by the extractor's confidence that
the extraction is new information (later corrected by the
redundancy checker).

**Redundancy check** runs two passes. (i) Vector similarity (cosine
against existing cell embeddings, threshold 0.86 by default — slightly
higher than the federation threshold of 0.92 because tacit cells
have more lexical drift than federated ones). (ii) Lexical
similarity (token Jaccard on canonicalised content, threshold 0.55).
Either pass marks `redundant_with_cell_id`. If both passes pass and
both fall below threshold the cell is `novel = true`.

**Cell write** is performed via a **port** — `CognitiveMemorySink`
— not by importing the cognitive-memory package directly. This
keeps `@borjie/tacit-knowledge` independent of the cognitive-memory
build and lets the host wire the production store.

**Provenance** on every cell written: `subject_user_id`, `mode`,
`interview_id`, `at` (ISO timestamp of utterance, not session), and
`place` (geo point if available; null otherwise). Provenance is
written into `content_structured` on the cognitive-memory cell.

---

## 4. Consent and Ownership

Tacit knowledge is **the subject's**, not the tenant's. The package
enforces this through a separate consent table that is checked
before every cell write.

**Consent grant.** When a subject is first interviewed, they record
a consent grant for the tenant. Grant is the default state; absence
of a row blocks writes. The grant is recorded with an audit hash.

**Consent revoke.** A subject can revoke consent at any time. Revoke
sets `status = 'revoked'` and `revoked_at`. Once revoked, *no
further writes* are accepted into cognitive-memory under that
subject's `subject_user_id`. The package does **not** retroactively
delete prior cells from cognitive-memory (that is the cognitive-
memory store's responsibility under its own retention discipline)
but it does mark prior tacit interviews as `revoked_post_capture`
and the interview-engine declines to surface them in cross-role
probes.

**Mid-session revoke.** If consent is revoked while a session is
running, the interview-engine catches the revoke before the next
extractor call and refuses to persist any further extractions from
that session. Already-persisted cells are left as-is (since they
were captured with valid consent at the moment of capture); the
interview transcript is sealed with `status = 'ended_revoked'`.

**Ownership transfer.** When a subject leaves the tenant, consent
defaults to the same status they last set. Tenants do not inherit
consent from departed users.

---

## 5. Persistence Layout (Migration 0044)

Three tables:

- **`tacit_interviews`** — one row per session. `subject_user_id`
  is the person being interviewed (never named "interviewee" in
  UI). `interviewer` defaults to `'mr-mwikila'`. `mode` is one of
  the five values. `transcript` is `jsonb` carrying the ordered
  turns. `location_geog` is a pgvector `geography(Point,4326)` for
  the session anchor (where the walk-the-floor happened, the
  vehicle origin for ride-along, etc.).

- **`tacit_extractions`** — one row per extracted artifact.
  Links to `interview_id`. Carries `entity_kind`, `entity`
  (jsonb payload), `confidence`, `novel` (extractor's claim),
  `redundant_with_cell_id` (filled by redundancy checker if not
  novel), `persisted_cell_id` (filled by cell-writer once the
  cell is written into cognitive-memory).

- **`tacit_consents`** — one row per (subject, tenant) pair.
  `PRIMARY KEY (subject_user_id, tenant_id)`. Default
  `status = 'granted'`. `revoked_at` is set on revoke. The audit
  hash chains.

Every table is RLS-bound on `tenant_id` using the canonical
`app.tenant_id` GUC pattern. Every mutation appends to the audit
hash chain. The migration is idempotent (`CREATE ... IF NOT
EXISTS`, `DO $$ ... $$` policy blocks).

---

## 6. State of the Art (2025–2026 references)

The Wave HARVEST design is grounded in:

- **SECI model — tacit ↔ explicit knowledge conversion.** Ikujiro
  Nonaka and Hirotaka Takeuchi, *The Knowledge-Creating Company*
  (Oxford University Press, 1995); summarised in
  [Wikipedia — SECI model of knowledge dimensions](https://en.wikipedia.org/wiki/SECI_model_of_knowledge_dimensions)
  (accessed 2026-05-26). Modes A (walk-the-floor) and E (cross-role)
  are *socialisation* in SECI terms; modes B/C/D are *externalisation*.

- **Anthropic — Chain-of-Thought extraction and faithfulness.**
  [Reasoning models don't always say what they think](https://www.anthropic.com/research/reasoning-models-dont-say-think)
  (Anthropic Research, 2025-04). The extractor uses CoT prompts
  but explicitly does **not** treat the reasoning text as ground
  truth — it treats the final classification as a probabilistic
  claim that the redundancy checker validates.

- **Mem0 — long-term memory for agents.**
  [mem0.ai/research](https://mem0.ai/research) (accessed 2026-05-26);
  [Mem0 GitHub](https://github.com/mem0ai/mem0). Mem0's
  fact-extraction-then-consolidation loop is the reference design
  for the `extractor → redundancy-checker → cell-writer` chain.

- **LangGraph — interrupt patterns and human-in-the-loop.**
  [langchain-ai.github.io/langgraph/concepts/human_in_the_loop](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/)
  (accessed 2026-05-26). The walk-the-floor and ride-along modes
  use interrupt-style pacing: the engine yields to the subject and
  waits for an explicit resume signal before its next utterance.

- **NTT Data — tacit knowledge AI tooling.**
  [NTT Data — Tacit Knowledge AI Translation](https://www.nttdata.com/global/en/insights/focus/2024/tacit-knowledge-ai-translation)
  (2024-09-12). Reference for the cross-role mode — NTT's "expert
  apprentice" prototype validated the silent-observer pattern.

- **Deloitte Tohmatsu — AI Interview Agent for tacit knowledge.**
  [Deloitte Tohmatsu develops AI Interview Agent](https://itbusinesstoday.com/hr-tech/deloitte-tohmatsu-develops-ai-interview-agent-to-digitize-tacit-knowledge-within-companies/)
  (IT Business Today, 2026-01-22). Reference for post-incident and
  deal-replay framings.

- **Squirro — Corporate amnesia and tacit-knowledge capture.**
  [squirro.com — How AI Captures Tacit Knowledge](https://squirro.com/squirro-blog/ai-tacit-knowledge-capture)
  (2026-03-04). Source for the 80% figure and the consent framing.

- **OpenAI — Realtime API for voice-first capture.**
  [platform.openai.com — Realtime API](https://platform.openai.com/docs/guides/realtime)
  (accessed 2026-05-26). The walk-the-floor mode targets voice as
  the primary input channel; the package's transcript model is
  shaped for streaming-voice input.

- **Cognitive Task Analysis (CTA) — Critical Decision Method.**
  Klein, Calderwood, MacGregor, *Critical Decision Method for
  Eliciting Knowledge*, IEEE Transactions on Systems, Man, and
  Cybernetics, 1989. The post-incident mode's question shapes
  ("what did you almost do?", "what would you tell yourself three
  hours earlier?") are the Klein CDM probes adapted for mining.

---

## 7. Wire-Up Boundaries

- **Cognitive-memory port.** `@borjie/tacit-knowledge` writes via
  the `CognitiveMemorySink` port. It does **not** import
  `@borjie/cognitive-memory`. The host (api-gateway) wires the
  production sink.
- **LLM extraction port.** `EntityExtractor` is an injected port.
  The package ships a reference implementation that returns a
  deterministic skeleton extraction for tests; production wires
  `@borjie/brain-llm-router`.
- **Embedding port.** Redundancy uses a `VectorIndex` port for
  embedding-driven similarity. The reference implementation does
  in-memory cosine; production wires pgvector via
  `@borjie/cognitive-memory`'s embedding service.
- **Repository ports.** Three repos —
  `TacitInterviewRepository`,
  `TacitExtractionRepository`,
  `TacitConsentRepository` — each ships in-memory + Drizzle
  implementations. Tests use in-memory; the api-gateway wires
  Drizzle.
- **Audit.** Every mutation is hashed via `@borjie/audit-hash-chain`
  using the content-only variant (matching the swarm-coordination
  pattern).

---

## 8. Telemetry

- `borjie_tacit_sessions_started_total{mode,tenant}` — counter.
- `borjie_tacit_artifacts_extracted_total{mode,kind,tenant}` —
  counter.
- `borjie_tacit_artifacts_redundant_total{mode,tenant}` — counter
  (when redundancy-check matches).
- `borjie_tacit_consent_revokes_total{tenant}` — counter.
- `borjie_tacit_session_duration_ms{mode,tenant}` — histogram.

All structured logs use the canonical `createLogger(TelemetryConfig)`
from `@borjie/observability`.

---

## 9. UI Naming Discipline

Per the brand constraint: never name the subject's role aloud. UI
says **"walk-the-floor session with [Name]"**, not "interview the
foreman". The mode label is *system-internal only* for
disambiguation in audit logs. The cognitive-memory cell stores the
mode in `content_structured.mode` for later analysis but never
surfaces it in user-facing artifacts unless the owner explicitly
asks for it.

---

## 10. Acceptance Criteria

- Five mode templates implemented with distinct pacing budgets.
- Extractor returns `Extraction[]` with kind, confidence, novel.
- Redundancy checker can mark a duplicate as redundant.
- Consent revoke mid-session blocks further persistence.
- Three repositories (interviews, extractions, consents) have
  in-memory + SQL adapters.
- Migration 0044 idempotent, RLS-bound on tenant_id.
- TypeScript strict mode passes with no `@ts-nocheck` and no
  `any`.
- Live-test only — no mocks in runtime code.
- 14+ tests covering modes, extractor, redundancy, consent,
  engine orchestration, and repositories.

---

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

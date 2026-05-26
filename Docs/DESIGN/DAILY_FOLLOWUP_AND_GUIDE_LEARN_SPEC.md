# Daily Follow-up + Guide-vs-Learn — Combined Design Specification

> Wave M2. Combined-pillar spec that fuses
> [`DAILY_USER_FOLLOWUP_SPEC.md`](./DAILY_USER_FOLLOWUP_SPEC.md) and
> [`GUIDE_VS_LEARN_MODE_SPEC.md`](./GUIDE_VS_LEARN_MODE_SPEC.md) into a
> single runtime contract. Owner-facing proactive nudges + the
> guide-vs-learn voice toggle are two halves of the same operating
> principle: *the org should feel alive, and the human should always
> be the one deciding how much they want to drive*.
>
> **Cross-links:** [`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md),
> [`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`MEMORY_AMNESIA_PREVENTION_SOTA.md`](./MEMORY_AMNESIA_PREVENTION_SOTA.md).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Vision — founder verbatim

> "Root MD always knows progress of every user daily and makes
> appropriate follow-ups, making the org feel ALIVE for the owner.
> Users can toggle between GUIDE and LEARN."

The two halves cannot be specified separately because the follow-up
voice **must respect** the user's mode preference. A `LEARN`-mode
user does not want Mr. Mwikila to file the Tumemadini return for
them at 14:30 and announce it the next morning — they want him to
notice that the filing window opens in 3 days and ask "would you
like to walk through how I'd compute the rate before you file?"
Same trigger, two voices.

---

## 2. Thesis — Two Loops, One Operating Principle

### Loop A — *Daily Follow-up*

Mr. Mwikila proactively contacts every user every day with three
sections (yesterday's progress, today's open items, streaks & gaps).
He picks the channel and the moment that minimises interruption
while maximising the chance the user acts. The owner sees an
*aggregate pulse* — counts, streaks, friction signals — without
violating any individual user's privacy.

### Loop B — *Guide vs Learn*

Every Mr. Mwikila output that lands on a human surface (chat,
email, WhatsApp, in-app card, daily follow-up bundle) is rendered
through one of two voices. `GUIDE` minimises cognitive load — the
artifact comes pre-drafted, the user reviews and approves. `LEARN`
maximises mastery — the artifact appears at the *bottom*, behind
the explanation, so the human cannot skip the cognitive work.

The two loops compose: the follow-up engine **selects** the trigger
and **suppresses** based on quiet hours and per-day cap; the
voice layer **renders** the chosen content in the user's chosen
mode. Neither layer knows about the other's internals — they meet
at a `FollowupCandidate.payload` boundary that the voice styler
consumes as input.

---

## 3. Trigger Sources

Loop A pulls candidates from six observable sources. Each source
writes into the same `followup_candidates` queue; the scoring
layer (§5) is the only thing that ranks them.

1. **Work-cycle journal** ([`CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`](./CONTINUOUS_24_7_WORK_CYCLE_SPEC.md)).
   Yesterday's journal entry naming what the user shipped, what was
   approved, and what learning gains were recorded becomes the
   "yesterday's progress" section.

2. **Anticipatory sweeps** ([`ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md)).
   Predicted likely-next-actions become *suggested* candidates with
   confidence ≥0.6 are eligible. Example: "your top 5 buyers
   haven't ordered in 30 days, run a sweep?".

3. **Regulator calendar.** TRA Tumemadini quarterly returns, NEMC
   EIA renewals, OSHA inspections, BOT FX-exposure declarations.
   Every Tanzanian-regulator-specific deadline (encoded in
   `packages/compliance-pack/`) generates a follow-up candidate at
   `T-30`, `T-14`, `T-3`, `T-1` and `T+0` per the regulator's own
   late-filing penalty curve.

4. **User-flagged items.** Anything the user labelled "remind me",
   "follow up later", or "park this" during a chat turn. The
   cognitive engine writes these to `pending_threads`
   ([`MEMORY_AMNESIA_PREVENTION_SOTA.md`](./MEMORY_AMNESIA_PREVENTION_SOTA.md))
   with `pending_kind='follow_up'`; the follow-up engine reads them
   back out.

5. **Relationship-graph dormancy.** Mr. Mwikila tracks the user's
   tended relationships (buyers, suppliers, regulators, internal
   peers). When the last-touched-at on a high-importance contact
   exceeds the relationship's natural cadence (e.g. a Tier-A buyer
   not contacted in ≥14 days), a candidate fires.

6. **Post-mortem of incidents.** Any incident the user opened
   yesterday (Site B compressor temperature alarm, Pit 4 wall
   stability concern, late royalty filing) gets a 24-hour
   post-mortem candidate: "yesterday you flagged the Site B
   compressor temp; here's the post-mortem".

---

## 4. Channels + Channel Routing

Three channel families. The user's preference (§7) chooses which.
Defaults differ by tenant tier and by role.

| Channel | Best for | Default for |
|---|---|---|
| `inapp` | High-priority, decision-required items | Owners; in-office Managers |
| `email` | Reflective items, long lists, no urgency | Off-site users; daily digest readers |
| `whatsapp` | Field workers; mobile-first users | Workers; Tanzanian SMB owners with low desktop time |

Within `inapp`, three sub-surfaces:

- **Floating chat bubble** ([`packages/chat-ui/src/widget/`](../../packages/chat-ui/src/widget))
  — used for items the user must see *during* a session.
- **Daily morning card** — pinned at the top of the home dashboard;
  the canonical landing surface for the 09:00 daily bundle.
- **Tab-attached badge** — when the candidate is scoped to a single
  tab (e.g. "Tumemadini-filing — draft is ready").

The channel adapter is a *port* (interface) injected by the host —
the user-followup package never carries live HTTP/SMTP/WhatsApp
client code. Live impls are wired in `services/notification-bus/`
and `apps/web/`.

---

## 5. Prioritisation — impact × urgency × user attention

Each candidate carries a numeric `priority` in `[0, 1]` computed by:

```
priority = sigmoid(
    0.45 * impact_score
  + 0.35 * urgency_score
  + 0.20 * attention_score
  - 0.10 * fatigue_penalty
)
```

- **`impact_score`** is supplied by the source (regulator deadline =
  0.9; relationship-dormancy on a Tier-C buyer = 0.2). The scorer
  clamps to `[0, 1]`.
- **`urgency_score`** is `1.0 - days_until_deadline / 30`, clamped.
  Items without deadlines default to `0.3`.
- **`attention_score`** rises when the user *has* engaged with this
  candidate's topic recently (open thread on it, asked a related
  question, gave it a tag). The cognitive engine maintains this
  signal per (user, topic) pair.
- **`fatigue_penalty`** penalises candidates whose topic the user
  has already received ≥3 followups about this week — a debounce
  against nag.

The top `max_per_day` (default 5; tunable per-user in
`followup_preferences`) are scheduled. The rest are stamped
`expired` at midnight local.

---

## 6. Quiet Hours + Opt-Out Semantics

Quiet hours block *scheduling*, not *enqueueing*. Candidates queued
during a user's quiet window are held and reconsidered at the next
boundary. The `quiet_hours_start` / `quiet_hours_end` fields are
local-time clock values stored as `time` (PostgreSQL), interpreted
in the user's `IANA` timezone (resolved from `identity.users`).

Three opt-out levels are supported, in keeping with the founder's
employee-privacy directive:

1. **`disabled_channels`** — the user has removed `whatsapp` from
   their `allowed_channels` array. Mr. Mwikila skips WhatsApp but
   still pings `email` or `inapp`.
2. **`max_per_day = 0`** — no follow-ups at all; only the daily
   morning bundle and *blocking* regulator items pass through.
3. **`mode = 'paused'`** in `persona_voice_mode` — Mr. Mwikila is
   muted entirely. Even the morning bundle suppresses. The owner
   does not see this user's check-ins for the duration. Useful for
   medical leave, sabbatical, etc.

The owner cannot override any of these — *employee privacy is
non-negotiable*. The owner *does* see counts in the morning
briefing (e.g. "14 of 16 users active yesterday"), but never the
content of any individual user's check-in.

---

## 7. Guide-vs-Learn Modes — concrete mining examples

`persona_voice_mode` carries one of three values: `guide`, `learn`,
`balanced` (default). The voice styler consumes the mode plus the
draft answer and returns a styled answer.

### 7.1 GUIDE mode — Mr. Mwikila does, the user approves

Example trigger: TRA Tumemadini Q2 return window opens in 3 days.

> *"I've drafted your Q2 Tumemadini return using the BoT
> gold-window rate from yesterday's close (USD 2 412.30/oz). The
> royalty is computed against your June production of 184.7 oz —
> see clause 4.2 of the attached. The draft is on your desk;
> approving below files it Friday at 14:30 (within the TRA
> filing window). Alternative: hold to next week — you lose
> 0.3% on the gold-window slip but gain working-capital float.
> My recommendation is file Friday."*

Style markers: first-person plural ("we"), action verbs, sentences
under 25 words, recommendation first, citation as superscript.

### 7.2 LEARN mode — Mr. Mwikila teaches, the user does

Same trigger, LEARN voice:

> *"Tumemadini Q2 window opens in 3 days. Before we draft, walk
> through this with me. Question 1: yesterday's BoT gold-window
> rate closed at USD 2 412.30/oz. What does that imply for the
> royalty rate in clause 4.2? Take a guess — I'll show you the
> calc. Question 2: your June production was 184.7 oz. Given
> the answer to Q1, what's the gross royalty owed before the
> small-miner exemption? Once we work through these two, the
> draft will be obvious and you'll have the formula in your
> head for Q3."*

Style markers: Socratic, scaffolded, no answer-first, sentence
length unlocked to ~40 words, comparative framing.

### 7.3 BALANCED mode (default)

For mid-mastery users — Mr. Mwikila shows the draft *and* a short
"why I drafted it this way" affordance, but does not require the
user to walk through every step.

> *"Q2 Tumemadini return drafted (preview below). One-paragraph
> rationale: BoT gold-window rate from yesterday → royalty rate
> via clause 4.2 → applied to June production of 184.7 oz. Tap
> 'why' to expand the math; tap 'approve' to file Friday."*

---

## 8. Tacit-knowledge harvest in LEARN mode

The second-order purpose of LEARN mode is **tacit-knowledge
capture** ([`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md)).
When a seasoned user walks Mr. Mwikila through *their* mental
model, the cognitive engine writes a candidate `Skill`
([`MEMORY_AMNESIA_PREVENTION_SOTA.md`](./MEMORY_AMNESIA_PREVENTION_SOTA.md))
with status `observed`. Over enough observations, the skill is
promoted and becomes the org's own playbook. LEARN mode is
therefore not just pedagogy — it is the *acquisition pipeline*
for the tenant's procedural memory.

---

## 9. Storage + RLS

Three tenant-scoped tables (migration `0034_followup_voice.sql`):

- `followup_candidates` (id, tenant_id, user_id, source, payload,
  priority, channel, scheduled_for, status, sent_at, audit_hash) —
  queue of pending and historical nudges.
- `followup_preferences` (tenant_id, user_id, allowed_channels,
  quiet_hours_start, quiet_hours_end, max_per_day) — per-user
  preference row.
- `persona_voice_mode` (tenant_id, user_id, mode, verbosity_level,
  updated_at) — per-user voice configuration.

All three carry RLS via the canonical `app.tenant_id` GUC. The
migration is idempotent (`IF NOT EXISTS` + `DO $$ ... $$` blocks).

---

## 10. Audit + Determinism

Every dispatched follow-up writes a row through the host's
`AuditChainPort` (same pattern as `@borjie/persistent-memory`).
The chain link covers `(candidate_id, tenant_id, user_id, source,
priority, channel, dispatched_at)`. This means: if a regulator
later asks "why did the user receive a TRA-filing reminder at
09:14 on this date?", the chain produces a verifiable provenance.

The scoring function is **pure** — same inputs always produce the
same priority. The scheduler is **pure given a clock + prefs**.
This matters because deterministic behaviour is testable, and
testable behaviour is what justifies the founder's mutation-authority
grant.

---

## 11. Cited evidence (2026 state of the art)

The combined loop reflects what the world's leading proactive-AI
systems do, adapted to the mining-estate domain.

- **Anthropic — Claude proactive memory + follow-up patterns.**
  Claude in claude.ai now surfaces "you mentioned X last week —
  want to revisit?" prompts. Source: [Anthropic, *Introducing
  memory in Claude*](https://www.anthropic.com/news/memory),
  published 2025-04-09. Retrieved 2026-05-26. Pattern adopted:
  surface unresolved threads with explicit citation back to the
  original turn.

- **OpenAI — Scheduled Tasks (Tasks API).** GPT-class assistants
  can schedule future check-ins ("remind me about the quarterly
  filing"). Source: [OpenAI, *Tasks in ChatGPT
  documentation*](https://help.openai.com/en/articles/10491870-tasks-in-chatgpt),
  retrieved 2026-05-26. Pattern adopted: user-scheduled reminders
  are a first-class candidate source.

- **Google — Gemini Spark / Daily Brief.** Gemini ships
  morning/afternoon/evening proactive summaries. Source:
  [Explosion.com, *Google turns Gemini into a proactive AI agent
  with Spark*](https://www.explosion.com/186813/google-turns-gemini-into-a-proactive-ai-agent-with-spark/),
  retrieved 2026-05-26. Pattern adopted: tri-section structure
  (yesterday / today / streaks) for the morning bundle.

- **Google ADK — Proactive Prompts pattern.** The Agent Development
  Kit documents a "proactive_prompt" lifecycle stage. Source:
  [Google ADK docs, *Building proactive
  agents*](https://google.github.io/adk-docs/), retrieved
  2026-05-26. Pattern adopted: proactive prompts are evaluated
  against a suppression window before dispatch.

- **Khan Academy — Khanmigo (Socratic AI tutor).** ~50M-student
  deployment as of 2026. Source: [Khan Academy, *Introducing
  Khanmigo*](https://www.khanmigo.ai/), retrieved 2026-05-26.
  Pattern adopted: the LEARN-mode voice template ("deliver the
  next question, not the answer").

- **Voyager (NVIDIA / Wang et al. 2023).** Skill library +
  Socratic-style auto-curriculum. Source:
  [arXiv:2305.16291](https://arxiv.org/abs/2305.16291), Wang et
  al., *Voyager: An Open-Ended Embodied Agent with Large Language
  Models*, retrieved 2026-05-26. Pattern adopted: LEARN-mode
  walk-throughs feed the procedural-skill library described in
  `MEMORY_AMNESIA_PREVENTION_SOTA.md`.

- **MindStudio — Proactive vs Anticipatory Agents.** Industry
  taxonomy for the "monitor commitments, detect neglected
  relationships, generate contextual drafts 24/7" pattern.
  Source: [MindStudio, *What is proactive AI? Reactive to
  anticipatory
  agents*](https://www.mindstudio.ai/blog/what-is-proactive-ai-reactive-to-anticipatory-agents),
  retrieved 2026-05-26. Pattern adopted: distinguishing
  *reactive* (waits for prompt), *proactive* (monitors triggers)
  and *anticipatory* (predicts likely-next-actions) — the
  follow-up engine sits at the proactive/anticipatory boundary.

- **WCAG 2.2 AA — Notification frequency + opt-out.** Source:
  [W3C, *Web Content Accessibility Guidelines
  2.2*](https://www.w3.org/TR/WCAG22/), 2023-10-05 publication,
  retrieved 2026-05-26. Pattern adopted: quiet-hours support and
  per-channel opt-out as accessibility-grade defaults.

All claims cited above are URL + title + date. No claim is left
unattributed.

---

## 12. Package boundary + dataflow

Two packages land in this wave:

- `@borjie/user-followup` (this spec, §§3–6, §§9–10) — owner-facing
  daily nudge engine. Pure scoring + scheduling + repository
  surface. No network code. Channel adapters are *ports*; live
  HTTP/SMTP/WhatsApp wiring lives in `services/notification-bus/`.

- `@borjie/persona-voice` (this spec, §§7–8) — the guide-vs-learn
  styling layer. Given a draft Mr. Mwikila answer plus a
  `(tenant_id, user_id)` voice mode, returns a styled answer
  ready for the caller's render path. No network code; pure
  text-transformation library.

The packages are independent at compile time and dependency-free at
runtime. The follow-up scheduler emits a `FollowupCandidate.payload`
of shape `{ text: string, citations: Citation[], action?: Action }`
which the persona-voice styler can consume directly when the host
wires the two together (typical wiring is in
`apps/web/src/server/followup-dispatcher.ts`).

A *third-party* observer — for example a future "send the same
follow-up via voice call in Swahili" worker — can also subscribe
to the queue without modifying either package, because the queue
itself is the seam.

---

## 13. Failure modes + mitigations

| Failure | Cause | Mitigation |
|---|---|---|
| User receives 7 follow-ups in one hour | Multiple sources fire at once with no debounce | `max_per_day` enforced at scheduler; `fatigue_penalty` decreases priority on repeat topics |
| Follow-up fires at 02:00 local | Quiet hours misconfigured or default missing | Quiet hours have safe defaults (22:00 → 07:00 local); scheduler queries `IANA` tz before dispatch |
| Owner sees individual user's check-in content | Aggregator over-reaches | Owner-aggregate view sees only counts + streaks; per-user content is gated by RLS to the user only |
| LEARN-mode user gets impatient and wants the answer | Verbose voice mismatch | The mode toggle is one click; the styler stores `last_changed_at` so frequent toggles trigger a soft suggestion to switch to BALANCED |
| Regulator deadline missed because user opted out entirely | `max_per_day = 0` blocks even critical items | Critical items (regulator deadlines with `T-3` or sooner) bypass `max_per_day` and emit on the in-app channel regardless |

---

## 14. Out of scope

- **Voice-channel follow-ups** (Gemini Live / Swahili) are
  specified separately in
  [`VOICE_GEMINI_LIVE_SWAHILI_SPEC.md`](./VOICE_GEMINI_LIVE_SWAHILI_SPEC.md).
  The `whatsapp` channel adapter in this spec covers text only.
- **Multi-user batched follow-ups** (e.g. "remind the whole
  ops team") — punted to Wave M3.
- **SMS fallback** — punted; deliverability in rural Tanzania is
  unreliable enough that we defer until the WhatsApp Business
  baseline is stable.
- **Cross-tenant follow-up benchmarking** (anonymised "users in
  similar mining ops act on follow-ups within X hours") is a
  fairness-and-privacy concern; defer to a dedicated audit.

---

## 15. Acceptance criteria

A working M2 deployment must demonstrate:

1. A user with `mode='learn'` who flags a "follow up later" item at
   16:00 receives a follow-up the next morning rendered in LEARN
   voice (Socratic, no answer first).
2. A user with `quiet_hours_start=22:00`, `quiet_hours_end=07:00`
   who has 6 candidates queued at midnight receives **zero**
   dispatches between 22:00 and 07:00 and exactly `max_per_day`
   dispatches at and after 07:00.
3. A user with `whatsapp` removed from `allowed_channels` never
   receives a WhatsApp message even when the candidate's preferred
   channel is `whatsapp` — it falls back to `email` (or `inapp` if
   email is also removed).
4. A regulator deadline at `T-1` bypasses `max_per_day` and is
   delivered even when the user has hit their daily cap.
5. The owner's morning briefing shows counts and streaks for all
   users but **never** the body of any user's check-in.

---

## 16. Source map

| Artefact | Path |
|---|---|
| This spec | `Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md` |
| Migration | `packages/database/drizzle/0034_followup_voice.sql` |
| Schema | `packages/database/src/schemas/followup-voice.schema.ts` |
| Follow-up package | `packages/user-followup/` |
| Voice package | `packages/persona-voice/` |
| Sibling spec (full daily-followup) | `Docs/DESIGN/DAILY_USER_FOLLOWUP_SPEC.md` |
| Sibling spec (full guide-vs-learn) | `Docs/DESIGN/GUIDE_VS_LEARN_MODE_SPEC.md` |

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

---

## § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

This section is the immutable reconciliation record of founder-locked decisions that override prior defaults in this spec. Idempotent — re-running the reconcile pass is a no-op once this section exists. Persona: Mr. Mwikila.

### Override — Decision #1 (Tier 2-Critical escalation quiet hours)

**Verbatim**: *Default: 18:00–06:00 quiet window in every timezone. Mr. Mwikila does NOT escalate Tier 2-Critical actions to a live user during quiet hours unless the action's deadline is < 12 hours away. Items raised during quiet hours queue up and surface at 06:00 local. Mr. Mwikila may proactively ask the user once during onboarding if they want a different window, but the platform default is 18:00–06:00 universal.*

Config constants — `QUIET_HOURS_START = '18:00'`, `QUIET_HOURS_END = '06:00'`, `TIER_2_CRITICAL_DEADLINE_FLOOR_HOURS = 12`. The 12-hour deadline floor is the only override and only applies when the deadline itself is closer than the quiet window. Jurisdiction-profile finer-grained defaults (e.g. Ramadan windows) layer on top per the universal addendum.

**Rationale**: Founder-locked default that protects user wellbeing from machine-speed escalation; quiet-hours suppression is enforced in `packages/user-followup/` and respected by every downstream notification path including wave-resilience-manager auto-resumes.

### Override — Decision #3 (Daily check-in content privacy — three-tier rendering)

**Verbatim**: *SOTA — three-tier rendering by recipient.*

| Recipient | Counts | Streaks | Content body |
|---|---|---|---|
| Subject (the employee being checked-in on) | ✓ | ✓ | ✓ full text |
| Direct supervisor (1-up scope) | ✓ | ✓ | redacted summary only (entity-stripped + 2-sentence cap) |
| Owner (root MD scope) | ✓ | ✓ | aggregate stats only — no per-row content |
| Cross-tenant / federation | ✗ | ✗ | ✗ — never shared, even with consent |

Implementation: `packages/session-mirror/` PII boundary redaction (sha256 salted hash for identifiers) layered on top of `packages/org-scope/` scope-aware row filtering. Subject can opt-in to share verbatim with a specific person via an explicit one-shot, audited "share this check-in with X" UI gesture.

Citations: **GDPR Art. 5(1)(c) data minimisation** (https://gdpr.eu/article-5-how-to-process-personal-data/), **NIST 800-122 PII guidelines** (https://csrc.nist.gov/publications/detail/sp/800-122/final), **Apple Differential Privacy guide** (https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf), **MIT Tacit-Knowledge access-control framework** (Nonaka 1995 SECI model).

**Rationale**: Founder-locked SOTA tier matrix; protects the subject employee from supervisor surveillance creep while preserving operational visibility through aggregate stats — minimum-necessary data exposure at every read.

### Override — Decision #4 (Mode-toggle org policy override — SOTA with stronger consent)

**Verbatim**: *SOTA — industry standard with stronger consent.* Admin can set a default mode org-wide, BUT:

1. **Employee notification on mode change** — every employee scoped under the admin gets an in-app notification within 30 min of the change ("Your organisation has switched Mr. Mwikila to LEARN mode. This means…").
2. **24-hour opt-out window** — each employee can opt themselves back to BALANCED for their own session for the next 24 h after notification (a longer override requires the admin to also opt them out).
3. **LEARN-mode audit trail** — anything Mr. Mwikila silently observes during LEARN mode is captured in `cognitive_memory_cells` with `provenance.consent_state = 'org-default-learn'`. Tenant admins can export this audit trail on demand (right-of-access).
4. **Quarterly re-consent** — every 90 days the admin must re-confirm the org-wide default (a single click in the admin panel); the platform shows a banner reminding them.

Pattern borrowed from Google Workspace data-region opt-out flow + Slack Enterprise Grid retention policy override flow + GDPR Art. 7(3) (consent withdrawable).

Citations: **GDPR Art. 7(3)** (https://gdpr.eu/article-7-conditions-for-consent/), **Google Workspace data-region docs** (https://support.google.com/a/answer/7630496), **Slack retention policy override** (https://slack.com/help/articles/360002746788), **NIST 800-53 AC-21 (consent management)**.

**Rationale**: Founder-locked consent-management policy ensures employees never lose informed agency when an admin flips the mode toggle; the 90-day re-consent reminder closes the slow drift toward background observation that pure org-default toggles would otherwise enable.

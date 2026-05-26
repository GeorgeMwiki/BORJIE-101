# Tacit Knowledge Harvesting — Design Specification

> Pillar 2 of [`CAPABILITY_BOOST_VISION.md`](../STRATEGY/CAPABILITY_BOOST_VISION.md).
> Sibling specs:
> [`OMNIDATA_CONNECTOR_INVENTORY.md`](./OMNIDATA_CONNECTOR_INVENTORY.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md),
> [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila — Borjie's autonomous Managing
Director, here cast specifically as a **conversational anthropologist**.

---

## 1. The Thesis — Most Knowledge Lives in Heads, Not Data

Squirro's 2026 research, cited widely in the enterprise-AI literature
([squirro.com — Corporate Amnesia](https://squirro.com/squirro-blog/ai-tacit-knowledge-capture)),
puts the figure plainly: **roughly 80% of business value sits in tacit
knowledge** — the intuition, context, unwritten rules, customer
relationships, failure stories, and trade craft that make work
actually work. Omnidata gives Mr. Mwikila the raw substrate; data
onboarding gives him the persistence pipeline; the cognitive engine
gives him the reasoning discipline. None of those, by themselves,
extracts the *why* from the human who knows it. Without
interviewing people, the platform reads the surface of the
organisation while missing its operating logic.

The founder's brief is direct:

> "Literal ability to poke, identify, and document critical know-hows
> that are in people's heads by prompting more or asking follow-ups or
> curious explanations or clarifications into domain knowledge,
> learning, etc. Look continues."

The state of the art in 2026 is converging on the same point.
Deloitte Tohmatsu shipped an "AI Interview Agent" in January 2026
([itbusinesstoday.com](https://itbusinesstoday.com/hr-tech/deloitte-tohmatsu-develops-ai-interview-agent-to-digitize-tacit-knowledge-within-companies/))
that explicitly targets tacit knowledge digitisation; KS-Agents
markets an AI-powered exit-interview product
([ks-agents.com/offboarding](https://ks-agents.com/offboarding/));
JoySuite, CogniCache, and Squirro itself sell variations of the same
idea. Where every existing product has *one* harvesting mode —
typically exit interviews — Borjie ships **five**, each tuned to a
different moment in the employee lifecycle. That is what makes
Mr. Mwikila a real anthropologist, not a leaving-employee survey.

---

## 2. The Five Harvesting Modes

### 2.1 Onboarding Interview

**When fired:** within 24 hours of a new employee being added to the
tenant.

**What it does:** Mr. Mwikila runs a structured 20–30 minute
conversational interview with the new employee. Topics: their role,
recurring tasks, methods they use, software they touch, key
relationships (internal + external), one-week / one-month / one-quarter
deliverables, what they think they will need to learn, what they
worry will go wrong. The interview is bilingual (Swahili / English
toggleable mid-session); the question generator (§4) adapts question
depth to the employee's role seniority (a CFO gets methodology-elicitation-
style questions; a new junior surveyor gets a checklist-style intake).

**Output:** between 30 and 90 `KnowHowArtifact`s per session.

**Frequency:** once per employee, at hire. Optional 30-day follow-up.

### 2.2 Departure Interview

**When fired:** triggered by HR / owner marking an employee as
exiting (notice period reached). Voluntary — employees opt in or
decline; declined exits leave no record.

**What it does:** between one and five 60–90 minute sessions over the
notice period, depending on role seniority. Mr. Mwikila asks deep
methodology-elicitation questions: *"Walk me through how you used to
decide which buyer to call first when prices moved sharply"*, *"What
do you wish someone had told you on your first month here?"*, *"If
your replacement had three weeks with you, what would you teach
them?"*. The MD asks **until satisfied** — re-prompts on shallow
answers, follows up on names dropped, surfaces inconsistencies with
the omnidata record.

**Output:** between 150 and 500 `KnowHowArtifact`s for a senior
expert; 50–150 for a mid-level role.

**Frequency:** once per departing employee, multi-session as needed.

### 2.3 Curious Follow-up

**When fired:** in-flight, mid-chat, when an employee (or the owner)
mentions a name, a process, a number, or a relationship that
Mr. Mwikila has no know-how artifact for.

**What it does:** Mr. Mwikila injects 1–3 follow-up questions
inline — *"You mentioned 'the Friday gold run' — is that your
standard cycle? Who handles it if you're out?"* — and stops as soon
as the gap is closed or the employee signals they want to move on.
Never pushy; never blocking the original task.

**Output:** 1–5 `KnowHowArtifact`s per follow-up.

**Frequency:** ad-hoc; triggered hundreds of times per week across
the tenant. The cumulative volume here exceeds onboarding +
departure interviews combined.

### 2.4 Methodology Elicitation

**When fired:** scheduled by the owner for a specific senior expert —
typically a 3- to 5-session arc, with the expert agreeing to be the
"teacher". Used for the depth case: a 22-year leach-pad operator, a
geologist with a private spreadsheet system, a buyer-rep with a
relationship book.

**What it does:** Mr. Mwikila runs a structured "walk me through how
you do X" sequence, where X is a high-value capability the tenant
wants to durably capture. Combines the 5-Whys frame (Toyota
Production System), Cynefin sense-making categorisation
(simple / complicated / complex / chaotic), and ethnographic
"narrative reconstruction" — getting the expert to tell a recent
real story and probing the decision points.

**Output:** 100–300 `KnowHowArtifact`s per arc; produces a
**playbook artifact** (a generated document) the team can read.

**Frequency:** as the owner schedules — typically a handful per year
per tenant.

### 2.5 Just-in-Time Documentation

**When fired:** when an employee completes a task that Mr. Mwikila
has flagged as either novel (no know-how artifacts match) or unusually
successful (outcome metrics exceeded baseline).

**What it does:** Mr. Mwikila offers, in chat: *"That looked like a
useful approach — should I save it for the team?"* If yes, runs a
short 3-question recap, generates a know-how artifact, and adds it
to the tenant's playbook.

**Output:** 5–15 `KnowHowArtifact`s per event.

**Frequency:** triggered by the continuous-improvement loop in the
existing manifesto; runs dozens of times per week across the tenant.

---

## 3. The Interview Engine Contract

```typescript
export type HarvestMode =
  | 'onboarding'
  | 'departure'
  | 'curious_followup'
  | 'methodology_elicitation'
  | 'jit_documentation';

export interface InterviewSession {
  readonly id: string;
  readonly tenant_id: string;
  readonly employee_id: string;
  readonly mode: HarvestMode;
  readonly initiated_by: 'system' | 'owner' | 'employee';
  readonly consent_record_id: string;             // mandatory
  readonly language: 'sw' | 'en';
  readonly target_artifact_count: number;         // expected know-how yield
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'declined' | 'paused';
}

export interface InterviewTurn {
  readonly id: string;
  readonly session_id: string;
  readonly turn_index: number;
  readonly question: string;                      // canonical question text
  readonly question_frame: QuestionFrame;
  readonly response: string;
  readonly response_audio_url: string | null;     // if voice
  readonly extracted_artifacts: ReadonlyArray<string>;  // KnowHowArtifact ids
  readonly follow_up_signals: ReadonlyArray<FollowUpSignal>;
  readonly created_at: string;
}

export type QuestionFrame =
  | 'intake'             // factual structural — onboarding mode
  | 'five_whys'          // Toyota TPS root-cause
  | 'cynefin_categorise' // simple / complicated / complex / chaotic
  | 'ethnographic'       // tell-me-a-story narrative
  | 'gap_probe'          // close a missing-know-how gap
  | 'failure_elicit'     // "what went wrong last time"
  | 'relationship_map';  // "who do you call when..."

export interface FollowUpSignal {
  readonly kind: 'name_dropped' | 'process_mentioned' | 'tool_named' | 'metric_cited' | 'failure_alluded';
  readonly value: string;
  readonly should_probe: boolean;
}

export interface RunInterviewParams {
  readonly mode: HarvestMode;
  readonly employee_id: string;
  readonly language: 'sw' | 'en';
  readonly max_turns: number;
}
```

The engine exposes one persona-kernel tool per mode
(`run_onboarding_interview_v1`, `run_departure_interview_v1`,
`run_methodology_elicitation_v1`, `harvest_follow_up_v1`,
`offer_jit_documentation_v1`) plus a shared
`generate_next_question_v1` primitive that the question generator
(§4) calls.

---

## 4. Question Generation

Question generation is LLM-driven but structured. The generator
receives, per turn:

- the running session transcript
- the employee's role / seniority
- the harvesting mode + question frame
- the omnidata signals about this employee (what we've already
  ingested from Slack / email / etc. — used to inform the question, not
  to surveil)
- the list of `FollowUpSignal`s emitted by prior turns that have not
  yet been probed
- the running know-how artifact yield

It uses Anthropic Claude with extended thinking (`thinking.budgetTokens`
= 4000 for methodology elicitation, 1500 for curious follow-up, 2500
otherwise) to compose a single next question that:

1. Sits within the chosen `QuestionFrame`.
2. Is **minimally invasive** — never asks for personal information
   unrelated to work; never asks about other employees' opinions in
   an attributable way.
3. Maximises information gain — picks the gap with highest expected
   know-how yield given session goals.
4. Is **culturally calibrated** — Swahili question generation is
   tested separately against a Tanzania-specific eval set.

Five structural frames anchor the generator:

- **5-Whys (TPS)** — recursively probe causation.
- **Cynefin** — categorise the kind of decision (simple / complicated /
  complex / chaotic) before going deep.
- **Ethnographic narrative** — get a recent specific story before
  generalising.
- **Failure elicitation** — "tell me about a time this went wrong"
  surfaces tacit guard rails.
- **Relationship mapping** — "who do you call when…" surfaces the
  network.

The generator caps any single session at the configured `max_turns`
to prevent fatigue. Below 60% expected-yield, the session pauses
automatically and asks the employee whether to continue.

---

## 5. Output Format — `KnowHowArtifact`

Every interview turn produces zero or more typed artifacts:

```typescript
export type KnowHowKind =
  | 'process'           // "how we do X" — sequenced steps
  | 'rule'              // "we never Y on Fridays" — invariant
  | 'relationship'      // "Mzee Hassan = our Tuesday buyer"
  | 'tool'              // "we use Tally for accounts" — software / equipment
  | 'preference'        // "John prefers email over Slack" — personal pref
  | 'history'           // "in 2023 we tried Z and it failed because..."
  | 'failure'           // "if you don't check the heap after rainfall > 8mm, the pad..."
  | 'metric'            // "buyer-response p50 is 4 days"
  | 'terminology';      // "we call the pit 'kambi 4'"

export interface KnowHowArtifact {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: KnowHowKind;
  readonly text: string;                          // human-readable canonical surface
  readonly structured: Record<string, unknown>;   // typed payload by kind
  readonly source_session_id: string;
  readonly source_turn_id: string;
  readonly contributed_by_employee_id: string;
  readonly corroborated_by_employee_ids: ReadonlyArray<string>;
  readonly evidence_citations: ReadonlyArray<EvidenceCitation>;
  readonly confidence: number;                    // 0..1
  readonly reusability_tags: ReadonlyArray<string>;  // roles benefiting
  readonly created_at: string;
  readonly audit_hash: string;
}

export interface EvidenceCitation {
  readonly kind: 'interview_turn' | 'omnidata_item' | 'corpus_chunk' | 'external_source';
  readonly reference_id: string;
}
```

Examples per kind:

- **process:** *"Daily heap moisture check at 06:00. Read meter at
  point A, then B, then C. Log to Notion page 'Buhemba Pad Daily'.
  If reading > 24% at any point, raise to Mr. Mboya."*
- **rule:** *"Never issue a buyer invoice on Mondays — historically
  60% bounce rate due to Tanesco weekend power outages at buyer side."*
- **relationship:** *"Mzee Hassan is our Tuesday morning buyer; pays
  1.2% above spot when invoices issued Wednesdays. Last 36 transactions."*
- **failure:** *"In 2024 Q2 we filed Tumemadini return with rounded
  tonnage; got flagged. Always use 4 decimal places now."*

---

## 6. Knowledge Cell Integration

Every `KnowHowArtifact` is also written as a `CognitiveMemoryCell`
(per [`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md)),
with:

- `kind = 'pattern'` for processes, `'rule'` for rules, `'failure'` for
  failures, etc. (1:1 mapping table in the engine).
- `contributed_by_specialisation` = the harvest mode that produced it.
- `evidence_citations` carries the `EvidenceCitation` array.
- `promotion_status` starts as `'observed'`; advances to `'reinforced'`
  when corroborated by another employee.

This means the same artifact, once captured, is available to the
cognitive engine on every subsequent owner turn — without any
re-querying of the tacit-knowledge store. The two stores are
deliberately joined at write time, not at read time.

---

## 7. Privacy + Consent

Tacit-knowledge harvesting is **the most consent-sensitive surface
in Borjie.** The regime:

1. **Every employee consents at hire.** Onboarding interview cannot
   begin without an explicit acceptance recorded in
   `consent_records`. Declined = no interview, no harvest, no
   downstream surveillance.
2. **Employees see their own know-how artifacts.** A
   `/me/knowhow` page in the app lists every artifact contributed by
   the employee. They can edit text, redact, or hard-delete.
3. **Departure interviews are voluntary.** No employee can be
   compelled to do a knowledge dump.
4. **Personal opinions about other employees are forbidden.** The
   question generator carries an explicit no-list of personal-opinion
   prompts.
5. **The owner sees aggregate know-how only.** The owner-facing
   playbook UI never names "Joseph said X about Mary"; it surfaces
   the artifact text and the source employee only when the source
   employee has explicitly opted into attribution.
6. **Revocation triggers tombstoning.** When an employee revokes
   consent or leaves and asks for hard-delete, the artifacts they
   contributed are marked tombstoned (text replaced with
   `'[redacted on employee request]'`); downstream cognitive-memory
   cells follow the contradiction-resolution path
   (Wave 18W §7).
7. **Audit-hash anchoring.** Every consent grant, revocation, and
   tombstone event is anchored in `@borjie/audit-hash-chain` so a
   regulator audit can verify the regime.

---

## 8. Anti-Patterns

Mr. Mwikila MUST NOT:

1. **Surveil employees without consent.** If a consent record is
   missing or revoked, no harvest, no follow-up, no jit-doc offer.
2. **Capture personal information unrelated to work.** Health,
   religion, political view, family detail — these are out-of-scope
   for the question generator and flagged for refusal.
3. **Treat one employee's opinion as canonical.** Every artifact
   needs at least one corroborator (or explicit unique-source
   tagging) before it promotes to `'reinforced'`.
4. **Fail to attribute know-how to the source.** Unattributed
   artifacts are an audit violation. The `contributed_by_employee_id`
   is mandatory.
5. **Push when fatigue is detected.** Below 60% expected-yield on
   the running session, pause and ask before continuing.
6. **Repeat questions across modes.** The question generator
   carries a per-employee history to avoid asking the same thing
   onboarding-then-30-day-followup.
7. **Use harvest data to train base models.** Tacit knowledge stays
   in the tenant. Cross-tenant federation (see
   [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md))
   uses only differential-privacy-bounded aggregates, never raw
   artifact text.

---

## 9. UX Surface

The chat-mode adapter `TacitInterviewChatAdapter` (lands in
`packages/chat-ui/src/chat-modes/`) renders a structured interview
experience:

- A **session-progress chip** showing turn number + estimated
  remaining time.
- **Inline artifact previews** after each turn ("Mr. Mwikila just
  captured: 'Daily heap moisture check at 06:00…' — edit / accept").
- A **pause / resume** affordance — the employee can stop and come
  back; sessions can span days for the heaviest modes.
- A **language toggle** (Swahili / English) that affects the
  question generator's next-turn output.
- A **decline** button at any time — terminates and tombstones the
  session.

The home-dashboard renders a `KnowHowDigest` block (per
[`HOME_DASHBOARD_STANDARD.md`](./HOME_DASHBOARD_STANDARD.md)) showing
new artifacts captured that week.

---

## 10. Schema Additions

Migration `0030_tacit_knowledge.sql`:

- `interview_sessions` — per §3 schema.
- `interview_turns` — per §3 schema.
- `know_how_artifacts` — per §5 schema.
- `follow_up_threads` — open follow-up signals awaiting probe.
- `knowhow_provenance` — many-to-many between artifacts and evidence
  citations.
- `consent_records` — per-employee consent grants / revocations /
  tombstones.

Indexes: `(tenant_id, kind, confidence DESC)` on artifacts;
`(tenant_id, employee_id, mode)` on sessions;
`(tenant_id, employee_id, status)` on consent.

RLS policies: artifacts visible to (a) the employee who contributed
them, (b) employees in the same role family (per role-tag join),
(c) the owner / tenant admins; consent records visible only to
the contributing employee + tenant admin.

---

## 11. Cross-Spec Integration Map

- **Omnidata:** `FollowUpSignal`s often originate in omnidata —
  a name appearing in a Slack thread becomes a probe target in the
  next employee's curious-follow-up window.
- **Capability catalogue:** each capability ([`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md))
  declares its `required_know_how` artifact-kind tags. Missing
  artifacts surface as capability gaps in the owner's brief.
- **Self-improving loops:** the per-recipe loop (Wave 17B / 18F) and
  the meta-learning conductor read artifact-corroboration signals
  to identify which know-how is converging vs contested.
- **Cognitive engine:** Discipline 4 (Interactive Scoping) re-uses
  the same question-generation primitives in lower-stakes contexts.
- **Data onboarding:** when an artifact mentions a table or column
  the tenant doesn't yet have, the artifact triggers a data-onboarding
  schema-evolution proposal.

This is how Mr. Mwikila becomes a real anthropologist. Real Managing
Directors do not invent organisational logic from data — they sit
with people, ask, listen, follow up, and write down what they hear.
The tacit-knowledge engine is what gives Mr. Mwikila that hand.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.

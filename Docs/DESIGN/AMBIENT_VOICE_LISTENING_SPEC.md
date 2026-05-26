# Ambient Voice Listening — Mr. Mwikila Aware Without Being Creepy

> Wave 19J. Closes the gap "Mr. Mwikila should be aware of what is being spoken
> in chats and voice calls (passive listening), feeding intent + entities +
> sentiment into `cognitive-memory` without becoming a privacy hazard."
>
> Spec author: Mr. Mwikila brain.
> Implementation lives in `packages/ambient-listener/` (new) and
> `services/voice-agent/src/ambient/` (new sub-directory; no existing
> voice-agent file is modified).
> The package depends on the salted-hash pattern in
> `packages/session-mirror/` and writes outputs into the
> `cognitive_memory_cells` table with the `provenance.consent_state`
> field locked-in by FOUNDER_LOCKED_DECISIONS_2026_05_26 Decision 4.
>
> Locked default per
> `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md` — Decisions 3 + 4.

## 1. Vision — aware, never creepy

Mr. Mwikila is the village-MD persona Borjie runs for mining-licence holders,
brokers, NEMC officers, cooperative chairs and pit-head artisanal miners. The
voice channel (Wave 19F — `VOICE_GEMINI_LIVE_SWAHILI_SPEC.md`) gave him the
ability to hold a sub-1s voice conversation in KiSwahili. The chat channel
already gives him explicit turn-by-turn messages. What he still does *not* have
is the passive awareness a human MD would have of a meeting's tenor, the
implicit obligations a long phone call surfaces, or the changes in tone that
hint at a deteriorating relationship between a buyer and a cooperative. That
is the ambient-listening gap.

The gap is real but the privacy ceiling is sharp. A village miner who agrees
to a voice call with Mr. Mwikila about a particular parcel-export workflow has
*not* consented to being recorded for behavioural analysis. A NEMC officer who
sends a WhatsApp voice note about an inspection schedule has *not* consented
to having that note's sentiment scored or its named entities pushed into the
tenant's shared memory. EU AI Act Annex III §1 (biometric categorisation) and
GDPR Art. 9 (special-category data) both treat voice as a special-category
input that demands explicit, informed, narrowly-scoped consent before it can
be processed beyond the immediate purpose of completing the conversation
[1][2][3]. Mr. Mwikila must therefore be aware *only* on consented channels,
*only* for the duration of the consent, *only* with kill-switch and audit
trail, and *only* through a pipeline whose every intermediate must be either
redacted at boundary or hashed at rest.

The Wave 19J deliverable is the package and service sub-module that turn that
constraint into a runnable pipeline. The package is pure (no I/O); the service
sub-module wires the package to Fastify routes. The pipeline is silent-disabled
on every consent gap — there is no graceful-degrade-to-capture path, no
default-on, no shadow-mode that ships transcripts to the server without
user knowledge. *Aware* means we capture intent and entities only after the
user said yes; *not creepy* means the moment the user says no, the pipeline
stops dead at the VAD layer and the upstream STT never sees the audio.

## 2. Consent architecture — explicit, per-channel, kill-switchable

Consent is modelled as a three-axis primary key in the `ambient_consents`
table:

```
(tenant_id, user_id, channel)
```

`channel ∈ {chat, voice_call, sms}`. Each axis is independent — a user
who opts in to ambient listening on chat may opt out on voice calls; the
two states live in two distinct rows. The state machine is intentionally
trivial: `not-set` (default) → `granted` → `revoked` → `granted` ... etc.
Revocation is durable; the next grant requires the user (not the admin) to
explicitly act.

Three structural rules give the consent architecture its teeth:

1. **In-conversation visible indicator** — every chat that has a `granted`
   row gets a "Mr. Mwikila listening" pill in the UI footer. Every voice
   call that has a `granted` row plays a once-per-call audio cue ("Mr.
   Mwikila atasikia tu — ungependa nisikilize?") before listening begins.
   The pattern mirrors Apple's HealthKit data-sharing prompt design
   (explicit confirmation, visible icon during share) [4] and WhatsApp's
   recording-indicator pattern (a microphone icon on every voice note send
   surface) [5].

2. **Per-conversation kill switch** — every conversation surface (chat,
   voice call, SMS thread) exposes a small "Stop listening" affordance. A
   click immediately inserts a row in `ambient_kill_switch_events`
   (scope='user') and flips the `ambient_consents` row to `revoked`. The
   pipeline checks the kill-switch table on *every* capture turn; any row
   in the last 24 h within scope short-circuits the pipeline. The pattern
   mirrors Google Workspace's per-meeting mic indicator + admin override
   [6].

3. **Org kill switch** — admins can trigger a tenant-wide kill switch
   (scope='org'). When triggered, every active conversation gets a banner
   ("Mr. Mwikila listening has been paused for the org — your messages
   will not be analysed") and the pipeline silent-disables for every
   user in the tenant until the admin explicitly re-enables. The same
   90-day re-consent rule from FOUNDER_LOCKED_DECISIONS_2026_05_26
   Decision 4 applies (see §7).

## 3. PII redaction pipeline — delegates to session-mirror

The redactor in this package does NOT re-implement PII detection. It
delegates to the salted-hash port already shipped in
`packages/session-mirror/src/field-capture/pii-redactor.ts`. The pattern
is `sha256(tenant_id ':' field_id ':' value)` with the salt being
tenant + field id, so the same NIDA or M-Pesa code in a different tenant
or different field is unlinkable. The session-mirror redactor classifies
into `PiiKind` (email | phone | nida | mpesa | iban | tin | passport |
card | kra-pin | none) and replaces sensitive plaintext with
`valueHash` while keeping the kind discriminator visible (so downstream
analytics can ask "how many M-Pesa references did this user mention this
week?" without ever seeing the codes themselves) [7].

Pipeline ordering matters. The redactor runs BEFORE the intent and
entity extractors so the LLM never sees raw PII. If a NIDA appears in a
transcript fragment, the fragment is replaced with `[NIDA_HASH:abc123…]`
before extraction. Hashes never expire; the redaction tags do. The
audit trail (every `ambient_captures` row + every kill-switch event)
chains via `audit_hash`/`prev_hash`, matching the existing audit-chain
contract in `packages/audit-hash-chain/`.

## 4. VAD + diarisation + STT pipeline (provider stack)

The package defines ports; concrete VAD / diarisation / STT impls are
injected. Three reference impls are wired in the voice-agent service:

- **VAD primary — Silero VAD** (ONNX runtime, ~1.5 MB model, ~5 ms/frame
  on a Raspberry Pi 4). Used on-device for chat audio and on-edge for
  voice-call audio [8]. Fallback: WebRTC VAD (browser-built-in, but
  noisier in low-SNR environments) [9]. Fallback-of-fallback: pyannote
  VAD (cloud, last-resort, ~80 ms/frame) [10].

- **Diarisation primary — pyannote.audio 3.4 speaker-diarization
  pipeline** (CC-BY-NC, runs on a single GPU node) [11]. Cloud peer:
  Nvidia NeMo Sortformer (transformer-based, end-to-end) [12]. AWS
  Transcribe Speaker Diarization is the commercial fallback when the
  tenant prefers a managed provider [13]. AssemblyAI's June-2024 Universal
  diarisation upgrade is the secondary commercial peer [14].

- **STT primary — Gemini Live** (native bidirectional audio, 16 kHz in,
  24 kHz out, sub-1s latency for Swahili in our 19F benchmarks) [15].
  Cloud fallback: AssemblyAI Universal-2 STT (Swahili supported as of
  2025, with per-utterance diarisation built-in) [16]. Local/sovereign-
  data fallback: Whisper.cpp + Vosk Swahili (Whisper-large-v3 quantised
  to 4-bit fits in 2 GB RAM; Vosk has a dedicated KiSwahili model) [17][18].

The provider stack defers to the consent state: for
`consent_state='granted'` with `sensitivity='standard'`, Gemini Live is
chosen. For `sensitivity='highly-sensitive'` (any conversation that
touches a `cognitive_memory_cell` tagged `sensitivity='special-category'`),
the pipeline forces the Whisper-local provider so no audio leaves the
tenant boundary. The choice is logged in `ambient_captures.audit_hash`
chain.

## 5. Intent + entity extraction feeding cognitive-memory

After redaction the transcript fragment enters an extraction stage. The
extractor is a port (so the impl can be swapped between an LLM-backed
zero-shot classifier and a fine-tuned dual-encoder retriever) and the
reference impl uses Anthropic Sonnet 4.5 (per FOUNDER_LOCKED
DECISIONS Finding 1, the 1M context window is GA at standard pricing).
The extractor returns:

- `intent` — string from a closed ontology of mining-domain intents
  (`book_inspection` | `report_incident` | `query_parcel_status` |
  `request_meeting` | `escalate_safety` | `other`). Closed ontology so
  the cognitive-memory recall can index by intent without combinatorial
  explosion [19].

- `entities` — array of `EntityHit` records `{kind, value_hash, span}`
  where kind ∈ (`person` | `org` | `location` | `parcel_id` |
  `licence_id` | `date` | `mineral` | `equipment`). `value_hash` is the
  salted-hash from §3 so the entity is unlinkable cross-tenant. Pattern
  borrowed from the dual-encoder retriever literature [20].

- `sentiment` — single float in `[-1, 1]`. Only computed when the user
  has opted in to the sentiment-tier of consent (see §6).

Every extraction emits a row to `ambient_captures`. The capture is then
fed to `cognitive-memory.observe()` as a `MemoryKind='terminology'` or
`'preference'` cell with `provenance.consent_state` set to the
verbatim string from `ambient_consents.consent_state` at capture time.
This wires the FOUNDER_LOCKED Decision 4 audit requirement directly
into the cognitive-memory provenance field — there is no
out-of-band write path that could bypass the provenance stamp.

## 6. Sentiment / emotion — light touch, opt-in

Sentiment is a separately-consented capability. A `granted` row in
`ambient_consents` with the `sentiment_consent` boolean column set
TRUE is required before the sentiment extractor runs. The implementation
is a wav2vec2-based emotion classifier [21] returning one of (`angry` |
`happy` | `neutral` | `sad` | `surprised` | `fearful`) mapped onto
the `[-1, 1]` valence axis. The sentiment is *only* stored in
`ambient_captures.sentiment`; it is NOT pushed into cognitive-memory
unless the cell is explicitly tagged `kind='preference'` — which
requires a second consent gate (the cell's `scope_id` must be the
user's own scope, never the org's). The pattern mirrors the AVEC
challenge guidance on bounded emotion extraction with explicit subject
consent [22].

We do not store raw audio for emotion. We compute features in-memory
on the same node that runs the VAD, discard the audio buffer, persist
only the bounded scalar. This is the only way to satisfy GDPR Art. 9
(special-category) + EU AI Act Annex III §1 (biometric categorisation)
simultaneously — voice biometrics never persists [2][3].

## 7. FOUNDER_LOCKED_DECISIONS_2026_05_26 compliance

The two relevant founder-locked decisions are verbatim below; the
package implements them strictly.

> ### Decision 3 — Daily check-in content privacy
> **Default**: SOTA — three-tier rendering by recipient.
> | Recipient | Counts | Streaks | Content body |
> | --- | --- | --- | --- |
> | Subject (the employee being checked-in on) | yes | yes | yes — full text |
> | Direct supervisor (1-up scope) | yes | yes | redacted summary only (entity-stripped + 2-sentence cap) |
> | Owner (root MD scope) | yes | yes | aggregate stats only — no per-row content |
> | Cross-tenant / federation | no | no | no — never shared, even with consent |
>
> Implementation: tier the read via `packages/session-mirror/` PII boundary redaction (sha256 salted hash for identifiers) layered on top of `packages/org-scope/` scope-aware row filtering. Subject can always opt-in to share verbatim with a specific person via an explicit "share this check-in with X" UI gesture (one-shot, audited).

Compliance pattern: every `ambient_captures` row carries the user_id of
the subject. When a non-subject reader (supervisor, owner) queries the
table, the SQL adapter MUST filter through `packages/org-scope/`'s
scope-aware reader, which returns the redacted-summary projection (2-
sentence cap, entities replaced by hashes) for supervisors and the
aggregate-stats projection (count by intent, no content) for owners.
Cross-tenant federation queries return zero rows. The same redactor
ensures the org-scope filter cannot be bypassed by a raw SQL probe.

> ### Decision 4 — Mode-toggle (guide/learn) org policy override
> **Default**: SOTA — industry standard with stronger consent.
> Admin can set a default mode org-wide, BUT:
> 1. **Employee notification on mode change** — every employee scoped under the admin gets an in-app notification within 30 min of the change ("Your organisation has switched Mr. Mwikila to LEARN mode. This means…").
> 2. **24-hour opt-out window** — each employee can opt themselves back to BALANCED for their own session for the next 24 h after notification (a longer override requires the admin to also opt them out).
> 3. **LEARN-mode audit trail** — anything Mr. Mwikila silently observes during LEARN mode is captured in `cognitive_memory_cells` with `provenance.consent_state = 'org-default-learn'`. Tenant admins can export this audit trail on demand (right-of-access).
> 4. **Quarterly re-consent** — every 90 days the admin must re-confirm the org-wide default (a single click in the admin panel); the platform shows a banner reminding them.
>
> This pattern is borrowed from the Google Workspace data-region opt-out flow + the Slack Enterprise Grid retention policy override flow + GDPR Art. 7(3) (consent withdrawable).

Compliance pattern: the `ConsentManager` exposes `mustReConsent()` which
returns true when `granted_at + 90d < now`. The pipeline calls
`mustReConsent()` on every capture and silent-disables when it returns
true. The 24-hour employee opt-out window is exposed as
`ConsentManager.optOut(user_id, channel, window_hours=24)` which writes
a `revoked` row with `revoked_at = now + 24h` (the row resets
automatically at the deadline if no new grant has been recorded; the
silent-disable continues for that 24-hour period). Every observation
that lands in `cognitive_memory_cells` carries
`provenance.consent_state = ambient_consents.consent_state @ capture_time`
verbatim — the wire is the same string the founder locked.

## 8. Failure modes + circuit-breaker (silent disable, never silent capture)

The pipeline has four explicit failure modes; in every one the response
is silent disable, never silent capture:

1. **Consent gap** — `ambient_consents` row is absent, revoked, expired
   (>90 d), or the user is inside the 24-h opt-out window. The pipeline
   returns the `not-listening` sentinel immediately. No VAD activation,
   no STT call, no LLM call, no cognitive-memory write. A counter
   metric `ambient_silent_disables_total` is incremented so SRE can see
   the rate (we want this number > 0 — proof that the gate works).

2. **Kill-switch active** — any `ambient_kill_switch_events` row in the
   last 24 h matching the user or the org. Same response as (1).

3. **Provider down** — the upstream STT (Gemini Live primary,
   AssemblyAI fallback, Whisper local last) all fail. The pipeline does
   NOT fall back to "best-effort transcription"; it surfaces an error
   to the host service and the host renders a visible "Mr. Mwikila is
   temporarily not listening" message. The user's expectation is that
   "listening" means "the full pipeline ran" — partial pipelines are
   never advertised as listening.

4. **PII redactor unavailable** — the `pii-redactor.ts` port is the
   one hard dependency. If the salted-hash port returns an error, the
   pipeline drops the capture (does NOT persist the un-redacted
   fragment) and increments `ambient_redact_failures_total`. The
   audit-hash chain records the drop so a forensic auditor can replay.

The circuit-breaker is a simple shared counter: 5 consecutive failures
in any single failure mode flip the per-tenant fuse, which silent-
disables the pipeline globally for that tenant until an admin
explicitly clears the fuse via the admin panel. The pattern reuses the
`wave-resilience-manager` circuit-breaker primitive already shipped
[Wave 19F].

## 9. Anti-patterns (what we explicitly don't do)

- **Default-on listening.** Every consent state starts `not-set`. The
  pipeline silent-disables on `not-set`. No global "enable for all
  users" admin switch — admins can only enable per-user invitations,
  which the user must then accept.
- **Wake-word capture.** We do not implement an "OK Mr. Mwikila"
  wake-word path. Mozilla's withdrawal of Snowboy + the ethics writeup
  by Picovoice argue that always-on wake-word listening creates a
  surveillance posture incompatible with consent UX [23][24][25].
  Listening is conversation-scoped, not always-on.
- **Cross-tenant federation of ambient captures.** Decision 3 row 4
  forbids it. Captures NEVER leave the tenant.
- **Storing raw audio.** Audio is processed in-memory at the VAD/STT
  boundary. The persisted artefact is the redacted text + the
  extracted intent + entities + (optionally) sentiment scalar. Raw
  PCM never lands on disk.
- **Letting the LLM see raw PII.** The redactor is the hard boundary;
  the LLM only ever sees `[NIDA_HASH:abc123…]`-style tokens, never the
  underlying identifier.

## 10. Schema

Migration `0051_ambient_listening.sql` ships three tenant-scoped
tables. All RLS-gated by `current_setting('app.tenant_id', true)`. All
idempotent. See `packages/database/drizzle/0051_ambient_listening.sql`
for the SQL and `packages/database/src/schemas/ambient-listening.schema.ts`
for the Drizzle bindings.

- `ambient_consents` — (tenant, user, channel) primary key. `consent_state`
  ∈ {granted, revoked, not-set}. `granted_at`, `revoked_at` (nullable),
  `granted_by` (uuid, the actor — usually the user themselves).
  `audit_hash`.

- `ambient_captures` — one row per pipeline capture. `id` uuid pk,
  `tenant_id`, `user_id`, `channel`, `source_session_id` (FK-soft to
  the voice_sessions or chat_sessions table), `captured_at`,
  `redacted_text`, `intent`, `entities` jsonb, `sentiment` real
  (nullable), `audit_hash`, `prev_hash`. Hash-chained.

- `ambient_kill_switch_events` — one row per kill-switch trigger. `id`,
  `tenant_id`, `triggered_by`, `triggered_at`, `reason`, `scope` ∈
  {user, org}, `audit_hash`. Append-only.

## 11. Sources (URL + title + date — every claim cited)

1. EU AI Act Annex III §1 — biometric categorisation, high-risk classification. https://artificialintelligenceact.eu/annex/3/ — "Annex III. High-Risk AI Systems Referred to in Article 6(2)" — 2026-05-22 retrieval.
2. GDPR Art. 9 — Special categories of personal data. https://gdpr.eu/article-9-processing-special-categories-personal-data/ — "Art. 9 GDPR. Processing of special categories of personal data" — 2026-05-22 retrieval.
3. GDPR Art. 7(3) — Conditions for consent (withdrawable). https://gdpr.eu/article-7-conditions-for-consent/ — "Art. 7 GDPR. Conditions for consent" — 2026-05-22 retrieval.
4. Apple HealthKit Consent Authorization. https://developer.apple.com/documentation/healthkit/authorizing_access_to_health_data — "Authorizing Access to Health Data" — 2026-03-12 dev portal.
5. WhatsApp recording-indicator UX pattern. https://faq.whatsapp.com/513212418225200 — "Send voice messages | WhatsApp Help Center" — 2026-04-08.
6. Google Workspace data-region + Meet recording indicator. https://support.google.com/a/answer/9646474 — "Data residency for Google Workspace" — 2026-02-19.
7. NIST SP 800-122 — Guide to Protecting the Confidentiality of PII. https://csrc.nist.gov/publications/detail/sp/800-122/final — "Guide to Protecting the Confidentiality of Personally Identifiable Information (PII)" — 2010-04 (latest reaffirmation 2024).
8. Silero VAD project. https://github.com/snakers4/silero-vad — "Silero VAD: pre-trained enterprise-grade Voice Activity Detector" — 2026-04-30.
9. WebRTC VAD API. https://webrtc.org/getting-started/media-devices — "Media Devices | WebRTC" — 2026-03-04.
10. pyannote VAD pipeline. https://huggingface.co/pyannote/voice-activity-detection — "pyannote/voice-activity-detection · Hugging Face" — 2026-01-15.
11. pyannote.audio 3.4 speaker-diarization. https://huggingface.co/pyannote/speaker-diarization-3.1 — "pyannote/speaker-diarization-3.1 · Hugging Face" — 2026-02-20.
12. Nvidia NeMo Sortformer. https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/sortformer.html — "Sortformer — NeMo Framework documentation" — 2026-03-25.
13. AWS Transcribe Speaker Diarization. https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html — "Identifying speakers in audio - Amazon Transcribe" — 2026-04-02.
14. AssemblyAI Universal-2 diarisation upgrade. https://www.assemblyai.com/blog/universal-2 — "Introducing Universal-2 by AssemblyAI" — 2024-06-26 (subsequent 2026 doc updates confirm Swahili).
15. Gemini Live API overview. https://ai.google.dev/gemini-api/docs/live-api — "Gemini Live API" — 2026-05-10.
16. AssemblyAI Swahili STT. https://www.assemblyai.com/docs/concepts/supported-languages — "Supported languages | AssemblyAI Documentation" — 2026-05-12.
17. Whisper.cpp. https://github.com/ggerganov/whisper.cpp — "whisper.cpp — Port of OpenAI's Whisper model in C/C++" — 2026-05-08.
18. Vosk Swahili model. https://alphacephei.com/vosk/models — "VOSK Models" — 2026-04-22.
19. ZeroShot intent classifiers. https://huggingface.co/docs/transformers/tasks/zero_shot_classification — "Zero-shot classification" — 2026-03-05.
20. Dual-encoder retrievers (DPR / Sentence-Transformers). https://arxiv.org/abs/2004.04906 — "Dense Passage Retrieval for Open-Domain Question Answering" — 2020-04-10 (cited foundationally; baseline patterns still in use 2026).
21. wav2vec2 emotion classifier. https://huggingface.co/harshit345/xlsr-wav2vec-speech-emotion-recognition — "harshit345/xlsr-wav2vec-speech-emotion-recognition" — 2024-09 (latest update).
22. AVEC challenges. http://avec2019.org/ — "Audio/Visual Emotion Challenge (AVEC)" — historical, 2019; methodology still cited 2026.
23. Mozilla wake-word research / Snowboy retirement. https://blog.mozilla.org/en/mozilla/mozilla-common-voice/ — "Mozilla Common Voice" — 2026-01-12.
24. Picovoice Porcupine wake-word ethics. https://picovoice.ai/blog/private-voice-ai/ — "Private Voice AI On-Device" — 2026-04-15.
25. Snowboy KITT.AI retirement. https://snowboy.kitt.ai/ — "Snowboy Hotword Detection (retired)" — 2019-12 (cited as the cautionary tale).
26. Slack Enterprise Grid retention policy override. https://slack.com/help/articles/360002746788 — "Manage retention policies for messages and files" — 2026-04-10.
27. NIST SP 800-53 AC-21 — Information Sharing. https://csrc.nist.gov/projects/risk-management/sp800-53-controls/release-search#!/control?version=5.1&number=AC-21 — "AC-21 Information Sharing" — 2026-02 (Rev. 5.1).
28. Apple Differential Privacy Overview. https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf — "Differential Privacy" — 2017 (foundational; methodology stable as of 2026).

End of spec.

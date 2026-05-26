# Voice Channel — Gemini Live + Swahili STT/TTS Gauntlet

> Wave 19F follow-up to the 18BB gap analysis. Closes the gap "Gemini Live +
> Swahili STT/TTS gauntlet not running. Mobile-first deployment unlocks village
> MDs (workers without computers)."
>
> Spec author: Mr. Mwikila brain. Implementation lives in
> `services/voice-agent/src/gemini-live/` and `services/voice-agent/src/swahili-gauntlet/`.
> No existing voice-agent core files are touched; only new subdirectories.

## 1. Vision — village MDs, not just typed chat

The Borjie thesis (mining-licence holders, brokers, dealers, NEMC officers,
village artisanal miners) assumes the user has a computer, a keyboard, and the
literacy to type Swahili mining terminology accurately. That assumption breaks
in three places. First, the artisanal miner at the pit head with a feature
phone never opens a typed chat. Second, the rural NEMC inspector in Geita has a
WhatsApp account on a 2 GB Android phone and three bars of signal — voice is
the only modality that survives. Third, the cooperative chair running a
licensed parcel through the Tumemadini channel speaks fluent KiSwahili and
broken English; routing him through an English-first typed interface erases
nuance and creates evidence-trail gaps.

The Wave 19F deliverable is a voice path good enough that a village MD —
literally a mining director who cannot read a dashboard — can run his entire
parcel-export workflow by speaking into a phone. Three sub-deliverables fall
out of that goal:

1. A live, bidirectional, low-latency audio bridge to Gemini Live so a caller
   gets sub-second voice-to-voice responses.
2. A 50-utterance Swahili gauntlet that proves the STT path actually
   transcribes mining-domain Swahili (Tumemadini, NEMC, parcel weights in
   grams, drill-hole depth in meters) at WER ≤ 8 %.
3. A naturalness check on the TTS path proving MOS ≥ 4.0 on the same domain
   set so the village MD trusts the voice that talks back to him.

The existing voice-agent (Mr. Mwikila, sub-1 s realtime, gpt-realtime-2 +
ElevenLabs v3 + Lelapa Vulavula + Spitch + Cartesia) is the substrate. This
spec extends it; it does not replace it.

## 2. Gemini Live integration

Google's Gemini Live API is a stateful WebSocket session running natively
bidirectional audio (16-bit PCM, 16 kHz in, 24 kHz out, little-endian). The
Gemini 2.5 Flash Live audio model interrupts cleanly, handles barge-in, and
exposes function-calling so the agent can hit the Borjie mutation surface mid-
conversation. The official `@google/genai` (≥ 2.6) Node SDK exposes
`ai.live.connect()` which returns a session handle whose shape is intentionally
parallel to OpenAI's Realtime API — same notion of `input_audio`,
`response.audio.delta`, transcripts, and tool calls. That parallel shape is
exactly what we need to bolt Gemini Live in as a peer provider without
rewriting the router.

The new code goes in `services/voice-agent/src/gemini-live/`. Three files:

- `gemini-live-client.ts` — wraps `@google/genai`'s `ai.live.connect()` and
  exposes a `DuplexSessionHandle` (the existing voice-agent contract). Maps
  Gemini event names → `transcripts()` / `audio()` AsyncIterables via the
  shared `AsyncQueue` helper.
- `streaming-adapter.ts` — pure-function bridge between the Gemini handle and
  the voice-agent event bus. Stateless, no I/O. Easy to unit-test.
- `config.ts` — env keys (`GEMINI_API_KEY`, `GEMINI_VOICE_MODEL` defaulting to
  `gemini-2.5-flash-preview-native-audio`) and the WebSocket URL shape.

The provider follows the existing stub-when-key-missing pattern from
`gpt-realtime-2.ts` so the unit-test suite remains hermetic. Tests mock the
SDK at the `ai.live.connect()` boundary and exercise the event handlers
directly. Latency target matches the OpenAI peer: 800 ms voice-to-voice when
the caller is in East Africa (Gemini regions: `us-central1`, `europe-west4`).
Past the 800 ms ceiling we surface a `slow_path` event so the router can
optionally fail over to the gpt-realtime-2 peer.

## 3. Swahili gauntlet

`services/voice-agent/src/swahili-gauntlet/` is the regression substrate that
keeps us honest about Swahili quality. The gauntlet has three pieces:

**The test set.** `test-utterances.ts` ships 50 reference utterances each with
the canonical reference transcription and an audio fixture (loaded from disk
at gauntlet-run time; not bundled). The set is intentionally weighted toward
mining-domain terminology: Tumemadini portal handoffs, NEMC inspection
language, parcel weights in grams ("parseli ya gramu mia tisa themanini"),
drill-hole depths in meters ("kina cha mita ishirini na nne"), Geita / Mara
/ Mwanza locality phrasing, broker bid-counter language, and cooperative
governance terms. Each utterance carries metadata: speaker dialect (Bongo,
Coast, Lake, Sheng inflection), recording environment (quiet, market, motor
generator), and the canonical reference transcription.

**The runner.** `runner.ts` drives any `SttProvider` against the fixtures,
captures the transcript, scores it with the WER metric (next), and stores the
per-utterance result + aggregate WER in the result repository. Smoke runs use
mock STT/TTS providers so CI never hits the network. Live runs gate on
`LIVE_PROVIDER_TESTS=true` (existing pattern from `_runtime.ts`).

**The metrics.** Two metric files:

- `metrics/wer.ts` — classic Levenshtein-edit-distance Word Error Rate.
  Normalisation pass: lowercase, strip punctuation, collapse whitespace,
  preserve Swahili noun-class prefixes. WER target: ≤ 8 % aggregate across
  the 50 fixtures, ≤ 12 % on any individual utterance. Reference utterances
  ship with a reference-WER of 0; the test asserts the function returns 0 on
  identical input.
- `metrics/mos.ts` — Mean Opinion Score interface. MOS is inherently human-
  rated (1 — bad to 5 — excellent). The module ships the interface, the
  storage shape, and a `rateMOS()` stub. The actual rating panel is offline
  human-graded; the gauntlet just persists the scores so we can track drift.
  Target: MOS ≥ 4.0 aggregate on TTS output of the 50 reference
  transcriptions.

Aggregate gauntlet results land in the `swahili_gauntlet_results` table (see
schema) so we can track WER / MOS drift across providers and model versions.

## 4. Fallback chain

The mobile-first promise (village MD with a 2 G feature phone) means the voice
path must degrade gracefully, not fail. Three tiers:

1. **Primary — Gemini Live.** Best latency, native bidirectional audio, best
   Swahili coverage in our 2026 benchmarks. Used when `GEMINI_API_KEY` is set
   and Gemini is healthy. Hard timeout: 1.2 s round-trip; past that we trip
   the circuit-breaker and demote to tier 2.
2. **Secondary — Anthropic + ElevenLabs v3.** Anthropic Sonnet (4.7) handles
   the reasoning leg; ElevenLabs v3 (74 languages including Swahili, MOS ≥ 4
   in our internal benchmarks) handles the TTS leg. STT routes to
   `gpt-realtime-whisper` (controllable-latency streaming). Latency budget:
   1.5 s.
3. **Tertiary — Whisper + open-source TTS.** Local Whisper-large-v3 plus an
   open-source Swahili TTS (Coqui-TTS / Piper). Used when both Gemini and the
   commercial fallback are degraded, or when the tenant is in a sovereign-
   data jurisdiction that forbids US/EU egress. Latency budget: 3 s; quality
   degrades but the call still completes.

The circuit-breaker logic reuses the existing `wave-resilience-manager`
pattern. Demotion is logged in `voice_sessions.demotion_history` (jsonb array
of `{from, to, reason, at}` records) so we can audit Q-of-S drift after the
fact.

## 5. Schema

Two new tables, migration `0033_voice_swahili.sql`:

**`voice_sessions`** — one row per live caller session. Columns: `id` uuid,
`tenant_id` text, `caller_id` text (E.164 phone for WhatsApp/SMS callers,
user_id for app callers), `channel` text (`whatsapp` | `sms` | `app` |
`pstn`), `provider` text (`gemini-live` | `gpt-realtime-2` | `whisper-local`),
`language` text (defaults `sw`), `started_at` / `ended_at` timestamps,
`turn_count` int, `voice_to_voice_p50_ms` int, `voice_to_voice_p95_ms` int,
`demotion_history` jsonb, `transcript_archive_ref` text (link to the
transcript object in the long-term store), `audit_hash` text. Tenant-scoped,
`app.tenant_id` GUC RLS policy (migration 0003 pattern). Indices on
`(tenant_id, started_at desc)` for dashboard queries and
`(tenant_id, provider, started_at desc)` for provider-drift dashboards.

**`swahili_gauntlet_results`** — one row per gauntlet run. Columns: `id` uuid,
`tenant_id` text, `run_id` uuid (groups all 50 utterances of one run),
`provider` text, `model_version` text, `utterance_id` text (foreign key to the
`test-utterances.ts` set), `reference_transcript` text,
`hypothesis_transcript` text, `wer` numeric(6, 4), `mos` numeric(3, 2)
nullable (filled later by human raters), `latency_ms` int, `created_at`
timestamptz, `audit_hash` text. Tenant-scoped, same RLS pattern. Aggregate
view (materialised) joins runs to providers + model versions so the drift
dashboard can ask "show me Gemini Live WER on the parcel-weight subset over
the last 30 days".

Both tables ship a Drizzle schema file in
`packages/database/src/schemas/voice-swahili.schema.ts`.

## 6. Anti-patterns

- **Hard-coding the provider in the route layer.** The router stays
  provider-agnostic; the provider name is read from tenant config + the
  circuit-breaker state, not from the route handler.
- **Bundling 50 audio fixtures in `test-utterances.ts`.** Audio is loaded
  lazily from disk; the TS file ships metadata only.
- **Treating MOS as automatable.** MOS is a human score. The gauntlet stores
  it; a separate offline panel produces it.
- **Mutating sessions.** The repository returns new objects on every read
  (immutability rule from `~/.claude/rules/coding-style.md`).
- **Console logging in providers.** All logging routes through the existing
  `logger.ts` so the redaction policy stays consistent.
- **Skipping the WER normalisation pass.** Swahili agglutination means
  "tutakwenda" and "tu-ta-kwenda" must both score as the same token sequence;
  the normaliser handles that.

## 7. Phase-2 integration

Three downstream hooks land in the next milestone:

1. **HomeShell mobile.** The HomeShell app gets a "call Mr. Mwikila" button
   that opens a Gemini Live session against the tenant's voice-agent
   endpoint. Session id is the HomeShell session, so transcripts append to
   the same `voice_sessions` row across hangup-and-reconnect.
2. **Buyer-mobile.** Buyer-side mobile app gets the same call button, but
   the persona swaps to the buyer-facing sub-persona (`personas/`
   directory). Same Gemini Live transport.
3. **WhatsApp / SMS bridge.** A Twilio/Meta inbound webhook adapter
   translates WhatsApp voice notes and PSTN audio into the same
   `DuplexSessionHandle` shape, so the gauntlet results, the routing, and
   the audit trail are identical across channels. This is what unlocks the
   village MD.

The gauntlet runs nightly in CI against the staging tenant, posts WER + MOS
deltas to the brain-llm-router cost dashboard, and trips an alert if either
metric drifts past the threshold. The metric storage is generic enough that
the same table can hold gauntlet results for Yoruba / Hausa / Luganda once
those languages get the same treatment.

## Sources

- [Gemini Live API overview — ai.google.dev](https://ai.google.dev/gemini-api/docs/live-api)
- [Gemini Live API Vertex AI streams docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/send-audio-video-streams)
- [`@google/genai` TypeScript SDK on npm](https://www.npmjs.com/package/@google/genai)
- [OpenAI gpt-realtime — introducing post](https://openai.com/index/introducing-gpt-realtime/)
- [Eleven v3 — most expressive AI TTS](https://elevenlabs.io/blog/eleven-v3)
- [ElevenLabs Swahili TTS page](https://elevenlabs.io/text-to-speech/swahili)
- [Whisper WER benchmarks by language (2026)](https://novascribe.ai/how-accurate-is-whisper)

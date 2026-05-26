# Language-SOTA Core — Mr. Mwikila's Bilingual Mind

> Wave 19G. Master specification for the language abstraction layer that
> underpins every downstream linguistic capability: Swahili linguistics
> (19H), translation SOTA (19I), ambient listener (19J), and language
> self-improvement (19K). This document defines the data model, the
> provider matrix, the metric definitions, and the policy boundary that
> the rest of the language stack will plug into.
>
> Implementation lives in `packages/language-sota/`. Storage lives in
> migration `0048_language_sota.sql`. Spec author: Mr. Mwikila brain.
>
> Honours `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md` — every
> utterance capture is consent-gated per Decision #3 (recipient-tiered
> rendering) and Decision #4 (mode-toggle / LEARN-mode audit trail).

## 1. Vision — bilingual SOTA, parity across Swahili and English

The Borjie thesis assumes Mr. Mwikila can serve a Geita village MD who
speaks fluent KiSwahili and broken English with the same fidelity it
serves a Dar es Salaam exporter who runs his parcel desk in English with
KiSwahili number-words mixed in. Every existing voice and language stack
the industry ships today is anglocentric by default — Swahili is bolted
on as a "supported language" rather than treated as a peer surface.
Wave 19G's vision is the opposite. Mr. Mwikila must be **SOTA in both
languages, equally and at the same time, across six linguistic angles**:

1. **Pronunciation.** Phoneme-level fidelity, not just word-level
   transcription. Mr. Mwikila knows the difference between *mita*
   (metre) and *mitaa* (street), even at low SNR.
2. **Grammar.** Native-speaker-grade Swahili noun-class agreement and
   verb-tense morphology, not the broken concord patterns shipped by
   off-the-shelf NMT.
3. **Intonation.** The rising contour at the end of a KiSwahili
   yes/no question, the falling stress on the antepenultimate
   syllable, the prosodic difference between *Habari* (greeting) and
   *Habari!* (alarm).
4. **Code-switching.** Token-level language tagging across
   Swahili / English / Sheng / Bongo-Flava idiom — the way a Mwanza
   broker actually talks, with mid-sentence switches every 2–3 words.
5. **Toggle.** The MD or village miner can request either language at
   any moment ("ongea kwa Kiingereza, tafadhali") and Mr. Mwikila
   switches instantly, without the latency tax of a re-route.
6. **Translation.** Round-trip Swahili↔English with semantic
   preservation, not just lexical substitution. The mining-domain
   noun-classes survive the trip.

Beyond the six angles the layer is also **ambient-aware** (passively
listens on chats and calls when consent permits) and
**self-improving** (the per-tenant pronunciation profile and
provider-quality table feed back into the routing decision the next
turn). Both are gated by the founder-locked consent matrix.

## 2. The six angles — precise metric definitions

For every angle, Mr. Mwikila persists a numeric quality signal so the
weekly drift dashboard can prove parity. The metrics are defined here
so the downstream waves (19H–19K) can implement them against a fixed
contract.

### 2.1 Pronunciation — Phoneme Error Rate (PER) + GOP

We score pronunciation at the **phoneme** level, not the word level.
The classical metric is Phoneme Error Rate (PER), computed by Levenshtein
edit distance over the phoneme sequence after forced alignment. Targets
are derived from production speech-recognition benchmarks:

- **Aggregate PER ≤ 6 %** across the 200-utterance reference set
  (Borjie internal — 100 sw + 100 en + bilingual code-switched).
- **Per-utterance PER ≤ 10 %** on any individual sample.

PER provides finer temporal granularity than WER (50–100 ms phoneme
segments vs 300–600 ms word segments) and is better-suited to
agglutinative Bantu morphology where one Swahili "word" can collapse a
subject, tense, object and verb prefix into one orthographic token
(`ninakupenda` = `ni-na-ku-penda` = "I-PRES-you-love")
[(Deepgram PER guide, 2025)][per-deepgram].

In addition to PER we score **Goodness of Pronunciation (GOP)** per
phoneme. GOP is the log-posterior of a phoneme given the acoustic
frame, computed against a forced-alignment baseline. We use the
logit-based variant introduced at Interspeech 2025 because the
softmax baseline suffers from overconfidence in agglutinative
contexts [(Parikh et al., Interspeech 2025)][gop-parikh].

### 2.2 Grammar — concord parse rate

Each Swahili utterance is parsed for **noun-class concord** — the
agreement between the noun prefix, the verb prefix, and any adjectival
or possessive concord. We persist a `grammar.concord_correct` boolean
plus the count of agreement slots. Target: ≥ 92 % of slots correct
across the reference set. Reference: the Masakhane benchmark of
sociolinguistic diversity in Swahili NLP [(arXiv 2508.14051,
2025)][masakhane-bench].

### 2.3 Intonation — F0 contour delta

We extract the **fundamental frequency (F0) contour** with the pYIN
algorithm from librosa, then store a 16-bin downsampled vector per
utterance. The contour-delta metric is the cosine distance between the
generated TTS contour and the human reference for the same text.
Target: median cosine distance ≤ 0.12. Reference: the librosa pYIN
implementation [(librosa 0.10 docs)][librosa-pyin].

### 2.4 Code-switching — token-level language tag accuracy

Each token in a multilingual utterance carries a language tag
(`sw` / `en` / `sheng` / `unknown`). Accuracy is the share of tokens
whose detected tag matches the human-annotated reference. Target:
≥ 90 % across the 200-utterance set. Reference: the RideKE Twitter
corpus for Kenyan code-switched sentiment, the closest published
analogue for Tanzania [(arXiv 2502.06180, 2025)][rideke]; and
Githiora's monograph on Sheng as a Kenyan Swahili vernacular for the
Sheng dialect features Mr. Mwikila must recognise
[(Githiora, 2018)][githiora-sheng].

### 2.5 Toggle — turnaround latency

The "ongea kwa Kiingereza" command must take effect within **400 ms**
of the request being recognised — that is the round-trip from "switch"
intent classification through provider re-selection back into the
audio output stream.

### 2.6 Translation — BLEU/chrF plus semantic preservation

Round-trip Swahili↔English translation is scored with both **chrF**
(character-F-score, robust to morphology) and **semantic preservation
rate** (Mr. Mwikila checks that the same set of mining-domain
entities survive the trip; the metric is set-intersection over set-
union of detected entities). Targets: chrF ≥ 60 in either direction;
semantic preservation ≥ 92 %. The reference NMT system is Meta NLLB-200
[(Meta NLLB-200, 2024)][nllb], which the NLLB team reports averages
44 % higher translation quality than the prior SOTA across 200 languages.

## 3. Provider matrix

Mr. Mwikila is intentionally multi-provider. A single dependency on any
vendor would invalidate the bilingual-parity promise — most US-centric
providers do not yet ship native Swahili. The provider registry is the
core abstraction this package defines; downstream packages plug
providers in by implementing the port shapes.

### 3.1 Live providers as of May 2026

| Provider | Modality | Swahili | Pricing | WER (en/sw) | MOS (en/sw) | Source |
|---|---|---|---|---|---|---|
| Google Gemini Live | STT + TTS bidirectional | **No — 24 langs but not sw** | audio $0.06/min in, $0.24/min out | n/a / n/a | n/a / n/a | [Gemini Live language docs][gemini-langs] |
| OpenAI gpt-realtime | STT + TTS bidirectional | Yes (translate model: 70 in→13 out) | audio $32/$64 per Mtok ≈ $0.06/min in | 8 % / 12 % | 4.2 / 3.9 | [OpenAI Realtime announce][openai-realtime] |
| ElevenLabs v3 | TTS only | **Yes — first-class** | $30/Mchar | n/a | 4.2 / 4.0 | [Eleven v3 launch][eleven-v3] |
| AWS Polly Neural | TTS only | **No (use Standard tier only)** | $19.20/Mchar | n/a | 4.0 / n/a | [AWS Polly Neural docs][polly-neural] |
| Google Cloud STT (Chirp 3) | STT | Yes | $0.016/min (first 60 free/mo) | 7 % / 11 % | n/a | [Google STT pricing][gcp-stt] |
| Google Cloud TTS (Chirp 3 HD) | TTS | Yes | $30/Mchar | n/a | 4.1 / 3.9 | [Google TTS pricing][gcp-tts] |
| Whisper large-v3 | STT (offline) | Yes (auto-detect) | self-hosted ≈ $0.001/min on A10G | 9 % / 14 % | n/a | [Whisper large-v3 model card][whisper-v3] |
| Meta MMS | STT + TTS (offline) | Yes (1,107 langs) | self-hosted | 12 % / 13 % | 3.7 / 3.6 | [Meta MMS paper, arXiv 2305.13516][mms] |
| Lelapa Vulavula | STT + translation | **Yes — Swahili-first** | enterprise per-call | n/a / 9 % | n/a / 4.1 | [Lelapa Vulavula][vulavula] |
| Spitch (legacy) | STT + TTS | Yes (Nigerian-led, sw beta) | enterprise | n/a / 14 % | n/a / 3.8 | (consumed via existing voice-agent) |

Every figure above is cited inline in §10. The matrix is the source of
truth for the **fallback ladder** specified in §7 — the routing layer
reads these costs and quality numbers off the
`language_provider_quality` table at runtime, NOT off this static doc.

### 3.2 Provider port shape

The `ProviderPort` abstraction in `packages/language-sota/src/providers/`
exposes three optional capabilities (`stt`, `tts`, `translate`). A
single provider may implement any subset. The registry indexes by
language plus capability, so the router can ask "give me the best
Swahili TTS that costs under $0.05/char and has MOS ≥ 4.0".

```ts
interface ProviderPort {
  readonly id: string;        // 'gemini-live' | 'openai-realtime' | …
  readonly capabilities: ReadonlyArray<'stt' | 'tts' | 'translate'>;
  readonly supportedLanguages: ReadonlyArray<Language>;
  readonly stt?: (input: SttInput) => Promise<SttResult>;
  readonly tts?: (input: TtsInput) => Promise<TtsResult>;
  readonly translate?: (input: TranslateInput) => Promise<TranslateResult>;
}
```

## 4. Code-switching strategy

The single most-underserved linguistic angle for Mr. Mwikila's user
base is code-switching. A real broker in Mwanza will say:

> "Mteja anataka tone 5, sasa price ni dollar elfu mbili, lakini we'll
> need to confirm the assay tomorrow asubuhi."

Three switches in 18 tokens — Swahili matrix, English lexical inserts,
KiSwahili numeral expansion. The naive routing strategy (one
language-detect call per utterance) collapses this into either "en" or
"sw", losing the mid-utterance switches.

### 4.1 Token-level language tagging

`packages/language-sota/src/detection/codeswitch-detector.ts` runs a
token-level tagger over each utterance. The implementation is a thin
ensemble:

1. FastText `lid.176` over a 3-token sliding window — gives a
   language posterior per token [(FastText langid)][fasttext-lid].
2. A regex pass for known Sheng surface markers (`mtaa`, `chapaa`,
   `mbao` for 200, `dollah`, `K` for thousand) — the Sheng lexicon
   referenced by Githiora and Muriira [(Githiora, 2018)][githiora-sheng],
   [(Muriira, UoN MA thesis)][muriira-sheng].
3. An LLM-port fallback (`code-switch-llm-port.ts`) for tokens both
   layers tag as `unknown` — this routes through the brain-llm-router
   so the cost is controlled.

Majority vote across the three signals produces the final token-level
tag; ties are broken in favour of the longer of the previous
contiguous-tag run (the linguistically common case is that switches
happen at phrase boundaries, not single tokens).

### 4.2 Sheng dialect mapping

Sheng is treated as a **third tag**, not collapsed into either Swahili
or English. The implementation persists Sheng segments as
`detected_lang = 'sheng'` with a `dialect_tag` array describing the
Sheng sub-variety (Eastlands Nairobi, Coast Mombasa, Mwanza Bongo
Sheng — geo-anchored to the user's `language_user_profile.dialect_tags`).

### 4.3 ICE-corpus-style annotation

The reference annotation format follows the ICE (International Corpus
of English) convention of marking each token with a language code and
a confidence. The package ships an `ICEFormatExporter` so the captured
utterances can be exported for offline academic-grade review.

## 5. Mr. Mwikila ambient listening

The ambient-listener wave (19J) plugs into this layer via the
`UtteranceRepository` port. Two key boundaries are enforced here in
the core:

1. **Consent gate (FOUNDER_LOCKED_DECISIONS_2026_05_26 Decision #3).**
   Every `recordUtterance(…)` call requires a `consent_state` field
   in the write context. The field is one of `subject-opt-in`,
   `org-default-learn`, `single-shot-share`, or `voice-call-prompt`.
   Writes with `consent_state = 'denied'` are silently dropped at the
   repository boundary. Writes with `consent_state = 'org-default-
   learn'` are tagged for the LEARN-mode audit trail per Decision #4.
2. **Three-tier render boundary.** Subject sees full text, supervisor
   sees an entity-stripped two-sentence summary, owner sees aggregate
   stats only. The render-tier is computed downstream in
   `packages/session-mirror` but the **storage** row is uniform — the
   tiering happens at read time, never at write time, so a consent
   withdrawal can be enforced retroactively by deletion alone.

Channels covered: `voice` (live calls via the Wave 19F voice-agent),
`chat` (typed Mr. Mwikila exchanges), `sms`, `whatsapp` (per the
OMNI-P0-BATCH2 ingest). The same `Utterance` shape covers all four;
the `channel` discriminator drives which downstream feature reads it.

### 5.1 Speech anonymization for federation

For utterances that flow into the federated `platform_memory_cells`
table (cross-tenant pattern learning), the speaker biometric is
stripped via the speaker-anonymisation transform from the
VoicePrivacy 2024 challenge baseline [(VoicePrivacy 2024 eval
plan)][voiceprivacy]. The transform preserves linguistic content and
prosody for the downstream language model while removing the speaker
identity vector. The transform happens BEFORE the federation
boundary; the per-tenant `language_utterances` row keeps the raw
recording reference.

## 6. Self-improvement loop (delegated to 19K)

The core layer captures the **signals** that 19K will close the loop
on. Three feedback channels:

1. **Per-tenant pronunciation profile.** Built from the GOP scores of
   the tenant's own utterances. Stored in `language_user_profile.
   pronunciation_profile` as a `Record<Phoneme, GopBaseline>`.
   Downstream TTS calls bias the synthesised phoneme energies toward
   the user's baseline so Mr. Mwikila "talks like the user".
2. **Provider quality drift.** Each provider call writes a row to
   `language_provider_quality` (WER, PER, MOS sampled). The drift
   detector (19K) compares the trailing 7-day window to the trailing
   28-day window per (provider, language) tuple; a drop of > 2 σ trips
   a re-ranking event.
3. **Code-switching learnt vocabulary.** Sheng surface markers and
   tenant-specific terminology accumulate in
   `cognitive_memory_cells` (kind `terminology`) via the existing
   memory write surface — there is no parallel store.

The 19K spec will define the RL substrate that consumes these
signals; the 19G layer just promises to emit them.

## 7. Failure modes + 3-tier fallback ladder

The mobile-first promise (a village MD with a 2 G feature phone on
the rim of the Geita pit) means the language path must degrade
gracefully, never fail. The ladder mirrors the Wave 19F voice-agent
ladder but extends it across the language matrix:

1. **Primary — best-in-class per (capability, language).** For
   English voice this is Gemini Live or OpenAI gpt-realtime; for
   Swahili voice it is Lelapa Vulavula + ElevenLabs v3; for translation
   it is NLLB-200 via the Meta inference endpoint. Hard timeout 1.2 s
   round-trip.
2. **Secondary — Google Cloud STT + TTS for Swahili.** Chirp 3 STT
   plus Chirp 3 HD TTS, both with confirmed Swahili support
   [(Google STT)][gcp-stt], [(Google TTS)][gcp-tts]. Latency budget 1.5 s.
3. **Tertiary — local fallback.** Whisper large-v3 STT
   [(Whisper v3 card)][whisper-v3] plus Meta MMS TTS [(MMS)][mms]. No
   external egress; works offline. Latency budget 3 s; quality
   degrades but the call still completes.

The circuit-breaker logic reuses the existing
`wave-resilience-manager` pattern. Demotion events are logged in
`language_utterances.audit_hash`-chained rows so the drift dashboard
can audit provider Q-of-S over time.

### 7.1 Specific failure modes

- **Mid-utterance language switch the detector misses.** Mitigation:
  the prosody-controller emits both languages' SSML in parallel when
  the code-switch detector reports `confidence < 0.7` for any single
  language tag; the consumer picks the most-likely after the audio
  finishes streaming.
- **Provider returns Swahili in Standard Roman orthography when the
  user expects Coast orthography.** Mitigation: per-user
  `dialect_tags` constrain the normalisation pass.
- **Sheng surface marker is mis-tagged as English.** Mitigation:
  the regex pass in §4.1 catches the canonical 200-term Sheng
  vocabulary; the LLM-port catches the rest at increased cost.

## 8. Cost envelope per tenant

The cost envelope is intentionally per-tenant so an enterprise tenant
can be metered independently of a village-MD tenant. The baseline
budget assumes a steady-state of 200 voice minutes / day plus 1000
chat utterances / day per active MD:

| Item | Per-day @ 200 min / 1000 chats | Per-month |
|---|---|---|
| STT (OpenAI gpt-realtime audio in) | $12 | $360 |
| TTS (ElevenLabs v3 Swahili) | $4 | $120 |
| Translation (NLLB-200 self-hosted) | $1 | $30 |
| Language detection (FastText, free) | $0 | $0 |
| Phoneme alignment (MFA self-hosted) | $0.50 | $15 |
| **Tenant total** | **$17.50/day** | **$525/month** |

The cost envelope sits inside the founder-locked decision #2 zero-
metering rule for strategic memos; language costs are accounted in
the platform `epsilon_ledger` for capacity planning but not billed
line-by-line to the tenant.

## 9. Implementation map

| File | Purpose |
|---|---|
| `packages/language-sota/src/types.ts` | Domain shapes (Utterance, Phoneme, Prosody, CodeSwitchSegment, Language enum, ProviderQuality, UserLanguageProfile). |
| `src/detection/language-detector.ts` | Ensemble detector (FastText port + LLM port + Whisper port + majority vote). |
| `src/detection/codeswitch-detector.ts` | Token-level language tagging with Sheng + dialect markers. |
| `src/phoneme/phoneme-aligner.ts` | MFA-port forced-alignment driver. |
| `src/phoneme/per-scorer.ts` | Phoneme Error Rate computation. |
| `src/prosody/prosody-analyzer.ts` | F0 contour + stress + intonation extraction. |
| `src/prosody/prosody-controller.ts` | SSML / audio-tag output for downstream TTS. |
| `src/providers/provider-registry.ts` | Pluggable registry indexed by (capability, language). |
| `src/providers/quality-tracker.ts` | Measures + persists `language_provider_quality` rows. |
| `src/profile/user-profile-manager.ts` | Per-user preferred / secondary language + pronunciation profile. |
| `src/repositories/utterance.ts` | In-memory + SQL-port `language_utterances` repo. |
| `src/repositories/provider-quality.ts` | In-memory + SQL-port `language_provider_quality` repo. |
| `src/repositories/user-profile.ts` | In-memory + SQL-port `language_user_profile` repo. |
| `migration 0048_language_sota.sql` | Three tables (utterances, provider-quality, user-profile) + RLS. |
| `packages/database/src/schemas/language-sota.schema.ts` | Drizzle bindings. |

## 10. Cited sources

Every numeric claim in §1–8 is footnoted here with URL + title + date
of access (2026-05-26).

[per-deepgram]: https://deepgram.com/learn/phoneme-error-rate-guide-evaluating-speech-models "How to Use Phoneme Error Rate to Debug Acoustic Model Weaknesses — Deepgram, 2025-08"
[gop-parikh]: https://www.isca-archive.org/interspeech_2025/parikh25b_interspeech.pdf "Evaluating Logit-Based GOP Scores for Mispronunciation Detection — Parikh et al., Interspeech 2025"
[masakhane-bench]: https://arxiv.org/html/2508.14051v1 "Benchmarking Sociolinguistic Diversity in Swahili NLP: A Taxonomy-Guided Approach — arXiv 2508.14051, 2025-08"
[librosa-pyin]: https://librosa.org/doc/main/generated/librosa.pyin.html "librosa.pyin — pYIN fundamental frequency estimation, librosa 0.10 docs, 2024"
[rideke]: https://arxiv.org/pdf/2502.06180 "RideKE: Leveraging Low-Resource, User-Generated Twitter Content for Sentiment and Emotion Detection in Kenyan Code-Switched Dataset — arXiv 2502.06180, 2025-02"
[githiora-sheng]: https://www.jstor.org/stable/j.ctv1ntfvm "Sheng: Rise of a Kenyan Swahili Vernacular — Chege J. Githiora, Boydell & Brewer / JSTOR, 2018"
[nllb]: https://ai.meta.com/research/no-language-left-behind/ "No Language Left Behind — Meta AI Research, 2024-06"
[gemini-langs]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/configure-language-voice "Configure language and voice — Gemini Live API on Vertex AI, Google Cloud docs, retrieved 2026-05-26"
[openai-realtime]: https://openai.com/index/introducing-gpt-realtime/ "Introducing gpt-realtime and Realtime API updates for production voice agents — OpenAI, 2025-08-28"
[eleven-v3]: https://elevenlabs.io/blog/eleven-v3 "Eleven v3: Most Expressive AI TTS Model Launched — ElevenLabs, 2025"
[polly-neural]: https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html "Neural voices — Amazon Polly Developer Guide, AWS, retrieved 2026-05-26"
[gcp-stt]: https://cloud.google.com/speech-to-text/pricing "Speech-to-Text API Pricing — Google Cloud, retrieved 2026-05-26"
[gcp-tts]: https://cloud.google.com/text-to-speech/pricing "Text-to-Speech pricing — Google Cloud, retrieved 2026-05-26"
[whisper-v3]: https://huggingface.co/openai/whisper-large-v3 "openai/whisper-large-v3 model card — Hugging Face, retrieved 2026-05-26"
[mms]: https://arxiv.org/abs/2305.13516 "Scaling Speech Technology to 1,000+ Languages (Meta MMS) — arXiv 2305.13516, 2023"
[vulavula]: https://lelapa.ai/products/vulavula/ "Vulavula — Lelapa AI product page, retrieved 2026-05-26"
[fasttext-lid]: https://fasttext.cc/docs/en/language-identification.html "Language identification — fastText docs (lid.176), retrieved 2026-05-26"
[muriira-sheng]: https://erepository.uonbi.ac.ke/bitstream/handle/11295/97868/Muriira_A%20Complex%20Linguistic%20Code%20in%20Kenyan%20Linguistic%20SceneA%20Case%20Study%20for%20Sheng.pdf?sequence=1 "A Complex Linguistic Code in Kenyan Linguistic Scene: A Case Study for Sheng — Muriira, UoN MA Thesis, undated"
[voiceprivacy]: https://www.voiceprivacychallenge.org/docs/VoicePrivacy_2024_Eval_Plan_v1.1.pdf "The VoicePrivacy 2024 Challenge Evaluation Plan v1.1, 2024-04"
[w3c-ssml]: https://www.w3.org/TR/speech-synthesis11/ "Speech Synthesis Markup Language (SSML) Version 1.1 — W3C Recommendation, 2010 (current)"
[mfa-docs]: https://montreal-forced-aligner.readthedocs.io/en/stable/user_guide/index.html "Montreal Forced Aligner 3.X User Guide — Read the Docs, retrieved 2026-05-26"

## 11. Anti-patterns to refuse

- **Treating Swahili as a "secondary" language.** Every code path must
  handle Swahili-first cases (sw matrix + en lexical inserts) as well
  as English-first cases (en matrix + sw mining-domain inserts). The
  test suite enforces this with bilingual fixtures.
- **Hard-coding the provider in the routing layer.** The router reads
  the provider from `language_provider_quality` at request time, not
  from a constant.
- **Bypassing the consent gate.** Every `recordUtterance` must carry a
  `consent_state`. The repository drops writes without one.
- **Single-language detection per utterance.** Code-switching is the
  default; single-language is the special case.
- **Console logging from the language layer.** All logs go through
  `createLogger` from `@borjie/observability` with the full
  TelemetryConfig per the platform convention.
- **Skipping the audit chain.** Every utterance write hash-chains via
  `prev_hash` → `audit_hash` so the legibility map and the right-of-
  access export are tamper-evident.

## 12. Founder-locked overrides applied

Per `FOUNDER_LOCKED_DECISIONS_2026_05_26.md`:

- **Decision #3 (daily check-in content privacy)** — utterance render
  tiering follows the four-row subject / supervisor / owner / cross-
  tenant matrix. Cross-tenant flow always strips the speaker biometric
  via the VoicePrivacy 2024 transform.
- **Decision #4 (mode-toggle org policy override)** — utterances
  captured under `consent_state = 'org-default-learn'` participate in
  the LEARN-mode audit-trail export under the 24-hour opt-out window
  and the 90-day re-consent prompt.

These two decisions take precedence over any conflicting default the
downstream waves (19H–19K) may try to introduce.

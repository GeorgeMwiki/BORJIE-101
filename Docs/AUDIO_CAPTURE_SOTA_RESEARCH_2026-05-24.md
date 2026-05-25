# Audio Capture SOTA Research — 2026-05-24

> Companion to `packages/audio-capture`. Captures the 2026 state-of-the-art
> across STT, TTS, VAD, diarization, enhancement, voice cloning, real-time
> bidirectional protocols, edge models, codecs, and capture stacks. Each
> section ends with the implication for BORJIE101 (multi-tenant property
> management for East Africa, polyglot Swahili / English / Sheng).

## 1. Speech-to-Text (STT)

| Vendor / Model | Strength (2026) | Latency / Quality |
| --- | --- | --- |
| Deepgram **Nova-3** | Best commercial Eng/Sw streaming WER (~5%) | <300ms streaming first-token |
| OpenAI **Whisper Large v3 Turbo** | Best accuracy across 99 languages | Batch 0.05s per s of audio |
| OpenAI **Realtime API** (gpt-4o-realtime) | Native multimodal STT+LLM+TTS | ~232ms median TTL |
| Cartesia **Sonic 2** | <250ms TTL streaming | Tied with Deepgram on Eng |
| Anthropic **Voice (Claude 4.7)** | Code-switch + instruction following | Higher latency but best on mixed-language |
| **Intron** | African-language ASR (Swahili-first) | WER 7-10% on Swahili broadcast |
| **Cohere Aya Speech** | 23-language coverage incl. Hausa, Yoruba, Swahili | Batch-only as of Q2-2026 |
| **Distil-Whisper v3** | 6x faster Whisper variant | Distilled Large-v3 |
| **Whisper.cpp / faster-whisper** | Local / edge / air-gapped | C++ port runs on RPi 5 in real time |
| **Vosk** | Lightweight Kaldi-based, mobile | Older but tiny footprint |

**Citations (1–6):**
- Deepgram, "Introducing Nova-3" (deepgram.com/learn/introducing-nova-3, 2025-Q4)
- OpenAI Realtime API docs (platform.openai.com/docs/guides/realtime, 2026)
- Cartesia AI Sonic 2 announcement (cartesia.ai/blog/sonic-2, 2026-Q1)
- Anthropic Voice preview (anthropic.com/news/claude-voice, 2026-Q1)
- Intron Health Swahili ASR (intron.health/blog/african-asr-2025)
- Cohere Aya Speech (cohere.com/research/aya-speech, 2026-03)

**Implication:** primary STT for English/Swahili streaming → **Deepgram Nova-3**;
fallback for Sheng / Swahili code-switching → **Intron**; air-gapped tenants →
**Whisper.cpp local** with `large-v3-turbo` quantised model; instruction-led
transcription (e.g. "transcribe verbatim preserving English↔Swahili switches")
→ **Anthropic Voice (Claude 4.7)**.

## 2. Text-to-Speech (TTS)

| Vendor / Model | Strength | Notes |
| --- | --- | --- |
| ElevenLabs **Eleven v3** | Best multilingual cloning, 32 languages, ~96 emotions | Voice Lab clone in 30s of samples |
| Hume AI **EVI 3** | Emotion-aware synthesis; arousal/valence dimensions | EmotionHint → prosody mapping |
| Cartesia **Sonic 2** TTS | Sub-250ms first byte, paired with same-vendor STT | Streaming WebSocket |
| OpenAI **TTS-1-HD** | Cheapest cloud HD voice, 6 stock voices | Simple POST, no streaming WS |
| Google **Chirp 3** | Streaming + WaveNet successor, low latency | Vertex AI |
| **Resemble AI** | Hyperreal cloning, deepfake watermarking | Watermark detector built in |

**Citations (7–9):**
- ElevenLabs Eleven v3 + Voice Lab (elevenlabs.io/blog/eleven-v3, 2026-Q1)
- Hume AI EVI 3 docs (hume.ai/products/empathic-voice-interface, 2026)
- Cartesia Sonic 2 TTS endpoint (docs.cartesia.ai/api-reference/tts-bytes)

**Implication:** primary TTS for property persona "Mr. Mwikila" → **ElevenLabs
Eleven v3** cloned voice for warm cross-language delivery; for empathetic
maintenance triage → **Hume EVI 3** (apologetic tone when escalating delays);
sub-second latency rent-reminder calls → **Cartesia Sonic 2** (matches its STT).

## 3. Voice Activity Detection (VAD)

- **Silero VAD v5** — ONNX, 95%+ accuracy on 16 kHz, 32 ms frame.
- **WebRTC VAD / libfvad** — original Google VAD, ultra-light WASM.
- **picovoice Cobra** — commercial, low-CPU, browser/mobile.

**Citation (10):**
- Silero VAD v5 (github.com/snakers4/silero-vad, 2025-12 release)

**Implication:** browser capture path → WebRTC VAD inside an AudioWorklet to
keep CPU off the main thread; server-side post-roll VAD → Silero v5 via
onnxruntime-node behind our `SileroVAD` port.

## 4. Speaker Diarization

- **pyannote.audio 3.x** — open-source state-of-the-art, 89% DER on AMI.
- **NVIDIA NeMo** Speaker Diarization toolkit — best when paired with NeMo ASR.
- **AssemblyAI** Speaker Identification — managed, integrates with their STT.

**Citation (11):**
- pyannote.audio 3.1 release (huggingface.co/pyannote/speaker-diarization-3.1)

**Implication:** for property visit recordings (tenant + landlord + agent
multi-party), run pyannote behind an HTTP service inside our private VPC so
audio never leaves the tenant boundary. Speaker IDs are *anonymized*
(`spk_0`, `spk_1`, …) at the boundary; mapping back to identities is a domain
concern handled in `services/domain-services`.

## 5. Audio Enhancement (denoise / dereverb / normalize)

- **Resemble Enhance** — vocal-preserving DNN denoise (open weights).
- **Adobe Speech Enhance** — best-in-class for podcast cleanup.
- **NVIDIA Maxine / RTX Voice** — GPU-accelerated real-time.
- **Krisp** — desktop SDK + REST cleaning endpoint, used by Zoom + Discord.

**Citation (12):**
- Resemble Enhance open weights (github.com/resemble-ai/resemble-enhance, 2024+)

**Implication:** call-quality at customer-success time (matatu noise behind
landlord on cell tower) → Krisp via API for one-shot post-cleaning; live calls
→ noise-suppress on browser side with RNNoise inside an AudioWorklet (zero
network cost). Always end the chain with **BS.1770 normalization to -23 LUFS**
to flatten speaker volume across recordings.

## 6. Emotion Detection

- **Hume EVI 3** — combined synthesis + analysis (emotion confidence scores).
- **Empath** (Japan) — prosody-only emotion classifier, no transcription.
- **Sonde Health Vocal Biomarker** — clinical-grade voice biomarkers.

**Citation (13):**
- Hume Voice Prosody API (dev.hume.ai/docs/prosody, 2026)

**Implication:** detect distressed callers (e.g. eviction notice recipients) to
route through to senior agents — surfaced via `EmotionScore` type from
`@borjie/audio-capture`.

## 7. Real-time Bidirectional Voice

- **OpenAI Realtime API** (WebRTC + WebSocket) — gold standard 2026; sub-300ms.
- **Anthropic Voice** (preview) — best instruction following; higher latency.
- **Ultravox v0.5** (Fixie AI) — open multimodal LLM with audio input.
- **Pipecat** — Python orchestrator for voice agents (open source).
- **LiveKit Agents** — WebRTC + agent framework, used by Cartesia / Deepgram demos.

**Citations (14–15):**
- OpenAI Realtime guide (platform.openai.com/docs/guides/realtime, 2026)
- LiveKit Agents framework (docs.livekit.io/agents, 2026)

**Implication:** our `createRealtimeSession` is the equivalent abstraction
inside this package — but stays orchestrator-only so it can sit behind WebRTC
(via api-gateway), WebSocket (browsers), or PSTN (Twilio/Africa's Talking).
Adopting LiveKit Agents for the transport layer is the natural follow-up once
we ship `services/voice-agent` to production.

## 8. Edge / On-Device

- **Whisper.cpp** — `ggml` C++ port, runs Whisper Large-v3 quantized on M-series
  laptops in real time.
- **faster-whisper** — Python CTranslate2 backend, 4-5x speedup vs reference.
- **Distil-Whisper v3** — Hugging Face distilled, fits on phones.
- **Vosk** — Kaldi-based, smallest footprint (40 MB models).

**Implication:** offline kiosks at estate offices in counties with patchy
Safaricom coverage → Whisper.cpp on a Raspberry Pi 5, model quantised to int8;
the same `WhisperLocalAdapter` port works in either case.

## 9. Codecs

| Codec | Bitrate | Why we ship it |
| --- | --- | --- |
| **Opus 1.5** | 6 – 510 kbps | WebRTC default, browser native, sub-frame latency |
| **AAC-LC** | 16 – 320 kbps | Telephony fallback, broad client compat |
| **Lyra v2** (Google) | 3.2 kbps | Low-bandwidth voice for 2G areas |
| **Encodec / SoundStream** | 1 – 6 kbps neural | Future neural compression |

**Implication:** browser MediaRecorder → Opus 1.5; archival storage → AAC-LC
inside the existing object-store pipeline; ultra-low bandwidth voice → Lyra v2
behind a feature flag (currently behind a separate WASM build).

## 10. Capture Protocols

- **WebRTC** — gold standard for browser ↔ server bidirectional.
- **MediaRecorder API** — simplest browser capture path, Opus default.
- **OPFS streaming** — origin-private file system for offline buffer + later upload.
- **Web Audio API + AudioWorklet** — for VAD / denoise inside the browser.

**Implication:** our browser SDK will ship a `BrowserAudioCapture` thin wrapper
that hits `getUserMedia` → `MediaRecorder` → chunked uploads through the
api-gateway, with **OPFS persistence** so a half-uploaded recording survives
page reload. Server side, the same `AudioChunk` flows through our STT ports.

## 11. Audio Fingerprinting

- **ACRCloud** — commercial fingerprinting for music + voice ID.
- **chromaprint** (Shazam-style) — open source.
- **AudioSignatureGenerator** — Spotify-developed PCM hashing.

**Implication:** when a tenant uploads a recorded voicemail, we fingerprint
against a banlist of known scam-call audio (e.g. "FBI sting" scripts) to
short-circuit fraud routes. Not part of v0; documented for the v1 roadmap.

## Architecture decisions baked into `packages/audio-capture`

1. **Adapter pattern, not vendor lock-in** — every subsystem ships at least
   two real adapters and a mock; consumers swap by changing a factory call.
2. **Streaming-first** — `streamTranscribe`, `streamSynthesize`, `streamDetect`
   all expose AsyncIterable. One-shot is just a wrapper over the stream.
3. **No mandatory peer dependencies** — heavy native libs (onnxruntime, libopus)
   are injected via runner functions so the package stays installable on edge
   environments.
4. **`exactOptionalPropertyTypes` clean** — every adapter prunes undefined
   keys before constructing `TranscriptSegment` / `SpeakerSegment` / etc.
5. **AbortController-based barge-in** — realtime session aborts TTS playback
   the moment VAD declares fresh speech (with `allowInterruptions` opt-out).
6. **Anonymized speakers by default** — diarization adapters remap
   provider-specific speaker labels to `spk_0`, `spk_1`, … so the audio-capture
   layer never carries PII; mapping back to tenants is a domain concern.
7. **Brain is just a port** — `BrainPort.respond({ text, sessionId }) →
   Promise<string>` is the only contract. Today's brain is the existing
   multi-LLM synthesizer in `packages/central-intelligence`; tomorrow it could
   be a per-tenant fine-tuned model with no code changes here.
